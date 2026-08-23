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
} from '../src/database/entities/ai-analysis.entity';
import { Part, PartStatus } from '../src/database/entities/part.entity';
import { PartImage } from '../src/database/entities/part-image.entity';
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

describe('POST /parts/:id/merge -- manager duplicate-Part backstop (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let uploadDir: string;
  let fakeGemini: { analyzePartImage: jest.Mock };

  let tenant: Tenant;
  let manager: User;
  let taxonomy: PartTaxonomy;
  let vehicle: Vehicle;
  const MANAGER_PASSWORD = 'merge-test-password';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'junkyard-merge-test-'),
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
      tenantRepo.create({ name: `Merge Test Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: `Fender ${randomUUID()}`,
        category: 'Body',
        isExteriorVisual: true,
      }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Merge Test Manager',
          email: 'merge-test-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
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

  async function createGradedPart(
    token: string,
    grade: 'A' | 'B' | 'C',
    damageCodes: string[],
  ): Promise<Part> {
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
    fakeGemini.analyzePartImage.mockResolvedValueOnce({
      grade,
      damage_codes: damageCodes,
      confidence: 0.8,
    });
    const uploadRes = await request(app.getHttpServer())
      .post(`/parts/${part.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach(
        'file',
        Buffer.from(`${grade}-photo-${randomUUID()}`),
        'photo.jpg',
      )
      .expect(201);
    const imageId = (uploadRes.body as { id: string }).id;
    await waitFor(async () => {
      const analysis = await withTenantContext(dataSource, tenant.id, (m) =>
        m
          .getRepository(AiAnalysis)
          .findOne({ where: { partImageId: imageId } }),
      );
      return analysis?.status === AiAnalysisStatus.COMPLETE;
    }, 15000);
    return part;
  }

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post(`/parts/${randomUUID()}/merge`)
      .send({ sourcePartIds: [randomUUID()] })
      .expect(401);
  });

  it('404s when the target part does not exist', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/parts/${randomUUID()}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourcePartIds: [randomUUID()] })
      .expect(404);
  });

  it('404s when a source part does not exist', async () => {
    const token = await loginManager();
    const target = await createGradedPart(token, 'A', []);
    await request(app.getHttpServer())
      .post(`/parts/${target.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourcePartIds: [randomUUID()] })
      .expect(404);
  }, 20000);

  it('400s when sourcePartIds only contains the target itself', async () => {
    const token = await loginManager();
    const target = await createGradedPart(token, 'A', []);
    await request(app.getHttpServer())
      .post(`/parts/${target.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourcePartIds: [target.id] })
      .expect(400);
  }, 20000);

  it('400s when the source part belongs to a different vehicle', async () => {
    const token = await loginManager();
    const target = await createGradedPart(token, 'A', []);
    const otherVehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: `MG${randomUUID().slice(0, 15).toUpperCase()}`,
          crushStatus: CrushStatus.ACTIVE,
        }),
      ),
    );
    const sourceOnOtherVehicle = await withTenantContext(
      dataSource,
      tenant.id,
      (m) =>
        m.getRepository(Part).save(
          m.getRepository(Part).create({
            tenantId: tenant.id,
            vehicleId: otherVehicle.id,
            taxonomyId: taxonomy.id,
            status: PartStatus.PENDING_AI,
          }),
        ),
    );
    await request(app.getHttpServer())
      .post(`/parts/${target.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourcePartIds: [sourceOnOtherVehicle.id] })
      .expect(400);
  }, 20000);

  it('400s when the source part is already listed', async () => {
    const token = await loginManager();
    const target = await createGradedPart(token, 'A', []);
    const listedSource = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.LISTED,
        }),
      ),
    );
    await request(app.getHttpServer())
      .post(`/parts/${target.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourcePartIds: [listedSource.id] })
      .expect(400);
  }, 20000);

  it("merges the source Part's images and analyses onto the target, unions damage codes via the existing worst-grade-wins aggregation, and deletes the source Part", async () => {
    const token = await loginManager();
    const target = await createGradedPart(token, 'A', ['light-scuff']);
    const source = await createGradedPart(token, 'C', ['collision-damage']);

    const res = await request(app.getHttpServer())
      .post(`/parts/${target.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourcePartIds: [source.id] })
      .expect(200);

    expect((res.body as { id: string }).id).toBe(target.id);
    const body = res.body as {
      photos: unknown[];
      latestAnalysis: { grade: string; damageCodes: string[] } | null;
    };
    expect(body.photos).toHaveLength(2);
    expect(body.latestAnalysis?.grade).toBe('C');
    expect(body.latestAnalysis?.damageCodes.sort()).toEqual(
      ['collision-damage', 'light-scuff'].sort(),
    );

    const images = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).find({ where: { partId: target.id } }),
    );
    expect(images).toHaveLength(2);

    const sourceStillExists = await withTenantContext(
      dataSource,
      tenant.id,
      (m) => m.getRepository(Part).findOne({ where: { id: source.id } }),
    );
    expect(sourceStillExists).toBeNull();
  }, 30000);

  it('bumps a manually-created (imageless) target from needs_manual_grading to pending_review once a graded source is merged in', async () => {
    const token = await loginManager();
    const manualTarget = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.NEEDS_MANUAL_GRADING,
        }),
      ),
    );
    const source = await createGradedPart(token, 'B', ['scratch']);

    await request(app.getHttpServer())
      .post(`/parts/${manualTarget.id}/merge`)
      .set('Authorization', `Bearer ${token}`)
      .send({ sourcePartIds: [source.id] })
      .expect(200);

    const updated = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).findOneOrFail({ where: { id: manualTarget.id } }),
    );
    expect(updated.status).toBe(PartStatus.PENDING_REVIEW);
  }, 30000);
});
