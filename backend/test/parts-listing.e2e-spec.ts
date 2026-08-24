import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
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

describe('Parts listing/detail/approve (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenant: Tenant;
  let manager: User;
  let worker: User;
  let taxonomy: PartTaxonomy;
  let vehicle: Vehicle;
  let reviewPart: Part;
  let approvedPart: Part;
  let multiPhotoPart: Part;
  let multiPhotoWorstAnalysis: AiAnalysis;
  let xAndRealGradePart: Part;
  let allXPart: Part;
  const MANAGER_PASSWORD = 'parts-listing-password';
  const WORKER_PIN = '3571';

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
      tenantRepo.create({ name: `Parts Listing Test Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: `Alternator ${randomUUID()}`,
        category: 'Electrical',
        isQuickPick: false,
      }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Parts Listing Manager',
          email: 'parts-listing-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Parts Listing Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );

    vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: 'PARTSLISTVIN1234',
          make: 'Ford',
          model: 'F-150',
          year: 2015,
          crushStatus: CrushStatus.ACTIVE,
        }),
      ),
    );

    reviewPart = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.PENDING_REVIEW,
        }),
      ),
    );
    const reviewImage = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: reviewPart.id,
          url: 'fixture.jpg',
          qualityFlags: null,
        }),
      ),
    );
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(AiAnalysis).save(
        m.getRepository(AiAnalysis).create({
          tenantId: tenant.id,
          partId: reviewPart.id,
          partImageId: reviewImage.id,
          modelVersion: 'gemini-2.0-flash',
          grade: AiGrade.C,
          damageCodes: ['rust'],
          confidence: 0.4,
          status: AiAnalysisStatus.COMPLETE,
        }),
      ),
    );

    approvedPart = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.APPROVED,
        }),
      ),
    );

    // Two photos of the same Part (e.g. via a manual multi-select assign),
    // graded independently -- one clean angle (A), one showing real damage
    // (C). The Part's displayed grade must reflect the worse of the two,
    // not whichever image happened to be graded most recently.
    multiPhotoPart = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.PENDING_REVIEW,
        }),
      ),
    );
    const cleanImage = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: multiPhotoPart.id,
          url: 'clean-angle.jpg',
          qualityFlags: null,
        }),
      ),
    );
    const damagedImage = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: multiPhotoPart.id,
          url: 'damaged-angle.jpg',
          qualityFlags: null,
        }),
      ),
    );
    // Saved older-first, graded-worse-second -- proves the aggregation
    // picks the worst grade, not just the most recently created row.
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(AiAnalysis).save(
        m.getRepository(AiAnalysis).create({
          tenantId: tenant.id,
          partId: multiPhotoPart.id,
          partImageId: cleanImage.id,
          modelVersion: 'gemini-2.0-flash',
          grade: AiGrade.A,
          damageCodes: ['scratch'],
          confidence: 0.9,
          status: AiAnalysisStatus.COMPLETE,
        }),
      ),
    );
    multiPhotoWorstAnalysis = await withTenantContext(
      dataSource,
      tenant.id,
      (m) =>
        m.getRepository(AiAnalysis).save(
          m.getRepository(AiAnalysis).create({
            tenantId: tenant.id,
            partId: multiPhotoPart.id,
            partImageId: damagedImage.id,
            modelVersion: 'gemini-2.0-flash',
            grade: AiGrade.C,
            damageCodes: ['rust'],
            confidence: 0.6,
            status: AiAnalysisStatus.COMPLETE,
          }),
        ),
    );

    // X ("insufficient information") from one blurry angle must never mask
    // a real grade found from a different, clearer angle of the same Part.
    xAndRealGradePart = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.PENDING_REVIEW,
        }),
      ),
    );
    const blurryImage = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: xAndRealGradePart.id,
          url: 'blurry-angle.jpg',
          qualityFlags: null,
        }),
      ),
    );
    const clearImage = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: xAndRealGradePart.id,
          url: 'clear-angle.jpg',
          qualityFlags: null,
        }),
      ),
    );
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(AiAnalysis).save(
        m.getRepository(AiAnalysis).create({
          tenantId: tenant.id,
          partId: xAndRealGradePart.id,
          partImageId: blurryImage.id,
          modelVersion: 'gemini-2.0-flash',
          grade: AiGrade.X,
          damageCodes: [],
          confidence: 0.3,
          status: AiAnalysisStatus.COMPLETE,
        }),
      ),
    );
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(AiAnalysis).save(
        m.getRepository(AiAnalysis).create({
          tenantId: tenant.id,
          partId: xAndRealGradePart.id,
          partImageId: clearImage.id,
          modelVersion: 'gemini-2.0-flash',
          grade: AiGrade.B,
          damageCodes: ['dent'],
          confidence: 0.8,
          status: AiAnalysisStatus.COMPLETE,
        }),
      ),
    );

    // Every image is X -- there's no real grade to surface, so the Part
    // itself should report X too.
    allXPart = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.PENDING_REVIEW,
        }),
      ),
    );
    const allXImage = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: allXPart.id,
          url: 'unassessable-angle.jpg',
          qualityFlags: null,
        }),
      ),
    );
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(AiAnalysis).save(
        m.getRepository(AiAnalysis).create({
          tenantId: tenant.id,
          partId: allXPart.id,
          partImageId: allXImage.id,
          modelVersion: 'gemini-2.0-flash',
          grade: AiGrade.X,
          damageCodes: [],
          confidence: 0.2,
          status: AiAnalysisStatus.COMPLETE,
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
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
    await request(app.getHttpServer()).get('/parts').expect(401);
  });

  it('rejects a worker (manager/owner only)', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .get('/parts')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('lists parts with vehicle, taxonomy, and latest AI analysis embedded', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get('/parts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      items: Array<{
        id: string;
        taxonomyName: string;
        vehicle: { vin: string };
        latestAnalysis: { grade: string; confidence: string | number } | null;
      }>;
      total: number;
    };
    // reviewPart, approvedPart, multiPhotoPart, xAndRealGradePart, allXPart.
    expect(body.total).toBe(5);
    const found = body.items.find((p) => p.id === reviewPart.id);
    expect(found?.taxonomyName).toBe(taxonomy.name);
    expect(found?.vehicle.vin).toBe('PARTSLISTVIN1234');
    expect(found?.latestAnalysis?.grade).toBe('C');
    expect(Number(found?.latestAnalysis?.confidence)).toBeCloseTo(0.4);

    const approved = body.items.find((p) => p.id === approvedPart.id);
    expect(approved?.latestAnalysis).toBeNull();
  });

  it("a Part with multiple graded photos shows the worst grade and every photo's damage codes, not just the latest photo's", async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get('/parts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      items: Array<{
        id: string;
        latestAnalysis: {
          id: string;
          grade: string;
          damageCodes: string[];
          confidence: string | number;
        } | null;
      }>;
    };
    const found = body.items.find((p) => p.id === multiPhotoPart.id);
    // Worse of the two grades (C beats A), from the analysis that
    // actually produced it -- confirms the "controlling" row is real,
    // not a synthesized average, so correction-recording still has a
    // valid AiAnalysis id to attach to.
    expect(found?.latestAnalysis?.id).toBe(multiPhotoWorstAnalysis.id);
    expect(found?.latestAnalysis?.grade).toBe('C');
    expect(Number(found?.latestAnalysis?.confidence)).toBeCloseTo(0.6);
    // Union of both photos' damage codes, not just the controlling row's.
    expect(found?.latestAnalysis?.damageCodes.sort()).toEqual([
      'rust',
      'scratch',
    ]);

    const detailRes = await request(app.getHttpServer())
      .get(`/parts/${multiPhotoPart.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const detail = detailRes.body as {
      latestAnalysis: { grade: string; damageCodes: string[] } | null;
    };
    expect(detail.latestAnalysis?.grade).toBe('C');
    expect(detail.latestAnalysis?.damageCodes.sort()).toEqual([
      'rust',
      'scratch',
    ]);
  });

  it('an X ("insufficient information") reading from one angle never masks a real grade found from another angle of the same Part', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get('/parts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as {
      items: Array<{ id: string; latestAnalysis: { grade: string } | null }>;
    };
    const found = body.items.find((p) => p.id === xAndRealGradePart.id);
    expect(found?.latestAnalysis?.grade).toBe('B');
  });

  it('reports X when every photo of a Part came back as X', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get('/parts')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    const body = res.body as {
      items: Array<{ id: string; latestAnalysis: { grade: string } | null }>;
    };
    const found = body.items.find((p) => p.id === allXPart.id);
    expect(found?.latestAnalysis?.grade).toBe('X');
  });

  it('filters by status', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get('/parts?status=approved')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as { items: Array<{ id: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.items[0].id).toBe(approvedPart.id);
  });

  it('returns part detail with photos and latest analysis', async () => {
    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .get(`/parts/${reviewPart.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.body).toMatchObject({
      id: reviewPart.id,
      taxonomyName: taxonomy.name,
    });
    expect((res.body as { photos: unknown[] }).photos).toHaveLength(1);
  });

  it('approve moves a part to approved status, manager/owner only', async () => {
    const workerLogin = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    await request(app.getHttpServer())
      .post(`/parts/${reviewPart.id}/approve`)
      .set(
        'Authorization',
        `Bearer ${(workerLogin.body as { accessToken: string }).accessToken}`,
      )
      .expect(403);

    const token = await loginManager();
    await request(app.getHttpServer())
      .post(`/parts/${reviewPart.id}/approve`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const updated = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).findOneOrFail({ where: { id: reviewPart.id } }),
    );
    expect(updated.status).toBe(PartStatus.APPROVED);
  });
});
