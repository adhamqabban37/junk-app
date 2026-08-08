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
import { CrushStatus, Vehicle } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { closeTestApp } from './close-test-app';

describe('Part image file serving (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let uploadDir: string;

  let tenant: Tenant;
  let manager: User;
  let worker: User;
  let part: Part;
  let image: PartImage;
  let taxonomy: PartTaxonomy;
  const MANAGER_PASSWORD = 'part-image-file-password';
  const WORKER_PIN = '6284';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'junkyard-part-image-file-test-'),
    );
    process.env.UPLOAD_DIR = uploadDir;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    const tenantRepo = dataSource.getRepository(Tenant);
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: `Part Image File Test Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: 'Radiator',
        category: 'Cooling',
        isQuickPick: false,
      }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Part Image File Manager',
          email: 'part-image-file-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Part Image File Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );

    const vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: 'PARTIMGFILEVIN123',
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

    const relativePath = `${tenant.id}/${part.id}/fixture.jpg`;
    await fs.mkdir(path.join(uploadDir, tenant.id, part.id), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(uploadDir, relativePath),
      Buffer.from('fake-jpeg-bytes'),
    );
    image = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: part.id,
          url: relativePath,
          qualityFlags: null,
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    // Shared reference data -- no RLS, no cascade from Tenant. See the same
    // note in analytics.e2e-spec.ts; this suite was leaking a 'Radiator'
    // row per run, which collides by name with the real seeded one.
    await dataSource.getRepository(PartTaxonomy).delete({ id: taxonomy.id });
    await closeTestApp(app);
    await fs.rm(uploadDir, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
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
    await request(app.getHttpServer())
      .get(`/parts/${part.id}/images/${image.id}/file`)
      .expect(401);
  });

  it('rejects a worker (manager/owner only)', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .get(`/parts/${part.id}/images/${image.id}/file`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('404s for an image id that does not belong to the given part', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .get(`/parts/${part.id}/images/00000000-0000-0000-0000-000000000099/file`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  });

  it('returns the real image bytes with the correct content-type for a manager', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get(`/parts/${part.id}/images/${image.id}/file`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.headers['content-type']).toContain('image/jpeg');
    expect(Buffer.from(res.body as Buffer).toString()).toBe('fake-jpeg-bytes');
  });

  it("is tenant-isolated: a manager from another tenant gets 404, not another tenant's image", async () => {
    const otherTenant = await dataSource.getRepository(Tenant).save(
      dataSource.getRepository(Tenant).create({
        name: `Part Image File Other Tenant ${Date.now()}`,
      }),
    );
    const OTHER_PASSWORD = 'other-tenant-password';
    const otherManager = await withTenantContext(
      dataSource,
      otherTenant.id,
      (m) =>
        m.getRepository(User).save(
          m.getRepository(User).create({
            tenantId: otherTenant.id,
            role: UserRole.MANAGER,
            name: 'Other Tenant Manager',
            email: 'other-tenant-manager@test.local',
            passwordHash: bcrypt.hashSync(OTHER_PASSWORD, 4),
          }),
        ),
    );

    const login = await request(app.getHttpServer())
      .post('/auth/login/manager')
      .send({
        tenantId: otherTenant.id,
        email: otherManager.email,
        password: OTHER_PASSWORD,
      })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .get(`/parts/${part.id}/images/${image.id}/file`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);

    await dataSource.getRepository(Tenant).delete({ id: otherTenant.id });
  });
});
