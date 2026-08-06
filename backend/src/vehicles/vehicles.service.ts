import { randomUUID } from 'crypto';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { DataSource, FindOptionsWhere } from 'typeorm';
import {
  AI_ANALYSIS_QUEUE,
  AiAnalysisJobData,
} from '../ai/ai-analysis.processor';
import { Part, PartStatus } from '../database/entities/part.entity';
import { PartImage } from '../database/entities/part-image.entity';
import {
  VehicleImage,
  VehicleImageAngle,
} from '../database/entities/vehicle-image.entity';
import { CrushStatus, Vehicle } from '../database/entities/vehicle.entity';
import { withTenantContext } from '../database/tenant-context';
import { LocalFileStorage } from '../storage/local-file-storage';

export interface VehicleListItem extends Vehicle {
  partsCount: number;
}

export interface VehicleListResult {
  items: VehicleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

interface IntakeDecodedInput {
  make?: string | null;
  model?: string | null;
  year?: number | null;
  trim?: string | null;
  raw?: Record<string, unknown> | null;
}

interface IntakePartInput {
  id?: string;
  taxonomyId?: string;
}

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
  constructor(
    private readonly dataSource: DataSource,
    private readonly storage: LocalFileStorage,
    @InjectQueue(AI_ANALYSIS_QUEUE)
    private readonly aiQueue: Queue<AiAnalysisJobData>,
  ) {
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

    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const vehicleRepo = manager.getRepository(Vehicle);
      const existing = await vehicleRepo.findOne({
        where: { tenantId, intakeDraftId: draftId },
      });
      if (existing) {
        return { vehicleId: existing.id };
      }

      const vehicle = await vehicleRepo.save(
        vehicleRepo.create({
          tenantId,
          intakeDraftId: draftId,
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
        for (const file of files) {
          if (!file.fieldname.startsWith(partFilePrefix)) continue;

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

          // Non-blocking per CLAUDE.md rule 4, same retry budget as
          // PartsService.addImage().
          await this.aiQueue.add(
            'analyze',
            { tenantId, partImageId: partImage.id },
            { attempts: 3, backoff: { type: 'exponential', delay: 2000 } },
          );
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

  async detail(
    tenantId: string,
    vehicleId: string,
  ): Promise<Vehicle & { parts: Part[] }> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const vehicle = await manager
        .getRepository(Vehicle)
        .findOne({ where: { id: vehicleId } });
      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }
      const parts = await manager
        .getRepository(Part)
        .find({ where: { vehicleId } });
      return { ...vehicle, parts };
    });
  }
}
