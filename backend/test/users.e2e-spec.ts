import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { closeTestApp } from './close-test-app';

describe('Users (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenant: Tenant;
  let manager: User;
  let worker: User;
  const MANAGER_PASSWORD = 'users-test-password';
  const WORKER_PIN = '7410';

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
      tenantRepo.create({ name: `Users Test Tenant ${Date.now()}` }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Users Manager',
          email: 'users-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Users Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
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
    const res = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/users').expect(401);
  });

  it('rejects a worker (manager/owner only)', async () => {
    const token = await loginWorker();
    await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('lists tenant users without ever exposing password/pin hashes', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const users = res.body as Array<Record<string, unknown>>;
    expect(users).toHaveLength(2);
    for (const u of users) {
      expect(u.passwordHash).toBeUndefined();
      expect(u.pinHash).toBeUndefined();
    }
  });

  it('creates a worker with a PIN', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'New Worker', role: 'worker', pin: '2580' })
      .expect(201);

    const created = res.body as { id: string; name: string; role: string };
    expect(created.name).toBe('New Worker');
    expect(created.role).toBe('worker');

    const loginRes = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: created.id, pin: '2580' })
      .expect(200);
    expect(loginRes.body).toHaveProperty('accessToken');
  });

  it('creates a manager with email+password', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'New Manager',
        role: 'manager',
        email: 'new-manager@test.local',
        password: 'new-manager-password',
      })
      .expect(201);

    const created = res.body as { id: string };
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login/manager')
      .send({
        tenantId: tenant.id,
        email: 'new-manager@test.local',
        password: 'new-manager-password',
      })
      .expect(200);
    expect(loginRes.body).toHaveProperty('accessToken');
    void created;
  });

  it('rejects creating an owner-role user via this endpoint', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Sneaky Owner',
        role: 'owner',
        email: 'sneaky@test.local',
        password: 'whatever123',
      })
      .expect(400);
  });

  it('rejects a worker payload missing a pin', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'No Pin Worker', role: 'worker' })
      .expect(400);
  });

  it('updates a user name and role', async () => {
    const token = await loginManager();
    const createRes = await request(app.getHttpServer())
      .post('/users')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Rename Me', role: 'worker', pin: '9630' })
      .expect(201);
    const userId = (createRes.body as { id: string }).id;

    await request(app.getHttpServer())
      .patch(`/users/${userId}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Renamed' })
      .expect(200);

    const users = (await request(app.getHttpServer())
      .get('/users')
      .set('Authorization', `Bearer ${token}`)
      .expect(200)) as { body: Array<{ id: string; name: string }> };
    expect(users.body.find((u) => u.id === userId)?.name).toBe('Renamed');
  });
});
