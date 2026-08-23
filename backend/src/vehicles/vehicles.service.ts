import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource, EntityManager, FindOptionsWhere, In } from 'typeorm';
import {
  VEHICLE_ANALYSIS_QUEUE,
  VehicleAnalysisJobData,
} from '../ai/vehicle-analysis.processor';
import { Part, PartStatus } from '../database/entities/part.entity';
import { PartTaxonomy } from '../database/entities/part-taxonomy.entity';
import { VehicleAnalysis } from '../database/entities/vehicle-analysis.entity';
import { CrushStatus, Vehicle } from '../database/entities/vehicle.entity';
import { VehiclePhotoSuggestion } from '../database/entities/vehicle-photo-suggestion.entity';
import {
  VehiclePhoto,
  VehiclePhotoSection,
} from '../database/entities/vehicle-photo.entity';
import { withTenantContext } from '../database/tenant-context';
import { PartsService } from '../parts/parts.service';
import {
  LocalFileStorage,
  mimetypeFromExtension,
  resolveImageExtension,
} from '../storage/local-file-storage';
import { VehicleIntakeDto } from './dto/vehicle-intake.dto';
import { parseDecoded } from './dto/vehicle-intake.schema';

export interface VehiclePhotoSuggestionItem {
  taxonomyId: string;
  taxonomyName: string | null;
  confidence: number;
}

export interface VehiclePhotoListItem extends VehiclePhoto {
  /** Every distinct part Gemini identified in this photo -- a photo can show more than one (headlight + bumper + fender in one frame), so this is a list, not a single hint. */
  suggestions: VehiclePhotoSuggestionItem[];
}

export interface VehicleGradeSummary {
  grade: string | null;
  status: string;
  photoCount: number;
}

export interface VehicleListItem extends Vehicle {
  partsCount: number;
  latestGrade: VehicleGradeSummary | null;
  /** Earliest still-unassigned VehiclePhoto id, for a list-card thumbnail. Null once every photo has been assigned to a Part (consumed by assignPhotos()) or none were ever uploaded -- the UI shows a placeholder in that case. */
  firstPhotoId: string | null;
}

