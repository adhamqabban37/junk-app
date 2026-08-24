import { randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource, EntityManager, FindOptionsWhere, In } from 'typeorm';
import { AI_ANALYSIS_QUEUE, AiAnalysisJobData } from '../ai/ai-queue.constants';
import {
  AiAnalysis,
  AiAnalysisStatus,
  AiGrade,
} from '../database/entities/ai-analysis.entity';
import { Embedding } from '../database/entities/embedding.entity';
import { Listing } from '../database/entities/listing.entity';
import { Part, PartStatus } from '../database/entities/part.entity';
import { PartImage } from '../database/entities/part-image.entity';
import { PartTaxonomy } from '../database/entities/part-taxonomy.entity';
import { PricingHistory } from '../database/entities/pricing-history.entity';
import { Vehicle } from '../database/entities/vehicle.entity';
import { withTenantContext } from '../database/tenant-context';
import type { AraDamageInstance } from '../ai/grading.service';
import { toCsv } from './csv';
import {
  LocalFileStorage,
  mimetypeFromExtension,
  resolveImageExtension,
} from '../storage/local-file-storage';

/**
 * Exported for reuse by AiAnalysisService.analyzeVehicle(), which combines
 * multiple per-section Gemini calls into one overall vehicle grade the
 * same "worst wins" way. X is included only for type completeness --
 * aggregatePartAnalysis() below (and analyzeVehicle(), which never
 * produces X in the first place) both exclude X from real severity
 * comparisons, so this value is never actually read.
 */
export const GRADE_SEVERITY: Record<AiGrade, number> = {
  [AiGrade.A]: 0,
  [AiGrade.B]: 1,
  [AiGrade.C]: 2,
  [AiGrade.X]: -1,
};

/**
 * A Part can have more than one AiAnalysis row -- one per PartImage, e.g.
 * after a manual multi-photo assign attaches several angles to the same
 * Part. Picking only the most recently graded image (the old behavior)
 * silently discarded every other angle's already-computed grade and
 * damage codes -- a scratch visible only on a angle that wasn't "latest"
 * was invisible to the Part's displayed grade. This picks the worst
 * graded row as the "controlling" analysis (same id/confidence/status
 * the UI and the correction-recording flow act on), but reports the
 * union of every row's damage codes so nothing gets hidden. Falls back
 * to the latest row when none have a grade yet (all pending/failed) --
 * identical to the old single-row behavior in that case. `analyses` must
 * already be ordered latest-first (createdAt DESC), matching every
 * caller's own query.
 */
function aggregatePartAnalysis(analyses: AiAnalysis[]): AiAnalysis | null {
  if (analyses.length === 0) return null;
  // X ("insufficient information") is excluded from the worst-wins pool --
  // it's not a severity tier, so an X reading from one blurry angle must
  // never mask a real A/B/C grade found from a different, clearer angle of
  // the same Part. Only surfaces when every graded row is X.
  const graded = analyses.filter(
    (a): a is AiAnalysis & { grade: AiGrade } =>
      a.grade !== null && a.grade !== AiGrade.X,
  );
  const controlling =
    graded.length > 0
      ? graded.reduce((worst, a) =>
          GRADE_SEVERITY[a.grade] > GRADE_SEVERITY[worst.grade] ? a : worst,
        )
      : (analyses.find((a) => a.grade === AiGrade.X) ?? analyses[0]);
  const damageCodes = [...new Set(analyses.flatMap((a) => a.damageCodes))];
  return { ...controlling, damageCodes };
}

