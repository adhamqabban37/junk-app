import 'reflect-metadata';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { GeminiService } from '../src/ai/gemini.service';
import {
  AiAnalysis,
  AiAnalysisStatus,
} from '../src/database/entities/ai-analysis.entity';
import { Part, PartStatus } from '../src/database/entities/part.entity';
import { PartImage } from '../src/database/entities/part-image.entity';
import { PartTaxonomy } from '../src/database/entities/part-taxonomy.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { VehicleImage } from '../src/database/entities/vehicle-image.entity';
import { Vehicle } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { closeTestApp } from './close-test-app';

/**
 * The one endpoint the whole "photos to inventory" product thesis runs
 * through — see docs/PROGRESS.md. Posts a real multipart request matching
 * frontend/src/lib/offline/sync.ts's buildIntakeFormData() exactly, so a
 * field-name mismatch between the two sides would actually fail here.
 */
async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 8000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

describe('Vehicles intake (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let uploadDir: string;
  let fakeGemini: { analyzePartImage: jest.Mock };

  let tenant: Tenant;
  let worker: User;
  let taxonomy: PartTaxonomy;
  const WORKER_PIN = '4821';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'junkyard-intake-test-'),
    );
    process.env.UPLOAD_DIR = uploadDir;

    fakeGemini = {
      analyzePartImage: jest.fn().mockResolvedValue({
        grade: 'B',
        damage_codes: ['dent'],
        confidence: 0.75,
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GeminiService)
      .useValue(fakeGemini)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);

    const tenantRepo = dataSource.getRepository(Tenant);
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: `Intake Test Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: 'Alternator',
        category: 'Engine',
        isQuickPick: false,
      }),
    );

    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Intake Test Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await dataSource.getRepository(PartTaxonomy).delete({ id: taxonomy.id });
    await closeTestApp(app);
    await fs.rm(uploadDir, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  });

  async function loginWorker(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  function buildRequest(
    token: string,
    draftId: string,
    partId: string,
    vin: string,
  ) {
    return request(app.getHttpServer())
      .post('/vehicles/intake')
      .set('Authorization', `Bearer ${token}`)
      .field('draftId', draftId)
      .field('vin', vin)
      .field('vinEntryMethod', 'scanned')
      .field(
        'decoded',
        JSON.stringify({
          make: 'Honda',
          model: 'Civic',
          year: 2008,
          trim: 'EX',
          raw: { Make: 'HONDA' },
        }),
      )
      .field(
        'parts',
        JSON.stringify([
          {
            id: partId,
            taxonomyId: taxonomy.id,
            taxonomyName: taxonomy.name,
            photoIds: ['photo-1'],
          },
        ]),
      )
      .attach(
        `exteriorPhoto:front:ext-1`,
        Buffer.from('fake-exterior-jpeg'),
        'ext-1.jpg',
      )
      .attach(
        `partPhoto:${partId}:photo-1`,
        Buffer.from('fake-part-jpeg'),
        'photo-1.jpg',
      );
  }

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post('/vehicles/intake')
      .field('draftId', 'draft-unauth')
      .expect(401);
  });

  it('rejects a request with no draftId', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .post('/vehicles/intake')
      .set('Authorization', `Bearer ${token}`)
      .field('vin', 'INTAKETESTVIN1234')
      .expect(400);
  });

  it('rejects a request with no vin', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .post('/vehicles/intake')
      .set('Authorization', `Bearer ${token}`)
      .field('draftId', 'draft-no-vin')
      .expect(400);
  });

  it('creates a Vehicle, VehicleImage, Part, PartImage, and grades the part via the real AI queue', async () => {
    const token = await loginWorker();
    const draftId = `draft-${Date.now()}`;
    const partId = `part-${Date.now()}`;

    const res = await buildRequest(
      token,
      draftId,
      partId,
      'INTAKETESTVIN1234',
    ).expect(201);

    const vehicleId = (res.body as { vehicleId: string }).vehicleId;
    expect(vehicleId).toBeTruthy();

    const vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).findOneOrFail({ where: { id: vehicleId } }),
    );
    expect(vehicle).toMatchObject({
      vin: 'INTAKETESTVIN1234',
      make: 'Honda',
      model: 'Civic',
      year: 2008,
      trim: 'EX',
      intakeDraftId: draftId,
    });

    const vehicleImages = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(VehicleImage).find({ where: { vehicleId } }),
    );
    expect(vehicleImages).toHaveLength(1);
    expect(vehicleImages[0].angle).toBe('front');

    const parts = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).find({ where: { vehicleId } }),
    );
    expect(parts).toHaveLength(1);
    expect(parts[0].taxonomyId).toBe(taxonomy.id);

    const partImages = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).find({ where: { partId: parts[0].id } }),
    );
    expect(partImages).toHaveLength(1);

    await waitFor(async () => {
      const analysis = await withTenantContext(dataSource, tenant.id, (m) =>
        m
          .getRepository(AiAnalysis)
          .findOne({ where: { partImageId: partImages[0].id } }),
      );
      return analysis?.status === AiAnalysisStatus.COMPLETE;
    });
    expect(fakeGemini.analyzePartImage).toHaveBeenCalled();

    const updatedPart = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).findOneOrFail({ where: { id: parts[0].id } }),
    );
    expect(updatedPart.status).toBe(PartStatus.PENDING_REVIEW);
  }, 15000);

  it('is idempotent: retrying the same draftId returns the same vehicle instead of creating a duplicate', async () => {
    const token = await loginWorker();
    const draftId = `draft-retry-${Date.now()}`;
    const partId = `part-retry-${Date.now()}`;

    const first = await buildRequest(
      token,
      draftId,
      partId,
      'RETRYTESTVIN12345',
    ).expect(201);
    const second = await buildRequest(
      token,
      draftId,
      partId,
      'RETRYTESTVIN12345',
    ).expect(201);

    const firstVehicleId = (first.body as { vehicleId: string }).vehicleId;
    const secondVehicleId = (second.body as { vehicleId: string }).vehicleId;
    expect(secondVehicleId).toBe(firstVehicleId);

    const vehicles = await withTenantContext(dataSource, tenant.id, (m) =>
      m
        .getRepository(Vehicle)
        .find({ where: { tenantId: tenant.id, intakeDraftId: draftId } }),
    );
    expect(vehicles).toHaveLength(1);
  }, 15000);
});
