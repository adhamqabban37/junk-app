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

describe('Parts CSV export (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let tenant: Tenant;
  let manager: User;
  let taxonomy: PartTaxonomy;
  let approvedPart: Part;
  const MANAGER_PASSWORD = 'export-test-password';

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
      tenantRepo.create({ name: `Export Test Tenant ${Date.now()}` }),
    );

    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    taxonomy = await taxonomyRepo.save(
      taxonomyRepo.create({
        // Keeps the comma deliberately -- this suite is also asserting
        // that CSV export quotes a comma-containing title field correctly.
        name: `Radiator, Aluminum ${randomUUID()}`,
        category: 'Cooling',
        isQuickPick: false,
      }),
    );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Export Manager',
          email: 'export-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );

    const vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: 'EXPORTTESTVIN123',
          make: 'Ford',
          model: 'F-150',
          year: 2015,
          crushStatus: CrushStatus.ACTIVE,
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
    const image = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).save(
        m.getRepository(PartImage).create({
          tenantId: tenant.id,
          partId: approvedPart.id,
          url: 'fixture.jpg',
          qualityFlags: null,
        }),
      ),
    );
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(AiAnalysis).save(
        m.getRepository(AiAnalysis).create({
          tenantId: tenant.id,
          partId: approvedPart.id,
          partImageId: image.id,
          modelVersion: 'gemini-2.0-flash',
          grade: AiGrade.B,
          damageCodes: ['scratch', 'dent'],
          confidence: 0.82,
          status: AiAnalysisStatus.COMPLETE,
        }),
      ),
    );

    // A pending_ai part -- must never appear in the export (not ready for
    // marketplace listing).
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).save(
        m.getRepository(Part).create({
          tenantId: tenant.id,
          vehicleId: vehicle.id,
          taxonomyId: taxonomy.id,
          status: PartStatus.PENDING_AI,
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await dataSource.getRepository(PartTaxonomy).delete({ id: taxonomy.id });
    await closeTestApp(app);
  });

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/parts/export.csv').expect(401);
  });

  it('exports approved/listed parts as CSV with the expected columns, quoting a comma-containing field correctly', async () => {
    const login = await request(app.getHttpServer())
      .post('/auth/login/manager')
      .send({
        tenantId: tenant.id,
        email: manager.email,
        password: MANAGER_PASSWORD,
      })
      .expect(200);
    const token = (login.body as { accessToken: string }).accessToken;

    const res = await request(app.getHttpServer())
      .get('/parts/export.csv')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('attachment');

    const lines = res.text.trim().split('\n');
    expect(lines[0]).toBe(
      'id,vin,title,description,grade,damage_codes,confidence,status,price',
    );
    // Exactly one data row -- the pending_ai part must be excluded.
    expect(lines).toHaveLength(2);

    const row = lines[1];
    expect(row).toContain(approvedPart.id);
    expect(row).toContain('EXPORTTESTVIN123');
    // The title contains a comma (from the taxonomy name) -- correct CSV
    // quotes the whole field, not just the comma-containing substring.
    expect(row).toContain(`"2015 Ford F-150 ${taxonomy.name}"`);
    expect(row).toContain('scratch;dent');
    expect(row).toContain(',B,');
  });
});
