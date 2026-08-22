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
import { VehiclePhoto } from '../src/database/entities/vehicle-photo.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { LocalFileStorage } from '../src/storage/local-file-storage';
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

describe('Vehicle photos: list / file / assign (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let storage: LocalFileStorage;
  let uploadDir: string;
  let fakeGemini: { analyzePartImage: jest.Mock };

  let tenant: Tenant;
  let otherTenant: Tenant;
  let manager: User;
  let worker: User;
  let taxonomy: PartTaxonomy;
  let vehicle: Vehicle;
  const MANAGER_PASSWORD = 'vehicle-photos-test-password';
  const WORKER_PIN = '7531';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'junkyard-vehicle-photos-test-'),
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
    storage = app.get(LocalFileStorage);

    const tenantRepo = dataSource.getRepository(Tenant);
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: `Vehicle Photos Test Tenant ${Date.now()}` }),
    );
    otherTenant = await tenantRepo.save(
      tenantRepo.create({
        name: `Vehicle Photos Test Other Tenant ${Date.now()}`,
      }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: 'Headlight',
        category: 'Lighting',
        isQuickPick: false,
      }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Vehicle Photos Manager',
          email: 'vehicle-photos-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Vehicle Photos Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await dataSource.getRepository(Tenant).delete({ id: otherTenant.id });
    await dataSource.getRepository(PartTaxonomy).delete({ id: taxonomy.id });
    await closeTestApp(app);
    await fs.rm(uploadDir, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  });

  beforeEach(async () => {
    vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: `VP${randomUUID().slice(0, 15).toUpperCase()}`,
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

  async function loginWorker(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  async function createPhoto(vehicleId: string, content: string) {
    const id = randomUUID();
    const relativePath = `${tenant.id}/${vehicleId}/${id}.jpg`;
    await storage.save(relativePath, Buffer.from(content));
    return withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(VehiclePhoto).save(
        m.getRepository(VehiclePhoto).create({
          id,
          tenantId: tenant.id,
          vehicleId,
          url: relativePath,
        }),
      ),
    );
  }

  it('rejects unauthenticated requests on all three routes', async () => {
    await request(app.getHttpServer())
      .get(`/vehicles/${vehicle.id}/photos`)
      .expect(401);
    await request(app.getHttpServer())
      .get(`/vehicles/${vehicle.id}/photos/${randomUUID()}/file`)
      .expect(401);
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos/assign`)
      .send({ photoIds: [randomUUID()], taxonomyId: taxonomy.id })
      .expect(401);
  });

  it('rejects a worker (manager/owner only)', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .get(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('lists a vehicle photos, never another tenant vehicle photos', async () => {
    await createPhoto(vehicle.id, 'a');
    await createPhoto(vehicle.id, 'b');

    const otherVehicle = await withTenantContext(
      dataSource,
      otherTenant.id,
      (m) =>
        m.getRepository(Vehicle).save(
          m.getRepository(Vehicle).create({
            tenantId: otherTenant.id,
            vin: 'OTHERTENANTVIN99',
            crushStatus: CrushStatus.ACTIVE,
          }),
        ),
    );
    await withTenantContext(dataSource, otherTenant.id, (m) =>
      m.getRepository(VehiclePhoto).save(
        m.getRepository(VehiclePhoto).create({
          tenantId: otherTenant.id,
          vehicleId: otherVehicle.id,
          url: `${otherTenant.id}/${otherVehicle.id}/x.jpg`,
        }),
      ),
    );

    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body as unknown[]).toHaveLength(2);
  });

  it('serves the raw file bytes, and 404s for a photo id not on this vehicle', async () => {
    const photo = await createPhoto(vehicle.id, 'hello-bytes');
    const token = await loginManager();

    const res = await request(app.getHttpServer())
      .get(`/vehicles/${vehicle.id}/photos/${photo.id}/file`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.headers['content-type']).toContain('image/jpeg');

    await request(app.getHttpServer())
      .get(`/vehicles/${vehicle.id}/photos/${randomUUID()}/file`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('rejects assigning an empty photoIds array', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photoIds: [], taxonomyId: taxonomy.id })
      .expect(400);
  });

  it('404s when assigning a photo id that does not belong to the vehicle', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photoIds: [randomUUID()], taxonomyId: taxonomy.id })
      .expect(404);
  });

  it('assigns raw photos to a taxonomy: creates one Part with a PartImage per photo, consumes the raw photos, and reaches AI grading', async () => {
    const photoA = await createPhoto(vehicle.id, 'photo-a');
    const photoB = await createPhoto(vehicle.id, 'photo-b');
    const token = await loginManager();

    const res = await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photoIds: [photoA.id, photoB.id], taxonomyId: taxonomy.id })
      .expect(200);

    const partId = (res.body as { partId: string }).partId;
    const part = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).findOneOrFail({ where: { id: partId } }),
    );
    expect(part).toMatchObject({
      vehicleId: vehicle.id,
      taxonomyId: taxonomy.id,
      status: PartStatus.PENDING_AI,
    });

    const partImages = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).find({ where: { partId } }),
    );
    expect(partImages).toHaveLength(2);

    const remainingPhotos = await withTenantContext(
      dataSource,
      tenant.id,
      (m) =>
        m
          .getRepository(VehiclePhoto)
          .find({ where: { vehicleId: vehicle.id } }),
    );
    expect(remainingPhotos).toHaveLength(0);

    // Longer budget than the single-photo waitFor() elsewhere in this
    // suite (e.g. parts.e2e-spec.ts's 8s default): assignPhotos() does
    // two full storage+insert+enqueue cycles inside one transaction, so
    // there's a wider (though still bounded, retried) window where a
    // BullMQ worker can pick up a just-enqueued job before that
    // transaction commits and the PartImage row becomes visible to it.
    await waitFor(async () => {
      const analyses = await withTenantContext(dataSource, tenant.id, (m) =>
        m.getRepository(AiAnalysis).find({ where: { partId } }),
      );
      return (
        analyses.length === 2 &&
        analyses.every((a) => a.status === AiAnalysisStatus.COMPLETE)
      );
    }, 20000);
    expect(fakeGemini.analyzePartImage).toHaveBeenCalled();
  }, 25000);
});
