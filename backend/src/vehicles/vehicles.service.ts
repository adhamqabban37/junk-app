import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, FindOptionsWhere, In } from 'typeorm';
import { Part, PartStatus } from '../database/entities/part.entity';
import { CrushStatus, Vehicle } from '../database/entities/vehicle.entity';
import { VehiclePhoto } from '../database/entities/vehicle-photo.entity';
import { withTenantContext } from '../database/tenant-context';
import { PartsService } from '../parts/parts.service';
import {
  LocalFileStorage,
  mimetypeFromExtension,
  resolveImageExtension,
} from '../storage/local-file-storage';
import { VehicleIntakeDto } from './dto/vehicle-intake.dto';
import { parseDecoded } from './dto/vehicle-intake.schema';

export interface VehicleListItem extends Vehicle {
  partsCount: number;
}

export interface VehicleListResult {
  items: VehicleListItem[];
  total: number;
  page: number;
  pageSize: number;
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
  ) {}

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
    dto: VehicleIntakeDto,
    files: Express.Multer.File[],
  ): Promise<IntakeResult> {
    const decoded = parseDecoded(dto.decoded);

    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const existing = await manager
        .getRepository(Vehicle)
        .findOne({ where: { tenantId, intakeDraftId: dto.draftId } });
      if (existing) {
        return { vehicleId: existing.id, duplicate: true };
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
        }),
      );

      for (const file of files) {
        const [kind, photoId] = file.fieldname.split(':');
        if (kind !== 'photo') continue;
        const extension = resolveImageExtension(file.mimetype);
        const relativePath = await this.storage.save(
          `${tenantId}/${vehicle.id}/${photoId}.${extension}`,
          file.buffer,
        );
        await manager.getRepository(VehiclePhoto).save(
          manager.getRepository(VehiclePhoto).create({
            tenantId,
            vehicleId: vehicle.id,
            url: relativePath,
          }),
        );
      }

      return { vehicleId: vehicle.id, duplicate: false };
    });
  }

  async listPhotos(
    tenantId: string,
    vehicleId: string,
  ): Promise<VehiclePhoto[]> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const vehicle = await manager
        .getRepository(Vehicle)
        .findOne({ where: { id: vehicleId } });
      if (!vehicle) {
        throw new NotFoundException('Vehicle not found');
      }
      return manager
        .getRepository(VehiclePhoto)
        .find({ where: { vehicleId }, order: { createdAt: 'ASC' } });
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
   * The manager-side counterpart to `intake()`: takes a set of raw,
   * unassigned VehiclePhotos and a chosen taxonomy, creates the Part they
   * actually belong to, and turns each photo into a real PartImage
   * (reusing PartsService.addImageInTransaction()'s existing
   * storage+insert+AI-enqueue logic) -- this is the point where a photo
   * finally becomes gradable inventory.
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
        await manager.getRepository(VehiclePhoto).delete({ id: photo.id });
        await this.storage.delete(photo.url);
      }

      return { partId: part.id };
    });
  }
}
