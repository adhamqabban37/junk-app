import 'reflect-metadata';
import 'dotenv/config';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { DataSource } from 'typeorm';
import { AiAnalysisService } from '../src/ai/ai-analysis.service';
import { GeminiRequestError, GeminiService } from '../src/ai/gemini.service';
import { PartsService } from '../src/parts/parts.service';
import { LocalFileStorage } from '../src/storage/local-file-storage';
import { ENTITIES } from '../src/database/entities.list';
import {
  AiAnalysis,
  AiAnalysisStatus,
} from '../src/database/entities/ai-analysis.entity';
import { Part, PartStatus } from '../src/database/entities/part.entity';
import { PartImage } from '../src/database/entities/part-image.entity';
import { PartTaxonomy } from '../src/database/entities/part-taxonomy.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { Vehicle, CrushStatus } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';

const MODEL_VERSION = 'gemini-2.0-flash';

class FakeGeminiService {
  response: {
    grade: 'A' | 'B' | 'C';
    damage_codes: string[];
    confidence: number;
  } | null = {
    grade: 'A',
    damage_codes: ['scratch'],
    confidence: 0.9,
  };
  error: Error | null = null;
  calls = 0;

  analyzePartImage() {
    this.calls += 1;
    if (this.error) return Promise.reject(this.error);
    return Promise.resolve(this.response);
  }
}

