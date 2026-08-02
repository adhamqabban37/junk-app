import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiAnalysis, AiGrade } from '../database/entities/ai-analysis.entity';
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

/**
 * Applies a human correction onto the AiAnalysis row itself, so the
 * corrected value -- not the AI's original guess -- is what Inventory,
 * the Review Queue, and CSV export show afterward (Phase 5 acceptance:
 * "manager ... corrects a field, approves it, sees it in Inventory,
 * exports a CSV containing it"). The original value is still captured on
 * the HumanCorrection row above for the Moat, so nothing about the AI's
 * original prediction is lost -- this only changes what's displayed.
 * Unrecognized fields or unparsable values are left as pure correction-log
 * entries (no display surface reads them, so there's nothing to apply).
 */
function applyCorrection(
  analysis: AiAnalysis,
  field: string,
  correctedValue: string,
): void {
  switch (field) {
    case 'grade':
      if ((Object.values(AiGrade) as string[]).includes(correctedValue)) {
        analysis.grade = correctedValue as AiGrade;
      }
      break;
    case 'confidence': {
      const parsed = Number(correctedValue);
      if (!Number.isNaN(parsed)) {
        analysis.confidence = parsed;
      }
      break;
    }
    case 'damage_codes': {
      try {
        const parsed: unknown = JSON.parse(correctedValue);
        if (
          Array.isArray(parsed) &&
          parsed.every((v) => typeof v === 'string')
        ) {
          analysis.damageCodes = parsed;
        }
      } catch {
        // Not valid JSON -- leave the AI's damage codes as-is.
      }
      break;
    }
    default:
      break;
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
      const analysisRepo = manager.getRepository(AiAnalysis);
      const analysis = await analysisRepo.findOne({
        where: { id: aiAnalysisId },
      });
      if (!analysis) {
        throw new NotFoundException('AI analysis not found');
      }

      const correction = await manager.getRepository(HumanCorrection).save(
        manager.getRepository(HumanCorrection).create({
          tenantId,
          aiAnalysisId,
          field,
          originalValue: originalValueFor(analysis, field),
          correctedValue,
          correctedByUserId: userId,
        }),
      );

      applyCorrection(analysis, field, correctedValue);
      await analysisRepo.save(analysis);

      return correction;
    });
  }
}
