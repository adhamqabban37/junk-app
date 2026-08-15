import 'reflect-metadata';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
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
import { Vehicle, CrushStatus } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { closeTestApp } from './close-test-app';

describe('Corrections (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenant: Tenant;
  let manager: User;
  let worker: User;
  let taxonomy: PartTaxonomy;
  let analysis: AiAnalysis;
  let partId: string;
  const MANAGER_PASSWORD = 'correction-tests-password';
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
      tenantRepo.create({ name: `Corrections Test Tenant ${Date.now()}` }),
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
          name: 'Manager',
          email: 'corrections-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );

    const vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: 'CORRECTVIN123456',
          crushStatus: CrushStatus.ACTIVE,
        }),
      ),
    );
    const part = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.PENDING_REVIEW,
        }),
      ),
    );
    partId = part.id;
    const partImage = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: part.id,
          url: `${tenant.id}/${part.id}/fixture.jpg`,
          qualityFlags: null,
        }),
      ),
    );
    analysis = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(AiAnalysis).save(
        m.getRepository(AiAnalysis).create({
          tenantId: tenant.id,
          partId: part.id,
          partImageId: partImage.id,
          modelVersion: 'gemini-2.0-flash',
          grade: AiGrade.B,
          damageCodes: ['scratch'],
          confidence: 0.7,
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
    await request(app.getHttpServer())
      .post(`/ai-analyses/${analysis.id}/corrections`)
      .send({ field: 'grade', correctedValue: 'A' })
      .expect(401);
  });

  it('rejects a worker (manager/owner only)', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;

    await request(app.getHttpServer())
      .post(`/ai-analyses/${analysis.id}/corrections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ field: 'grade', correctedValue: 'A' })
      .expect(403);
  });

  it('records a correction with the prior AI value captured as originalValue', async () => {
    const token = await loginManager();

    const res = await request(app.getHttpServer())
      .post(`/ai-analyses/${analysis.id}/corrections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ field: 'grade', correctedValue: 'A' })
      .expect(201);

    const correctionId = (res.body as { id: string }).id;
    const correction = await withTenantContext(dataSource, tenant.id, (m) =>
      m
        .getRepository(HumanCorrection)
        .findOneOrFail({ where: { id: correctionId } }),
    );
    expect(correction).toMatchObject({
      field: 'grade',
      originalValue: 'B',
      correctedValue: 'A',
      correctedByUserId: manager.id,
      aiAnalysisId: analysis.id,
    });
  });

  // INVERTED DELIBERATELY (2026-08-12) -- read this before "fixing" it back.
  //
  // This test used to assert the opposite: that a correction was written
  // ONTO the AiAnalysis row. That was the behaviour, and it was wrong.
  // human_corrections joins back to ai_analyses for the model version and
  // the confidence at prediction time, so mutating the analysis silently
  // corrupted the training context of every correction attached to it, and
  // a field corrected twice lost its intermediate prediction outright --
  // the exact dataset CLAUDE.md rule 6 exists to protect.
  //
  // The prediction is now immutable and the human's answer lives on the
  // Part. The user-visible behaviour this test originally protected (a
  // corrected grade reaching Inventory and the CSV export) is unchanged and
  // is covered by the next test.
  it('does NOT mutate the AI analysis -- the prediction is immutable', async () => {
    const token = await loginManager();

    await request(app.getHttpServer())
      .post(`/ai-analyses/${analysis.id}/corrections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ field: 'grade', correctedValue: 'C' })
      .expect(201);

    const untouched = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(AiAnalysis).findOneOrFail({ where: { id: analysis.id } }),
    );
    // Still exactly what the model predicted in beforeAll, despite two
    // corrections (B -> A in the previous test, then A -> C here).
    expect(untouched.grade).toBe(AiGrade.B);
    expect(untouched.damageCodes).toEqual(['scratch']);
  });

  it('surfaces the corrected grade through the parts API, so Inventory/CSV export show it instead of the AI original', async () => {
    const token = await loginManager();

    await request(app.getHttpServer())
      .post(`/ai-analyses/${analysis.id}/corrections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ field: 'grade', correctedValue: 'D' })
      .expect(201);

    const res = await request(app.getHttpServer())
      .get(`/parts/${partId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const body = res.body as {
      latestAnalysis: { id: string; grade: string; gradeSource: string };
    };
    expect(body.latestAnalysis.grade).toBe('D');
    expect(body.latestAnalysis.gradeSource).toBe('human');
    // Still the real analysis id -- the UI POSTs corrections against it.
    expect(body.latestAnalysis.id).toBe(analysis.id);
  });

  // The chain records what was actually replaced. A second correction
  // replaces the first human answer, not the AI's original prediction --
  // otherwise the log would misrepresent what changed.
  it('records the previous human answer as originalValue on a re-correction', async () => {
    const token = await loginManager();

    const res = await request(app.getHttpServer())
      .post(`/ai-analyses/${analysis.id}/corrections`)
      .set('Authorization', `Bearer ${token}`)
      .send({ field: 'grade', correctedValue: 'A' })
      .expect(201);

    const correction = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(HumanCorrection).findOneOrFail({
        where: { id: (res.body as { id: string }).id },
      }),
    );
    // 'D' from the previous test, not 'B' from the AI.
    expect(correction.originalValue).toBe('D');
  });

  it('404s when the AI analysis does not exist', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post('/ai-analyses/00000000-0000-0000-0000-000000000099/corrections')
      .set('Authorization', `Bearer ${token}`)
      .send({ field: 'grade', correctedValue: 'A' })
      .expect(404);
  });
});
