import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { closeTestApp } from './close-test-app';

describe('Settings (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenant: Tenant;
  let manager: User;
  let worker: User;
  const MANAGER_PASSWORD = 'settings-test-password';
  const WORKER_PIN = '8642';

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
      tenantRepo.create({ name: `Settings Test Tenant ${Date.now()}` }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Settings Manager',
          email: 'settings-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Settings Worker',
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

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/settings').expect(401);
  });

  it('rejects a worker (manager/owner only)', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .get('/settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('returns the default AI confidence threshold for a fresh tenant', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get('/settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual({ aiConfidenceThreshold: 0.7 });
  });

  it('updates the AI confidence threshold and persists it', async () => {
    const token = await loginManager();

    await request(app.getHttpServer())
      .put('/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ aiConfidenceThreshold: 0.85 })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/settings')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(res.body).toEqual({ aiConfidenceThreshold: 0.85 });
  });

  it('rejects an out-of-range threshold', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .put('/settings')
      .set('Authorization', `Bearer ${token}`)
      .send({ aiConfidenceThreshold: 1.5 })
      .expect(400);
  });
});
