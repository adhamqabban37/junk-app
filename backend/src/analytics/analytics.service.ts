import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import {
  AiAnalysis,
  AiAnalysisStatus,
} from '../database/entities/ai-analysis.entity';
import { Part } from '../database/entities/part.entity';
import { Vehicle } from '../database/entities/vehicle.entity';
import { withTenantContext } from '../database/tenant-context';

export interface AnalyticsSummary {
  totalVehicles: number;
  totalParts: number;
  partsByStatus: Record<string, number>;
  gradeDistribution: Record<string, number>;
  vehiclesByCrushStatus: Record<string, number>;
}

@Injectable()
export class AnalyticsService {
  constructor(private readonly dataSource: DataSource) {}

  async summary(tenantId: string): Promise<AnalyticsSummary> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      // Sequential against the shared transactional manager -- see the same
      // note in PartsService: a single Postgres connection can't run
      // concurrent/interleaved queries.
      const partsByStatusRaw = await manager
        .getRepository(Part)
        .createQueryBuilder('part')
        .select('part.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('part.status')
        .getRawMany<{ status: string; count: string }>();

      const vehiclesByCrushStatusRaw = await manager
        .getRepository(Vehicle)
        .createQueryBuilder('vehicle')
        .select('vehicle.crushStatus', 'crushStatus')
        .addSelect('COUNT(*)', 'count')
        .groupBy('vehicle.crushStatus')
        .getRawMany<{ crushStatus: string; count: string }>();

      // Only the latest analysis per part_image counts toward grade
      // distribution -- a retried/re-analyzed image shouldn't double-count.
      // model_version+part_image_id is already unique (idempotency key), so
      // grouping by grade across complete analyses is safe without a
      // separate "latest per part" join here.
      const gradeDistributionRaw = await manager
        .getRepository(AiAnalysis)
        .createQueryBuilder('analysis')
        .select('analysis.grade', 'grade')
        .addSelect('COUNT(*)', 'count')
        .where('analysis.status = :status', {
          status: AiAnalysisStatus.COMPLETE,
        })
        .andWhere('analysis.grade IS NOT NULL')
        .groupBy('analysis.grade')
        .getRawMany<{ grade: string; count: string }>();

      const partsByStatus: Record<string, number> = {};
      for (const row of partsByStatusRaw) {
        partsByStatus[row.status] = Number(row.count);
      }
      const vehiclesByCrushStatus: Record<string, number> = {};
      for (const row of vehiclesByCrushStatusRaw) {
        vehiclesByCrushStatus[row.crushStatus] = Number(row.count);
      }
      const gradeDistribution: Record<string, number> = {};
      for (const row of gradeDistributionRaw) {
        gradeDistribution[row.grade] = Number(row.count);
      }

      const totalParts = Object.values(partsByStatus).reduce(
        (a, b) => a + b,
        0,
      );
      const totalVehicles = Object.values(vehiclesByCrushStatus).reduce(
        (a, b) => a + b,
        0,
      );

      return {
        totalVehicles,
        totalParts,
        partsByStatus,
        gradeDistribution,
        vehiclesByCrushStatus,
      };
    });
  }
}
