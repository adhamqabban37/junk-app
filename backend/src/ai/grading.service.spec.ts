import { AiGrade } from '../database/entities/ai-analysis.entity';
import {
  AraDamageType,
  AraSeverity,
  DAMAGE_UNIT_TABLE,
  GradingService,
  type AraDamageInstance,
} from './grading.service';

function instance(
  damageType: AraDamageType,
  severity: AraSeverity,
  location = 'LF',
): AraDamageInstance {
  return {
    location,
    damageType,
    severity,
    units: DAMAGE_UNIT_TABLE[damageType][severity],
  };
}

describe('GradingService', () => {
  let service: GradingService;

  beforeEach(() => {
    service = new GradingService();
  });

  describe('gradeFromDamageUnits', () => {
    it('grades A at and below the 1 unit boundary', () => {
      expect(service.gradeFromDamageUnits(0)).toBe(AiGrade.A);
      expect(service.gradeFromDamageUnits(1)).toBe(AiGrade.A);
    });

    it('grades B just above 1 and at the 2 unit boundary', () => {
      expect(service.gradeFromDamageUnits(1.01)).toBe(AiGrade.B);
      expect(service.gradeFromDamageUnits(2)).toBe(AiGrade.B);
    });

    it('grades C above 2 units', () => {
      expect(service.gradeFromDamageUnits(2.01)).toBe(AiGrade.C);
      expect(service.gradeFromDamageUnits(10)).toBe(AiGrade.C);
    });
  });

  describe('calculateDamageUnits', () => {
    it("sums every instance's units", () => {
      const instances = [
        instance(AraDamageType.SCRATCH, AraSeverity.MINOR),
        instance(AraDamageType.CREASE_DENT, AraSeverity.MODERATE),
      ];
      expect(service.calculateDamageUnits(instances)).toBeCloseTo(
        DAMAGE_UNIT_TABLE[AraDamageType.SCRATCH][AraSeverity.MINOR] +
          DAMAGE_UNIT_TABLE[AraDamageType.CREASE_DENT][AraSeverity.MODERATE],
      );
    });

    it('returns 0 for no instances', () => {
      expect(service.calculateDamageUnits([])).toBe(0);
    });
  });

  describe('gradeSheetMetalPart', () => {
    it('grades A with zero damage units when no instances were found and the photo was assessable', () => {
      const result = service.gradeSheetMetalPart([], true);
      expect(result).toEqual({ grade: AiGrade.A, damageUnits: 0 });
    });

    it('returns X regardless of any detected instances when the photo was not assessable', () => {
      const instances = [
        instance(AraDamageType.MISSING, AraSeverity.MAJOR),
        instance(AraDamageType.CRACKED, AraSeverity.MAJOR),
      ];
      const result = service.gradeSheetMetalPart(instances, false);
      expect(result).toEqual({ grade: AiGrade.X, damageUnits: 0 });
    });

    it('computes a real grade from summed damage units when assessable', () => {
      const instances = [
        instance(AraDamageType.CREASE_DENT, AraSeverity.MODERATE), // 1
        instance(AraDamageType.SCRATCH, AraSeverity.MINOR), // 0.25
      ];
      const result = service.gradeSheetMetalPart(instances, true);
      expect(result.damageUnits).toBeCloseTo(1.25);
      expect(result.grade).toBe(AiGrade.B);
    });
  });

  describe('formatDamageCodes', () => {
    it('formats each instance as a short human-readable string', () => {
      const instances = [
        instance(AraDamageType.CREASE_DENT, AraSeverity.MODERATE, 'RF'),
      ];
      expect(service.formatDamageCodes(instances)).toEqual([
        'RF Crease/Dent (moderate)',
      ]);
    });

    it('returns an empty array for no instances', () => {
      expect(service.formatDamageCodes([])).toEqual([]);
    });
  });
});
