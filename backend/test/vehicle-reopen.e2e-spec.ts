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
import { Part, PartStatus } from '../src/database/entities/part.entity';
import { PartImage } from '../src/database/entities/part-image.entity';
import { PartTaxonomy } from '../src/database/entities/part-taxonomy.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { VehicleImage } from '../src/database/entities/vehicle-image.entity';
import { CrushStatus, Vehicle } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { closeTestApp } from './close-test-app';

/**
 * The attendant "reopen a previous vehicle" flow: find a vehicle synced days
 * ago, see what's already on it, and add another exterior angle. Part
 * re-shoots go through the pre-existing POST /parts/:partId/images, which is
 * already covered by parts.e2e-spec.ts.
 */
describe('Vehicle reopen / add exterior photo (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let uploadDir: string;

  let tenant: Tenant;
  let worker: User;
  let vehicle: Vehicle;
  let taxonomy: PartTaxonomy;
  let part: Part;
  const WORKER_PIN = '7391';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'junkyard-reopen-'));
    process.env.UPLOAD_DIR = uploadDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    tenant = await dataSource
      .getRepository(Tenant)
      .save(
        dataSource
          .getRepository(Tenant)
          .create({ name: `Reopen Test Tenant ${Date.now()}` }),
      );

    taxonomy = await dataSource.getRepository(PartTaxonomy).save(
      dataSource.getRepository(PartTaxonomy).create({
        name: 'Tail Light',
        category: 'Lighting',
        isQuickPick: false,
      }),
    );

    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Reopen Test Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );

    vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: 'REOPENTESTVIN123',
          make: 'Toyota',
          model: 'Camry',
          year: 2011,
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
          status: PartStatus.PENDING_REVIEW,
        }),
      ),
    );
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: part.id,
          url: 'existing.jpg',
          qualityFlags: null,
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

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/images`)
      .field('angle', 'front')
      .attach('file', Buffer.from('x'), 'p.jpg')
      .expect(401);
  });

  it('lets a worker read a vehicle detail enriched with part names and photo counts', async () => {
    const token = await loginWorker();
    const res = await request(app.getHttpServer())
      .get(`/vehicles/${vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      vin: string;
      images: unknown[];
      parts: Array<{ taxonomyName: string; photosCount: number }>;
    };
    expect(body.vin).toBe('REOPENTESTVIN123');
    // The two fields that make the screen usable and that don't exist on the
    // Part row itself.
    expect(body.parts[0].taxonomyName).toBe('Tail Light');
    expect(body.parts[0].photosCount).toBe(1);
  });

  it('rejects an exterior photo with a missing or bogus angle', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from('x'), 'p.jpg')
      .expect(400);

    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .field('angle', 'sideways')
      .attach('file', Buffer.from('x'), 'p.jpg')
      .expect(400);
  });

  it('rejects a request with no file attached', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .field('angle', 'front')
      .expect(400);
  });

  it('404s for a vehicle that does not exist', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .post('/vehicles/00000000-0000-0000-0000-000000000099/images')
      .set('Authorization', `Bearer ${token}`)
      .field('angle', 'front')
      .attach('file', Buffer.from('x'), 'p.jpg')
      .expect(404);
  });

  it('lets a worker add an exterior photo to an already-synced vehicle and read it back', async () => {
    const token = await loginWorker();

    const res = await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .field('angle', 'rear')
      .attach('file', Buffer.from('fresh-rear-shot'), 'rear.jpg')
      .expect(201);

    const created = res.body as { id: string; angle: string };
    expect(created.angle).toBe('rear');

    const stored = await withTenantContext(dataSource, tenant.id, (m) =>
      m
        .getRepository(VehicleImage)
        .findOneOrFail({ where: { id: created.id } }),
    );
    expect(stored.vehicleId).toBe(vehicle.id);

    const fileRes = await request(app.getHttpServer())
      .get(`/vehicles/${vehicle.id}/images/${created.id}/file`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(fileRes.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.from(fileRes.body as Buffer).toString()).toBe(
      'fresh-rear-shot',
    );

    // And it now shows up on the vehicle the attendant reopened.
    const detail = await request(app.getHttpServer())
      .get(`/vehicles/${vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect((detail.body as { images: unknown[] }).images).toHaveLength(1);
  });

  it('is tenant-isolated: another tenant cannot add a photo to this vehicle', async () => {
    const otherTenant = await dataSource
      .getRepository(Tenant)
      .save(
        dataSource
          .getRepository(Tenant)
          .create({ name: `Reopen Other Tenant ${Date.now()}` }),
      );
    const OTHER_PIN = '1122';
    const otherWorker = await withTenantContext(
      dataSource,
      otherTenant.id,
      (m) =>
        m.getRepository(User).save(
          m.getRepository(User).create({
            tenantId: otherTenant.id,
            role: UserRole.WORKER,
            name: 'Other Tenant Worker',
            pinHash: bcrypt.hashSync(OTHER_PIN, 4),
          }),
        ),
    );

    const login = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({
        tenantId: otherTenant.id,
        userId: otherWorker.id,
        pin: OTHER_PIN,
      })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .field('angle', 'front')
      .attach('file', Buffer.from('x'), 'p.jpg')
      .expect(404);

    await dataSource.getRepository(Tenant).delete({ id: otherTenant.id });
  });
});
