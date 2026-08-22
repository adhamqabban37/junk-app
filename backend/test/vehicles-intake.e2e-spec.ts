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
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { Vehicle } from '../src/database/entities/vehicle.entity';
import { VehiclePhoto } from '../src/database/entities/vehicle-photo.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { closeTestApp } from './close-test-app';

// Exercises the mobile sync client's real contract (frontend/src/lib/offline
// /sync.ts's buildIntakeFormData()): a worker POSTs a flat batch of raw
// photos with no part/taxonomy chosen yet -- assignment now happens later,
// from the manager dashboard (see vehicle-photos.e2e-spec.ts).
describe('Vehicles intake (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let uploadDir: string;

  let tenant: Tenant;
  let worker: User;
  const WORKER_PIN = '4813';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'junkyard-vehicles-intake-test-'),
    );
    process.env.UPLOAD_DIR = uploadDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GeminiService)
      .useValue({ analyzePartImage: jest.fn() })
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);

    const tenantRepo = dataSource.getRepository(Tenant);
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: `Vehicles Intake Test Tenant ${Date.now()}` }),
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
    opts?: { decoded?: string; vin?: string; photoCount?: number },
  ) {
    const decoded =
      opts?.decoded ??
      JSON.stringify({
        make: 'Honda',
        model: 'Accord',
        year: 2005,
        trim: 'EX',
        raw: { source: 'nhtsa' },
      });

    let req = request(app.getHttpServer())
      .post('/vehicles/intake')
      .set('Authorization', `Bearer ${token}`)
      .field('draftId', draftId)
      .field('vin', opts?.vin ?? 'INTAKETESTVIN1234')
      .field('vinEntryMethod', 'manual')
      .field('decoded', decoded);

    const photoCount = opts?.photoCount ?? 3;
    for (let i = 0; i < photoCount; i++) {
      req = req.attach(
        `photo:photo-${i}`,
        Buffer.from(`photo-${i}-bytes`),
        `photo-${i}.jpg`,
      );
    }
    return req;
  }

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post('/vehicles/intake')
      .field('draftId', 'no-auth')
      .expect(401);
  });

  it('rejects a malformed vin', async () => {
    const token = await loginWorker();
    await buildRequest(token, `draft-bad-vin-${Date.now()}`, {
      vin: 'TOOSHORT',
    }).expect(400);
  });

  it('rejects malformed decoded JSON', async () => {
    const token = await loginWorker();
    await buildRequest(token, `draft-bad-decoded-${Date.now()}`, {
      decoded: 'not-json',
    }).expect(400);
  });

  it('a worker can sync a free-form photo batch: creates the Vehicle and its raw, unassigned photos', async () => {
    const token = await loginWorker();
    const draftId = `draft-happy-${Date.now()}`;

    const res = await buildRequest(token, draftId, { photoCount: 3 }).expect(
      201,
    );
    const body = res.body as { vehicleId: string; duplicate: boolean };
    expect(body.duplicate).toBe(false);

    const vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).findOneOrFail({ where: { id: body.vehicleId } }),
    );
    expect(vehicle).toMatchObject({
      vin: 'INTAKETESTVIN1234',
      make: 'Honda',
      model: 'Accord',
      year: 2005,
      trim: 'EX',
      intakeDraftId: draftId,
    });
    expect(vehicle.decodedRaw).toEqual({ source: 'nhtsa' });

    const photos = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(VehiclePhoto).find({ where: { vehicleId: vehicle.id } }),
    );
    expect(photos).toHaveLength(3);
    for (const photo of photos) {
      await expect(
        fs.stat(path.join(uploadDir, photo.url)),
      ).resolves.toBeDefined();
    }
  });

  it('re-syncing the same draftId is idempotent: no duplicate vehicle/photos are created', async () => {
    const token = await loginWorker();
    const draftId = `draft-retry-${Date.now()}`;

    const first = await buildRequest(token, draftId).expect(201);
    const firstBody = first.body as { vehicleId: string; duplicate: boolean };
    expect(firstBody.duplicate).toBe(false);

    const second = await buildRequest(token, draftId).expect(201);
    const secondBody = second.body as {
      vehicleId: string;
      duplicate: boolean;
    };
    expect(secondBody.duplicate).toBe(true);
    expect(secondBody.vehicleId).toBe(firstBody.vehicleId);

    const vehicles = await withTenantContext(dataSource, tenant.id, (m) =>
      m
        .getRepository(Vehicle)
        .find({ where: { tenantId: tenant.id, intakeDraftId: draftId } }),
    );
    expect(vehicles).toHaveLength(1);

    const photos = await withTenantContext(dataSource, tenant.id, (m) =>
      m
        .getRepository(VehiclePhoto)
        .find({ where: { vehicleId: firstBody.vehicleId } }),
    );
    // buildRequest's default photoCount (3) attached once, not duplicated.
    expect(photos).toHaveLength(3);
  });

  it('accepts a draft with zero photos', async () => {
    const token = await loginWorker();
    const draftId = `draft-no-photos-${Date.now()}`;

    const res = await buildRequest(token, draftId, { photoCount: 0 }).expect(
      201,
    );
    const body = res.body as { vehicleId: string };
    const photos = await withTenantContext(dataSource, tenant.id, (m) =>
      m
        .getRepository(VehiclePhoto)
        .find({ where: { vehicleId: body.vehicleId } }),
    );
    expect(photos).toHaveLength(0);
  });
});
