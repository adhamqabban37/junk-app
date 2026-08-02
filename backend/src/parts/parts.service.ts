import { randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource, FindOptionsWhere, In } from 'typeorm';
import {
  AI_ANALYSIS_QUEUE,
  AiAnalysisJobData,
} from '../ai/ai-analysis.processor';
import { AiAnalysis } from '../database/entities/ai-analysis.entity';
import { Part, PartStatus } from '../database/entities/part.entity';
import { PartImage } from '../database/entities/part-image.entity';
import { PartTaxonomy } from '../database/entities/part-taxonomy.entity';
import { Vehicle } from '../database/entities/vehicle.entity';
import { withTenantContext } from '../database/tenant-context';
import { toCsv } from './csv';
import { LocalFileStorage } from '../storage/local-file-storage';

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
  latestAnalysis: {
    id: string;
    grade: string | null;
    damageCodes: string[];
    confidence: number | string | null;
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
      const photoCountByPart = new Map(
        photoCounts.map((c): [string, number] => [c.partId, Number(c.count)]),
      );

      return {
        items: parts.map((part) =>
          this.toListItem(
            part,
            vehicleById,
            taxonomyById,
            latestAnalysisByPart,
            photoCountByPart,
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
      latestAnalysis: analysis
        ? {
            id: analysis.id,
            grade: analysis.grade,
            damageCodes: analysis.damageCodes,
            confidence: analysis.confidence,
            status: analysis.status,
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
        latestAnalysis: analyses[0] ?? null,
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
          analysis?.damageCodes.join(';') ?? '',
          analysis?.confidence != null ? String(analysis.confidence) : '',
          part.status,
          '', // price placeholder -- real pricing logic is out of MVP scope
        ];
      });

      return toCsv(header, rows);
    });
  }
}
