import 'reflect-metadata';
import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { GeminiService } from '../src/ai/gemini.service';
import { AiAnalysisStatus } from '../src/database/entities/ai-analysis.entity';
import { Part } from '../src/database/entities/part.entity';
import { PartImage } from '../src/database/entities/part-image.entity';
import { PartTaxonomy } from '../src/database/entities/part-taxonomy.entity';
import { Tenant } from '../src/database/entities/tenant.entity';
import { User, UserRole } from '../src/database/entities/user.entity';
import { CrushStatus, Vehicle } from '../src/database/entities/vehicle.entity';
import { VehicleAnalysis } from '../src/database/entities/vehicle-analysis.entity';
import { VehiclePhotoSuggestion } from '../src/database/entities/vehicle-photo-suggestion.entity';
import { VehiclePhoto } from '../src/database/entities/vehicle-photo.entity';
import { withTenantContext } from '../src/database/tenant-context';
import { configureApp } from '../src/configure-app';
import { closeTestApp } from './close-test-app';

async function waitFor(
  predicate: () => Promise<boolean>,
  timeoutMs = 8000,
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`waitFor: condition not met within ${timeoutMs}ms`);
}

describe('Whole-vehicle AI grading (e2e)', () => {
  let app: INestApplication;
  let dataSource: DataSource;
  let uploadDir: string;
  let fakeGemini: { analyzeVehiclePhotos: jest.Mock };

  let tenant: Tenant;
  let worker: User;
  let vehicle: Vehicle;
  const WORKER_PIN = '9642';

  beforeAll(async () => {
    uploadDir = await fs.mkdtemp(
      path.join(os.tmpdir(), 'junkyard-vehicle-analysis-test-'),
    );
    process.env.UPLOAD_DIR = uploadDir;

    fakeGemini = {
      analyzeVehiclePhotos: jest.fn().mockResolvedValue({
        grade: 'B',
        damage_codes: ['scratch'],
        confidence: 0.75,
        photo_suggestions: [],
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

    const tenantRepo = dataSource.getRepository(Tenant);
    tenant = await tenantRepo.save(
      tenantRepo.create({ name: `Vehicle Analysis Test Tenant ${Date.now()}` }),
    );

    worker = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(User).save(
        m.getRepository(User).create({
          tenantId: tenant.id,
          role: UserRole.WORKER,
          name: 'Vehicle Analysis Worker',
          pinHash: bcrypt.hashSync(WORKER_PIN, 4),
        }),
      ),
    );
  });

  afterAll(async () => {
    await dataSource.getRepository(Tenant).delete({ id: tenant.id });
    await closeTestApp(app);
    await fs.rm(uploadDir, { recursive: true, force: true });
    delete process.env.UPLOAD_DIR;
  });

  beforeEach(async () => {
    fakeGemini.analyzeVehiclePhotos.mockClear();
    vehicle = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Vehicle).save(
        m.getRepository(Vehicle).create({
          tenantId: tenant.id,
          vin: `VA${randomUUID().slice(0, 15).toUpperCase()}`,
          crushStatus: CrushStatus.ACTIVE,
        }),
      ),
    );
  });

  async function loginWorker(): Promise<string> {
    const res = await request(app.getHttpServer())
      .post('/auth/login/pin')
      .send({ tenantId: tenant.id, userId: worker.id, pin: WORKER_PIN })
      .expect(200);
    return (res.body as { accessToken: string }).accessToken;
  }

  async function latestAnalysis(): Promise<VehicleAnalysis | null> {
    return withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(VehicleAnalysis).findOne({
        where: { vehicleId: vehicle.id },
        order: { createdAt: 'DESC' },
      }),
    );
  }

  /**
   * PartTaxonomy is a global, un-tenant-scoped lookup table -- and every
   * name this suite needs ("Fender", "Bumper Assy Front", "Headlight
   * Assembly") already exists as a real seeded row (see taxonomy.seed.ts).
   * Blindly creating a fresh row with the same name on every test run once
   * produced duplicate-named rows that made suggestion-matching
   * nondeterministic (ai-analysis.service.ts's taxonomyIdByName map just
   * keeps whichever same-named row it iterates last) -- confirmed live via
   * a flaky-then-failing e2e run. Reuse the existing row by name instead of
   * ever creating a second one.
   */
  async function getOrCreateExteriorTaxonomy(
    name: string,
    category: string,
  ): Promise<PartTaxonomy> {
    const taxonomyRepo = dataSource.getRepository(PartTaxonomy);
    const existing = await taxonomyRepo.findOne({ where: { name } });
    if (existing) return existing;
    return taxonomyRepo.save(
      taxonomyRepo.create({ name, category, isExteriorVisual: true }),
    );
  }

  it('grades the vehicle from a single photo -- never blocks waiting for more', async () => {
    const token = await loginWorker();

    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo:p1', Buffer.from('only-photo'), 'p1.jpg')
      .expect(201);

    await waitFor(async () => {
      const analysis = await latestAnalysis();
      return analysis?.status === AiAnalysisStatus.COMPLETE;
    }, 20000);

    const analysis = await latestAnalysis();
    expect(analysis).toMatchObject({
      grade: 'B',
      damageCodes: ['scratch'],
      photoCount: 1,
      status: AiAnalysisStatus.COMPLETE,
    });
    expect(fakeGemini.analyzeVehiclePhotos).toHaveBeenCalledTimes(1);
    const calls = fakeGemini.analyzeVehiclePhotos.mock.calls as unknown[][];
    const images = calls[0][0] as unknown[];
    expect(images).toHaveLength(1);
  }, 25000);

  it('debounces a burst of individual photo uploads into a single grading job, not one per photo', async () => {
    const token = await loginWorker();

    // Mirrors the real mobile "add more photos" screen: each selected photo
    // is POSTed as its own immediate request, not one batch. Fired in quick
    // succession -- well within the 5s debounce window -- this must not
    // enqueue (and pay for) a separate Gemini call per photo.
    for (let i = 0; i < 5; i++) {
      await request(app.getHttpServer())
        .post(`/vehicles/${vehicle.id}/photos`)
        .set('Authorization', `Bearer ${token}`)
        .attach('photo:p' + i, Buffer.from(`photo-${i}`), `p${i}.jpg`)
        .expect(201);
    }

    await waitFor(async () => {
      const analysis = await latestAnalysis();
      return analysis?.status === AiAnalysisStatus.COMPLETE;
    }, 20000);

    const all = await withTenantContext(dataSource, tenant.id, (m) =>
      m
        .getRepository(VehicleAnalysis)
        .find({ where: { vehicleId: vehicle.id } }),
    );
    expect(all).toHaveLength(1);
    expect(all[0].photoCount).toBe(5);
    expect(fakeGemini.analyzeVehiclePhotos).toHaveBeenCalledTimes(1);
  }, 25000);

  it('re-grades with a growing photo count as more photos are added, writing a new row rather than overwriting', async () => {
    const token = await loginWorker();

    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo:p1', Buffer.from('first-photo'), 'p1.jpg')
      .expect(201);

    await waitFor(async () => {
      const analysis = await latestAnalysis();
      return analysis?.photoCount === 1;
    }, 20000);
    const firstAnalysisId = (await latestAnalysis())?.id;

    // Waits for the first job to fully finish (removeOnComplete clears its
    // jobId) before uploading the second photo -- deliberately outside the
    // debounce window, so this exercises "two separate upload sessions"
    // rather than the single-burst debounce covered by the test above.
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo:p2', Buffer.from('second-photo'), 'p2.jpg')
      .expect(201);

    await waitFor(async () => {
      const analysis = await latestAnalysis();
      return analysis?.photoCount === 2 && analysis.id !== firstAnalysisId;
    }, 20000);

    const all = await withTenantContext(dataSource, tenant.id, (m) =>
      m
        .getRepository(VehicleAnalysis)
        .find({ where: { vehicleId: vehicle.id } }),
    );
    expect(all).toHaveLength(2);
  }, 30000);

  it('records multiple distinct parts suggested within a single photo, and auto-creates one Part per confident pairing', async () => {
    const bumper = await getOrCreateExteriorTaxonomy(
      'Bumper Assy Front',
      'Body',
    );
    const headlight = await getOrCreateExteriorTaxonomy(
      'Headlight Assembly',
      'Lighting',
    );
    const token = await loginWorker();

    // One wide-angle photo (index 0) shows both a bumper and a headlight --
    // two entries for the same photo_index, the whole point of this
    // feature. Photo 1 gets no entries at all (omitted, not a null
    // placeholder) -- nothing from the candidate list is visible in it.
    fakeGemini.analyzeVehiclePhotos.mockResolvedValueOnce({
      grade: 'B',
      damage_codes: [],
      confidence: 0.7,
      photo_suggestions: [
        {
          photo_index: 0,
          suggested_part: 'Bumper Assy Front',
          confidence: 0.92,
          group_id: 0,
        },
        {
          photo_index: 0,
          suggested_part: 'Headlight Assembly',
          confidence: 0.85,
          group_id: 1,
        },
      ],
    });

    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo:p1', Buffer.from('wide-angle-photo'), 'p1.jpg')
      .attach('photo:p2', Buffer.from('interior-photo'), 'p2.jpg')
      .expect(201);

    await waitFor(async () => {
      const analysis = await latestAnalysis();
      return analysis?.status === AiAnalysisStatus.COMPLETE;
    }, 20000);

    const photos = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(VehiclePhoto).find({
        where: { vehicleId: vehicle.id },
        order: { createdAt: 'ASC' },
      }),
    );
    expect(photos).toHaveLength(2);

    const suggestions = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(VehiclePhotoSuggestion).find({
        where: { vehiclePhotoId: photos[0].id },
      }),
    );
    expect(suggestions).toHaveLength(2);
    expect(suggestions.map((s) => s.taxonomyId).sort()).toEqual(
      [bumper.id, headlight.id].sort(),
    );

    const photo2Suggestions = await withTenantContext(
      dataSource,
      tenant.id,
      (m) =>
        m.getRepository(VehiclePhotoSuggestion).find({
          where: { vehiclePhotoId: photos[1].id },
        }),
    );
    expect(photo2Suggestions).toHaveLength(0);

    // Both suggestions are above the tenant's default 0.7 threshold -- two
    // real Parts should have been auto-created from this single photo,
    // without any manual Assign click.
    const parts = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).find({ where: { vehicleId: vehicle.id } }),
    );
    expect(parts).toHaveLength(2);
    expect(parts.map((p) => p.taxonomyId).sort()).toEqual(
      [bumper.id, headlight.id].sort(),
    );

    // No cleanup needed: bumper/headlight are the real seeded rows
    // (getOrCreateExteriorTaxonomy reused them, never created new ones).
  }, 25000);

  it('does not auto-create a Part for a suggestion below the confidence threshold -- stays a manual-assign hint', async () => {
    const fender = await getOrCreateExteriorTaxonomy('Fender', 'Body');
    const token = await loginWorker();

    fakeGemini.analyzeVehiclePhotos.mockResolvedValueOnce({
      grade: 'B',
      damage_codes: [],
      confidence: 0.6,
      photo_suggestions: [
        {
          photo_index: 0,
          suggested_part: 'Fender',
          confidence: 0.5,
          group_id: 0,
        },
      ],
    });

    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo:p1', Buffer.from('low-confidence-photo'), 'p1.jpg')
      .expect(201);

    await waitFor(async () => {
      const analysis = await latestAnalysis();
      return analysis?.status === AiAnalysisStatus.COMPLETE;
    }, 20000);

    const photo = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(VehiclePhoto).findOneOrFail({
        where: { vehicleId: vehicle.id },
      }),
    );
    // The suggestion is still recorded as a hint...
    const suggestion = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(VehiclePhotoSuggestion).findOneOrFail({
        where: { vehiclePhotoId: photo.id },
      }),
    );
    expect(suggestion.taxonomyId).toBe(fender.id);
    // ...but 0.5 confidence is below the 0.7 default threshold, so no Part
    // gets created automatically -- a manager still has to Assign it.
    const parts = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).find({ where: { vehicleId: vehicle.id } }),
    );
    expect(parts).toHaveLength(0);
  }, 25000);

  it('re-suggesting the same (photo, part) pairing on a later run refreshes confidence but never re-creates a Part -- not even if the new confidence crosses the threshold', async () => {
    // Just needs the row to exist -- this test never asserts on its id.
    await getOrCreateExteriorTaxonomy('Fender', 'Body');
    const token = await loginWorker();

    // Run 1: below threshold, recorded as a hint only.
    fakeGemini.analyzeVehiclePhotos.mockResolvedValueOnce({
      grade: 'B',
      damage_codes: [],
      confidence: 0.6,
      photo_suggestions: [
        {
          photo_index: 0,
          suggested_part: 'Fender',
          confidence: 0.5,
          group_id: 0,
        },
      ],
    });
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo:p1', Buffer.from('fender-photo'), 'p1.jpg')
      .expect(201);
    await waitFor(async () => {
      const analysis = await latestAnalysis();
      return analysis?.photoCount === 1;
    }, 20000);

    const photo = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(VehiclePhoto).findOneOrFail({
        where: { vehicleId: vehicle.id },
      }),
    );

    // Run 2 (a second, separate upload session -- outside the debounce
    // window, same pattern as the "growing photo count" test above):
    // Gemini now re-suggests the exact same (photo, Fender) pairing, this
    // time at 0.9 -- well above threshold.
    fakeGemini.analyzeVehiclePhotos.mockResolvedValueOnce({
      grade: 'B',
      damage_codes: [],
      confidence: 0.8,
      photo_suggestions: [
        {
          photo_index: 0,
          suggested_part: 'Fender',
          confidence: 0.9,
          group_id: 0,
        },
      ],
    });
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo:p2', Buffer.from('unrelated-photo'), 'p2.jpg')
      .expect(201);
    await waitFor(async () => {
      const analysis = await latestAnalysis();
      return analysis?.photoCount === 2;
    }, 20000);

    // Confidence refreshed to the latest value...
    const suggestions = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(VehiclePhotoSuggestion).find({
        where: { vehiclePhotoId: photo.id },
      }),
    );
    expect(suggestions).toHaveLength(1);
    expect(Number(suggestions[0].confidence)).toBeCloseTo(0.9);

    // ...but this pairing was already seen on run 1, so it never
    // auto-creates a Part even though the new confidence clears the
    // threshold -- the manager already had visibility into it as a hint
    // and can Assign it manually if they agree.
    const parts = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).find({ where: { vehicleId: vehicle.id } }),
    );
    expect(parts).toHaveLength(0);
  }, 30000);

  it('merges photos that Gemini groups under the same group_id into one Part with multiple PartImages, instead of one Part per photo', async () => {
    const fender = await getOrCreateExteriorTaxonomy('Fender', 'Body');
    const token = await loginWorker();

    // Two photos, no section tag on either -- both land in the same
    // "untagged" bucket and go to Gemini in one call. Both entries share
    // group_id 0: two angles of the very same physical fender.
    fakeGemini.analyzeVehiclePhotos.mockResolvedValueOnce({
      grade: 'B',
      damage_codes: ['scratch'],
      confidence: 0.8,
      photo_suggestions: [
        {
          photo_index: 0,
          suggested_part: 'Fender',
          confidence: 0.9,
          group_id: 0,
        },
        {
          photo_index: 1,
          suggested_part: 'Fender',
          confidence: 0.85,
          group_id: 0,
        },
      ],
    });

    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .attach('photo:p1', Buffer.from('fender-angle-1'), 'p1.jpg')
      .attach('photo:p2', Buffer.from('fender-angle-2'), 'p2.jpg')
      .expect(201);

    await waitFor(async () => {
      const analysis = await latestAnalysis();
      return analysis?.status === AiAnalysisStatus.COMPLETE;
    }, 20000);

    const parts = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(Part).find({ where: { vehicleId: vehicle.id } }),
    );
    // One Part, not two -- the whole point of grouping.
    expect(parts).toHaveLength(1);
    expect(parts[0].taxonomyId).toBe(fender.id);

    const images = await withTenantContext(dataSource, tenant.id, (m) =>
      m.getRepository(PartImage).find({ where: { partId: parts[0].id } }),
    );
    expect(images).toHaveLength(2);
  }, 25000);

  it('sends one Gemini call per distinct photo section, and combines their grades using worst-wins for the overall vehicle grade', async () => {
    const token = await loginWorker();

    // Front bucket: clean grade. Uploaded first, so its bucket is
    // processed first (buckets iterate in first-seen, createdAt order).
    fakeGemini.analyzeVehiclePhotos.mockResolvedValueOnce({
      grade: 'A',
      damage_codes: ['light-scuff'],
      confidence: 0.9,
      photo_suggestions: [],
    });
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .field('section', 'front')
      .attach('photo:front-1', Buffer.from('front-bytes'), 'front-1.jpg')
      .expect(201);

    // Rear bucket: worse grade -- must win for the overall vehicle grade.
    fakeGemini.analyzeVehiclePhotos.mockResolvedValueOnce({
      grade: 'C',
      damage_codes: ['collision-damage'],
      confidence: 0.6,
      photo_suggestions: [],
    });
    await request(app.getHttpServer())
      .post(`/vehicles/${vehicle.id}/photos`)
      .set('Authorization', `Bearer ${token}`)
      .field('section', 'rear')
      .attach('photo:rear-1', Buffer.from('rear-bytes'), 'rear-1.jpg')
      .expect(201);

    await waitFor(async () => {
      const analysis = await latestAnalysis();
      return analysis?.photoCount === 2;
    }, 20000);

    // Two photos in two different sections -> two separate Gemini calls,
    // not one call across the whole gallery.
    expect(fakeGemini.analyzeVehiclePhotos).toHaveBeenCalledTimes(2);
    const calls = fakeGemini.analyzeVehiclePhotos.mock.calls as unknown[][];
    expect((calls[0][0] as unknown[]).length).toBe(1);
    expect((calls[1][0] as unknown[]).length).toBe(1);

    const analysis = await latestAnalysis();
    expect(analysis?.grade).toBe('C');
    expect(analysis?.damageCodes.sort()).toEqual(
      ['collision-damage', 'light-scuff'].sort(),
    );
  }, 25000);
});
