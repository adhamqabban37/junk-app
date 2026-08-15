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
import { configureApp } from '../src/configure-app';
import { GeminiService } from '../src/ai/gemini.service';
import { AiAnalysis } from '../src/database/entities/ai-analysis.entity';
import { Part, PartStatus } from '../src/database/entities/part.entity';
import { PartImage } from '../src/database/entities/part-image.entity';
import { PartTaxonomy } from '../src/database/entities/part-taxonomy.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import {
  VehicleImage,
  VehicleImageAngle,
} from '../src/database/entities/vehicle-image.entity';
import { CrushStatus, Vehicle } from '../src/database/entities/vehicle.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { LocalFileStorage } from '../src/storage/local-file-storage';
import { closeTestApp } from './close-test-app';

/**
 * Minimal buffer sniffImageMime() recognises as a JPEG. Must be at least 12
 * bytes -- the sniffer rejects anything shorter outright, before it even
 * looks at the magic bytes.
 */
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(12, 0),
]);

/** The NHTSA decode shape stored on Vehicle.decodedRaw. */
function decodedRaw(vars: Record<string, string>) {
  return {
    Results: Object.entries(vars).map(([Variable, Value]) => ({
      Variable,
      Value,
    })),
  };
}

/**
 * POST /vehicles/:id/scan -- the manager-side "find and grade every part in
 * these photos" path.
 *
 * Gemini is faked throughout: these tests are about what gets *filed* from a
 * detection, not about the model. The single most important assertion in
 * here is that `analyzePartImage` is never called -- re-running the
 * single-part grading prompt over a scene photo would stamp one arbitrary
 * grade onto every part in it.
 */