export interface VehicleListResult {
  items: VehicleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MyVehicleListItem extends Vehicle {
  partsCount: number;
  unassignedPhotosCount: number;
  latestGrade: VehicleGradeSummary | null;
  firstPhotoId: string | null;
}

export interface IntakeResult {
  vehicleId: string;
  duplicate: boolean;
}

export interface VehiclePhotoFile {
  buffer: Buffer;
  contentType: string;
}

@Injectable()
export class VehiclesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly partsService: PartsService,
    private readonly storage: LocalFileStorage,
    @InjectQueue(VEHICLE_ANALYSIS_QUEUE)
    private readonly vehicleAnalysisQueue: Queue<VehicleAnalysisJobData>,
  ) {
    // Same rationale as PartsService's aiQueue listener -- an unlistened
    // 'error' event on a BullMQ Queue is a Node-level crash, not just a
    // dropped log line.
    this.vehicleAnalysisQueue.on('error', (error) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[VehiclesService] vehicle analysis queue error', error);
      }
    });
  }

  async list(
    tenantId: string,
    crushStatus: CrushStatus | undefined,
    page: number,
    pageSize: number,
  ): Promise<VehicleListResult> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const where: FindOptionsWhere<Vehicle> = { tenantId };
      if (crushStatus) {
        where.crushStatus = crushStatus;
      }

      const [vehicles, total] = await manager
        .getRepository(Vehicle)
        .findAndCount({
          where,
          order: { createdAt: 'DESC' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        });

      const ids = vehicles.map((v) => v.id);
      // Sequential, not Promise.all -- see the same note in
      // PartsService.list()/detail(): these share the one transactional
      // client withTenantContext hands out, and a single Postgres
      // connection can't run concurrent/interleaved queries.
      const counts = ids.length
        ? await manager
            .getRepository(Part)
            .createQueryBuilder('part')
            .select('part.vehicleId', 'vehicleId')
            .addSelect('COUNT(*)', 'count')
            .where('part.vehicleId IN (:...ids)', { ids })
            .groupBy('part.vehicleId')
            .getRawMany<{ vehicleId: string; count: string }>()
        : [];
      const countsByVehicle = new Map(
        counts.map((c) => [c.vehicleId, Number(c.count)]),
      );
      const latestGradeByVehicle = ids.length
        ? await this.latestGradesFor(manager, ids)
        : new Map<string, VehicleGradeSummary>();
      const firstPhotoByVehicle = ids.length
        ? await this.firstPhotoIdsFor(manager, ids)
        : new Map<string, string>();

      return {
        items: vehicles.map((v) => ({
          ...v,
          partsCount: countsByVehicle.get(v.id) ?? 0,
          latestGrade: latestGradeByVehicle.get(v.id) ?? null,
          firstPhotoId: firstPhotoByVehicle.get(v.id) ?? null,
        })),
        total,
        page,
        pageSize,
      };
    });
  }

  /** Same DISTINCT ON shape as latestGradesFor(), but picks each vehicle's earliest still-unassigned VehiclePhoto id for a list-card thumbnail. */
  private async firstPhotoIdsFor(
    manager: EntityManager,
    vehicleIds: string[],
  ): Promise<Map<string, string>> {
    const rows = await manager
      .getRepository(VehiclePhoto)
      .createQueryBuilder('p')
      .distinctOn(['p.vehicleId'])
      .where('p.vehicleId IN (:...vehicleIds)', { vehicleIds })
      .orderBy('p.vehicleId')
      .addOrderBy('p.createdAt', 'ASC')
      .getMany();
    return new Map(rows.map((r): [string, string] => [r.vehicleId, r.id]));
  }

  /**
   * "Latest analysis wins" per vehicle -- VehicleAnalysis deliberately has
   * no uniqueness constraint (a new row is written every time the photo set
   * changes), so this picks the most recent row per vehicleId. DISTINCT ON
   * needs an explicit ORDER BY starting with the same column it
   * distinguishes on (vehicle_id) before the tiebreaker (created_at DESC).
   */
  private async latestGradesFor(
    manager: EntityManager,
    vehicleIds: string[],
  ): Promise<Map<string, VehicleGradeSummary>> {
    const rows = await manager
      .getRepository(VehicleAnalysis)
      .createQueryBuilder('a')
      .distinctOn(['a.vehicleId'])
      .where('a.vehicleId IN (:...vehicleIds)', { vehicleIds })
      .orderBy('a.vehicleId')
      .addOrderBy('a.createdAt', 'DESC')
      .getMany();
    return new Map(
      rows.map((r): [string, VehicleGradeSummary] => [
        r.vehicleId,
        { grade: r.grade, status: r.status, photoCount: r.photoCount },
      ]),
    );
  }

  /**
   * The mobile home screen's "Your vehicles" list: every vehicle this
   * worker (or manager/owner) personally sent through `intake()`, most
   * recent first, with enough signal (parts created so far, raw photos
   * still waiting on a manager to assign) to tell at a glance which ones
   * still need photos or are just sitting unassigned.
   */
  async mine(
    tenantId: string,
    userId: string,
    page: number,
    pageSize: number,
  ): Promise<{
    items: MyVehicleListItem[];
    total: number;
    page: number;
    pageSize: number;
  }> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const [vehicles, total] = await manager
        .getRepository(Vehicle)
        .findAndCount({
          where: { tenantId, createdByUserId: userId },
          order: { createdAt: 'DESC' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        });

      const ids = vehicles.map((v) => v.id);
      const [partCounts, photoCounts] = ids.length
        ? await Promise.all([
            manager
              .getRepository(Part)
              .createQueryBuilder('part')
              .select('part.vehicleId', 'vehicleId')
              .addSelect('COUNT(*)', 'count')
              .where('part.vehicleId IN (:...ids)', { ids })
              .groupBy('part.vehicleId')
              .getRawMany<{ vehicleId: string; count: string }>(),
            manager
              .getRepository(VehiclePhoto)
              .createQueryBuilder('photo')
              .select('photo.vehicleId', 'vehicleId')
              .addSelect('COUNT(*)', 'count')
              .where('photo.vehicleId IN (:...ids)', { ids })
              .groupBy('photo.vehicleId')
              .getRawMany<{ vehicleId: string; count: string }>(),
          ])
        : [[], []];
      const partCountsByVehicle = new Map(
        partCounts.map((c) => [c.vehicleId, Number(c.count)]),
      );
      const photoCountsByVehicle = new Map(
        photoCounts.map((c) => [c.vehicleId, Number(c.count)]),
      );
      const latestGradeByVehicle = ids.length
        ? await this.latestGradesFor(manager, ids)
        : new Map<string, VehicleGradeSummary>();
      const firstPhotoByVehicle = ids.length
        ? await this.firstPhotoIdsFor(manager, ids)
        : new Map<string, string>();

      return {
        items: vehicles.map((v) => ({
          ...v,
          partsCount: partCountsByVehicle.get(v.id) ?? 0,
          unassignedPhotosCount: photoCountsByVehicle.get(v.id) ?? 0,
          latestGrade: latestGradeByVehicle.get(v.id) ?? null,
          firstPhotoId: firstPhotoByVehicle.get(v.id) ?? null,
        })),
        total,
        page,
        pageSize,
      };
    });
  }

  async detail(
    tenantId: string,
    vehicleId: string,
  ): Promise<
    Vehicle & { parts: Part[]; latestVehicleAnalysis: VehicleAnalysis | null }
  > {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const vehicle = await manager
        .getRepository(Vehicle)
        .findOne({ where: { id: vehicleId } });
      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }
      // Sequential -- see the Promise.all note on list()/mine() above.
      const parts = await manager
        .getRepository(Part)
        .find({ where: { vehicleId } });
      const latestVehicleAnalysis = await manager
        .getRepository(VehicleAnalysis)
        .findOne({ where: { vehicleId }, order: { createdAt: 'DESC' } });
      return { ...vehicle, parts, latestVehicleAnalysis };
    });
  }

  /**
   * Backs the mobile intake flow's `syncDraft()` (frontend/src/lib/offline
   * /sync.ts): turns one photographed vehicle walkaround into a Vehicle +
   * its raw, unassigned VehiclePhotos, in one transaction. No Part is
   * created here -- a manager assigns photos to a Part/taxonomy afterward,
   * see `assignPhotos()`. Idempotent on `(tenantId, draftId)` --
   * `syncPendingDrafts()` retries a `sync_failed` draft from scratch, so a
   * request that already succeeded server-side but lost its response must
   * not create a duplicate vehicle+photos on retry.
   */
  async intake(
    tenantId: string,
    userId: string,
    dto: VehicleIntakeDto,
    files: Express.Multer.File[],
  ): Promise<IntakeResult> {
    const decoded = parseDecoded(dto.decoded);

    const result = await withTenantContext(
      this.dataSource,
      tenantId,
      async (manager) => {
        const existing = await manager
          .getRepository(Vehicle)
          .findOne({ where: { tenantId, intakeDraftId: dto.draftId } });
        if (existing) {
          return { vehicleId: existing.id, duplicate: true, photosSaved: 0 };
        }

        const vehicle = await manager.getRepository(Vehicle).save(
          manager.getRepository(Vehicle).create({
            tenantId,
            vin: dto.vin,
            make: decoded?.make ?? null,
            model: decoded?.model ?? null,
            year: decoded?.year ?? null,
            trim: decoded?.trim ?? null,
            decodedRaw: decoded?.raw ?? null,
            intakeDraftId: dto.draftId,
            createdByUserId: userId,
          }),
        );

        const saved = await this.savePhotos(
          manager,
          tenantId,
          vehicle.id,
          files,
          dto.section,
        );

        return {
          vehicleId: vehicle.id,
          duplicate: false,
          photosSaved: saved.length,
        };
      },
    );

    // After commit -- see savePhotos()'s comment for why enqueueing must
    // not happen inside the still-open transaction.
    if (result.photosSaved > 0) {
      await this.enqueueVehicleAnalysis(tenantId, result.vehicleId);
    }

    return { vehicleId: result.vehicleId, duplicate: result.duplicate };
  }

  private static readonly VEHICLE_ANALYSIS_DEBOUNCE_MS = 5000;

  /**
   * Non-blocking, same rationale as PartsService.addImageInTransaction: the
   * upload request returns as soon as photos are stored, grading happens
   * asynchronously. Called after intake()/addPhotos() commit their
   * transaction, so the worker is guaranteed to see every photo it queries
   * for.
   *
   * Debounced per vehicle: the mobile "add more photos" screen
   * (my-vehicle-detail-page-client.tsx) uploads each selected photo as its
   * own immediate request, not one batch -- confirmed live, picking 10
   * photos fired 10 separate grading jobs, each redundantly re-grading
   * whatever photos already existed by the time it ran. A fixed jobId per
   * vehicle plus `changeDelay()` on an already-pending job means a burst of
   * uploads collapses into exactly one job, fired once 5s after the *last*
   * upload in the burst -- not one per photo. removeOnComplete/removeOnFail
   * let the same jobId be reused for a later, separate upload burst once
   * this one has actually finished.
   */
  private async enqueueVehicleAnalysis(
    tenantId: string,
    vehicleId: string,
  ): Promise<void> {
    // BullMQ rejects ':' in a custom jobId (reserved as an internal Redis
    // key delimiter) -- confirmed live via a real "Custom Id cannot
    // contain :" error, not a guess.
    const jobId = `vehicle-analysis-${vehicleId}`;
    const existing = await this.vehicleAnalysisQueue.getJob(jobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'delayed' || state === 'waiting') {
        await existing.changeDelay(
          VehiclesService.VEHICLE_ANALYSIS_DEBOUNCE_MS,
        );
        return;
      }
    }

    await this.vehicleAnalysisQueue.add(
      'analyze-vehicle',
      { tenantId, vehicleId },
      {
        jobId,
        delay: VehiclesService.VEHICLE_ANALYSIS_DEBOUNCE_MS,
        // 5 attempts / exponential from 3s (3s,6s,12s,24s,48s -- ~93s worst
        // case) instead of the original 3/2s: confirmed live via Gemini's
        // own error message ("This model is currently experiencing high
        // demand... usually temporary") that a real demand spike can
        // outlast a ~6s total retry budget. This call already sends every
        // photo on the vehicle in one request, so it's worth a longer
        // budget rather than surfacing "grading failed" for something that
        // clears up on its own shortly after.
        attempts: 5,
        backoff: { type: 'exponential', delay: 3000 },
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  /**
   * Lets a worker attach more raw photos to a vehicle they already sent,
   * any time afterward -- e.g. they only had one part photographed when
   * they synced, and come back later with the rest. Same multipart shape
   * (`photo:{id}` fields) and storage/DB path as `intake()`'s own photo
   * loop, just against an existing Vehicle instead of a brand-new one.
   */
  async addPhotos(
    tenantId: string,
    vehicleId: string,
    files: Express.Multer.File[],
    section?: VehiclePhotoSection,
  ): Promise<VehiclePhoto[]> {
    const saved = await withTenantContext(
      this.dataSource,
      tenantId,
      async (manager) => {
        const vehicle = await manager
          .getRepository(Vehicle)
          .findOne({ where: { id: vehicleId } });
        if (!vehicle) {
          throw new NotFoundException('Vehicle not found');
        }
        return this.savePhotos(manager, tenantId, vehicleId, files, section);
      },
    );

    // After commit -- see savePhotos()'s comment.
    if (saved.length > 0) {
      await this.enqueueVehicleAnalysis(tenantId, vehicleId);
    }

    return saved;
  }

  private async savePhotos(
    manager: EntityManager,
    tenantId: string,
    vehicleId: string,
    files: Express.Multer.File[],
    section?: VehiclePhotoSection,
  ): Promise<VehiclePhoto[]> {
    const saved: VehiclePhoto[] = [];
    for (const file of files) {
      const [kind, photoId] = file.fieldname.split(':');
      if (kind !== 'photo') continue;
      const extension = resolveImageExtension(file.mimetype);
      const relativePath = await this.storage.save(
        `${tenantId}/${vehicleId}/${photoId}.${extension}`,
        file.buffer,
      );
      const photo = await manager.getRepository(VehiclePhoto).save(
        manager.getRepository(VehiclePhoto).create({
          tenantId,
          vehicleId,
          url: relativePath,
          section: section ?? null,
        }),
      );
      saved.push(photo);
    }
    // Deliberately does NOT enqueue the vehicle-analysis job here -- this
    // runs inside the caller's still-open transaction (withTenantContext in
    // intake()/addPhotos()), and BullMQ's Redis-backed queue is entirely
    // independent of that Postgres transaction. Enqueuing here let the
    // worker start analyzeVehicle() -- its own separate transaction -- and
    // query VehiclePhoto before this one committed, so it could see zero or
    // stale photos (confirmed live: an e2e test uploading a 2nd photo
    // flaked because the job ran before the photo was actually visible).
    // See intake()/addPhotos() for the real enqueue, done after commit.
    return saved;
  }

  async listPhotos(
    tenantId: string,
    vehicleId: string,
  ): Promise<VehiclePhotoListItem[]> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const vehicle = await manager
        .getRepository(Vehicle)
        .findOne({ where: { id: vehicleId } });
      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }
      const photos = await manager
        .getRepository(VehiclePhoto)
        .find({ where: { vehicleId }, order: { createdAt: 'ASC' } });

      const photoIds = photos.map((p) => p.id);
      const suggestions = photoIds.length
        ? await manager
            .getRepository(VehiclePhotoSuggestion)
            .find({ where: { vehiclePhotoId: In(photoIds) } })
        : [];
      const taxonomyIds = [...new Set(suggestions.map((s) => s.taxonomyId))];
      const taxonomies = taxonomyIds.length
        ? await manager
            .getRepository(PartTaxonomy)
            .findBy({ id: In(taxonomyIds) })
        : [];
      const taxonomyNameById = new Map(
        taxonomies.map((t): [string, string] => [t.id, t.name]),
      );
      const suggestionsByPhotoId = new Map<
        string,
        VehiclePhotoSuggestionItem[]
      >();
      for (const s of suggestions) {
        const list = suggestionsByPhotoId.get(s.vehiclePhotoId) ?? [];
        list.push({
          taxonomyId: s.taxonomyId,
          taxonomyName: taxonomyNameById.get(s.taxonomyId) ?? null,
          confidence: s.confidence,
        });
        suggestionsByPhotoId.set(s.vehiclePhotoId, list);
      }

      return photos.map((photo) => ({
        ...photo,
        suggestions: suggestionsByPhotoId.get(photo.id) ?? [],
      }));
    });
  }

  async getPhotoFile(
    tenantId: string,
    vehicleId: string,
    photoId: string,
  ): Promise<VehiclePhotoFile> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const photo = await manager
        .getRepository(VehiclePhoto)
        .findOne({ where: { id: photoId, vehicleId } });
      if (!photo) {
        throw new NotFoundException('Photo not found');
      }
      const buffer = await this.storage.read(photo.url);
      const extension = photo.url.split('.').pop() ?? '';
      return { buffer, contentType: mimetypeFromExtension(extension) };
    });
  }

  /**
   * The manager-side counterpart to `intake()`: takes a set of raw
   * VehiclePhotos and a chosen taxonomy, creates the Part they belong to,
   * and turns each photo into a real PartImage (reusing
   * PartsService.addImageInTransaction()'s existing storage+insert+AI-
   * enqueue logic, which saves its own independent copy of the bytes) --
   * this is the point where a photo finally becomes gradable inventory.
   *
   * Deliberately does NOT delete the original VehiclePhoto/file afterward
   * (an earlier version did). A single wide photo often shows more than one
   * part at once (bumper + headlight + hood in the same frame) -- deleting
   * it after the first assignment made it impossible to also assign it to
   * a second part, confirmed directly by the user hitting exactly this.
   * The same photo can now be assigned to as many parts as it actually
   * shows.
   */
  async assignPhotos(
    tenantId: string,
    vehicleId: string,
    photoIds: string[],
    taxonomyId: string,
  ): Promise<{ partId: string }> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const vehicle = await manager
        .getRepository(Vehicle)
        .findOne({ where: { id: vehicleId } });
      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }

      const photos = await manager
        .getRepository(VehiclePhoto)
        .find({ where: { id: In(photoIds), vehicleId } });
      if (photos.length !== photoIds.length) {
        throw new NotFoundException(
          'One or more photos were not found on this vehicle',
        );
      }

      const part = await manager.getRepository(Part).save(
        manager.getRepository(Part).create({
          tenantId,
          vehicleId,
          taxonomyId,
          status: PartStatus.PENDING_AI,
        }),
      );

      for (const photo of photos) {
        const buffer = await this.storage.read(photo.url);
        const extension = photo.url.split('.').pop() ?? '';
        await this.partsService.addImageInTransaction(
          manager,
          tenantId,
          part.id,
          { buffer, mimetype: mimetypeFromExtension(extension) },
        );
      }

      return { partId: part.id };
    });
  }

  /**
   * Manually adds a part with no photo -- for something the yard knows it
   * has but that isn't (and may never be) photographed, e.g. an alternator
   * still inside an unphotographed engine bay. See
   * PartsService.createManual() for what this actually creates.
   */
  async createManualPart(
    tenantId: string,
    vehicleId: string,
    taxonomyId: string,
  ): Promise<{ partId: string }> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const vehicle = await manager
        .getRepository(Vehicle)
        .findOne({ where: { id: vehicleId } });
      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }
      const part = await this.partsService.createManualInTransaction(
        manager,
        tenantId,
        vehicleId,
        taxonomyId,
      );
      return { partId: part.id };
    });
  }
}
