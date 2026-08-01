import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiAnalysis } from '../database/entities/ai-analysis.entity';
import { HumanCorrection } from '../database/entities/human-correction.entity';
import { withTenantContext } from '../database/tenant-context';

function originalValueFor(analysis: AiAnalysis, field: string): string | null {
  switch (field) {
    case 'grade':
      return analysis.grade;
    case 'confidence':
      return analysis.confidence === null ? null : String(analysis.confidence);
    case 'damage_codes':
      return JSON.stringify(analysis.damageCodes);
    default:
      return null;
  }
}

/** The Moat (CLAUDE.md rule 6): every human correction to an AI prediction, captured for future model training. */
@Injectable()
export class CorrectionsService {
  constructor(private readonly dataSource: DataSource) {}

  async recordCorrection(
    tenantId: string,
    aiAnalysisId: string,
    userId: string,
    field: string,
    correctedValue: string,
  ): Promise<HumanCorrection> {
    return withTenantContext(this.dataSource, tenantId, async (manager) => {
      const analysis = await manager
        .getRepository(AiAnalysis)
        .findOne({ where: { id: aiAnalysisId } });
      if (!analysis) {
        throw new NotFoundException('AI analysis not found');
      }

      return manager.getRepository(HumanCorrection).save(
        manager.getRepository(HumanCorrection).create({
          tenantId,
          aiAnalysisId,
          field,
          originalValue: originalValueFor(analysis, field),
          correctedValue,
          correctedByUserId: userId,
        }),
      );
    });
  }
}
