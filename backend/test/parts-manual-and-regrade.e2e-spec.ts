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
  timeoutMs = 8000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

describe('Manual part add, image file route, and re-grade (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let uploadDir: string;
  let fakeGemini: { analyzePartImage: jest.Mock };

  let tenant: Tenant;
  let manager: User;
  let taxonomy: PartTaxonomy;
  let vehicle: Vehicle;
  const MANAGER_PASSWORD = 'manual-part-test-password';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'junkyard-manual-part-test-'),
    );
    process.env.UPLOAD_DIR = uploadDir;

    fakeGemini = {
      analyzePartImage: jest.fn().mockResolvedValue({
        grade: 'A',
        damage_codes: [],
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
      tenantRepo.create({ name: `Manual Part Test Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: `Alternator ${randomUUID()}`,
        category: 'Electrical',
        isQuickPick: false,
      }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Manual Part Manager',
          email: 'manual-part-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
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
          vin: `MP${randomUUID().slice(0, 15).toUpperCase()}`,
          crushStatus: CrushStatus.ACTIVE,
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

  describe('POST /vehicles/:id/parts (manual add, no photo)', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .post(`/vehicles/${vehicle.id}/parts`)
        .send({ taxonomyId: taxonomy.id })
        .expect(401);
    });

    it('404s for a vehicle that does not exist', async () => {
      const token = await loginManager();
      await request(app.getHttpServer())
        .post(`/vehicles/${randomUUID()}/parts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ taxonomyId: taxonomy.id })
        .expect(404);
    });

    it('creates a Part with no image, starting at needs_manual_grading -- the "alternator inside the engine, never photographed" case', async () => {
      const token = await loginManager();

      const res = await request(app.getHttpServer())
        .post(`/vehicles/${vehicle.id}/parts`)
        .set('Authorization', `Bearer ${token}`)
        .send({ taxonomyId: taxonomy.id })
        .expect(200);

      const partId = (res.body as { partId: string }).partId;
      const part = await withTenantContext(dataSource, tenant.id, (m) =>
        m.getRepository(Part).findOneOrFail({ where: { id: partId } }),
      );
      expect(part).toMatchObject({
        vehicleId: vehicle.id,
        taxonomyId: taxonomy.id,
        status: PartStatus.NEEDS_MANUAL_GRADING,
      });
      // No AI job should ever fire for a part with no photo.
      expect(fakeGemini.analyzePartImage).not.toHaveBeenCalled();
    });
  });

  describe('GET /parts/:id/images/:imageId/file', () => {
    it('serves the real bytes, and 404s for an image id not on this part', async () => {
      const token = await loginManager();
      const part = await withTenantContext(dataSource, tenant.id, (m) =>
        m.getRepository(Part).save(
          m.getRepository(Part).create({
            tenantId: tenant.id,
            vehicleId: vehicle.id,
            taxonomyId: taxonomy.id,
            status: PartStatus.PENDING_AI,
          }),
        ),
      );
      const uploadRes = await request(app.getHttpServer())
        .post(`/parts/${part.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('real-bytes-here'), 'photo.jpg')
        .expect(201);
      const imageId = (uploadRes.body as { id: string }).id;

      const fileRes = await request(app.getHttpServer())
        .get(`/parts/${part.id}/images/${imageId}/file`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(fileRes.headers['content-type']).toContain('image/jpeg');

      await request(app.getHttpServer())
        .get(`/parts/${part.id}/images/${randomUUID()}/file`)
        .set('Authorization', `Bearer ${token}`)
        .expect(404);
    });

    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .get(`/parts/${randomUUID()}/images/${randomUUID()}/file`)
        .expect(401);
    });
  });

  describe('POST /parts/:id/regrade', () => {
    it('re-calls Gemini and overwrites a previously-complete analysis, instead of being a no-op', async () => {
      const token = await loginManager();
      const part = await withTenantContext(dataSource, tenant.id, (m) =>
        m.getRepository(Part).save(
          m.getRepository(Part).create({
            tenantId: tenant.id,
            vehicleId: vehicle.id,
            taxonomyId: taxonomy.id,
            status: PartStatus.PENDING_AI,
          }),
        ),
      );
      const uploadRes = await request(app.getHttpServer())
        .post(`/parts/${part.id}/images`)
        .set('Authorization', `Bearer ${token}`)
        .attach('file', Buffer.from('first-pass-bytes'), 'photo.jpg')
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
      expect(fakeGemini.analyzePartImage).toHaveBeenCalledTimes(1);

      fakeGemini.analyzePartImage.mockResolvedValueOnce({
        grade: 'C',
        damage_codes: ['rust'],
        confidence: 0.4,
      });

      await request(app.getHttpServer())
        .post(`/parts/${part.id}/regrade`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      await waitFor(async () => {
        const a = await withTenantContext(dataSource, tenant.id, (m) =>
          m
            .getRepository(AiAnalysis)
            .findOne({ where: { partImageId: imageId } }),
        );
        return a?.grade === AiGrade.C;
      });

      const analyses = await withTenantContext(dataSource, tenant.id, (m) =>
        m.getRepository(AiAnalysis).find({ where: { partImageId: imageId } }),
      );
      // Upserted onto the same row (partImageId, modelVersion is unique),
      // not a duplicate.
      expect(analyses).toHaveLength(1);
      expect(analyses[0]).toMatchObject({ grade: 'C', damageCodes: ['rust'] });
      expect(fakeGemini.analyzePartImage).toHaveBeenCalledTimes(2);
    }, 20000);
  });
});
