export const AI_ANALYSIS_QUEUE = 'ai-analysis';

export interface AiAnalysisJobData {
  tenantId: string;
  partImageId: string;
  /** Review Queue's "Re-grade" action -- bypasses the normal idempotency skip so a completed analysis actually gets re-run instead of being a no-op. */
  force?: boolean;
}
