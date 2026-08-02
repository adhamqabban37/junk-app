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
import { Vehicle, CrushStatus } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { closeTestApp } from './close-test-app';

// This test exercises the real BullMQ queue + worker end to end (upload ->
// job enqueued -> AiAnalysisProcessor picks it up -> AiAnalysisService
// writes AIAnalysis), the one place in this phase that isn't tested via a
// direct service call -- see ai-analysis.e2e-spec.ts for the deterministic
// idempotency/degradation coverage that would be slow and flaky to drive
// through real BullMQ backoff timing instead.
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

describe('Parts image upload (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let uploadDir: string;
  let fakeGemini: { analyzePartImage: jest.Mock };

  let tenant: Tenant;
  let worker: User;
  let taxonomy: PartTaxonomy;
  let part: Part;
  const WORKER_PIN = '9753';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'junkyard-parts-test-'),
    );
    process.env.UPLOAD_DIR = uploadDir;

    fakeGemini = {
      analyzePartImage: jest.fn().mockResolvedValue({
        grade: 'A',
        damage_codes: ['scratch'],
        confidence: 0.88,
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
      tenantRepo.create({ name: `Parts Test Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: 'Water Pump',
        category: 'Cooling',
        isQuickPick: false,
      }),
    );

    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Parts Test Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );

    const vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: 'PARTSTESTVIN1234',
          crushStatus: CrushStatus.ACTIVE,
        }),
      ),
    );
    part = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.PENDING_AI,
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

  it('rejects unauthenticated uploads', async () => {
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/images`)
      .attach('file', Buffer.from('fake-jpeg'), 'photo.jpg')
      .expect(401);
  });

  it('rejects a request with no file attached', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('404s for a part that does not exist', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .post('/parts/00000000-0000-0000-0000-000000000099/images')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake-jpeg'), 'photo.jpg')
      .expect(404);
  });

  it('uploading an image creates a PartImage, enqueues a job, and the worker produces a COMPLETE AIAnalysis', async () => {
    const token = await loginWorker();

    const uploadRes = await request(app.getHttpServer())
      .post(`/parts/${part.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('fake-jpeg-bytes'), 'photo.jpg')
      .expect(201);

    const partImageId = (uploadRes.body as { id: string }).id;

    const storedPath = path.join(
      uploadDir,
      tenant.id,
      part.id,
      `${partImageId}.jpg`,
    );
    await expect(fs.stat(storedPath)).resolves.toBeDefined();

    await waitFor(async () => {
      const analysis = await withTenantContext(dataSource, tenant.id, (m) =>
        m.getRepository(AiAnalysis).findOne({ where: { partImageId } }),
      );
      return analysis?.status === AiAnalysisStatus.COMPLETE;
    });

    const analysis = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(AiAnalysis).findOneOrFail({ where: { partImageId } }),
    );
    expect(analysis).toMatchObject({
      status: AiAnalysisStatus.COMPLETE,
      grade: 'A',
      damageCodes: ['scratch'],
    });
    expect(fakeGemini.analyzePartImage).toHaveBeenCalled();

    const updatedPart = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).findOneOrFail({ where: { id: part.id } }),
    );
    expect(updatedPart.status).toBe(PartStatus.PENDING_REVIEW);

    const image = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).findOneOrFail({ where: { id: partImageId } }),
    );
    expect(image.partId).toBe(part.id);
  }, 15000);
});
