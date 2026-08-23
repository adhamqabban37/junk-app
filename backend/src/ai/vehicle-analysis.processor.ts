import 'dotenv/config';
import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { AiAnalysisService } from './ai-analysis.service';

export interface VehicleAnalysisJobData {
  tenantId: string;
  vehicleId: string;
}

export const VEHICLE_ANALYSIS_QUEUE = 'vehicle-analysis';

// Same concurrency knob as AiAnalysisProcessor -- see that file's comment
// for why this is read from process.env directly instead of ConfigService.
const CONCURRENCY = Number(process.env.AI_QUEUE_CONCURRENCY) || 2;

@Processor(VEHICLE_ANALYSIS_QUEUE, { concurrency: CONCURRENCY })
export class VehicleAnalysisProcessor extends WorkerHost {
  constructor(private readonly aiAnalysisService: AiAnalysisService) {
    super();
  }

  async process(job: Job<VehicleAnalysisJobData>): Promise<void> {
    await this.aiAnalysisService.analyzeVehicle(
      job.data.tenantId,
      job.data.vehicleId,
    );
  }

  // Same "only escalate once the retry budget is spent" rationale as
  // AiAnalysisProcessor.onFailed -- and the same try/catch belt-and-
  // suspenders: BullMQ does not wrap this callback, so an uncaught error
  // here crashes the whole process, not just this job (confirmed live for
  // the equivalent per-part handler; hardened here too, proactively).
  @OnWorkerEvent('failed')
  async onFailed(job: Job<VehicleAnalysisJobData> | undefined): Promise<void> {
    if (!job) return;
    // Was a real, silent gap: nothing anywhere logged *why* a job attempt
    // failed (only whether the whole retry budget was later exhausted) --
    // confirmed live debugging a real failure with zero information to go
    // on. job.failedReason is BullMQ's own stringified error from the
    // attempt that just failed; log it on every attempt, not just the
    // final one, so a transient failure's cause isn't lost either.
    if (process.env.NODE_ENV !== 'test') {
      console.error(
        `[VehicleAnalysisProcessor] job ${job.id} attempt ${job.attemptsMade} failed: ${job.failedReason}`,
      );
    }
    const maxAttempts = job.opts.attempts ?? 1;
    if (job.attemptsMade >= maxAttempts) {
      try {
        await this.aiAnalysisService.handleVehicleAnalysisExhaustedRetries(
          job.data.tenantId,
          job.data.vehicleId,
        );
      } catch (error) {
        if (process.env.NODE_ENV !== 'test') {
          console.error(
            '[VehicleAnalysisProcessor] handleVehicleAnalysisExhaustedRetries failed',
            error,
          );
        }
      }
    }
  }

  // Same rationale as AiAnalysisProcessor.onError -- an unlistened 'error'
  // event on a BullMQ Worker is a Node-level crash, not just a dropped log.
  @OnWorkerEvent('error')
  onError(error: Error): void {
    if (process.env.NODE_ENV !== 'test') {
      console.error('[VehicleAnalysisProcessor] worker error', error);
    }
  }
}
