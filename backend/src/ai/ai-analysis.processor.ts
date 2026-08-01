import 'dotenv/config';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { AiAnalysisService } from './ai-analysis.service';

export interface AiAnalysisJobData {
  tenantId: string;
  partImageId: string;
}

export const AI_ANALYSIS_QUEUE = 'ai-analysis';

// Concurrency is read from process.env directly (not ConfigService) because
// @Processor's options are evaluated at class-decoration time, before Nest's
// DI container (and therefore ConfigModule) exists yet. `import
// 'dotenv/config'` above guarantees process.env is populated regardless of
// this file's position in the module import graph. Conservative default —
// Gemini's exact rate limit for this project's plan tier isn't pinned down
// yet; override via AI_QUEUE_CONCURRENCY once it is.
const CONCURRENCY = Number(process.env.AI_QUEUE_CONCURRENCY) || 2;

@Processor(AI_ANALYSIS_QUEUE, { concurrency: CONCURRENCY })
export class AiAnalysisProcessor extends WorkerHost {
  constructor(private readonly aiAnalysisService: AiAnalysisService) {
    super();
  }

  async process(job: Job<AiAnalysisJobData>): Promise<void> {
    await this.aiAnalysisService.analyzePartImage(
      job.data.tenantId,
      job.data.partImageId,
    );
  }

  // Fires on every failed attempt, not just the last one -- only escalate
  // to manual-grading once the job's whole retry budget is spent, so a
  // single transient Gemini blip doesn't prematurely take a Part out of the
  // AI pipeline.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<AiAnalysisJobData> | undefined): Promise<void> {
    if (!job) return;
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      await this.aiAnalysisService.handleExhaustedRetries(
        job.data.tenantId,
        job.data.partImageId,
      );
    }
  }
}
