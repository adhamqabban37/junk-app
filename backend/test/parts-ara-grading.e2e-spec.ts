import 'reflect-metadata';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DataSource, In } from 'typeorm';
import { AppModule } from '../src/app.module';
import { GeminiService } from '../src/ai/gemini.service';
import {
  AiAnalysis,
  AiAnalysisStatus,
  AiGrade,
} from '../src/database/entities/ai-analysis.entity';
import { Part, PartStatus } from '../src/database/entities/part.entity';
import { PartTaxonomy } from '../src/database/entities/part-taxonomy.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { CrushStatus, Vehicle } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { closeTestApp } from './close-test-app';

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 15000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

describe('ARA-style A/B/C/X sheet-metal grading (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let uploadDir: string;
  let fakeGemini: {
    analyzePartImage: jest.Mock;
    analyzeSheetMetalDamage: jest.Mock;
  };

  let tenant: Tenant;
  let manager: User;
  let sheetMetalTaxonomy: PartTaxonomy;
  let otherTaxonomy: PartTaxonomy;
  let vehicle: Vehicle;
  const MANAGER_PASSWORD = 'ara-grading-test-password';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'junkyard-ara-test-'));
    process.env.UPLOAD_DIR = uploadDir;

    fakeGemini = {
      analyzePartImage: jest.fn().mockResolvedValue({
        grade: 'A',
        damage_codes: [],
        confidence: 0.9,
      }),
      analyzeSheetMetalDamage: jest.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(GeminiService)
      .useValue(fakeGemini)
      .compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);

    const tenantRepo = dataSource.getRepository(Tenant);
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: `ARA Grading Test Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    sheetMetalTaxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: `Fender ${randomUUID()}`,
        category: 'Body',
        isSheetMetal: true,
      }),
    );
    otherTaxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        name: `Alternator ${randomUUID()}`,
        category: 'Electrical',
        isSheetMetal: false,
      }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'ARA Grading Test Manager',
          email: 'ara-grading-test-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await dataSource
      .getRepository(PartTaxonomy)
      .delete({ id: In([sheetMetalTaxonomy.id, otherTaxonomy.id]) });
    await closeTestApp(app);
    await fs.rm(uploadDir, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  });

  beforeEach(async () => {
    fakeGemini.analyzePartImage.mockClear();
    fakeGemini.analyzeSheetMetalDamage.mockClear();
    vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: `AG${randomUUID().slice(0, 15).toUpperCase()}`,
          crushStatus: CrushStatus.ACTIVE,
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

  async function uploadPhotoToNewPart(
    token: string,
    taxonomyId: string,
  ): Promise<{ imageId: string }> {
    const part = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId,
          status: PartStatus.PENDING_AI,
        }),
      ),
    );
    const uploadRes = await request(app.getHttpServer())
      .post(`/parts/${part.id}/images`)
      .set('Authorization', `Bearer ${token}`)
      .attach('file', Buffer.from(`photo-${randomUUID()}`), 'photo.jpg')
      .expect(201);
    return { imageId: (uploadRes.body as { id: string }).id };
  }

  it('computes grade and damage units from itemized ARA damage for a sheet-metal part -- never trusts a grade from Gemini for this path', async () => {
    fakeGemini.analyzeSheetMetalDamage.mockResolvedValueOnce({
      assessable: true,
      damage: [
        {
          location: 'front edge',
          damage_type: 'crease_dent',
          severity: 'moderate',
        }, // 1 unit
        { location: 'center', damage_type: 'scratch', severity: 'minor' }, // 0.25 units
      ],
      confidence: 0.85,
    });
    const token = await loginManager();
    const { imageId } = await uploadPhotoToNewPart(
      token,
      sheetMetalTaxonomy.id,
    );

    await waitFor(async () => {
      const a = await withTenantContext(dataSource, tenant.id, (m) =>
        m
          .getRepository(AiAnalysis)
          .findOne({ where: { partImageId: imageId } }),
      );
      return a?.status === AiAnalysisStatus.COMPLETE;
    });

    const analysis = await withTenantContext(dataSource, tenant.id, (m) =>
      m
        .getRepository(AiAnalysis)
        .findOneOrFail({ where: { partImageId: imageId } }),
    );
    expect(fakeGemini.analyzeSheetMetalDamage).toHaveBeenCalledWith(
      expect.any(Buffer),
      'image/jpeg',
      sheetMetalTaxonomy.name,
    );
    expect(fakeGemini.analyzePartImage).not.toHaveBeenCalled();
    expect(Number(analysis.damageUnits)).toBeCloseTo(1.25);
    expect(analysis.grade).toBe(AiGrade.B); // >1-2 units
    expect(analysis.araDamageCodes).toHaveLength(2);
    expect(analysis.damageCodes).toEqual([
      'front edge Crease/Dent (moderate)',
      'center Scratch (minor)',
    ]);
  }, 20000);

  it('grades X regardless of detected damage when Gemini flags the photo as not assessable', async () => {
    fakeGemini.analyzeSheetMetalDamage.mockResolvedValueOnce({
      assessable: false,
      damage: [
        { location: 'unknown', damage_type: 'missing', severity: 'major' },
      ],
      confidence: 0.3,
    });
    const token = await loginManager();
    const { imageId } = await uploadPhotoToNewPart(
      token,
      sheetMetalTaxonomy.id,
    );

    await waitFor(async () => {
      const a = await withTenantContext(dataSource, tenant.id, (m) =>
        m
          .getRepository(AiAnalysis)
          .findOne({ where: { partImageId: imageId } }),
      );
      return a?.status === AiAnalysisStatus.COMPLETE;
    });

    const analysis = await withTenantContext(dataSource, tenant.id, (m) =>
      m
        .getRepository(AiAnalysis)
        .findOneOrFail({ where: { partImageId: imageId } }),
    );
    expect(analysis.grade).toBe(AiGrade.X);
    expect(Number(analysis.damageUnits)).toBe(0);
  }, 20000);

  it('leaves a non-sheet-metal part on the exact original Gemini path, with no ARA fields populated', async () => {
    const token = await loginManager();
    const { imageId } = await uploadPhotoToNewPart(token, otherTaxonomy.id);

    await waitFor(async () => {
      const a = await withTenantContext(dataSource, tenant.id, (m) =>
        m
          .getRepository(AiAnalysis)
          .findOne({ where: { partImageId: imageId } }),
      );
      return a?.status === AiAnalysisStatus.COMPLETE;
    });

    const analysis = await withTenantContext(dataSource, tenant.id, (m) =>
      m
        .getRepository(AiAnalysis)
        .findOneOrFail({ where: { partImageId: imageId } }),
    );
    expect(fakeGemini.analyzePartImage).toHaveBeenCalledTimes(1);
    expect(fakeGemini.analyzeSheetMetalDamage).not.toHaveBeenCalled();
    expect(analysis.grade).toBe(AiGrade.A);
    expect(analysis.damageUnits).toBeNull();
    expect(analysis.araDamageCodes).toBeNull();
  }, 20000);
});
