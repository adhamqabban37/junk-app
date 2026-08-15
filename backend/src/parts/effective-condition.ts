import { AiAnalysis, AiGrade } from '../database/entities/ai-analysis.entity';
import { Part } from '../database/entities/part.entity';

export type ConditionSource = 'human' | 'ai' | 'none';

export interface EffectiveCondition {
  grade: AiGrade | null;
  damageCodes: string[];
  confidence: number | null;
  gradeSource: ConditionSource;
  damageCodesSource: ConditionSource;
}

/**
 * `numeric` columns arrive from pg as strings. Every consumer of this helper
 * writes the result straight into JSON or a CSV cell, so normalize once here
 * rather than making each of them remember.
 */
function toNumber(value: number | string | null): number | null {
  if (value === null || value === undefined) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Resolves what the business actually claims about a part's condition, from
 * the human's answer (`Part.final*`) and the AI's prediction (`AiAnalysis`).
 *
 * This exists because those two used to be the same row: corrections were
 * written onto the AiAnalysis, which made display trivial and quietly
 * destroyed the provenance the correction dataset depends on. Now that they
 * are separate, every display surface -- Inventory, the Review Queue, the
 * CSV export, analytics -- has to combine them the same way, and the only
 * reliable way to guarantee that is to give them one function.
 *
 * Resolution is **per field, not all-or-nothing**. A manager who fixes a
 * wrong grade but agrees with the AI's damage tags should not have those
 * tags re-attributed to them.
 *
 * NULL is the "nobody ruled on this" signal, so an empty `finalDamageCodes`
 * array is a real human answer ("I looked; there is no damage") and wins
 * over the AI's tags. Anything that treats empty as absent would silently
 * restore damage a manager had explicitly cleared.
 */
export function effectiveCondition(
  part: Pick<Part, 'finalGrade' | 'finalDamageCodes' | 'finalConfidence'>,
  analysis: Pick<AiAnalysis, 'grade' | 'damageCodes' | 'confidence'> | null,
): EffectiveCondition {
  const hasHumanGrade = part.finalGrade !== null;
  const hasHumanDamage = part.finalDamageCodes !== null;
  const hasHumanConfidence = part.finalConfidence !== null;

  const grade = hasHumanGrade ? part.finalGrade : (analysis?.grade ?? null);
  const damageCodes = hasHumanDamage
    ? (part.finalDamageCodes as string[])
    : (analysis?.damageCodes ?? []);
  const confidence = hasHumanConfidence
    ? toNumber(part.finalConfidence)
    : toNumber(analysis?.confidence ?? null);

  return {
    grade,
    damageCodes,
    confidence,
    gradeSource: hasHumanGrade ? 'human' : analysis ? 'ai' : 'none',
    damageCodesSource: hasHumanDamage ? 'human' : analysis ? 'ai' : 'none',
  };
}
