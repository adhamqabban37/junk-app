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
      //
      // COALESCE onto the part's human-set grade, not the raw prediction:
      // corrections used to be written back onto the analysis row, so this
      // query saw them for free. Now that AiAnalysis is append-only it would
      // otherwise report the AI's original grades and disagree with what
      // Inventory and the CSV export show. Raw quoted column names rather
      // than alias.property so the COALESCE is unambiguous across the join.
      const EFFECTIVE_GRADE = `COALESCE("part"."final_grade", "analysis"."grade")`;
      const gradeDistributionRaw = await manager
        .getRepository(AiAnalysis)
        .createQueryBuilder('analysis')
        .innerJoin(Part, 'part', '"part"."id" = "analysis"."part_id"')
        .select(EFFECTIVE_GRADE, 'grade')
        .addSelect('COUNT(*)', 'count')
        .where('analysis.status = :status', {
          status: AiAnalysisStatus.COMPLETE,
        })
        .andWhere(`${EFFECTIVE_GRADE} IS NOT NULL`)
        .groupBy(EFFECTIVE_GRADE)
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
