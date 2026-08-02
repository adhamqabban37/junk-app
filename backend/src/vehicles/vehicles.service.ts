import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, FindOptionsWhere } from 'typeorm';
import { Part } from '../database/entities/part.entity';
import { CrushStatus, Vehicle } from '../database/entities/vehicle.entity';
import { withTenantContext } from '../database/tenant-context';

export interface VehicleListItem extends Vehicle {
  partsCount: number;
}

export interface VehicleListResult {
  items: VehicleListItem[];
  total: number;
  page: number;
  pageSize: number;
}

@Injectable()
export class VehiclesService {
  constructor(private readonly dataSource: DataSource) {}

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
