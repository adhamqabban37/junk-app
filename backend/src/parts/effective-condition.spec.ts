import { AiAnalysis, AiGrade } from '../database/entities/ai-analysis.entity';
import { Part } from '../database/entities/part.entity';
import { effectiveCondition } from './effective-condition';

function makePart(overrides: Partial<Part> = {}): Part {
  return {
    finalGrade: null,
    finalDamageCodes: null,
    finalConfidence: null,
    conditionSetByUserId: null,
    conditionSetAt: null,
    ...overrides,
  } as Part;
}

function makeAnalysis(overrides: Partial<AiAnalysis> = {}): AiAnalysis {
  return {
    grade: AiGrade.B,
    damageCodes: ['scratch'],
    confidence: 0.7,
    ...overrides,
  } as AiAnalysis;
}

describe('effectiveCondition', () => {
  it('falls back to the AI prediction when no human has ruled on the part', () => {
    const result = effectiveCondition(makePart(), makeAnalysis());

    expect(result).toEqual({
      grade: AiGrade.B,
      damageCodes: ['scratch'],
      confidence: 0.7,
      gradeSource: 'ai',
      damageCodesSource: 'ai',
    });
  });

  it("prefers the human's grade over the AI's", () => {
    const result = effectiveCondition(
      makePart({ finalGrade: AiGrade.C }),
      makeAnalysis({ grade: AiGrade.B }),
    );

    expect(result.grade).toBe(AiGrade.C);
    expect(result.gradeSource).toBe('human');
  });

  // The whole reason the final* columns are per-field rather than one
  // "corrected condition" blob: a manager who fixes a wrong grade but agrees
  // with the AI's damage tags must not have those tags re-attributed to
  // them. Only what they actually changed becomes theirs.
  it('resolves each field independently', () => {
    const result = effectiveCondition(
      makePart({ finalGrade: AiGrade.D }),
      makeAnalysis({ grade: AiGrade.A, damageCodes: ['rust', 'dent'] }),
    );

    expect(result.grade).toBe(AiGrade.D);
    expect(result.gradeSource).toBe('human');
    expect(result.damageCodes).toEqual(['rust', 'dent']);
    expect(result.damageCodesSource).toBe('ai');
  });

  // An empty array is a real human answer ("I looked; there is no damage")
  // and must not be confused with NULL ("nobody has looked"). Getting this
  // wrong would silently restore the AI's damage tags onto a part a manager
  // had explicitly cleared.
  it('treats a human-set empty damage list as an answer, not as absent', () => {
    const result = effectiveCondition(
      makePart({ finalDamageCodes: [] }),
      makeAnalysis({ damageCodes: ['scratch', 'rust'] }),
    );

    expect(result.damageCodes).toEqual([]);
    expect(result.damageCodesSource).toBe('human');
  });

  it('handles a part that has no analysis at all', () => {
    const result = effectiveCondition(makePart(), null);

    expect(result).toEqual({
      grade: null,
      damageCodes: [],
      confidence: null,
      gradeSource: 'none',
      damageCodesSource: 'none',
    });
  });

  it('uses the human grade even when there is no analysis to fall back to', () => {
    const result = effectiveCondition(
      makePart({ finalGrade: AiGrade.A }),
      null,
    );

    expect(result.grade).toBe(AiGrade.A);
    expect(result.gradeSource).toBe('human');
  });

  // numeric columns come back from pg as strings; every consumer of this
  // helper puts the value straight into JSON or a CSV cell, so it has to be
  // a number by the time it leaves here.
  it('normalizes a numeric confidence that arrived as a string', () => {
    const result = effectiveCondition(
      makePart({ finalConfidence: '0.9250' as unknown as number }),
      makeAnalysis(),
    );

    expect(result.confidence).toBe(0.925);
  });
});
