import { z } from 'zod';

export const GeminiPartAnalysisSchema = z.object({
  grade: z.enum(['A', 'B', 'C']),
  damage_codes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type GeminiPartAnalysis = z.infer<typeof GeminiPartAnalysisSchema>;

/**
 * One part Gemini believes it can see in a scene photo. `part_name` is free
 * text straight from the model ("front bumper", "left headlight") -- it is
 * NOT a taxonomy id and is deliberately not constrained to an enum here.
 * Constraining it would make the model's whole response fail schema
 * validation over a single unrecognized part, throwing away the detections
 * that did map. TaxonomyMatcher resolves the free text separately, and
 * anything it can't place degrades to an unmapped suggestion the worker can
 * assign by hand.
 */
export const GeminiPartDetectionSchema = z.object({
  part_name: z.string().min(1),
  grade: z.enum(['A', 'B', 'C']),
  damage_codes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

/**
 * How readable the photo itself was. Reported so a manager can be told
 * "photo 3 is blurry" instead of silently getting fewer parts from it and
 * wondering why.
 *
 * `.optional()` for the same reason `part_name` is free text rather than an
 * enum: a model that omits this field must not fail the whole response and
 * throw away detections that were perfectly good. Absent simply means "no
 * opinion offered", never "poor".
 */
export const GeminiImageQualitySchema = z.object({
  clarity: z.enum(['clear', 'partial', 'poor']),
  /** Short human-readable reason, e.g. "heavy glare on the left side". */
  note: z.string(),
});

/**
 * A scene photo can legitimately contain zero recognizable parts (a photo of
 * the ground, a badly framed shot), so `detections` is allowed to be empty
 * rather than treated as an error.
 */
export const GeminiSceneDetectionSchema = z.object({
  detections: z.array(GeminiPartDetectionSchema),
  image_quality: GeminiImageQualitySchema.optional(),
});

export type GeminiImageQuality = z.infer<typeof GeminiImageQualitySchema>;

export type GeminiPartDetection = z.infer<typeof GeminiPartDetectionSchema>;
export type GeminiSceneDetection = z.infer<typeof GeminiSceneDetectionSchema>;
