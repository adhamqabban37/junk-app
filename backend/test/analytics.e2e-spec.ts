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
import { Part, PartStatus } from '../src/database/entities/part.entity';
import { PartImage } from '../src/database/entities/part-image.entity';
import { PartTaxonomy } from '../src/database/entities/part-taxonomy.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { CrushStatus, Vehicle } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { closeTestApp } from './close-test-app';

describe('Analytics (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenant: Tenant;
  let otherTenant: Tenant;
  let manager: User;
  let worker: User;
  let taxonomy: PartTaxonomy;
  const MANAGER_PASSWORD = 'analytics-test-password';
  const WORKER_PIN = '2468';

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
      tenantRepo.create({ name: `Analytics Test Tenant ${Date.now()}` }),
    );
    otherTenant = await tenantRepo.save(
      tenantRepo.create({ name: `Analytics Test Other Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: 'Fender',
        category: 'Body',
        isQuickPick: false,
      }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Analytics Manager',
          email: 'analytics-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Analytics Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );

    await withTenantContext(dataSource, tenant.id, async (m) => {
      const vehicleA = await m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: 'ANALYTICSVINA123',
          crushStatus: CrushStatus.ACTIVE,
        }),
      );
      const vehicleB = await m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: 'ANALYTICSVINB123',
          crushStatus: CrushStatus.CRUSHED,
        }),
      );

      const approvedPart = await m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicleA.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.APPROVED,
        }),
      );
      const pendingPart = await m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicleB.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.PENDING_REVIEW,
        }),
      );

      const image = await m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: approvedPart.id,
          url: 'analytics/fixture.jpg',
        }),
      );
      await m.getRepository(AiAnalysis).save(
        m.getRepository(AiAnalysis).create({
          tenantId: tenant.id,
          partId: approvedPart.id,
          partImageId: image.id,
          modelVersion: 'test-model',
          grade: AiGrade.A,
          confidence: 0.95,
          status: AiAnalysisStatus.COMPLETE,
        }),
      );

      const image2 = await m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: pendingPart.id,
          url: 'analytics/fixture2.jpg',
        }),
      );
      await m.getRepository(AiAnalysis).save(
        m.getRepository(AiAnalysis).create({
          tenantId: tenant.id,
          partId: pendingPart.id,
          partImageId: image2.id,
          modelVersion: 'test-model',
          grade: AiGrade.C,
          confidence: 0.4,
          status: AiAnalysisStatus.COMPLETE,
        }),
      );
    });

    await withTenantContext(dataSource, otherTenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: otherTenant.id,
          vin: 'OTHERTENANTANLYT',
          crushStatus: CrushStatus.ACTIVE,
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await dataSource.getRepository(Tenant).delete({ id: otherTenant.id });
    // part_taxonomies is shared reference data with no RLS and no cascade
    // from Tenant, so deleting the tenant above does NOT reclaim this row.
    // Without this, every run leaks one more 'Fender' into the dev database
    // and pollutes the real part picker (12 had accumulated by 2026-08-06).
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
    await request(app.getHttpServer()).get('/analytics').expect(401);
  });

  it('rejects a worker (manager/owner only)', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .get('/analytics')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('aggregates parts-by-status, grade distribution, and vehicles-by-crush-status for the caller tenant only', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get('/analytics')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      totalVehicles: number;
      totalParts: number;
      partsByStatus: Record<string, number>;
      gradeDistribution: Record<string, number>;
      vehiclesByCrushStatus: Record<string, number>;
    };

    expect(body.totalVehicles).toBe(2);
    expect(body.totalParts).toBe(2);
    expect(body.partsByStatus.approved).toBe(1);
    expect(body.partsByStatus.pending_review).toBe(1);
    expect(body.gradeDistribution.A).toBe(1);
    expect(body.gradeDistribution.C).toBe(1);
    expect(body.vehiclesByCrushStatus.active).toBe(1);
    expect(body.vehiclesByCrushStatus.crushed).toBe(1);
  });
});
