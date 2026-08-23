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
import { Part } from '../src/database/entities/part.entity';
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
  let fakeGemini: {
    analyzePartImage: jest.Mock;
    analyzeVehiclePhotos: jest.Mock;
  };

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
      // savePhotos() (backing both intake() and POST /vehicles/:id/photos)
      // enqueues a vehicle-analysis job on every saved photo batch --
      // mocked here too so that job completes cleanly instead of retrying
      // 3x with backoff against a missing method, which would otherwise
      // still be in flight at afterAll's app.close() and risk the
      // documented BullMQ/Redis teardown race (see PROGRESS.md).
      analyzeVehiclePhotos: jest.fn().mockResolvedValue({
        grade: 'B',
        damage_codes: [],
        confidence: 0.8,
        photo_suggestions: [],
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
        name: `Headlight ${randomUUID()}`,
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

  it('lets a worker view a vehicle\'s photos (their own "sent vehicles" flow), but not assign them -- that stays manager/owner only', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .get(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photoIds: [randomUUID()], taxonomyId: taxonomy.id })
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

  it('assigns raw photos to a taxonomy: creates one Part with a PartImage per photo, keeps the raw photos available for reuse, and reaches AI grading', async () => {
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
    // Not asserting `status` here -- removing the old delete-on-assign
    // calls made this transaction commit sooner, so the mocked-but-real
    // AI job now sometimes finishes (flipping status to PENDING_REVIEW)
    // before this line runs. The waitFor() below is the real correctness
    // check for the AI pipeline; this just confirms the Part itself.
    expect(part).toMatchObject({
      vehicleId: vehicle.id,
      taxonomyId: taxonomy.id,
    });

    const partImages = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).find({ where: { partId } }),
    );
    expect(partImages).toHaveLength(2);

    // Deliberately NOT deleted: a single photo often shows more than one
    // part (bumper + headlight in the same frame), so assigning it once
    // must not make it unavailable for a second, different part.
    const remainingPhotos = await withTenantContext(
      dataSource,
      tenant.id,
      (m) =>
        m
          .getRepository(VehiclePhoto)
          .find({ where: { vehicleId: vehicle.id } }),
    );
    expect(remainingPhotos).toHaveLength(2);

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

  it('lets the same photo be assigned to a second, different part -- it often shows more than one', async () => {
    const photo = await createPhoto(
      vehicle.id,
      'wide-shot-bumper-and-headlight',
    );
    const token = await loginManager();
    const secondTaxonomy = await dataSource.getRepository(PartTaxonomy).save(
      dataSource.getRepository(PartTaxonomy).create({
        name: `Bumper ${randomUUID()}`,
        category: 'Body',
        isQuickPick: false,
      }),
    );

    const first = await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photoIds: [photo.id], taxonomyId: taxonomy.id })
      .expect(200);

    const second = await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos/assign`)
      .set('Authorization', `Bearer ${token}`)
      .send({ photoIds: [photo.id], taxonomyId: secondTaxonomy.id })
      .expect(200);

    const firstPartId = (first.body as { partId: string }).partId;
    const secondPartId = (second.body as { partId: string }).partId;
    expect(firstPartId).not.toBe(secondPartId);

    const firstImages = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).find({ where: { partId: firstPartId } }),
    );
    const secondImages = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).find({ where: { partId: secondPartId } }),
    );
    expect(firstImages).toHaveLength(1);
    expect(secondImages).toHaveLength(1);

    // No cleanup of secondTaxonomy: the two Parts just created still
    // reference it via a FK, so deleting it here would violate that
    // constraint (PartTaxonomy is a global lookup table, not tenant-scoped
    // -- leaving one extra test row behind is harmless).
  });

  describe('POST /vehicles/:id/photos (add more, after initial intake)', () => {
    it('rejects unauthenticated requests', async () => {
      await request(app.getHttpServer())
        .post(`/vehicles/${vehicle.id}/photos`)
        .attach('photo:p1', Buffer.from('bytes'), 'p1.jpg')
        .expect(401);
    });

    it('404s for a vehicle id that does not exist', async () => {
      const token = await loginWorker();
      await request(app.getHttpServer())
        .post(`/vehicles/${randomUUID()}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .attach('photo:p1', Buffer.from('bytes'), 'p1.jpg')
        .expect(404);
    });

    it('lets a worker append more raw photos to a vehicle already sent, without touching its existing ones', async () => {
      const existing = await createPhoto(vehicle.id, 'already-there');
      const token = await loginWorker();

      const res = await request(app.getHttpServer())
        .post(`/vehicles/${vehicle.id}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .attach('photo:new-1', Buffer.from('new-bytes-1'), 'new-1.jpg')
        .attach('photo:new-2', Buffer.from('new-bytes-2'), 'new-2.jpg')
        .expect(201);

      const created = res.body as { id: string; vehicleId: string }[];
      expect(created).toHaveLength(2);

      const allPhotos = await withTenantContext(dataSource, tenant.id, (m) =>
        m
          .getRepository(VehiclePhoto)
          .find({ where: { vehicleId: vehicle.id } }),
      );
      expect(allPhotos.map((p) => p.id).sort()).toEqual(
        [existing.id, ...created.map((c) => c.id)].sort(),
      );

      const listRes = await request(app.getHttpServer())
        .get(`/vehicles/${vehicle.id}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(listRes.body as unknown[]).toHaveLength(3);
    });

    it('applies an optional section tag to every photo in the batch, and leaves it null when omitted', async () => {
      const token = await loginWorker();

      const tagged = await request(app.getHttpServer())
        .post(`/vehicles/${vehicle.id}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .field('section', 'driver_side')
        .attach('photo:side-1', Buffer.from('side-bytes-1'), 'side-1.jpg')
        .attach('photo:side-2', Buffer.from('side-bytes-2'), 'side-2.jpg')
        .expect(201);
      const taggedBody = tagged.body as { section: string | null }[];
      expect(taggedBody).toHaveLength(2);
      expect(taggedBody.every((p) => p.section === 'driver_side')).toBe(true);

      const untagged = await request(app.getHttpServer())
        .post(`/vehicles/${vehicle.id}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .attach('photo:plain-1', Buffer.from('plain-bytes'), 'plain-1.jpg')
        .expect(201);
      const untaggedBody = untagged.body as { section: string | null }[];
      expect(untaggedBody[0].section).toBeNull();
    });

    it('rejects an unrecognized section value', async () => {
      const token = await loginWorker();
      await request(app.getHttpServer())
        .post(`/vehicles/${vehicle.id}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .field('section', 'not-a-real-section')
        .attach('photo:p1', Buffer.from('bytes'), 'p1.jpg')
        .expect(400);
    });
  });
});
