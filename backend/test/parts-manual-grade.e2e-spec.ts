import 'reflect-metadata';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { GeminiService } from '../src/ai/gemini.service';
import {
  AiAnalysis,
  AiAnalysisStatus,
  AiGrade,
} from '../src/database/entities/ai-analysis.entity';
import { Part, PartStatus } from '../src/database/entities/part.entity';
import { PartTaxonomy } from '../src/database/entities/part-taxonomy.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { CrushStatus, Vehicle } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { closeTestApp } from './close-test-app';

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

describe('POST /parts/:id/manual-grade -- grading a photo-less part directly (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let uploadDir: string;
  let fakeGemini: { analyzePartImage: jest.Mock };
  let tenant: Tenant;
  let manager: User;
  let worker: User;
  let taxonomy: PartTaxonomy;
  let vehicle: Vehicle;
  let part: Part;
  const MANAGER_PASSWORD = 'manual-grade-test-password';
  const WORKER_PIN = '7391';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'junkyard-manual-grade-test-'),
    );
    process.env.UPLOAD_DIR = uploadDir;

    fakeGemini = {
      analyzePartImage: jest.fn().mockResolvedValue({
        grade: 'C',
        damage_codes: ['collision-damage'],
        confidence: 0.9,
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
      tenantRepo.create({ name: `Manual Grade Test Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: `Alternator ${randomUUID()}`,
        category: 'Electrical',
      }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Manual Grade Test Manager',
          email: 'manual-grade-test-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Manual Grade Test Worker',
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

  beforeEach(async () => {
    fakeGemini.analyzePartImage.mockClear();
    vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: `MG${randomUUID().slice(0, 15).toUpperCase()}`,
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
          status: PartStatus.NEEDS_MANUAL_GRADING,
        }),
      ),
    );
  });

  async function loginManager(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login/manager')
      .send({
        tenantId: tenant.id,
        email: manager.email,
        password: MANAGER_PASSWORD,
      })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  async function loginWorker(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/manual-grade`)
      .send({ grade: 'B' })
      .expect(401);
  });

  it('rejects a worker (manager/owner only)', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/manual-grade`)
      .set('Authorization', `Bearer ${token}`)
      .send({ grade: 'B' })
      .expect(403);
  });

  it('404s for a part that does not exist', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/parts/${randomUUID()}/manual-grade`)
      .set('Authorization', `Bearer ${token}`)
      .send({ grade: 'B' })
      .expect(404);
  });

  it('400s for an invalid grade value', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/manual-grade`)
      .set('Authorization', `Bearer ${token}`)
      .send({ grade: 'Z' })
      .expect(400);
  });

  it('records a manual grade for a photo-less part, visible via GET /parts', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/manual-grade`)
      .set('Authorization', `Bearer ${token}`)
      .send({ grade: 'B' })
      .expect(200, { status: 'graded', grade: 'B' });

    const res = await request(app.getHttpServer())
      .get(`/parts?vehicleId=${vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const items = (
      res.body as {
        items: { id: string; latestAnalysis: { grade: string } | null }[];
      }
    ).items;
    const found = items.find((i) => i.id === part.id);
    expect(found?.latestAnalysis?.grade).toBe('B');
  });

  it('re-grading manually updates the same row instead of creating a duplicate', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/manual-grade`)
      .set('Authorization', `Bearer ${token}`)
      .send({ grade: 'A' })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/manual-grade`)
      .set('Authorization', `Bearer ${token}`)
      .send({ grade: 'C' })
      .expect(200);

    const rows = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(AiAnalysis).find({ where: { partId: part.id } }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].grade).toBe(AiGrade.C);
    expect(rows[0].partImageId).toBeNull();
    expect(rows[0].status).toBe(AiAnalysisStatus.COMPLETE);
  });

  it('a Part that later gets a real photo aggregates worst-of-both (manual + AI) correctly', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/manual-grade`)
      .set('Authorization', `Bearer ${token}`)
      .send({ grade: 'A' })
      .expect(200);

    const uploadRes = await request(app.getHttpServer())
      .post(`/parts/${part.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(`photo-${randomUUID()}`), 'photo.jpg')
      .expect(201);
    const imageId = (uploadRes.body as { id: string }).id;

    await waitFor(async () => {
      const a = await withTenantContext(dataSource, tenant.id, (m) =>
        m
          .getRepository(AiAnalysis)
          .findOne({ where: { partImageId: imageId } }),
      );
      return a?.status === AiAnalysisStatus.COMPLETE;
    });

    const res = await request(app.getHttpServer())
      .get(`/parts/${part.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const detail = res.body as {
      latestAnalysis: { grade: string; damageCodes: string[] } | null;
    };
    // AI found real damage (C) -- worse than the earlier manual A, so it wins.
    expect(detail.latestAnalysis?.grade).toBe('C');
    expect(detail.latestAnalysis?.damageCodes).toEqual(['collision-damage']);
  }, 20000);
});