describe('AiAnalysisService (e2e)', () => {
  let dataSource: DataSource;
  let storageRoot: string;
  let storage: LocalFileStorage;
  let fakeGemini: FakeGeminiService;
  let service: AiAnalysisService;

  let tenant: Tenant;
  let taxonomy: PartTaxonomy;
  let vehicle: Vehicle;
  let part: Part;
  let partImage: PartImage;

  beforeAll(async () => {
    dataSource = new DataSource({
      type: 'postgres',
      url:
        process.env.DATABASE_URL ??
        'postgres://junkyard_app:junkyard_app_dev@localhost:5432/junkyard_dev',
      entities: ENTITIES,
      synchronize: false,
    });
    await dataSource.initialize();

    storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'junkyard-ai-test-'));
    storage = new LocalFileStorage(
      new ConfigService({ UPLOAD_DIR: storageRoot }),
    );
  });

  afterAll(async () => {
    await fs.rm(storageRoot, { recursive: true, force: true });
    await dataSource.destroy();
  });

  beforeEach(async () => {
    fakeGemini = new FakeGeminiService();
    service = new AiAnalysisService(
      dataSource,
      fakeGemini as unknown as GeminiService,
      storage,
      // Only analyzeVehicle() (not exercised by this file -- see
      // vehicle-analysis.e2e-spec.ts for that) touches partsService, so an
      // empty stub is enough to satisfy the constructor here.
      {} as PartsService,
      new ConfigService({ GEMINI_MODEL: MODEL_VERSION }),
    );

    const tenantRepo = dataSource.getRepository(Tenant);
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: `AI Test Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: `Alternator ${randomUUID()}`,
        category: 'Electrical',
        isQuickPick: false,
      }),
    );

    vehicle = await withTenantContext(dataSource, tenant.id, (manager) =>
      manager.getRepository(Vehicle).save(
        manager.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: 'AITESTVIN1234567',
          crushStatus: CrushStatus.ACTIVE,
        }),
      ),
    );
    part = await withTenantContext(dataSource, tenant.id, (manager) =>
      manager.getRepository(Part).save(
        manager.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.PENDING_AI,
        }),
      ),
    );
    const relativePath = await storage.save(
      `${tenant.id}/${part.id}/photo.jpg`,
      Buffer.from('fake-jpeg-bytes'),
    );
    partImage = await withTenantContext(dataSource, tenant.id, (manager) =>
      manager.getRepository(PartImage).save(
        manager.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: part.id,
          url: relativePath,
          qualityFlags: { blurry: false, tooDark: false },
        }),
      ),
    );
  });

  afterEach(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await dataSource.getRepository(PartTaxonomy).delete({ id: taxonomy.id });
  });

  it('writes a COMPLETE AiAnalysis and flips the Part to pending_review on success', async () => {
    await service.analyzePartImage(tenant.id, partImage.id);

    const analysis = await withTenantContext(dataSource, tenant.id, (manager) =>
      manager
        .getRepository(AiAnalysis)
        .findOne({ where: { partImageId: partImage.id } }),
    );
    expect(analysis).toMatchObject({
      status: AiAnalysisStatus.COMPLETE,
      grade: 'A',
      damageCodes: ['scratch'],
      partId: part.id,
    });
    expect(Number(analysis?.confidence)).toBeCloseTo(0.9);

    const updatedPart = await withTenantContext(
      dataSource,
      tenant.id,
      (manager) =>
        manager.getRepository(Part).findOneOrFail({ where: { id: part.id } }),
    );
    expect(updatedPart.status).toBe(PartStatus.PENDING_REVIEW);
  });

  it('retrying after a successful analysis is idempotent: no duplicate row, and Gemini is not called again', async () => {
    await service.analyzePartImage(tenant.id, partImage.id);
    expect(fakeGemini.calls).toBe(1);

    await service.analyzePartImage(tenant.id, partImage.id);
    expect(fakeGemini.calls).toBe(1); // not called a second time -- already COMPLETE

    const rows = await withTenantContext(dataSource, tenant.id, (manager) =>
      manager
        .getRepository(AiAnalysis)
        .find({ where: { partImageId: partImage.id } }),
    );
    expect(rows).toHaveLength(1);
  });

  it('a Gemini failure (malformed response) propagates and does not write any AiAnalysis row', async () => {
    fakeGemini.error = new GeminiRequestError(
      'Gemini response did not match the expected schema',
    );

    await expect(
      service.analyzePartImage(tenant.id, partImage.id),
    ).rejects.toThrow(GeminiRequestError);

    const rows = await withTenantContext(dataSource, tenant.id, (manager) =>
      manager
        .getRepository(AiAnalysis)
        .find({ where: { partImageId: partImage.id } }),
    );
    expect(rows).toHaveLength(0);

    const stillPart = await withTenantContext(
      dataSource,
      tenant.id,
      (manager) =>
        manager.getRepository(Part).findOneOrFail({ where: { id: part.id } }),
    );
    expect(stillPart.status).toBe(PartStatus.PENDING_AI);
  });

  it('handleExhaustedRetries records a FAILED analysis and flips the Part to needs_manual_grading', async () => {
    await service.handleExhaustedRetries(tenant.id, partImage.id);

    const analysis = await withTenantContext(dataSource, tenant.id, (manager) =>
      manager
        .getRepository(AiAnalysis)
        .findOne({ where: { partImageId: partImage.id } }),
    );
    expect(analysis).toMatchObject({
      status: AiAnalysisStatus.FAILED,
      grade: null,
    });

    const updatedPart = await withTenantContext(
      dataSource,
      tenant.id,
      (manager) =>
        manager.getRepository(Part).findOneOrFail({ where: { id: part.id } }),
    );
    expect(updatedPart.status).toBe(PartStatus.NEEDS_MANUAL_GRADING);
  });

  it('handleExhaustedRetries after analyzePartImage already succeeded does not clobber the COMPLETE analysis', async () => {
    await service.analyzePartImage(tenant.id, partImage.id);
    // A late-arriving stale "exhausted" event racing behind a since-succeeded
    // retry must not downgrade a good result back to failed.
    await service.handleExhaustedRetries(tenant.id, partImage.id);

    const rows = await withTenantContext(dataSource, tenant.id, (manager) =>
      manager
        .getRepository(AiAnalysis)
        .find({ where: { partImageId: partImage.id } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe(AiAnalysisStatus.COMPLETE);
  });
});
