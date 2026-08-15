import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AiAnalysis, AiGrade } from '../database/entities/ai-analysis.entity';
import { HumanCorrection } from '../database/entities/human-correction.entity';
import { Part } from '../database/entities/part.entity';
import { withTenantContext } from '../database/tenant-context';
import {
  EffectiveCondition,
  effectiveCondition,
} from '../parts/effective-condition';

/**
 * What this correction is replacing -- the value a manager was actually
 * looking at when they changed it, which is the previous *human* answer if
 * there is one and the AI's prediction otherwise.
 *
 * Not simply the AI's value: correcting a grade B->A and later A->C should
 * record the second correction as replacing A, not B. A chain that always
 * cited the original prediction would misrepresent what changed.
 */
function originalValueFor(
  current: EffectiveCondition,
  field: string,
): string | null {
  switch (field) {
    case 'grade':
      return current.grade;
    case 'confidence':
      return current.confidence === null ? null : String(current.confidence);
    case 'damage_codes':
      return JSON.stringify(current.damageCodes);
    default:
      return null;
  }
}

/**
 * Writes the human's answer onto the Part.
 *
 * This used to write onto the AiAnalysis row instead, which made display
 * trivial and silently corrupted the correction dataset -- see the class
 * comment on AiAnalysis. The prediction is now immutable; the answer lives
 * here, and readers combine the two via effectiveCondition().
 *
 * Returns whether anything was applied, so an unrecognized field or an
 * unparsable value stays a pure correction-log entry (no display surface
 * reads it) rather than stamping a bogus authorship onto the part.
 */
function applyCorrection(
  part: Part,
  field: string,
  correctedValue: string,
): boolean {
  switch (field) {
    case 'grade':
      if ((Object.values(AiGrade) as string[]).includes(correctedValue)) {
        part.finalGrade = correctedValue as AiGrade;
        return true;
      }
      return false;
    case 'confidence': {
      const parsed = Number(correctedValue);
      if (!Number.isNaN(parsed)) {
        part.finalConfidence = parsed;
        return true;
      }
      return false;
    }
    case 'damage_codes': {
      try {
        const parsed: unknown = JSON.parse(correctedValue);
        if (
          Array.isArray(parsed) &&
          parsed.every((v) => typeof v === 'string')
        ) {
          part.finalDamageCodes = parsed;
          return true;
        }
      } catch {
        // Not valid JSON -- leave the resolved condition as it was.
      }
      return false;
    }
    default:
      return false;
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

      const partRepo = manager.getRepository(Part);
      const part = await partRepo.findOne({ where: { id: analysis.partId } });
      if (!part) {
        // The analysis FK cascades from parts, so this is unreachable in
        // practice -- but reading through a null here would be a 500 on
        // what is really a not-found.
        throw new NotFoundException('Part not found for this AI analysis');
      }

      const correction = await manager.getRepository(HumanCorrection).save(
        manager.getRepository(HumanCorrection).create({
          tenantId,
          aiAnalysisId,
          field,
          originalValue: originalValueFor(
            effectiveCondition(part, analysis),
            field,
          ),
          correctedValue,
          correctedByUserId: userId,
        }),
      );

      if (applyCorrection(part, field, correctedValue)) {
        part.conditionSetByUserId = userId;
        part.conditionSetAt = new Date();
        await partRepo.save(part);
      }

      // AiAnalysis is deliberately NOT saved here. It is append-only.
      return correction;
    });
  }
}
