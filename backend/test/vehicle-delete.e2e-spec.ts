import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import {
  AiAnalysis,
  AiAnalysisStatus,
  AiGrade,
} from '../src/database/entities/ai-analysis.entity';
import { HumanCorrection } from '../src/database/entities/human-correction.entity';
import { Part, PartStatus } from '../src/database/entities/part.entity';
import { PartImage } from '../src/database/entities/part-image.entity';
import { PartTaxonomy } from '../src/database/entities/part-taxonomy.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import {
  VehicleImage,
  VehicleImageAngle,
} from '../src/database/entities/vehicle-image.entity';
import { CrushStatus, Vehicle } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { LocalFileStorage } from '../src/storage/local-file-storage';
import { closeTestApp } from './close-test-app';

/**
 * DELETE /vehicles/:id -- "this vehicle was added by mistake".
 *
 * The interesting part is the blast radius. Every child table cascades from
 * `vehicles` at the DB level (see the InitialSchema migration), so a single
 * DELETE takes parts, part images, AI analyses and human corrections with
 * it. These tests pin that, because a cascade that silently stops working
 * would leave orphan rows nothing in the app can ever reach again.
 */
describe('Vehicle deletion (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let storage: LocalFileStorage;
  let tenant: Tenant;
  let otherTenant: Tenant;
  let manager: User;
  let taxonomy: PartTaxonomy;
  const MANAGER_PASSWORD = 'vehicle-delete-password';
  const WORKER_PIN = '4726';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    storage = app.get(LocalFileStorage);

    const tenantRepo = dataSource.getRepository(Tenant);
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: `Vehicle Delete Tenant ${Date.now()}` }),
    );
    otherTenant = await tenantRepo.save(
      tenantRepo.create({ name: `Vehicle Delete Other ${Date.now()}` }),
    );

    // Shared reference data has no RLS and no cascade from Tenant, so this
    // row must be deleted explicitly in afterAll -- two suites leaking
    // taxonomy rows this way polluted every worker's real part picker.
    taxonomy = await dataSource.getRepository(PartTaxonomy).save(
      dataSource.getRepository(PartTaxonomy).create({
        name: `Delete Test Alternator ${Date.now()}`,
        category: 'Engine',
        isQuickPick: false,
      }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Delete Manager',
          email: 'vehicle-delete-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Delete Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );
  });

  afterAll(async () => {
    // Vehicles first, tenants second -- deleting the tenant outright fails
    // here. `human_corrections.corrected_by_user_id` REFERENCES users(id)
    // with NO ON DELETE action (InitialSchema migration), while both
    // `users.tenant_id` and `human_corrections.tenant_id` cascade from
    // tenants. So a tenant delete can reach `users` before it has cleared
    // the corrections pointing at them, and Postgres rejects it:
    //   update or delete on table "users" violates foreign key constraint
    //   "human_corrections_corrected_by_user_id_fkey"
    // Deleting the vehicles first drains the corrections via
    // ai_analyses, which is exactly the cascade this suite is testing.
    // NB this is a latent schema wrinkle, not something this feature
    // introduced -- see docs/PROGRESS.md.
    for (const t of [tenant.id, otherTenant.id]) {
      await withTenantContext(dataSource, t, (m) =>
        m.getRepository(Vehicle).delete({ tenantId: t }),
      );
    }
    // Taxonomy BEFORE tenants, unlike every other suite in this directory.
    // They all delete the tenant first and the taxonomy row last, so any
    // throw in the tenant delete skips taxonomy cleanup and leaks a row
    // into the shared dev database forever (part_taxonomies has no RLS and
    // no cascade from Tenant). That is the actual structural reason this
    // pollution keeps coming back -- it bit this very suite: its first two
    // runs threw on the tenant delete and leaked two rows.
    // Safe in this order because the vehicles above are already gone, so no
    // Part still references this taxonomy row.
    await dataSource.getRepository(PartTaxonomy).delete({ id: taxonomy.id });
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await dataSource.getRepository(Tenant).delete({ id: otherTenant.id });
    await closeTestApp(app);
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
    const workers = await request(app.getHttpServer())
      .get(`/auth/tenants/${tenant.id}/workers`)
      .expect(200);
    const found = (workers.body as { id: string; name: string }[]).find(
      (w) => w.name === 'Delete Worker',
    )!;
    const res = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: found.id, pin: WORKER_PIN })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  /** A vehicle with a part, a part photo, an AI grade, a correction and an exterior photo. */
  async function seedVehicle(vin: string, tenantId = tenant.id) {
    return withTenantContext(dataSource, tenantId, async (m) => {
      const vehicle = await m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId,
          vin,
          make: 'Hyundai',
          model: 'Genesis',
          year: 2015,
          crushStatus: CrushStatus.ACTIVE,
        }),
      );
      const part = await m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.PENDING_REVIEW,
        }),
      );
      const partImage = await m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId,
          partId: part.id,
          url: `${tenantId}/${part.id}/photo.jpg`,
          qualityFlags: null,
        }),
      );
      const analysis = await m.getRepository(AiAnalysis).save(
        m.getRepository(AiAnalysis).create({
          tenantId,
          partId: part.id,
          partImageId: partImage.id,
          modelVersion: 'test-model',
          grade: AiGrade.B,
          damageCodes: ['scratch'],
          confidence: 0.9,
          status: AiAnalysisStatus.COMPLETE,
        }),
      );
      const correction = await m.getRepository(HumanCorrection).save(
        m.getRepository(HumanCorrection).create({
          tenantId,
          aiAnalysisId: analysis.id,
          field: 'grade',
          originalValue: 'B',
          correctedValue: 'A',
          correctedByUserId: manager.id,
        }),
      );
      const vehicleImage = await m.getRepository(VehicleImage).save(
        m.getRepository(VehicleImage).create({
          tenantId,
          vehicleId: vehicle.id,
          angle: VehicleImageAngle.FRONT,
          url: `${tenantId}/${vehicle.id}/front.jpg`,
        }),
      );
      return { vehicle, part, partImage, analysis, correction, vehicleImage };
    });
  }

  it('requires authentication', async () => {
    const { vehicle } = await seedVehicle(`DELVIN${Date.now()}`.slice(0, 17));
    await request(app.getHttpServer())
      .delete(`/vehicles/${vehicle.id}`)
      .expect(401);
  });

  // Destructive and irreversible, so unlike the photo endpoints this one is
  // NOT open to every authenticated role.
  it('refuses a worker', async () => {
    const { vehicle } = await seedVehicle(`DELWRK${Date.now()}`.slice(0, 17));
    const token = await loginWorker();

    await request(app.getHttpServer())
      .delete(`/vehicles/${vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const still = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).findOne({ where: { id: vehicle.id } }),
    );
    expect(still).not.toBeNull();
  });

  it('deletes the vehicle and everything that hangs off it', async () => {
    const seeded = await seedVehicle(`DELOK${Date.now()}`.slice(0, 17));
    const token = await loginManager();

    const res = await request(app.getHttpServer())
      .delete(`/vehicles/${seeded.vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    // Reports the blast radius so the UI can say what actually went.
    expect(res.body).toMatchObject({
      vehicleId: seeded.vehicle.id,
      deletedParts: 1,
      deletedPhotos: 2, // one part photo + one exterior photo
    });

    await withTenantContext(dataSource, tenant.id, async (m) => {
      expect(
        await m
          .getRepository(Vehicle)
          .findOne({ where: { id: seeded.vehicle.id } }),
      ).toBeNull();
      expect(
        await m.getRepository(Part).findOne({ where: { id: seeded.part.id } }),
      ).toBeNull();
      expect(
        await m
          .getRepository(PartImage)
          .findOne({ where: { id: seeded.partImage.id } }),
      ).toBeNull();
      expect(
        await m
          .getRepository(AiAnalysis)
          .findOne({ where: { id: seeded.analysis.id } }),
      ).toBeNull();
      expect(
        await m
          .getRepository(VehicleImage)
          .findOne({ where: { id: seeded.vehicleImage.id } }),
      ).toBeNull();
      // The Moat goes too -- human_corrections cascades via ai_analyses.
      // Deliberate (a mistake vehicle's corrections are noise), but it is
      // real training data being destroyed, so it is pinned here rather
      // than left as an accident nobody noticed. See docs/PROGRESS.md.
      expect(
        await m
          .getRepository(HumanCorrection)
          .findOne({ where: { id: seeded.correction.id } }),
      ).toBeNull();
    });
  });

  it('removes the stored image files from disk, not just the rows', async () => {
    const seeded = await seedVehicle(`DELFILE${Date.now()}`.slice(0, 17));
    await storage.save(seeded.partImage.url, Buffer.from('part-photo-bytes'));
    await storage.save(seeded.vehicleImage.url, Buffer.from('exterior-bytes'));
    // Sanity: they really are there before the delete.
    await expect(storage.read(seeded.partImage.url)).resolves.toBeInstanceOf(
      Buffer,
    );

    const token = await loginManager();
    await request(app.getHttpServer())
      .delete(`/vehicles/${seeded.vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    await expect(storage.read(seeded.partImage.url)).rejects.toThrow();
    await expect(storage.read(seeded.vehicleImage.url)).rejects.toThrow();
  });

  // A row already missing its file must not block the delete -- writes and
  // rows are not in one transaction, so they can legitimately disagree.
  it('still deletes when a stored file is already gone', async () => {
    const seeded = await seedVehicle(`DELMISS${Date.now()}`.slice(0, 17));
    const token = await loginManager();

    await request(app.getHttpServer())
      .delete(`/vehicles/${seeded.vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const gone = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).findOne({ where: { id: seeded.vehicle.id } }),
    );
    expect(gone).toBeNull();
  });

  it('404s for a vehicle that does not exist', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .delete('/vehicles/11111111-1111-1111-1111-111111111111')
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  // RLS, not an explicit ownership check -- another tenant's vehicle is
  // simply invisible, so it reads as "not found".
  it("cannot delete another tenant's vehicle", async () => {
    const seeded = await seedVehicle(
      `DELOTH${Date.now()}`.slice(0, 17),
      otherTenant.id,
    );
    const token = await loginManager();

    await request(app.getHttpServer())
      .delete(`/vehicles/${seeded.vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    const survived = await withTenantContext(dataSource, otherTenant.id, (m) =>
      m.getRepository(Vehicle).findOne({ where: { id: seeded.vehicle.id } }),
    );
    expect(survived).not.toBeNull();
  });
});
