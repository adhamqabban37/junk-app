import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { withTenantContext } from '../src/database/tenant-context';

// Force a tiny connection pool so the concurrent test below is guaranteed to
// reuse physical connections across tenants — the exact scenario the Phase 2
// planning-gate finding warns about (a stale app.tenant_id session variable
// leaking from one tenant's request into the next request that reuses the
// same pooled connection). Must be set before AppModule's ConfigModule reads
// process.env during Test.createTestingModule(...).compile() in beforeAll.
process.env.DB_POOL_MAX = '2';

interface AccessTokenBody {
  accessToken: string;
}

function accessTokenOf(res: { body: unknown }): string {
  return (res.body as AccessTokenBody).accessToken;
}

describe('Auth (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;

  let tenantA: Tenant;
  let tenantB: Tenant;
  let managerA: User;
  let managerB: User;
  let workerA: User;
  let workerB: User;

  const MANAGER_A_PASSWORD = 'tenant-a-password';
  const MANAGER_B_PASSWORD = 'tenant-b-password';
  const WORKER_A_PIN = '4321';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    dataSource = app.get(DataSource);

    const tenantRepo = dataSource.getRepository(Tenant);
    tenantA = await tenantRepo.save(
      tenantRepo.create({ name: `Auth Test Tenant A ${Date.now()}` }),
    );
    tenantB = await tenantRepo.save(
      tenantRepo.create({ name: `Auth Test Tenant B ${Date.now()}` }),
    );

    managerA = await withTenantContext(dataSource, tenantA.id, (manager) =>
      manager.getRepository(User).save(
        manager.getRepository(User).create({
          tenantId: tenantA.id,
          role: UserRole.MANAGER,
          name: 'Manager A',
          email: 'manager-a@auth-test.local',
          passwordHash: bcrypt.hashSync(MANAGER_A_PASSWORD, 4),
        }),
      ),
    );
    managerB = await withTenantContext(dataSource, tenantB.id, (manager) =>
      manager.getRepository(User).save(
        manager.getRepository(User).create({
          tenantId: tenantB.id,
          role: UserRole.MANAGER,
          name: 'Manager B',
          email: 'manager-b@auth-test.local',
          passwordHash: bcrypt.hashSync(MANAGER_B_PASSWORD, 4),
        }),
      ),
    );
    workerA = await withTenantContext(dataSource, tenantA.id, (manager) =>
      manager.getRepository(User).save(
        manager.getRepository(User).create({
          tenantId: tenantA.id,
          role: UserRole.WORKER,
          name: 'Worker A',
          pinHash: bcrypt.hashSync(WORKER_A_PIN, 4),
        }),
      ),
    );
    workerB = await withTenantContext(dataSource, tenantB.id, (manager) =>
      manager.getRepository(User).save(
        manager.getRepository(User).create({
          tenantId: tenantB.id,
          role: UserRole.WORKER,
          name: 'Worker B',
          pinHash: bcrypt.hashSync('9999', 4),
        }),
      ),
    );
  });

  afterAll(async () => {
    const tenantRepo = dataSource.getRepository(Tenant);
    await tenantRepo.delete({ id: tenantA.id });
    await tenantRepo.delete({ id: tenantB.id });
    await app.close();
  });

  it('manager login succeeds with correct credentials and fails with the wrong password', async () => {
    const ok = await request(app.getHttpServer())
      .post('/auth/login/manager')
      .send({
        tenantId: tenantA.id,
        email: managerA.email,
        password: MANAGER_A_PASSWORD,
      })
      .expect(200);
    expect(accessTokenOf(ok)).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post('/auth/login/manager')
      .send({
        tenantId: tenantA.id,
        email: managerA.email,
        password: 'wrong-password',
      })
      .expect(401);
  });

  it('worker PIN login succeeds with the correct PIN and fails with the wrong PIN', async () => {
    const ok = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenantA.id, userId: workerA.id, pin: WORKER_A_PIN })
      .expect(200);
    expect(accessTokenOf(ok)).toEqual(expect.any(String));

    await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenantA.id, userId: workerA.id, pin: '0000' })
      .expect(401);
  });

  it('protected routes reject requests with no token', async () => {
    await request(app.getHttpServer()).get('/auth/me').expect(401);
  });

  it('a valid token authenticates /auth/me with the correct claims', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login/manager')
      .send({
        tenantId: tenantA.id,
        email: managerA.email,
        password: MANAGER_A_PASSWORD,
      })
      .expect(200);

    const me = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Authorization', `Bearer ${accessTokenOf(login)}`)
      .expect(200);

    expect(me.body).toMatchObject({
      sub: managerA.id,
      tenantId: tenantA.id,
      role: UserRole.MANAGER,
    });
  });

  it('RBAC denies a worker-role token on a manager-only route', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenantA.id, userId: workerA.id, pin: WORKER_A_PIN })
      .expect(200);

    await request(app.getHttpServer())
      .get('/auth/workers')
      .set('Authorization', `Bearer ${accessTokenOf(login)}`)
      .expect(403);
  });

  it('a manager token only sees workers from their own tenant (RLS session var scoping)', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login/manager')
      .send({
        tenantId: tenantA.id,
        email: managerA.email,
        password: MANAGER_A_PASSWORD,
      })
      .expect(200);

    const res = await request(app.getHttpServer())
      .get('/auth/workers')
      .set('Authorization', `Bearer ${accessTokenOf(login)}`)
      .expect(200);

    const workers = res.body as Array<{ id: string }>;
    expect(workers).toHaveLength(1);
    expect(workers[0].id).toBe(workerA.id);
  });

  it('rapid concurrent requests from different tenants on a pooled connection never cross-leak data', async () => {
    const loginA = await request(app.getHttpServer())
      .post('/auth/login/manager')
      .send({
        tenantId: tenantA.id,
        email: managerA.email,
        password: MANAGER_A_PASSWORD,
      })
      .expect(200);
    const loginB = await request(app.getHttpServer())
      .post('/auth/login/manager')
      .send({
        tenantId: tenantB.id,
        email: managerB.email,
        password: MANAGER_B_PASSWORD,
      })
      .expect(200);

    const tokenA = accessTokenOf(loginA);
    const tokenB = accessTokenOf(loginB);
    const ownWorkerIdByTenant: Record<string, string> = {
      [tenantA.id]: workerA.id,
      [tenantB.id]: workerB.id,
    };
    const otherWorkerIdByTenant: Record<string, string> = {
      [tenantA.id]: workerB.id,
      [tenantB.id]: workerA.id,
    };

    const requests = Array.from({ length: 30 }, (_, i) => {
      const isTenantA = i % 2 === 0;
      const token = isTenantA ? tokenA : tokenB;
      const expectedTenant = isTenantA ? tenantA.id : tenantB.id;
      return request(app.getHttpServer())
        .get('/auth/workers')
        .set('Authorization', `Bearer ${token}`)
        .then((res) => ({ res, expectedTenant }));
    });

    const results = await Promise.all(requests);
    for (const { res, expectedTenant } of results) {
      expect(res.status).toBe(200);
      const returnedIds = (res.body as Array<{ id: string }>).map((w) => w.id);
      // A single occurrence of the other tenant's worker id here means this
      // response was served under the wrong tenant's RLS session context —
      // a cross-tenant data leak caused by pooled-connection reuse.
      expect(returnedIds).not.toContain(otherWorkerIdByTenant[expectedTenant]);
      expect(returnedIds).toEqual([ownWorkerIdByTenant[expectedTenant]]);
    }
  });
});