describe('Vehicle scan (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let storage: LocalFileStorage;
  let uploadDir: string;
  let fakeGemini: {
    detectPartsInImage: jest.Mock;
    analyzePartImage: jest.Mock;
  };

  let tenant: Tenant;
  let manager: User;
  const MANAGER_PASSWORD = 'vehicle-scan-password';
  const WORKER_PIN = '5150';

  /**
   * Taxonomy rows are find-or-create, and only rows this suite actually
   * created are deleted. Both halves matter: locally the seeded rows already
   * exist and creating another would pollute every worker's real part picker,
   * while CI runs migrations WITHOUT the taxonomy seed, so nothing exists at
   * all and the suite has to make its own.
   */
  const createdTaxonomyIds: string[] = [];
  const taxonomyByName = new Map<string, PartTaxonomy>();

  async function ensureTaxonomy(
    name: string,
    category: string,
  ): Promise<PartTaxonomy> {
    const repo = dataSource.getRepository(PartTaxonomy);
    const existing = await repo.findOne({ where: { name } });
    if (existing) {
      taxonomyByName.set(name, existing);
      return existing;
    }
    const created = await repo.save(
      repo.create({ name, category, isQuickPick: false }),
    );
    createdTaxonomyIds.push(created.id);
    taxonomyByName.set(name, created);
    return created;
  }

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(path.join(os.tmpdir(), 'junkyard-scan-test-'));
    process.env.UPLOAD_DIR = uploadDir;

    fakeGemini = {
      detectPartsInImage: jest.fn(),
      analyzePartImage: jest.fn().mockResolvedValue({
        grade: 'B',
        damage_codes: [],
        confidence: 0.8,
      }),
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
    storage = app.get(LocalFileStorage);

    // Roster rows the 4-door sedan under test is expected to have.
    for (const [name, category] of [
      ['Fender (Left)', 'Body'],
      ['Fender (Right)', 'Body'],
      ['Bumper (Front)', 'Body'],
      ['Headlight (Left)', 'Lighting'],
      ['Headlight (Right)', 'Lighting'],
      ['Hood', 'Body'],
    ] as const) {
      await ensureTaxonomy(name, category);
    }

    tenant = await dataSource
      .getRepository(Tenant)
      .save(
        dataSource
          .getRepository(Tenant)
          .create({ name: `Vehicle Scan Tenant ${Date.now()}` }),
      );

    manager = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.MANAGER,
          name: 'Scan Manager',
          email: 'vehicle-scan-manager@test.local',
          passwordHash: bcrypt.hashSync(MANAGER_PASSWORD, 4),
        }),
      ),
    );
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Scan Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );
  });

  afterAll(async () => {
    // Vehicles first (drains parts -> analyses -> corrections), then
    // taxonomy, then the tenant. Taxonomy deliberately BEFORE the tenant:
    // every other suite does it last, so a throw in the tenant delete leaks
    // the row into the shared dev database forever.
    await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).delete({ tenantId: tenant.id }),
    );
    for (const id of createdTaxonomyIds) {
      await dataSource.getRepository(PartTaxonomy).delete({ id });
    }
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await closeTestApp(app);
    await fs.rm(uploadDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    fakeGemini.detectPartsInImage.mockReset();
    fakeGemini.analyzePartImage.mockClear();
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
    const workers = await request(app.getHttpServer())
      .get(`/auth/tenants/${tenant.id}/workers`)
      .expect(200);
    const found = (workers.body as { id: string; name: string }[]).find(
      (w) => w.name === 'Scan Worker',
    )!;
    const res = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: found.id, pin: WORKER_PIN })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  async function seedVehicle(vin: string): Promise<Vehicle> {
    return withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin,
          make: 'Hyundai',
          model: 'Genesis',
          year: 2015,
          crushStatus: CrushStatus.ACTIVE,
          decodedRaw: decodedRaw({
            'Vehicle Type': 'PASSENGER CAR',
            'Body Class': 'Sedan/Saloon',
            Doors: '4',
          }),
        }),
      ),
    );
  }

  function vin(prefix: string): string {
    return `${prefix}${Date.now()}`.slice(0, 17);
  }

  it('refuses a worker -- scanning writes inventory', async () => {
    const vehicle = await seedVehicle(vin('SCANWRK'));
    const token = await loginWorker();

    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', JPEG, 'a.jpg')
      .expect(403);
  });

  it('400s when given neither files nor useExistingImages', async () => {
    const vehicle = await seedVehicle(vin('SCANEMPTY'));
    const token = await loginManager();

    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('identifies and grades every part in a photo, with no re-grading', async () => {
    fakeGemini.detectPartsInImage.mockResolvedValue({
      detections: [
        {
          part_name: 'left fender',
          grade: 'B',
          damage_codes: ['scratch'],
          confidence: 0.9,
        },
        {
          part_name: 'front bumper',
          grade: 'C',
          damage_codes: ['crack', 'dent'],
          confidence: 0.88,
        },
        {
          part_name: 'left headlight',
          grade: 'A',
          damage_codes: [],
          confidence: 0.95,
        },
      ],
      image_quality: { clarity: 'clear', note: 'good light' },
    });

    const vehicle = await seedVehicle(vin('SCANOK'));
    const token = await loginManager();

    const res = await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', JPEG, 'front.jpg')
      .expect(201);

    const body = res.body as {
      partsCreated: number;
      needsGrading: number;
      photos: { clarity: string }[];
      roster: { found: string[]; missing: string[]; approximate: boolean };
    };
    expect(body.partsCreated).toBe(3);
    expect(body.needsGrading).toBe(0);
    expect(body.photos[0].clarity).toBe('clear');
    expect(body.roster.approximate).toBe(false);
    expect(body.roster.found).toEqual(
      expect.arrayContaining([
        'Fender (Left)',
        'Bumper (Front)',
        'Headlight (Left)',
      ]),
    );
    // A 4-door sedan should still be missing plenty -- that's the checklist.
    expect(body.roster.missing).toContain('Fender (Right)');

    await withTenantContext(dataSource, tenant.id, async (m) => {
      const parts = await m
        .getRepository(Part)
        .find({ where: { vehicleId: vehicle.id } });
      expect(parts).toHaveLength(3);
      expect(parts.every((p) => p.status === PartStatus.PENDING_REVIEW)).toBe(
        true,
      );

      const fender = parts.find(
        (p) => p.taxonomyId === taxonomyByName.get('Fender (Left)')!.id,
      )!;
      const analysis = await m
        .getRepository(AiAnalysis)
        .findOne({ where: { partId: fender.id } });
      // Each part keeps ITS OWN grade despite sharing one photo.
      expect(analysis!.grade).toBe('B');
      expect(analysis!.damageCodes).toEqual(['scratch']);

      const bumper = parts.find(
        (p) => p.taxonomyId === taxonomyByName.get('Bumper (Front)')!.id,
      )!;
      const bumperAnalysis = await m
        .getRepository(AiAnalysis)
        .findOne({ where: { partId: bumper.id } });
      expect(bumperAnalysis!.grade).toBe('C');
      expect(bumperAnalysis!.damageCodes).toEqual(['crack', 'dent']);
    });

    // The whole point: the single-part prompt must never touch these.
    expect(fakeGemini.analyzePartImage).not.toHaveBeenCalled();
  });

  // The real test of the AddGradeD migration: the ai_grade Postgres enum
  // has to accept 'D', not just the TypeScript union.
  it('persists a D grade for a severely damaged part', async () => {
    fakeGemini.detectPartsInImage.mockResolvedValue({
      detections: [
        {
          part_name: 'front bumper',
          grade: 'D',
          damage_codes: ['broken', 'dent'],
          confidence: 0.91,
        },
      ],
      image_quality: { clarity: 'clear', note: '' },
    });

    const vehicle = await seedVehicle(vin('SCAND'));
    const token = await loginManager();

    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', JPEG, 'wrecked.jpg')
      .expect(201);

    await withTenantContext(dataSource, tenant.id, async (m) => {
      const parts = await m
        .getRepository(Part)
        .find({ where: { vehicleId: vehicle.id } });
      const analysis = await m
        .getRepository(AiAnalysis)
        .findOne({ where: { partId: parts[0].id } });
      expect(analysis!.grade).toBe('D');
      expect(analysis!.damageCodes).toEqual(['broken', 'dent']);
    });
  });

  it('reuses existing parts instead of duplicating them on a re-scan', async () => {
    fakeGemini.detectPartsInImage.mockResolvedValue({
      detections: [
        { part_name: 'hood', grade: 'A', damage_codes: [], confidence: 0.92 },
      ],
      image_quality: { clarity: 'clear', note: '' },
    });

    const vehicle = await seedVehicle(vin('SCANDUP'));
    const token = await loginManager();

    const first = await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', JPEG, 'hood.jpg')
      .expect(201);
    expect((first.body as { partsCreated: number }).partsCreated).toBe(1);

    const second = await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', JPEG, 'hood-again.jpg')
      .expect(201);
    const body = second.body as { partsCreated: number; partsUpdated: number };
    expect(body.partsCreated).toBe(0);
    expect(body.partsUpdated).toBe(1);

    await withTenantContext(dataSource, tenant.id, async (m) => {
      const parts = await m
        .getRepository(Part)
        .find({ where: { vehicleId: vehicle.id } });
      // One Hood, not two -- otherwise every re-scan doubles the inventory.
      expect(parts).toHaveLength(1);
      const images = await m
        .getRepository(PartImage)
        .find({ where: { partId: parts[0].id } });
      expect(images).toHaveLength(2);
    });
  });

  it('files a low-confidence detection for a human instead of grading it', async () => {
    fakeGemini.detectPartsInImage.mockResolvedValue({
      detections: [
        {
          part_name: 'right fender',
          grade: 'B',
          damage_codes: [],
          // Below the 0.7 default threshold.
          confidence: 0.35,
        },
      ],
      image_quality: { clarity: 'poor', note: 'blurry and backlit' },
    });

    const vehicle = await seedVehicle(vin('SCANLOW'));
    const token = await loginManager();

    const res = await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', JPEG, 'blurry.jpg')
      .expect(201);

    const body = res.body as {
      needsGrading: number;
      photos: { clarity: string; note: string }[];
    };
    expect(body.needsGrading).toBe(1);
    // Still reported, still used -- "work with what we have".
    expect(body.photos[0].clarity).toBe('poor');
    expect(body.photos[0].note).toMatch(/blurry/i);

    await withTenantContext(dataSource, tenant.id, async (m) => {
      const parts = await m
        .getRepository(Part)
        .find({ where: { vehicleId: vehicle.id } });
      expect(parts).toHaveLength(1);
      expect(parts[0].status).toBe(PartStatus.NEEDS_MANUAL_GRADING);
      // No grade was invented for it.
      const analyses = await m
        .getRepository(AiAnalysis)
        .find({ where: { partId: parts[0].id } });
      expect(analyses).toHaveLength(0);
      // The photo is still filed against the right part, so whoever grades
      // it has something to look at.
      const images = await m
        .getRepository(PartImage)
        .find({ where: { partId: parts[0].id } });
      expect(images).toHaveLength(1);
    });
  });

  it('surfaces ambiguous and unmapped detections rather than guessing', async () => {
    fakeGemini.detectPartsInImage.mockResolvedValue({
      detections: [
        // No side given, and the taxonomy has both -- must not pick one.
        { part_name: 'fender', grade: 'B', damage_codes: [], confidence: 0.9 },
        // Nothing in this vehicle's roster corresponds to it.
        {
          part_name: 'catalytic converter',
          grade: 'A',
          damage_codes: [],
          confidence: 0.9,
        },
      ],
      image_quality: { clarity: 'clear', note: '' },
    });

    const vehicle = await seedVehicle(vin('SCANAMB'));
    const token = await loginManager();

    const res = await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', JPEG, 'side.jpg')
      .expect(201);

    const body = res.body as {
      partsCreated: number;
      unresolved: { partName: string; reason: string }[];
    };
    // Neither could be filed, so no inventory was invented.
    expect(body.partsCreated).toBe(0);
    expect(body.unresolved).toHaveLength(2);
    expect(body.unresolved.find((u) => u.partName === 'fender')!.reason).toBe(
      'ambiguous',
    );
    expect(
      body.unresolved.find((u) => u.partName === 'catalytic converter')!.reason,
    ).toBe('unmapped');

    await withTenantContext(dataSource, tenant.id, async (m) => {
      const parts = await m
        .getRepository(Part)
        .find({ where: { vehicleId: vehicle.id } });
      expect(parts).toHaveLength(0);
    });
  });

  it('scans the photos already stored on the vehicle, with no upload', async () => {
    fakeGemini.detectPartsInImage.mockResolvedValue({
      detections: [
        {
          part_name: 'right headlight',
          grade: 'A',
          damage_codes: [],
          confidence: 0.93,
        },
      ],
      image_quality: { clarity: 'clear', note: '' },
    });

    const vehicle = await seedVehicle(vin('SCANOLD'));
    // Two exterior walkaround photos, exactly as POST /vehicles/:id/images
    // would have stored them -- never AI-analysed at upload time.
    for (const angle of [VehicleImageAngle.FRONT, VehicleImageAngle.LEFT]) {
      const url = `${tenant.id}/${vehicle.id}/${angle}.jpg`;
      await storage.save(url, JPEG);
      await withTenantContext(dataSource, tenant.id, (m) =>
        m.getRepository(VehicleImage).save(
          m.getRepository(VehicleImage).create({
            tenantId: tenant.id,
            vehicleId: vehicle.id,
            angle,
            url,
          }),
        ),
      );
    }

    const token = await loginManager();
    const res = await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .field('useExistingImages', 'true')
      .expect(201);

    const body = res.body as { photos: unknown[]; partsCreated: number };
    expect(body.photos).toHaveLength(2);
    expect(fakeGemini.detectPartsInImage).toHaveBeenCalledTimes(2);
    // Both photos found the same part, so it collapses to one.
    expect(body.partsCreated).toBe(1);
  });

  it('400s when asked to scan existing photos but there are none', async () => {
    const vehicle = await seedVehicle(vin('SCANNOPIC'));
    const token = await loginManager();

    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .field('useExistingImages', 'true')
      .expect(400);
  });

  it('keeps one unreadable photo from costing the others', async () => {
    fakeGemini.detectPartsInImage
      .mockRejectedValueOnce(new Error('gemini exploded'))
      .mockResolvedValue({
        detections: [
          { part_name: 'hood', grade: 'A', damage_codes: [], confidence: 0.9 },
        ],
        image_quality: { clarity: 'clear', note: '' },
      });

    const vehicle = await seedVehicle(vin('SCANPART'));
    const token = await loginManager();

    const res = await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/scan`)
      .set('Authorization', `Bearer ${token}`)
      .attach('files', JPEG, 'bad.jpg')
      .attach('files', JPEG, 'good.jpg')
      .expect(201);

    const body = res.body as {
      partsCreated: number;
      photos: { error?: string }[];
    };
    expect(body.photos[0].error).toBeDefined();
    expect(body.partsCreated).toBe(1);
  });

  it('404s for a vehicle that does not exist', async () => {
    const token = await loginManager();
    await request(app.getHttpServer())
      .post('/vehicles/11111111-1111-1111-1111-111111111111/scan')
      .set('Authorization', `Bearer ${token}`)
      .attach('files', JPEG, 'a.jpg')
      .expect(404);
  });
});
