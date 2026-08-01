import type { Job } from 'bullmq';
import {
  AiAnalysisProcessor,
  type AiAnalysisJobData,
} from './ai-analysis.processor';
import { AiAnalysisService } from './ai-analysis.service';

function makeJob(
  overrides: Partial<Job<AiAnalysisJobData>> = {},
): Job<AiAnalysisJobData> {
  return {
    data: { tenantId: 't1', partImageId: 'pi1' },
    attemptsMade: 1,
    opts: { attempts: 3 },
    ...overrides,
  } as Job<AiAnalysisJobData>;
}

describe('AiAnalysisProcessor', () => {
  let analyzePartImage: jest.Mock;
  let handleExhaustedRetries: jest.Mock;
  let processor: AiAnalysisProcessor;

  beforeEach(() => {
    analyzePartImage = jest.fn().mockResolvedValue(undefined);
    handleExhaustedRetries = jest.fn().mockResolvedValue(undefined);
    const service = {
      analyzePartImage,
      handleExhaustedRetries,
    } as unknown as AiAnalysisService;
    processor = new AiAnalysisProcessor(service);
  });

  it('process() delegates to AiAnalysisService.analyzePartImage with the job data', async () => {
    const job = makeJob({
      data: { tenantId: 'tenant-x', partImageId: 'image-y' },
    });
    await processor.process(job);
    expect(analyzePartImage).toHaveBeenCalledWith('tenant-x', 'image-y');
  });

  it('onFailed does nothing when attempts remain (a transient retry, not exhaustion)', async () => {
    const job = makeJob({ attemptsMade: 1, opts: { attempts: 3 } });
    await processor.onFailed(job);
    expect(handleExhaustedRetries).not.toHaveBeenCalled();
  });

  it('onFailed calls handleExhaustedRetries once the final attempt has failed', async () => {
    const job = makeJob({
      data: { tenantId: 'tenant-x', partImageId: 'image-y' },
      attemptsMade: 3,
      opts: { attempts: 3 },
    });
    await processor.onFailed(job);
    expect(handleExhaustedRetries).toHaveBeenCalledWith('tenant-x', 'image-y');
  });

  it('onFailed is a no-op when bullmq passes no job (can happen on some failure paths)', async () => {
    await expect(processor.onFailed(undefined)).resolves.toBeUndefined();
    expect(handleExhaustedRetries).not.toHaveBeenCalled();
  });

  it('onFailed treats a missing attempts option as attempts=1 (fails immediately on first try)', async () => {
    const job = makeJob({ attemptsMade: 1, opts: {} });
    await processor.onFailed(job);
    expect(handleExhaustedRetries).toHaveBeenCalled();
  });
});
