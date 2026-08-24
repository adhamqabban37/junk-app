import { z } from 'zod';
import { AraDamageType, AraSeverity } from './grading.service';

export const GeminiPartAnalysisSchema = z.object({
  grade: z.enum(['A', 'B', 'C']),
  damage_codes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type GeminiPartAnalysis = z.infer<typeof GeminiPartAnalysisSchema>;

/** One vehicle photo's AI-suggested exterior-part match -- a hint the manager confirms via the normal assign flow, never auto-applied. suggested_part is validated against the real candidate list in ai-analysis.service.ts (never trusted as-is), since Gemini can still return free text despite the prompt constraining it to the given list. group_id ties together entries (possibly from different photos, within the same batch sent to one call) that show the same physical part instance -- e.g. two angles of the same fender share a group_id, while two different fenders (or a fender and a headlight) get different ones. Only meaningful within one response; never compared across separate calls. */
export const GeminiPhotoSuggestionSchema = z.object({
  photo_index: z.number().int().min(0),
  suggested_part: z.string().nullable(),
  confidence: z.number().min(0).max(1),
  group_id: z.number().int().min(0),
});

export const GeminiVehicleAnalysisSchema = GeminiPartAnalysisSchema.extend({
  photo_suggestions: z.array(GeminiPhotoSuggestionSchema),
});

export type GeminiVehicleAnalysis = z.infer<typeof GeminiVehicleAnalysisSchema>;

/**
 * ARA-style sheet-metal damage detection -- deliberately does NOT include
 * a `grade` field. Gemini detects and itemizes damage; GradingService
 * (grading.service.ts) is the only thing that ever computes a grade from
 * it, so the grading policy can change without touching this schema or
 * the prompt. `assessable: false` means the photo was too unclear/zoomed
 * out/obstructed to judge -- distinct from an empty `damage` array, which
 * means "assessed, found nothing" (grades A, not X).
 */
export const GeminiSheetMetalDamageSchema = z.object({
  assessable: z.boolean(),
  damage: z.array(
    z.object({
      location: z.string(),
      damage_type: z.nativeEnum(AraDamageType),
      severity: z.nativeEnum(AraSeverity),
    }),
  ),
  confidence: z.number().min(0).max(1),
});

export type GeminiSheetMetalDamage = z.infer<
  typeof GeminiSheetMetalDamageSchema
>;
