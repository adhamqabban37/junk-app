import { Injectable } from '@nestjs/common';
import { AiGrade } from '../database/entities/ai-analysis.entity';

/**
 * ARA/Car-Part.com-style damage type codes for sheet-metal/body panels.
 * Deliberately a small, fixed vocabulary (not free text) -- Gemini is
 * prompted to classify every detected damage instance into exactly one of
 * these, which is what makes damage-unit math deterministic and auditable
 * instead of another subjective free-form judgment.
 */
export enum AraDamageType {
  CREASE_DENT = 'crease_dent',
  SCRATCH = 'scratch',
  BEND_BUCKLE = 'bend_buckle',
  RUST = 'rust',
  HOLE = 'hole',
  PAINT_DAMAGE = 'paint_damage',
  MISSING = 'missing',
  CRACKED = 'cracked',
  GOUGE = 'gouge',
  WRINKLE = 'wrinkle',
}

export enum AraSeverity {
  MINOR = 'minor',
  MODERATE = 'moderate',
  MAJOR = 'major',
}

/** One damage finding on one sheet-metal part image. `units` is the resolved value from DAMAGE_UNIT_TABLE *at grading time* -- stored per instance (not just re-derivable from the table) so a row stays an accurate historical record even after the table is later retuned. */
export interface AraDamageInstance {
  location: string;
  damageType: AraDamageType;
  severity: AraSeverity;
  units: number;
}

/**
 * The one place damage-severity-to-numeric-unit-value mappings live --
 * exactly the "update later without touching the pipeline" hook this
 * feature was asked for. Cosmetic/surface damage (scratch, paint) is
 * weighted lightly; structural/replacement-implying damage (missing,
 * cracked, hole) is weighted heavily even at "minor" severity, since a
 * small crack or a missing piece is never really minor for resale grading.
 */
export const DAMAGE_UNIT_TABLE: Record<
  AraDamageType,
  Record<AraSeverity, number>
> = {
  [AraDamageType.SCRATCH]: {
    [AraSeverity.MINOR]: 0.25,
    [AraSeverity.MODERATE]: 0.5,
    [AraSeverity.MAJOR]: 1,
  },
  [AraDamageType.PAINT_DAMAGE]: {
    [AraSeverity.MINOR]: 0.25,
    [AraSeverity.MODERATE]: 0.5,
    [AraSeverity.MAJOR]: 1,
  },
  [AraDamageType.CREASE_DENT]: {
    [AraSeverity.MINOR]: 0.5,
    [AraSeverity.MODERATE]: 1,
    [AraSeverity.MAJOR]: 1.5,
  },
  [AraDamageType.GOUGE]: {
    [AraSeverity.MINOR]: 0.5,
    [AraSeverity.MODERATE]: 1,
    [AraSeverity.MAJOR]: 1.5,
  },
  [AraDamageType.WRINKLE]: {
    [AraSeverity.MINOR]: 0.5,
    [AraSeverity.MODERATE]: 1,
    [AraSeverity.MAJOR]: 1.5,
  },
  [AraDamageType.RUST]: {
    [AraSeverity.MINOR]: 0.5,
    [AraSeverity.MODERATE]: 1,
    [AraSeverity.MAJOR]: 2,
  },
  [AraDamageType.BEND_BUCKLE]: {
    [AraSeverity.MINOR]: 0.75,
    [AraSeverity.MODERATE]: 1.5,
    [AraSeverity.MAJOR]: 2,
  },
  [AraDamageType.HOLE]: {
    [AraSeverity.MINOR]: 1,
    [AraSeverity.MODERATE]: 1.5,
    [AraSeverity.MAJOR]: 2,
  },
  [AraDamageType.CRACKED]: {
    [AraSeverity.MINOR]: 1,
    [AraSeverity.MODERATE]: 1.5,
    [AraSeverity.MAJOR]: 2,
  },
  [AraDamageType.MISSING]: {
    [AraSeverity.MINOR]: 1.5,
    [AraSeverity.MODERATE]: 2,
    [AraSeverity.MAJOR]: 2.5,
  },
};

const DAMAGE_TYPE_LABEL: Record<AraDamageType, string> = {
  [AraDamageType.CREASE_DENT]: 'Crease/Dent',
  [AraDamageType.SCRATCH]: 'Scratch',
  [AraDamageType.BEND_BUCKLE]: 'Bend/Buckle',
  [AraDamageType.RUST]: 'Rust',
  [AraDamageType.HOLE]: 'Hole',
  [AraDamageType.PAINT_DAMAGE]: 'Paint Damage',
  [AraDamageType.MISSING]: 'Missing',
  [AraDamageType.CRACKED]: 'Cracked',
  [AraDamageType.GOUGE]: 'Gouge',
  [AraDamageType.WRINKLE]: 'Wrinkle',
};

/**
 * Centralized ARA-style grading logic for sheet-metal/body parts, kept
 * deliberately separate from GeminiService (which only detects damage) --
 * Gemini never decides a sheet-metal part's grade, this service always
 * does, so the grading policy can be retuned (DAMAGE_UNIT_TABLE, the
 * thresholds below) without touching the AI pipeline at all.
 */
@Injectable()
export class GradingService {
  /** Resolves one detected damage instance's ARA unit value from the shared table. */
  unitsFor(damageType: AraDamageType, severity: AraSeverity): number {
    return DAMAGE_UNIT_TABLE[damageType][severity];
  }

  /** Total damage units across every detected instance -- the sole input to gradeFromDamageUnits(). */
  calculateDamageUnits(instances: { units: number }[]): number {
    return instances.reduce((sum, i) => sum + i.units, 0);
  }

  /**
   * The user's exact ARA/Car-Part.com thresholds: 0-1 -> A, >1-2 -> B,
   * >2 -> C. Never returns X -- X only ever comes from "insufficient
   * information," a separate signal from Gemini, not a damage-units
   * outcome (see gradeSheetMetalPart()).
   */
  gradeFromDamageUnits(units: number): AiGrade.A | AiGrade.B | AiGrade.C {
    if (units <= 1) return AiGrade.A;
    if (units <= 2) return AiGrade.B;
    return AiGrade.C;
  }

  /**
   * The single entry point AiAnalysisService calls for a sheet-metal
   * part. `assessable: false` (Gemini couldn't get a clear enough look --
   * too blurry, too zoomed out, obstructed) always wins and returns X
   * regardless of any instances found, since a low-confidence damage list
   * from an unclear photo shouldn't produce a false-precision grade.
   * Zero instances + assessable is a real, meaningful "looked and found
   * nothing" -> 0 units -> A, correctly distinct from X.
   */
  gradeSheetMetalPart(
    instances: AraDamageInstance[],
    assessable: boolean,
  ): { grade: AiGrade; damageUnits: number } {
    if (!assessable) {
      return { grade: AiGrade.X, damageUnits: 0 };
    }
    const damageUnits = this.calculateDamageUnits(instances);
    return { grade: this.gradeFromDamageUnits(damageUnits), damageUnits };
  }

  /** Human-readable strings for the existing `damageCodes: string[]` column/UI/CSV -- every current reader keeps working without knowing the new structured format exists. */
  formatDamageCodes(instances: AraDamageInstance[]): string[] {
    return instances.map(
      (i) => `${i.location} ${DAMAGE_TYPE_LABEL[i.damageType]} (${i.severity})`,
    );
  }
}
