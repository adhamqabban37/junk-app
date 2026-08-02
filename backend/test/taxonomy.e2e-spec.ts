import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { PartTaxonomy } from '../src/database/entities/part-taxonomy.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { closeTestApp } from './close-test-app';

describe('Taxonomy (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenant: Tenant;
  let worker: User;
  let taxonomyItem: PartTaxonomy;
  const WORKER_PIN = '1357';

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);

    // part_taxonomies has no RLS (shared reference data) — seeded directly
    // here so this test is hermetic rather than depending on `seed:dev`
    // having already run against this database.
    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomyItem = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: `Taxonomy Test Alternator ${Date.now()}`,
        category: 'Electrical',
        isQuickPick: true,
      }),
    );

    const tenantRepo = dataSource.getRepository(Tenant);
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: `Taxonomy Test Tenant ${Date.now()}` }),
    );
    worker = await withTenantContext(dataSource, tenant.id, (manager) =>
      manager.getRepository(User).save(
        manager.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Taxonomy Test Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await dataSource
      .getRepository(PartTaxonomy)
      .delete({ id: taxonomyItem.id });
    await closeTestApp(app);
  });

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/taxonomy').expect(401);
  });

  it('returns the shared taxonomy list to any authenticated role, including workers', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;

    const res = await request(app.getHttpServer())
      .get('/taxonomy')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const items = res.body as Array<{
      id: string;
      name: string;
      category: string;
      isQuickPick: boolean;
    }>;
    const seeded = items.find((item) => item.id === taxonomyItem.id);
    expect(seeded).toMatchObject({
      name: taxonomyItem.name,
      category: 'Electrical',
      isQuickPick: true,
    });
  });
});
