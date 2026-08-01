import { z } from 'zod';

export const GeminiPartAnalysisSchema = z.object({
  grade: z.enum(['A', 'B', 'C']),
  damage_codes: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export type GeminiPartAnalysis = z.infer<typeof GeminiPartAnalysisSchema>;
