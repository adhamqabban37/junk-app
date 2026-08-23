import { z } from 'zod';

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
