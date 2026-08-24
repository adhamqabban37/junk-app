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
import { PricingHistory } from '../src/database/entities/pricing-history.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { CrushStatus, Vehicle } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { closeTestApp } from './close-test-app';

describe('POST /parts/:id/price -- manual pricing from the Inventory tab (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenant: Tenant;
  let manager: User;
  let worker: User;
  let taxonomy: PartTaxonomy;
  let vehicle: Vehicle;
  let part: Part;
  const MANAGER_PASSWORD = 'pricing-test-password';
  const WORKER_PIN = '4826';

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
      tenantRepo.create({ name: `Pricing Test Tenant ${Date.now()}` }),
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
          name: 'Pricing Test Manager',
          email: 'pricing-test-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Pricing Test Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await dataSource.getRepository(PartTaxonomy).delete({ id: taxonomy.id });
    await closeTestApp(app);
  });

  beforeEach(async () => {
    vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: `PR${randomUUID().slice(0, 15).toUpperCase()}`,
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
          status: PartStatus.APPROVED,
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
      .post(`/parts/${part.id}/price`)
      .send({ price: 49.99 })
      .expect(401);
  });

  it('rejects a worker (manager/owner only)', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 49.99 })
      .expect(403);
  });

  it('404s for a part that does not exist', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/parts/${randomUUID()}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 49.99 })
      .expect(404);
  });

  it('400s for a negative price', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: -5 })
      .expect(400);
  });

  it('records a manual price and returns it from the list endpoint as latestPrice', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 129.5 })
      .expect(200, { status: 'priced', price: 129.5 });

    const res = await request(app.getHttpServer())
      .get(`/parts?vehicleId=${vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const items = (
      res.body as { items: { id: string; latestPrice: string | null }[] }
    ).items;
    const found = items.find((i) => i.id === part.id);
    expect(Number(found?.latestPrice)).toBeCloseTo(129.5);
  });

  it('setting a second price appends to the history and list() reflects the newest one, not the first', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 100 })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/parts/${part.id}/price`)
      .set('Authorization', `Bearer ${token}`)
      .send({ price: 80 })
      .expect(200);

    const history = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PricingHistory).find({ where: { partId: part.id } }),
    );
    // Both rows kept -- append-only log, not an update-in-place.
    expect(history).toHaveLength(2);

    const res = await request(app.getHttpServer())
      .get(`/parts?vehicleId=${vehicle.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const items = (
      res.body as { items: { id: string; latestPrice: string | null }[] }
    ).items;
    const found = items.find((i) => i.id === part.id);
    expect(Number(found?.latestPrice)).toBeCloseTo(80);
  });
});
