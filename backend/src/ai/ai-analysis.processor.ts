import 'dotenv/config';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { AiAnalysisService } from './ai-analysis.service';
import { AI_ANALYSIS_QUEUE, AiAnalysisJobData } from './ai-queue.constants';

export { AI_ANALYSIS_QUEUE };
export type { AiAnalysisJobData };

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
      job.data.force,
    );
  }

  // Fires on every failed attempt, not just the last one -- only escalate
  // to manual-grading once the job's whole retry budget is spent, so a
  // single transient Gemini blip doesn't prematurely take a Part out of the
  // AI pipeline.
  @OnWorkerEvent('failed')
  async onFailed(job: Job<AiAnalysisJobData> | undefined): Promise<void> {
    if (!job) return;
    // Was a silent gap: nothing logged *why* an attempt failed, only
    // whether the whole retry budget was later exhausted -- see the same
    // fix on VehicleAnalysisProcessor for the live case that surfaced this.
    if (process.env.NODE_ENV !== 'test') {
      console.error(
        `[AiAnalysisProcessor] job ${job.id} attempt ${job.attemptsMade} failed: ${job.failedReason}`,
      );
    }
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      // BullMQ does not wrap event-handler callbacks in a try/catch of its
      // own -- an error thrown here crashes the whole Node process, not
      // just this job (confirmed live: an orphaned job's missing PartImage
      // did exactly that before handleExhaustedRetries was hardened
      // against it). Belt-and-suspenders: even a future, unrelated failure
      // in here should never take the server down.
      try {
        await this.aiAnalysisService.handleExhaustedRetries(
          job.data.tenantId,
          job.data.partImageId,
        );
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
          console.error(
            '[AiAnalysisProcessor] handleExhaustedRetries failed',
            error,
          );
        }
      }
    }
  }

  // BullMQ Workers are EventEmitters -- an 'error' event with zero
  // listeners is a Node-level unhandled-error crash, not just a log line.
  // This fires for transient connection blips in real operation, and
  // reliably fires during app shutdown too (the worker's blocking Redis
  // connection reporting itself closed while a blocking read was still
  // in flight) -- without this listener that shutdown-time error had no
  // handler and crashed whatever else was running in the process at that
  // moment (e.g. a completely unrelated Jest test file mid-run).
  @OnWorkerEvent('error')
  onError(error: Error): void {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[AiAnalysisProcessor] worker error', error);
    }
  }
}