export interface PartListResult {
  items: PartListItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PartListItem {
  id: string;
  status: PartStatus;
  createdAt: Date;
  taxonomyId: string;
  taxonomyName: string | null;
  vehicle: {
    id: string;
    vin: string;
    make: string | null;
    model: string | null;
    year: number | null;
  } | null;
  photosCount: number;
  /** Earliest PartImage id, for a Review Queue thumbnail -- "the photo AI graded this from," per the user's own ask ("have the image of where AI chose that [part] or not"). */
  firstImageId: string | null;
  /** Most recent PricingHistory row's price, if a manager has ever set one -- pricing_history is an append-only log, this is just its latest entry per part. */
  latestPrice: string | null;
  latestAnalysis: {
    id: string;
    grade: string | null;
    damageCodes: string[];
    confidence: number | string | null;
    status: string;
    /** ARA damage-unit total, sheet-metal parts only -- null for every other part type. See grading.service.ts. */
    damageUnits: number | string | null;
    /** Itemized ARA damage backing damageUnits/grade, sheet-metal parts only -- null otherwise. */
    araDamageCodes: AraDamageInstance[] | null;
  } | null;
}

@Injectable()
export class PartsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: LocalFileStorage,
    @InjectQueue(AI_ANALYSIS_QUEUE)
    private readonly aiQueue: Queue<AiAnalysisJobData>,
  ) {
    // Queue is an EventEmitter -- an unlistened 'error' event is a Node
    // crash, not just a dropped log line. See AiAnalysisProcessor's
    // matching Worker-side listener for the full explanation (this fires
    // both on real transient Redis blips and reliably during app shutdown).
    this.aiQueue.on('error', (error) => {
      if (process.env.NODE_ENV !== 'test') {
        console.error('[PartsService] queue error', error);
      }
    });
  }

  async addImage(
    tenantId: string,
    partId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<PartImage> {
    return withTenantContext(this.dataSource, tenantId, (manager) =>
      this.addImageInTransaction(manager, tenantId, partId, file),
    );
  }

  /**
   * Re-runs AI grading for every image on a part, bypassing the normal
   * idempotency skip (analyzePartImage's `force` flag) -- a manager
   * disagreeing with a grade in the Review Queue can ask for a fresh
   * opinion instead of only being able to override it by hand.
   */
  async regrade(tenantId: string, partId: string): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, async (manager) => {
      const part = await manager
        .getRepository(Part)
        .findOne({ where: { id: partId } });
      if (!part) {
        throw new NotFoundException('Part not found');
      }
      const images = await manager
        .getRepository(PartImage)
        .find({ where: { partId } });
      for (const image of images) {
        await this.aiQueue.add(
          'analyze',
          { tenantId, partImageId: image.id, force: true },
          { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
        );
      }
    });
  }

  /**
   * Records a manually-set asking price for a part -- pricing_history is an
   * append-only log (real deployments will also see rows land here from a
   * future MarketCheck/comp-pricing integration, per docs/PROGRESS.md's own
   * scoping note), so this never updates a row in place, it just adds the
   * newest one. `list()`'s `latestPrice` is always this row's price, per
   * part, ordered by createdAt.
   */
  async setPrice(
    tenantId: string,
    partId: string,
    price: number,
  ): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, async (manager) => {
      const part = await manager
        .getRepository(Part)
        .findOne({ where: { id: partId } });
      if (!part) {
        throw new NotFoundException('Part not found');
      }
      await manager.getRepository(PricingHistory).save(
        manager.getRepository(PricingHistory).create({
          tenantId,
          partId,
          source: 'manual',
          price: price.toFixed(2),
        }),
      );
    });
  }

  /**
   * Manager backstop for the AI still splitting one physical part across
   * several Parts (see docs/PROGRESS.md Phase 5) -- the within-batch
   * group_id grouping in AiAnalysisService.analyzeVehicle() only sees
   * photos from one Gemini call, so the same fender photographed in two
   * different upload sessions/sections still lands as two separate Parts.
   * Folds every sourcePartIds row's PartImages and AiAnalysis (plus
   * PricingHistory/Listing/Embedding, for completeness) onto the target
   * Part, then deletes the now-empty source Parts. Every part_id-bearing
   * table has ON DELETE CASCADE from parts -- anything not explicitly
   * repointed here before that delete would be silently destroyed, not
   * just orphaned.
   */
  async merge(
    tenantId: string,
    targetPartId: string,
    sourcePartIds: string[],
  ): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, async (manager) => {
      const ids = [...new Set(sourcePartIds)].filter(
        (id) => id !== targetPartId,
      );
      if (ids.length === 0) {
        throw new BadRequestException(
          'sourcePartIds must contain at least one part other than the target',
        );
      }

      const partRepo = manager.getRepository(Part);
      const target = await partRepo.findOne({ where: { id: targetPartId } });
      if (!target) {
        throw new NotFoundException('Target part not found');
      }
      const sources = await partRepo.find({ where: { id: In(ids) } });
      if (sources.length !== ids.length) {
        throw new NotFoundException('One or more source parts not found');
      }

      const immovable = [target, ...sources].find(
        (p) => p.status === PartStatus.LISTED || p.status === PartStatus.SOLD,
      );
      if (immovable) {
        throw new BadRequestException(
          'Cannot merge a part that is already listed or sold',
        );
      }
      const wrongVehicle = sources.find(
        (s) => s.vehicleId !== target.vehicleId,
      );
      if (wrongVehicle) {
        throw new BadRequestException(
          'Cannot merge parts from different vehicles',
        );
      }

      await manager
        .getRepository(PartImage)
        .update({ partId: In(ids) }, { partId: targetPartId });
      await manager
        .getRepository(AiAnalysis)
        .update({ partId: In(ids) }, { partId: targetPartId });
      await manager
        .getRepository(PricingHistory)
        .update({ partId: In(ids) }, { partId: targetPartId });
      await manager
        .getRepository(Listing)
        .update({ partId: In(ids) }, { partId: targetPartId });
      await manager
        .getRepository(Embedding)
        .update({ partId: In(ids) }, { partId: targetPartId });

      await partRepo.delete({ id: In(ids) });

      // A target created via createManual() (NEEDS_MANUAL_GRADING, no
      // images of its own) or still PENDING_AI can now have real graded
      // images merged onto it -- mirrors the status bump
      // analyzePartImage() already does whenever a graded image lands on
      // a Part, so the merged Part actually surfaces in Review Queue
      // instead of sitting invisible under its old pre-merge status.
      if (
        target.status !== PartStatus.APPROVED &&
        target.status !== PartStatus.LISTED &&
        target.status !== PartStatus.SOLD
      ) {
        const hasCompleteAnalysis = await manager
          .getRepository(AiAnalysis)
          .findOne({
            where: { partId: targetPartId, status: AiAnalysisStatus.COMPLETE },
          });
        if (hasCompleteAnalysis) {
          await partRepo.update(
            { id: targetPartId },
            { status: PartStatus.PENDING_REVIEW },
          );
        }
      }
    });
  }

  /**
   * Serves a PartImage's raw bytes -- "the image AI graded this part from,"
   * for the Review Queue thumbnail. Mirrors
   * VehiclesService.getPhotoFile()'s exact shape/rationale (JWT-guarded,
   * scoped to the specific part so a foreign image id 404s rather than
   * leaking another part's photo).
   */
  async getImageFile(
    tenantId: string,
    partId: string,
    imageId: string,
  ): Promise<{ buffer: Buffer; contentType: string }> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const image = await manager
        .getRepository(PartImage)
        .findOne({ where: { id: imageId, partId } });
      if (!image) {
        throw new NotFoundException('Image not found');
      }
      const buffer = await this.storage.read(image.url);
      const extension = image.url.split('.').pop() ?? '';
      return { buffer, contentType: mimetypeFromExtension(extension) };
    });
  }

  /**
   * Creates a Part with no photo at all -- for something the yard knows it
   * has but that isn't (and may never be) photographed, e.g. an alternator
   * still inside an unphotographed engine bay. Starts at
   * NEEDS_MANUAL_GRADING (not PENDING_AI): there's no image to send
   * Gemini, so no AI job is enqueued -- a manager grades it directly in
   * the Review Queue via the existing grade-override-then-approve flow.
   */
  async createManual(
    tenantId: string,
    vehicleId: string,
    taxonomyId: string,
  ): Promise<Part> {
    return withTenantContext(this.dataSource, tenantId, (manager) =>
      this.createManualInTransaction(manager, tenantId, vehicleId, taxonomyId),
    );
  }

  /**
   * Same as createManual(), but runs against a manager the caller already
   * has a transaction open on -- lets VehiclesService.createManualPart()
   * check the vehicle exists and create the Part atomically in one
   * transaction, rather than two separate connections/transactions that
   * could observe different states of the world (same rationale as
   * addImageInTransaction() above).
   */
  async createManualInTransaction(
    manager: EntityManager,
    tenantId: string,
    vehicleId: string,
    taxonomyId: string,
  ): Promise<Part> {
    return manager.getRepository(Part).save(
      manager.getRepository(Part).create({
        tenantId,
        vehicleId,
        taxonomyId,
        status: PartStatus.NEEDS_MANUAL_GRADING,
      }),
    );
  }

  /**
   * Same as `addImage()`, but runs against a manager the caller already has
   * a transaction open on, instead of opening its own via
   * `withTenantContext()`. Lets `VehiclesService.intake()` create a
   * Vehicle + its Parts + all their PartImages atomically in one
   * transaction, reusing this exact storage+insert+enqueue logic per photo.
   */
  async addImageInTransaction(
    manager: EntityManager,
    tenantId: string,
    partId: string,
    file: { buffer: Buffer; mimetype: string },
  ): Promise<PartImage> {
    const part = await manager
      .getRepository(Part)
      .findOne({ where: { id: partId } });
    if (!part) {
      throw new NotFoundException('Part not found');
    }

    const partImageId = randomUUID();
    const extension = resolveImageExtension(file.mimetype);
    const relativePath = await this.storage.save(
      `${tenantId}/${partId}/${partImageId}.${extension}`,
      file.buffer,
    );

    const partImage = await manager.getRepository(PartImage).save(
      manager.getRepository(PartImage).create({
        id: partImageId,
        tenantId,
        partId,
        url: relativePath,
        qualityFlags: null,
      }),
    );

    // Non-blocking per CLAUDE.md rule 4: the upload request returns as
    // soon as the image is stored, grading happens asynchronously.
    // Conservative retry budget -- see AiAnalysisProcessor's concurrency
    // comment re: Gemini's exact rate limit not being pinned down yet.
    await this.aiQueue.add(
      'analyze',
      { tenantId, partImageId: partImage.id },
      { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
    );

    return partImage;
  }

  async list(
    tenantId: string,
    statuses: PartStatus[] | undefined,
    page: number,
    pageSize: number,
    vehicleId?: string,
  ): Promise<PartListResult> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const where: FindOptionsWhere<Part> = { tenantId };
      if (statuses?.length) {
        where.status = In(statuses);
      }
      if (vehicleId) {
        where.vehicleId = vehicleId;
      }

      const [parts, total] = await manager.getRepository(Part).findAndCount({
        where,
        order: { createdAt: 'DESC' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });

      const partIds = parts.map((p) => p.id);
      const vehicleIds = [...new Set(parts.map((p) => p.vehicleId))];
      const taxonomyIds = [...new Set(parts.map((p) => p.taxonomyId))];

      // Sequential, not Promise.all: these all share the one transactional
      // client withTenantContext hands out, and a single Postgres
      // connection can't run concurrent/interleaved queries (pg logs a
      // deprecation warning today; a future pg major turns it into a hard
      // error).
      const vehicles = vehicleIds.length
        ? await manager.getRepository(Vehicle).findBy({ id: In(vehicleIds) })
        : [];
      const taxonomies = taxonomyIds.length
        ? await manager
            .getRepository(PartTaxonomy)
            .findBy({ id: In(taxonomyIds) })
        : [];
      const analyses = partIds.length
        ? await manager.getRepository(AiAnalysis).find({
            where: { partId: In(partIds) },
            order: { createdAt: 'DESC' },
          })
        : [];
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
      const firstImages = partIds.length
        ? await manager
            .getRepository(PartImage)
            .createQueryBuilder('img')
            .distinctOn(['img.partId'])
            .where('img.partId IN (:...partIds)', { partIds })
            .orderBy('img.partId')
            .addOrderBy('img.createdAt', 'ASC')
            .getMany()
        : [];
      const latestPrices = partIds.length
        ? await manager
            .getRepository(PricingHistory)
            .createQueryBuilder('ph')
            .distinctOn(['ph.partId'])
            .where('ph.partId IN (:...partIds)', { partIds })
            .orderBy('ph.partId')
            .addOrderBy('ph.createdAt', 'DESC')
            .getMany()
        : [];

      const vehicleById = new Map(
        vehicles.map((v): [string, Vehicle] => [v.id, v]),
      );
      const taxonomyById = new Map(
        taxonomies.map((t): [string, PartTaxonomy] => [t.id, t]),
      );
      const analysesByPart = new Map<string, AiAnalysis[]>();
      for (const analysis of analyses) {
        const group = analysesByPart.get(analysis.partId) ?? [];
        group.push(analysis);
        analysesByPart.set(analysis.partId, group);
      }
      const latestAnalysisByPart = new Map<string, AiAnalysis>();
      for (const [partId, group] of analysesByPart) {
        const aggregated = aggregatePartAnalysis(group);
        if (aggregated) latestAnalysisByPart.set(partId, aggregated);
      }
      const photoCountByPart = new Map(
        photoCounts.map((c): [string, number] => [c.partId, Number(c.count)]),
      );
      const firstImageByPart = new Map(
        firstImages.map((img): [string, string] => [img.partId, img.id]),
      );
      const latestPriceByPart = new Map(
        latestPrices.map((p): [string, string] => [p.partId, p.price]),
      );

      return {
        items: parts.map((part) =>
          this.toListItem(
            part,
            vehicleById,
            taxonomyById,
            latestAnalysisByPart,
            photoCountByPart,
            firstImageByPart,
            latestPriceByPart,
          ),
        ),
        total,
        page,
        pageSize,
      };
    });
  }

  private toListItem(
    part: Part,
    vehicleById: Map<string, Vehicle>,
    taxonomyById: Map<string, PartTaxonomy>,
    latestAnalysisByPart: Map<string, AiAnalysis>,
    photoCountByPart: Map<string, number>,
    firstImageByPart: Map<string, string>,
    latestPriceByPart: Map<string, string>,
  ): PartListItem {
    const vehicle = vehicleById.get(part.vehicleId);
    const taxonomy = taxonomyById.get(part.taxonomyId);
    const analysis = latestAnalysisByPart.get(part.id) ?? null;
    return {
      id: part.id,
      status: part.status,
      createdAt: part.createdAt,
      taxonomyId: part.taxonomyId,
      taxonomyName: taxonomy?.name ?? null,
      vehicle: vehicle
        ? {
            id: vehicle.id,
            vin: vehicle.vin,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
          }
        : null,
      photosCount: photoCountByPart.get(part.id) ?? 0,
      firstImageId: firstImageByPart.get(part.id) ?? null,
      latestPrice: latestPriceByPart.get(part.id) ?? null,
      latestAnalysis: analysis
        ? {
            id: analysis.id,
            grade: analysis.grade,
            damageCodes: analysis.damageCodes,
            confidence: analysis.confidence,
            status: analysis.status,
            damageUnits: analysis.damageUnits,
            araDamageCodes: analysis.araDamageCodes,
          }
        : null,
    };
  }

  async detail(tenantId: string, partId: string) {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const part = await manager
        .getRepository(Part)
        .findOne({ where: { id: partId } });
      if (!part) {
        throw new NotFoundException('Part not found');
      }
      // Sequential, not Promise.all -- see the same note in list() above.
      const vehicle = await manager
        .getRepository(Vehicle)
        .findOne({ where: { id: part.vehicleId } });
      const taxonomy = await manager
        .getRepository(PartTaxonomy)
        .findOne({ where: { id: part.taxonomyId } });
      const photos = await manager
        .getRepository(PartImage)
        .find({ where: { partId } });
      const analyses = await manager
        .getRepository(AiAnalysis)
        .find({ where: { partId }, order: { createdAt: 'DESC' } });
      return {
        id: part.id,
        status: part.status,
        createdAt: part.createdAt,
        taxonomyId: part.taxonomyId,
        taxonomyName: taxonomy?.name ?? null,
        vehicle,
        photos,
        latestAnalysis: aggregatePartAnalysis(analyses),
      };
    });
  }

  async approve(tenantId: string, partId: string): Promise<void> {
    await withTenantContext(this.dataSource, tenantId, async (manager) => {
      const part = await manager
        .getRepository(Part)
        .findOne({ where: { id: partId } });
      if (!part) {
        throw new NotFoundException('Part not found');
      }
      await manager
        .getRepository(Part)
        .update({ id: partId }, { status: PartStatus.APPROVED });
    });
  }

  /** Only APPROVED/LISTED parts are marketplace-ready -- a part still mid-review or newly intaken has no business in a syndication export. */
  async exportCsv(tenantId: string): Promise<string> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const parts = await manager.getRepository(Part).find({
        where: {
          tenantId,
          status: In([PartStatus.APPROVED, PartStatus.LISTED]),
        },
        order: { createdAt: 'ASC' },
      });

      const vehicleIds = [...new Set(parts.map((p) => p.vehicleId))];
      const taxonomyIds = [...new Set(parts.map((p) => p.taxonomyId))];
      const partIds = parts.map((p) => p.id);

      // Sequential -- see the Promise.all note on list()/detail() above.
      const vehicles = vehicleIds.length
        ? await manager.getRepository(Vehicle).findBy({ id: In(vehicleIds) })
        : [];
      const taxonomies = taxonomyIds.length
        ? await manager
            .getRepository(PartTaxonomy)
            .findBy({ id: In(taxonomyIds) })
        : [];
      const analyses = partIds.length
        ? await manager.getRepository(AiAnalysis).find({
            where: { partId: In(partIds) },
            order: { createdAt: 'DESC' },
          })
        : [];
      const latestPrices = partIds.length
        ? await manager
            .getRepository(PricingHistory)
            .createQueryBuilder('ph')
            .distinctOn(['ph.partId'])
            .where('ph.partId IN (:...partIds)', { partIds })
            .orderBy('ph.partId')
            .addOrderBy('ph.createdAt', 'DESC')
            .getMany()
        : [];

      const vehicleById = new Map(
        vehicles.map((v): [string, Vehicle] => [v.id, v]),
      );
      const taxonomyById = new Map(
        taxonomies.map((t): [string, PartTaxonomy] => [t.id, t]),
      );
      const latestAnalysisByPart = new Map<string, AiAnalysis>();
      for (const analysis of analyses) {
        if (!latestAnalysisByPart.has(analysis.partId)) {
          latestAnalysisByPart.set(analysis.partId, analysis);
        }
      }
      const latestPriceByPart = new Map(
        latestPrices.map((p): [string, string] => [p.partId, p.price]),
      );

      const header = [
        'id',
        'vin',
        'title',
        'description',
        'grade',
        'damage_units',
        'damage_codes',
        'confidence',
        'status',
        'price',
      ];
      const rows = parts.map((part) => {
        const vehicle = vehicleById.get(part.vehicleId);
        const taxonomy = taxonomyById.get(part.taxonomyId);
        const analysis = latestAnalysisByPart.get(part.id) ?? null;
        const title = [
          vehicle?.year,
          vehicle?.make,
          vehicle?.model,
          taxonomy?.name,
        ]
          .filter((v) => v !== null && v !== undefined && v !== '')
          .join(' ');
        const description = analysis
          ? `Grade ${analysis.grade}. Damage: ${analysis.damageCodes.length ? analysis.damageCodes.join(', ') : 'none noted'}.`
          : 'Not yet AI-graded.';
        return [
          part.id,
          vehicle?.vin ?? '',
          title,
          description,
          analysis?.grade ?? '',
          analysis?.damageUnits != null ? String(analysis.damageUnits) : '',
          analysis?.damageCodes.join(';') ?? '',
          analysis?.confidence != null ? String(analysis.confidence) : '',
          part.status,
          latestPriceByPart.get(part.id) ?? '',
        ];
      });

      return toCsv(header, rows);
    });
  }
}
