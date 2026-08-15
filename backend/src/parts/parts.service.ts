import { randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource, FindOptionsWhere, In } from 'typeorm';
import {
  AI_ANALYSIS_QUEUE,
  AiAnalysisJobData,
} from '../ai/ai-analysis.processor';
import { AiAnalysis, AiGrade } from '../database/entities/ai-analysis.entity';
import { Part, PartStatus } from '../database/entities/part.entity';
import { PartImage } from '../database/entities/part-image.entity';
import { PartTaxonomy } from '../database/entities/part-taxonomy.entity';
import { Vehicle } from '../database/entities/vehicle.entity';
import { withTenantContext } from '../database/tenant-context';
import { toCsv } from './csv';
import { effectiveCondition } from './effective-condition';
import { LocalFileStorage } from '../storage/local-file-storage';

/**
 * The condition fields every part-facing projection exposes. Split out so
 * list(), detail() and the CSV export cannot drift in how they combine the
 * human's answer with the AI's prediction.
 */
function conditionFields(
  part: Part,
  analysis: AiAnalysis | null,
): {
  grade: AiGrade | null;
  damageCodes: string[];
  confidence: number | null;
  gradeSource: string;
  damageCodesSource: string;
} {
  const resolved = effectiveCondition(part, analysis);
  return {
    grade: resolved.grade,
    damageCodes: resolved.damageCodes,
    confidence: resolved.confidence,
    gradeSource: resolved.gradeSource,
    damageCodesSource: resolved.damageCodesSource,
  };
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
  /** Ordered oldest-first, so [0] is the photo the first grade came from. */
  photoIds: string[];
  latestAnalysis: {
    id: string;
    grade: string | null;
    damageCodes: string[];
    confidence: number | string | null;
    /** 'human' once a manager has ruled on the field, else 'ai'/'none'. */
    gradeSource: string;
    damageCodesSource: string;
    status: string;
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
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const part = await manager
        .getRepository(Part)
        .findOne({ where: { id: partId } });
      if (!part) {
        throw new NotFoundException('Part not found');
      }

      const partImageId = randomUUID();
      const extension = file.mimetype === 'image/png' ? 'png' : 'jpg';
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
    });
  }

  async list(
    tenantId: string,
    statuses: PartStatus[] | undefined,
    page: number,
    pageSize: number,
  ): Promise<PartListResult> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const where: FindOptionsWhere<Part> = { tenantId };
      if (statuses?.length) {
        where.status = In(statuses);
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
      // Ids, not just a COUNT. The Review Queue is where a manager accepts
      // or overrides an AI grade, and it had no way to show the photo that
      // grade came from -- approving a grade you cannot see is not review.
      // Selecting two columns for a page of parts is cheap, and it replaces
      // a per-row detail fetch that would otherwise be needed to render one
      // thumbnail.
      const photoRows = partIds.length
        ? await manager.getRepository(PartImage).find({
            where: { partId: In(partIds) },
            select: { id: true, partId: true },
            order: { createdAt: 'ASC' },
          })
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
      const photoIdsByPart = new Map<string, string[]>();
      for (const row of photoRows) {
        const ids = photoIdsByPart.get(row.partId) ?? [];
        ids.push(row.id);
        photoIdsByPart.set(row.partId, ids);
      }

      return {
        items: parts.map((part) =>
          this.toListItem(
            part,
            vehicleById,
            taxonomyById,
            latestAnalysisByPart,
            photoIdsByPart,
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
    photoIdsByPart: Map<string, string[]>,
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
      photosCount: photoIdsByPart.get(part.id)?.length ?? 0,
      photoIds: photoIdsByPart.get(part.id) ?? [],
      // `id` and `status` stay the analysis's own -- `id` is what the UI
      // POSTs corrections against, so it must keep pointing at a real
      // AiAnalysis row. The condition fields are resolved through
      // effectiveCondition() because a human's answer now lives on the Part
      // rather than being written back onto the prediction; without this the
      // Review Queue and Inventory would silently revert to showing the AI's
      // original values after a correction.
      latestAnalysis: analysis
        ? {
            id: analysis.id,
            ...conditionFields(part, analysis),
            status: analysis.status,
          }
        : null,
    };
  }

  /**
   * Serves the raw bytes of a part's photo for the Inventory/Review Queue
   * UI. Content-type is inferred from the stored extension since
   * PartImage doesn't persist the original mimetype -- addImage()/the
   * intake endpoint both already normalize to .jpg/.png on save (see
   * extensionFor() in vehicles.service.ts), so this is a safe round-trip.
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
        throw new NotFoundException('Part image not found');
      }
      const buffer = await this.storage.read(image.url);
      const contentType = image.url.toLowerCase().endsWith('.png')
        ? 'image/png'
        : 'image/jpeg';
      return { buffer, contentType };
    });
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
      // Same resolution as list(): the row keeps the analysis's identity so
      // the UI can still POST a correction against it, but the condition
      // fields reflect the human's answer where one exists.
      const latest = analyses[0] ?? null;
      return {
        id: part.id,
        status: part.status,
        createdAt: part.createdAt,
        taxonomyId: part.taxonomyId,
        taxonomyName: taxonomy?.name ?? null,
        vehicle,
        photos,
        latestAnalysis: latest
          ? { ...latest, ...conditionFields(part, latest) }
          : null,
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

      const header = [
        'id',
        'vin',
        'title',
        'description',
        'grade',
        'damage_codes',
        'confidence',
        'status',
        'price',
      ];
      const rows = parts.map((part) => {
        const vehicle = vehicleById.get(part.vehicleId);
        const taxonomy = taxonomyById.get(part.taxonomyId);
        const analysis = latestAnalysisByPart.get(part.id) ?? null;
        // Export the condition the business actually claims, not the raw
        // prediction -- a manager who corrected a grade before approving
        // must see that grade leave the building, not the AI's original.
        const condition = effectiveCondition(part, analysis);
        const title = [
          vehicle?.year,
          vehicle?.make,
          vehicle?.model,
          taxonomy?.name,
        ]
          .filter((v) => v !== null && v !== undefined && v !== '')
          .join(' ');
        const description =
          condition.grade !== null
            ? `Grade ${condition.grade}. Damage: ${condition.damageCodes.length ? condition.damageCodes.join(', ') : 'none noted'}.`
            : 'Not yet AI-graded.';
        return [
          part.id,
          vehicle?.vin ?? '',
          title,
          description,
          condition.grade ?? '',
          condition.damageCodes.join(';'),
          condition.confidence != null ? String(condition.confidence) : '',
          part.status,
          '', // price placeholder -- real pricing logic is out of MVP scope
        ];
      });

      return toCsv(header, rows);
    });
  }
}
