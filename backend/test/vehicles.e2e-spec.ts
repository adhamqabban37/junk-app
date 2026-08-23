import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { Part, PartStatus } from '../src/database/entities/part.entity';
import { PartTaxonomy } from '../src/database/entities/part-taxonomy.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { CrushStatus, Vehicle } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { closeTestApp } from './close-test-app';

describe('Vehicles (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenant: Tenant;
  let otherTenant: Tenant;
  let manager: User;
  let worker: User;
  let taxonomy: PartTaxonomy;
  let vehicleA: Vehicle;
  let vehicleB: Vehicle;
  const MANAGER_PASSWORD = 'vehicles-test-password';
  const WORKER_PIN = '1593';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    const tenantRepo = dataSource.getRepository(Tenant);
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: `Vehicles Test Tenant ${Date.now()}` }),
    );
    otherTenant = await tenantRepo.save(
      tenantRepo.create({ name: `Vehicles Test Other Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: `Door ${randomUUID()}`,
        category: 'Body',
        isQuickPick: false,
      }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Vehicles Manager',
          email: 'vehicles-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Vehicles Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );

    vehicleA = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: 'VEHATESTVIN12345',
          make: 'Honda',
          model: 'Accord',
          year: 2005,
          crushStatus: CrushStatus.ACTIVE,
        }),
      ),
    );
    vehicleB = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: 'VEHBTESTVIN12345',
          make: 'Toyota',
          model: 'Camry',
          year: 2010,
          crushStatus: CrushStatus.CRUSHED,
        }),
      ),
    );
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicleA.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.APPROVED,
        }),
      ),
    );

    await withTenantContext(dataSource, otherTenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: otherTenant.id,
          vin: 'OTHERTENANTVIN12',
          crushStatus: CrushStatus.ACTIVE,
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await dataSource.getRepository(Tenant).delete({ id: otherTenant.id });
    await dataSource.getRepository(PartTaxonomy).delete({ id: taxonomy.id });
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

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/vehicles').expect(401);
  });

  it('rejects a worker (manager/owner only)', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .get('/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('lists only the caller tenant vehicles, with parts count, never another tenant', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get('/vehicles')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      items: Array<{ id: string; vin: string; partsCount: number }>;
      total: number;
    };
    expect(body.total).toBe(2);
    expect(body.items.map((v) => v.vin).sort()).toEqual([
      'VEHATESTVIN12345',
      'VEHBTESTVIN12345',
    ]);
    expect(body.items.find((v) => v.id === vehicleA.id)?.partsCount).toBe(1);
    expect(body.items.find((v) => v.id === vehicleB.id)?.partsCount).toBe(0);
  });

  it('filters by crushStatus', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get('/vehicles?crushStatus=crushed')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { items: Array<{ id: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(vehicleB.id);
  });

  it('returns vehicle detail with its parts', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get(`/vehicles/${vehicleA.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({
      id: vehicleA.id,
      vin: 'VEHATESTVIN12345',
    });
    expect((res.body as { parts: unknown[] }).parts).toHaveLength(1);
  });

  it('404s for a vehicle in another tenant', async () => {
    const token = await loginManager();
    const otherVehicle = await withTenantContext(
      dataSource,
      otherTenant.id,
      (m) =>
        m
          .getRepository(Vehicle)
          .findOneOrFail({ where: { tenantId: otherTenant.id } }),
    );

    await request(app.getHttpServer())
      .get(`/vehicles/${otherVehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });
});
