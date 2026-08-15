import { randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import { DataSource, EntityManager, FindOptionsWhere, In } from 'typeorm';
import {
  AI_ANALYSIS_QUEUE,
  AiAnalysisJobData,
} from '../ai/ai-analysis.processor';
import {
  AiAnalysis,
  AiAnalysisStatus,
  AiGrade,
} from '../database/entities/ai-analysis.entity';
import { Part, PartStatus } from '../database/entities/part.entity';
import { PartImage } from '../database/entities/part-image.entity';
import { PartTaxonomy } from '../database/entities/part-taxonomy.entity';
import {
  VehicleImage,
  VehicleImageAngle,
} from '../database/entities/vehicle-image.entity';
import { CrushStatus, Vehicle } from '../database/entities/vehicle.entity';
import { Tenant } from '../database/entities/tenant.entity';
import { withTenantContext } from '../database/tenant-context';
import { LocalFileStorage } from '../storage/local-file-storage';
import { DetectPartsService } from '../ai/detect-parts.service';
import { SCENE_DETECTION_PROMPT_VERSION } from '../ai/gemini.service';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { deriveRoster } from './vin-parts-roster';

export interface VehicleListItem extends Vehicle {
  partsCount: number;
}

export interface VehicleListResult {
  items: VehicleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/** What a delete actually destroyed, so the UI can report it rather than guess. */
export interface VehicleDeletionSummary {
  vehicleId: string;
  vin: string;
  deletedParts: number;
  deletedPhotos: number;
}

/**
 * A detection the scan could not file on its own. Never dropped: a
 * detection the human cannot see is one they cannot correct, and the AI
 * having spotted a grille the taxonomy can't place is still information.
 */
export interface UnresolvedDetection {
  /** Exactly what the model called it. */
  partName: string;
  /** Populated when ambiguous (the model didn't say which side). */
  candidateIds: string[];
  reason: 'ambiguous' | 'unmapped';
  grade: string;
  confidence: number;
  photoIndex: number;
}

export interface ScannedPhotoSummary {
  index: number;
  clarity: 'clear' | 'partial' | 'poor' | 'unknown';
  note: string | null;
  detections: number;
  error?: string;
}

export interface VehicleScanSummary {
  vehicleId: string;
  /** New Part rows created by this scan. */
  partsCreated: number;
  /** Existing parts this scan added a photo (and possibly a grade) to. */
  partsUpdated: number;
  /** Parts left for a human because the AI wasn't confident enough to grade them. */
  needsGrading: number;
  photos: ScannedPhotoSummary[];
  unresolved: UnresolvedDetection[];
  roster: {
    expected: string[];
    /** Roster entries this vehicle now has a Part for. */
    found: string[];
    /** Roster entries still unaccounted for -- what's left to photograph. */
    missing: string[];
    approximate: boolean;
    doors: number | null;
    bodyClass: string | null;
  };
}

interface IntakeDecodedInput {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  trim?: string | null;
  raw?: Record<string, unknown> | null;
}

/**
 * A grade the client's bulk scan (POST /ai/detect-parts) already produced
 * for one part in one photo. See the handling in intake() for why these are
 * persisted rather than re-derived.
 */
interface IntakeDetectionInput {
  photoId?: string;
  grade?: string;
  damageCodes?: string[];
  confidence?: number;
}

interface IntakePartInput {
  id?: string;
  taxonomyId?: string;
  detections?: IntakeDetectionInput[];
}

const VALID_GRADES = new Set<string>(Object.values(AiGrade));

const EXTERIOR_PHOTO_FIELDNAME = /^exteriorPhoto:([^:]*):(.+)$/;

function extensionFor(mimetype: string): string {
  return mimetype === 'image/png' ? 'png' : 'jpg';
}

function parseJsonField<T>(
  raw: string | undefined,
  fieldName: string,
): T | undefined {
  if (raw === undefined) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new BadRequestException(`${fieldName} must be valid JSON`);
  }
}

@Injectable()
export class VehiclesService {
  /**
   * Stamped on analyses persisted from a client-side bulk scan. Matches
   * AiAnalysisService's own modelVersion so both grading paths are
   * attributable to the same model, and so the (part_image_id,
   * model_version) unique index treats them as the same generation.
   */
  private readonly detectionModelVersion: string;

  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: LocalFileStorage,
    private readonly detectParts: DetectPartsService,
    @InjectQueue(AI_ANALYSIS_QUEUE)
    private readonly aiQueue: Queue<AiAnalysisJobData>,
    config: ConfigService,
  ) {
    this.detectionModelVersion =
      config.get<string>('GEMINI_MODEL') ?? 'gemini-flash-latest';
    // See PartsService's constructor for why this listener is required, not
    // just good hygiene: an unlistened 'error' event on an EventEmitter
    // crashes the process.
    this.aiQueue.on('error', (error) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[VehiclesService] queue error', error);
      }
    });
  }

  /**
   * Creates a Vehicle + its exterior VehicleImages + one Part per selected
   * taxonomy entry (each with its own PartImages, AI-analysis jobs enqueued
   * per photo) from a mobile worker's completed intake draft. This is the
   * one endpoint the entire "photos to inventory" product thesis runs
   * through — see docs/PROGRESS.md for how long it went missing.
   *
   * Idempotent on (tenantId, draftId): `syncPendingDrafts()` on the client
   * retries a `sync_failed` draft, so a request that succeeded server-side
   * but whose response was lost in transit must return the
   * already-created vehicle instead of creating a duplicate.
   */
  async intake(
    tenantId: string,
    body: Record<string, string>,
    files: Express.Multer.File[],
  ): Promise<{ vehicleId: string }> {
    const draftId = (body.draftId ?? '').trim();
    if (!draftId) {
      throw new BadRequestException('draftId is required');
    }
    const vin = (body.vin ?? '').trim();
    if (!vin) {
      throw new BadRequestException('vin is required');
    }
    const decoded = parseJsonField<IntakeDecodedInput | null>(
      body.decoded,
      'decoded',
    );
    const parts = parseJsonField<IntakePartInput[]>(body.parts, 'parts') ?? [];
    if (!Array.isArray(parts)) {
      throw new BadRequestException('parts must be an array');
    }

    return this.intakeInTenantContext(
      tenantId,
      draftId,
      vin,
      decoded,
      parts,
      files,
    );
  }

  /**
   * Claims this tenant's next stock number, atomically.
   *
   * `UPDATE ... RETURNING` rather than reading the counter and writing it
   * back: the read-modify-write version races two concurrent intakes into
   * the same number, and the unique index would then fail one of them at
   * random. The statement takes a row lock on the tenant for the rest of the
   * transaction, so intakes for one tenant serialize here -- fine, since
   * intake is a human photographing a car, not a hot path.
   *
   * In Postgres, RETURNING sees the NEW row, so `next_stock_number - 1` is
   * the value this call just claimed.
   */
  private async issueStockNumber(
    manager: EntityManager,
    tenantId: string,
  ): Promise<string> {
    const tenantRepo = manager.getRepository(Tenant);

    // increment() emits `SET next_stock_number = next_stock_number + 1`,
    // which takes the row lock. A concurrent intake for this tenant blocks
    // here until we commit and then re-reads the committed value, so two
    // callers can never claim the same number. The read below is inside the
    // same transaction, so it sees our own write.
    await tenantRepo.increment({ id: tenantId }, 'nextStockNumber', 1);

    const tenant = await tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException('Tenant not found');
    }
    return String(tenant.nextStockNumber - 1);
  }

  /**
   * Partial update of the manager-entered facts on a vehicle.
   *
   * Only keys actually present in the payload are written, so a caller
   * sending just `locationCode` cannot silently blank an odometer reading
   * someone else entered. `null` is a real value here (clear the field);
   * absent is not.
   */
  async updateDetails(
    tenantId: string,
    vehicleId: string,
    changes: UpdateVehicleDto,
  ): Promise<Vehicle> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const repo = manager.getRepository(Vehicle);
      const vehicle = await repo.findOne({ where: { id: vehicleId } });
      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }

      // Written out per field rather than looped over a key list: a loop
      // needs a cast to index the entity, and that cast is exactly what
      // would stop the compiler noticing if a DTO field were renamed or
      // retyped later.
      if (changes.odometerMiles !== undefined) {
        vehicle.odometerMiles = changes.odometerMiles ?? null;
      }
      if (changes.acquisitionCost !== undefined) {
        vehicle.acquisitionCost = changes.acquisitionCost ?? null;
      }
      if (changes.acquisitionSource !== undefined) {
        vehicle.acquisitionSource = changes.acquisitionSource ?? null;
      }
      if (changes.acquisitionDate !== undefined) {
        vehicle.acquisitionDate = changes.acquisitionDate ?? null;
      }
      if (changes.locationCode !== undefined) {
        vehicle.locationCode = changes.locationCode ?? null;
      }

      return repo.save(vehicle);
    });
  }

  private async intakeInTenantContext(
    tenantId: string,
    draftId: string,
    vin: string,
    decoded: IntakeDecodedInput | null | undefined,
    parts: IntakePartInput[],
    files: Express.Multer.File[],
  ): Promise<{ vehicleId: string }> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const vehicleRepo = manager.getRepository(Vehicle);
      const existing = await vehicleRepo.findOne({
        where: { tenantId, intakeDraftId: draftId },
      });
      if (existing) {
        return { vehicleId: existing.id };
      }

      // Deliberately after the idempotency check: a retried sync returns the
      // vehicle it already created and must not burn a second stock number,
      // which would leave a permanent gap in the yard's series.
      const stockNumber = await this.issueStockNumber(manager, tenantId);

      const vehicle = await vehicleRepo.save(
        vehicleRepo.create({
          tenantId,
          intakeDraftId: draftId,
          stockNumber,
          vin,
          make: decoded?.make ?? null,
          model: decoded?.model ?? null,
          year: decoded?.year ?? null,
          trim: decoded?.trim ?? null,
          decodedRaw: decoded?.raw ?? null,
        }),
      );

      for (const file of files) {
        const match = EXTERIOR_PHOTO_FIELDNAME.exec(file.fieldname);
        if (!match) continue;
        const [, angle] = match;
        if (
          !Object.values(VehicleImageAngle).includes(angle as VehicleImageAngle)
        ) {
          throw new BadRequestException(
            `Invalid exterior photo angle: ${angle}`,
          );
        }
        const relativePath = await this.storage.save(
          `${tenantId}/${vehicle.id}/exterior-${randomUUID()}.${extensionFor(file.mimetype)}`,
          file.buffer,
        );
        await manager.getRepository(VehicleImage).save(
          manager.getRepository(VehicleImage).create({
            tenantId,
            vehicleId: vehicle.id,
            angle: angle as VehicleImageAngle,
            url: relativePath,
          }),
        );
      }

      for (const partInput of parts) {
        if (!partInput?.id || !partInput?.taxonomyId) continue;

        const part = await manager.getRepository(Part).save(
          manager.getRepository(Part).create({
            tenantId,
            vehicleId: vehicle.id,
            taxonomyId: partInput.taxonomyId,
            status: PartStatus.PENDING_AI,
          }),
        );

        const partFilePrefix = `partPhoto:${partInput.id}:`;
        const detectionsByPhotoId = new Map<string, IntakeDetectionInput>();
        for (const detection of partInput.detections ?? []) {
          if (
            detection?.photoId &&
            detection.grade &&
            VALID_GRADES.has(detection.grade)
          ) {
            detectionsByPhotoId.set(detection.photoId, detection);
          }
        }
        let hasPersistedAnalysis = false;

        for (const file of files) {
          if (!file.fieldname.startsWith(partFilePrefix)) continue;
          const draftPhotoId = file.fieldname.slice(partFilePrefix.length);

          const partImageId = randomUUID();
          const relativePath = await this.storage.save(
            `${tenantId}/${part.id}/${partImageId}.${extensionFor(file.mimetype)}`,
            file.buffer,
          );
          const partImage = await manager.getRepository(PartImage).save(
            manager.getRepository(PartImage).create({
              id: partImageId,
              tenantId,
              partId: part.id,
              url: relativePath,
              qualityFlags: null,
            }),
          );

          const detection = detectionsByPhotoId.get(draftPhotoId);
          if (detection) {
            // This photo was already graded per-part by the bulk scan.
            // Re-running the single-part prompt on it would be worse than
            // redundant: a scene photo holds many parts, and that prompt
            // answers for exactly one, so every part sharing this photo
            // would end up with the same arbitrary grade. Persist what the
            // scan actually determined for THIS part instead.
            await manager.getRepository(AiAnalysis).save(
              manager.getRepository(AiAnalysis).create({
                tenantId,
                partId: part.id,
                partImageId: partImage.id,
                modelVersion: this.detectionModelVersion,
                promptVersion: SCENE_DETECTION_PROMPT_VERSION,
                rawJson: {
                  grade: detection.grade,
                  damage_codes: detection.damageCodes ?? [],
                  confidence: detection.confidence ?? null,
                  source: 'scene-detection',
                },
                grade: detection.grade as AiGrade,
                damageCodes: detection.damageCodes ?? [],
                confidence: detection.confidence ?? null,
                status: AiAnalysisStatus.COMPLETE,
              }),
            );
            hasPersistedAnalysis = true;
            continue;
          }

          // Non-blocking per CLAUDE.md rule 4, same retry budget as
          // PartsService.addImage().
          await this.aiQueue.add(
            'analyze',
            { tenantId, partImageId: partImage.id },
            { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
          );
        }

        // A part carrying a scan grade is reviewable immediately; without
        // this it would sit at pending_ai forever, since no job was queued
        // for it and nothing else ever moves it forward.
        if (hasPersistedAnalysis) {
          await manager
            .getRepository(Part)
            .update({ id: part.id }, { status: PartStatus.PENDING_REVIEW });
        }
      }

      return { vehicleId: vehicle.id };
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

      return {
        items: vehicles.map((v) => ({
          ...v,
          partsCount: countsByVehicle.get(v.id) ?? 0,
        })),
        total,
        page,
        pageSize,
      };
    });
  }

  /**
   * Attaches another exterior photo to an already-synced vehicle, so an
   * attendant can re-shoot a dark or missed angle days after intake. Unlike
   * part photos, exterior shots are not AI-analyzed, so nothing is enqueued.
   */
  async addImage(
    tenantId: string,
    vehicleId: string,
    angle: string | undefined,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<VehicleImage> {
    if (
      !angle ||
      !(Object.values(VehicleImageAngle) as string[]).includes(angle)
    ) {
      throw new BadRequestException(
        `angle must be one of: ${Object.values(VehicleImageAngle).join(', ')}`,
      );
    }

    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const vehicle = await manager
        .getRepository(Vehicle)
        .findOne({ where: { id: vehicleId } });
      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }

      const relativePath = await this.storage.save(
        `${tenantId}/${vehicleId}/exterior-${randomUUID()}.${extensionFor(file.mimetype)}`,
        file.buffer,
      );
      return manager.getRepository(VehicleImage).save(
        manager.getRepository(VehicleImage).create({
          tenantId,
          vehicleId,
          angle: angle as VehicleImageAngle,
          url: relativePath,
        }),
      );
    });
  }

  /** Mirrors PartsService.getImageFile(); see the content-type note there. */
  async getImageFile(
    tenantId: string,
    vehicleId: string,
    imageId: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const image = await manager
        .getRepository(VehicleImage)
        .findOne({ where: { id: imageId, vehicleId } });
      if (!image) {
        throw new NotFoundException('Vehicle image not found');
      }
      const buffer = await this.storage.read(image.url);
      const contentType = image.url.toLowerCase().endsWith('.png')
        ? 'image/png'
        : 'image/jpeg';
      return { buffer, contentType };
    });
  }

  /**
   * Enriched beyond the raw entities because this backs the attendant's
   * "reopen a previous vehicle" screen: a worker picking which part to
   * re-shoot needs the part's *name* and how many photos it already has,
   * neither of which lives on the Part row.
   */
  async detail(tenantId: string, vehicleId: string) {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const vehicle = await manager
        .getRepository(Vehicle)
        .findOne({ where: { id: vehicleId } });
      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }
      // Sequential, not Promise.all: these share withTenantContext's single
      // transactional client, which can't interleave queries.
      const parts = await manager
        .getRepository(Part)
        .find({ where: { vehicleId }, order: { createdAt: 'ASC' } });
      const images = await manager
        .getRepository(VehicleImage)
        .find({ where: { vehicleId }, order: { createdAt: 'ASC' } });

      const taxonomyIds = [...new Set(parts.map((p) => p.taxonomyId))];
      const taxonomies = taxonomyIds.length
        ? await manager
            .getRepository(PartTaxonomy)
            .findBy({ id: In(taxonomyIds) })
        : [];
      const partIds = parts.map((p) => p.id);
      const photoCounts = partIds.length
        ? await manager
            .getRepository(PartImage)
            .createQueryBuilder('img')
            .select('img.partId', 'partId')
            .addSelect('COUNT(*)', 'count')
            .where('img.partId IN (:...partIds)', { partIds })
            .groupBy('img.partId')
            .getRawMany<{ partId: string; count: string }>()
        : [];

      const taxonomyById = new Map(taxonomies.map((t) => [t.id, t]));
      const photoCountByPart = new Map(
        photoCounts.map((c): [string, number] => [c.partId, Number(c.count)]),
      );

      return {
        ...vehicle,
        images,
        parts: parts.map((part) => ({
          ...part,
          taxonomyName: taxonomyById.get(part.taxonomyId)?.name ?? null,
          photosCount: photoCountByPart.get(part.id) ?? 0,
        })),
      };
    });
  }

  /**
   * Runs multi-part AI detection over photos of a vehicle that already
   * exists, and files the results as inventory.
   *
   * This is the manager-side counterpart to the worker's intake scan, and
   * the reason it needs its own method rather than reusing
   * POST /ai/detect-parts: that endpoint is deliberately stateless (during
   * intake there is no Vehicle row to attach anything to), whereas here the
   * vehicle, its VIN and its decode are all already in the database. That
   * lets this path do two things the stateless one cannot:
   *
   *  1. Drive detection with the VIN-derived roster (vin-parts-roster.ts),
   *     which pins the model's vocabulary to the taxonomy's own wording and
   *     rules out parts the vehicle cannot have.
   *  2. Persist automatically, so a manager uploads photos and gets graded
   *     inventory without a per-detection confirmation step.
   *
   * Human-in-the-loop is preserved, just moved: nothing here is `approved`.
   * Confident detections land at `pending_review` for the Review Queue, and
   * only approval puts a part into an export.
   *
   * Grades come from the scan itself and are NEVER re-derived by queueing a
   * grading job -- the single-part prompt answers for one part, so running
   * it over a scene photo would stamp one arbitrary grade onto every part
   * in it. Same reasoning, and the same handling, as intake().
   */
  async scan(
    tenantId: string,
    vehicleId: string,
    files: { buffer: Buffer }[],
    useExistingImages: boolean,
  ): Promise<VehicleScanSummary> {
    const tenant = await this.dataSource
      .getRepository(Tenant)
      .findOne({ where: { id: tenantId } });
    const threshold = tenant?.settings?.aiConfidenceThreshold ?? 0.7;

    const { vehicle, buffers } = await withTenantContext(
      this.dataSource,
      tenantId,
      async (manager) => {
        const found = await manager
          .getRepository(Vehicle)
          .findOne({ where: { id: vehicleId } });
        if (!found) {
          throw new NotFoundException('Vehicle not found');
        }

        if (!useExistingImages) {
          return { vehicle: found, buffers: files.map((f) => f.buffer) };
        }

        // "Or old images": re-run detection over the walkaround photos
        // already stored on this vehicle, with no upload at all. These were
        // never AI-analysed -- exterior photos deliberately skip the queue
        // -- so for most vehicles this is the first time anything has
        // looked at them.
        const images = await manager
          .getRepository(VehicleImage)
          .find({ where: { vehicleId }, order: { createdAt: 'ASC' } });
        const loaded: Buffer[] = [];
        for (const image of images) {
          try {
            loaded.push(await this.storage.read(image.url));
          } catch {
            // A row whose file is missing must not sink the whole scan.
            continue;
          }
        }
        return { vehicle: found, buffers: loaded };
      },
    );

    if (buffers.length === 0) {
      throw new BadRequestException(
        useExistingImages
          ? 'This vehicle has no stored photos to scan'
          : 'No files uploaded',
      );
    }

    const roster = deriveRoster(vehicle.decodedRaw);
    // Detection runs OUTSIDE the transaction on purpose: it is 20-40s of
    // Gemini calls, and holding a Postgres transaction open across it would
    // pin a pooled connection for the whole time for no benefit.
    const { images } = await this.detectParts.detect(
      buffers.map((buffer) => ({ buffer })),
      roster.expected,
    );

    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const partRepo = manager.getRepository(Part);
      const existingParts = await partRepo.find({ where: { vehicleId } });
      // Keyed by taxonomy so a second scan, or a part added by hand, is
      // reused rather than duplicated. Without this every re-scan would
      // double the vehicle's inventory.
      const partByTaxonomy = new Map(
        existingParts.map((p) => [p.taxonomyId, p]),
      );
      // Snapshot of what was here BEFORE this scan. Needed because
      // partByTaxonomy grows as the scan creates parts, so without it a part
      // created from photo 1 and seen again in photo 2 would be counted as
      // both "created" and "updated" -- a live run reported 22 created and
      // 14 updated for a vehicle that only had 1 pre-existing part.
      const preExistingPartIds = new Set(existingParts.map((p) => p.id));
      const createdTaxonomyIds = new Set<string>();
      const updatedPartIds = new Set<string>();
      const needsGradingPartIds = new Set<string>();
      // One photo can show a part twice; it must not be attached twice.
      const attached = new Set<string>();
      const unresolved: UnresolvedDetection[] = [];
      const photos: ScannedPhotoSummary[] = [];

      for (const image of images) {
        photos.push({
          index: image.index,
          clarity: image.clarity ?? 'unknown',
          note: image.clarityNote ?? null,
          detections: image.detections.length,
          ...(image.error ? { error: image.error } : {}),
        });

        for (const detection of image.detections) {
          if (!detection.taxonomyId) {
            // Ambiguous or unmapped. No taxonomy row means no Part can be
            // created (taxonomy_id is NOT NULL), and guessing a side would
            // put a wrong part number into inventory -- worse than an
            // unresolved one. Surfaced for a person instead.
            unresolved.push({
              partName: detection.partName,
              candidateIds: detection.candidateIds,
              reason:
                detection.candidateIds.length > 0 ? 'ambiguous' : 'unmapped',
              grade: detection.grade,
              confidence: detection.confidence,
              photoIndex: image.index,
            });
            continue;
          }

          const confident = detection.confidence >= threshold;

          let part = partByTaxonomy.get(detection.taxonomyId);
          if (!part) {
            part = await partRepo.save(
              partRepo.create({
                tenantId,
                vehicleId,
                taxonomyId: detection.taxonomyId,
                status: confident
                  ? PartStatus.PENDING_REVIEW
                  : PartStatus.NEEDS_MANUAL_GRADING,
              }),
            );
            partByTaxonomy.set(detection.taxonomyId, part);
            createdTaxonomyIds.add(detection.taxonomyId);
          } else if (preExistingPartIds.has(part.id)) {
            updatedPartIds.add(part.id);
          }

          const attachKey = `${part.id}:${image.index}`;
          if (attached.has(attachKey)) continue;
          attached.add(attachKey);

          const partImageId = randomUUID();
          const relativePath = await this.storage.save(
            `${tenantId}/${part.id}/${partImageId}.jpg`,
            buffers[image.index],
          );
          const partImage = await manager.getRepository(PartImage).save(
            manager.getRepository(PartImage).create({
              id: partImageId,
              tenantId,
              partId: part.id,
              url: relativePath,
              qualityFlags: null,
            }),
          );

          if (!confident) {
            // Below the tenant's confidence threshold: the photo is filed
            // against the right part, but no grade is written and nothing
            // is queued. A person grades it, which is exactly the
            // "if it's uncertain, leave it for a person" case.
            needsGradingPartIds.add(part.id);
            await partRepo.update(
              { id: part.id },
              { status: PartStatus.NEEDS_MANUAL_GRADING },
            );
            continue;
          }

          await manager.getRepository(AiAnalysis).save(
            manager.getRepository(AiAnalysis).create({
              tenantId,
              partId: part.id,
              partImageId: partImage.id,
              modelVersion: this.detectionModelVersion,
              promptVersion: SCENE_DETECTION_PROMPT_VERSION,
              rawJson: {
                grade: detection.grade,
                damage_codes: detection.damageCodes,
                confidence: detection.confidence,
                detected_as: detection.partName,
                source: 'vehicle-scan',
              },
              grade: detection.grade as AiGrade,
              damageCodes: detection.damageCodes,
              confidence: detection.confidence,
              status: AiAnalysisStatus.COMPLETE,
            }),
          );
          // A part previously parked for manual grading that now has a
          // confident grade becomes reviewable again.
          await partRepo.update(
            { id: part.id },
            { status: PartStatus.PENDING_REVIEW },
          );
          needsGradingPartIds.delete(part.id);
        }
      }

      const allParts = await partRepo.find({ where: { vehicleId } });
      const taxonomyIds = [...new Set(allParts.map((p) => p.taxonomyId))];
      const taxonomies = taxonomyIds.length
        ? await manager
            .getRepository(PartTaxonomy)
            .findBy({ id: In(taxonomyIds) })
        : [];
      const heldNames = new Set(taxonomies.map((t) => t.name));

      return {
        vehicleId,
        partsCreated: createdTaxonomyIds.size,
        partsUpdated: updatedPartIds.size,
        needsGrading: needsGradingPartIds.size,
        photos,
        unresolved,
        roster: {
          expected: roster.expected,
          found: roster.expected.filter((name) => heldNames.has(name)),
          missing: roster.expected.filter((name) => !heldNames.has(name)),
          approximate: roster.approximate,
          doors: roster.doors,
          bodyClass: roster.bodyClass,
        },
      };
    });
  }

  /**
   * Hard-deletes a vehicle added by mistake, along with everything hanging
   * off it. Manager/owner only -- see the controller.
   *
   * One SQL DELETE is enough: every child table cascades from `vehicles` at
   * the DB level (InitialSchema migration) -- vehicle_images, and parts ->
   * part_images -> ai_analyses -> human_corrections, plus embeddings,
   * pricing_history and listings. Postgres runs referential actions
   * internally, so the cascade is not itself filtered by RLS; the DELETE
   * this issues *is*, which is what confines it to the caller's tenant.
   *
   * Two consequences worth being explicit about:
   *  - **The Moat goes with it.** human_corrections cascades via
   *    ai_analyses, so this destroys real training data (CLAUDE.md rule 6).
   *    Accepted for a mistake-entry vehicle, whose corrections are noise,
   *    but it is a genuine trade and there is no soft-delete today.
   *  - **In-flight AI jobs are left pointing at deleted rows.** That is
   *    safe: analyzePartImage throws EntityNotFoundError, the job burns its
   *    retries, and handleExhaustedRetries findOne-s (not findOneOrFail) and
   *    no-ops. This exact shape once killed the API process, so do not
   *    "tidy" either of those back into a throw.
   */
  async remove(
    tenantId: string,
    vehicleId: string,
  ): Promise<VehicleDeletionSummary> {
    const { summary, storedPaths } = await withTenantContext(
      this.dataSource,
      tenantId,
      async (manager) => {
        const vehicle = await manager
          .getRepository(Vehicle)
          .findOne({ where: { id: vehicleId } });
        if (!vehicle) {
          throw new NotFoundException('Vehicle not found');
        }

        // Read the file paths before deleting the rows -- afterwards there
        // is nothing left to tell us which files belonged to this vehicle.
        // Sequential for the same reason as detail(): one shared client.
        const parts = await manager
          .getRepository(Part)
          .find({ where: { vehicleId } });
        const partIds = parts.map((p) => p.id);
        const partImages = partIds.length
          ? await manager
              .getRepository(PartImage)
              .find({ where: { partId: In(partIds) } })
          : [];
        const vehicleImages = await manager
          .getRepository(VehicleImage)
          .find({ where: { vehicleId } });

        await manager.getRepository(Vehicle).delete({ id: vehicleId });

        return {
          summary: {
            vehicleId,
            vin: vehicle.vin,
            deletedParts: parts.length,
            deletedPhotos: partImages.length + vehicleImages.length,
          },
          storedPaths: [
            ...partImages.map((i) => i.url),
            ...vehicleImages.map((i) => i.url),
          ],
        };
      },
    );

    // Deliberately after the transaction commits, never inside it: an
    // unlink cannot be rolled back, so deleting files first would destroy
    // photos belonging to a transaction that then failed. Best-effort in
    // the other direction too -- an orphaned file is recoverable disk
    // waste, whereas failing the request here would report "not deleted"
    // for a vehicle that is already gone from the database.
    for (const relativePath of storedPaths) {
      try {
        await this.storage.remove(relativePath);
      } catch (error) {
        console.error(
          `[VehiclesService] failed to delete stored file ${relativePath}`,
          error,
        );
      }
    }

    return summary;
  }
}
