import { INestApplication } from '@nestjs/common';
import { AiAnalysisProcessor } from '../src/ai/ai-analysis.processor';

/**
 * Every e2e spec file boots a full Nest app, meaning a full BullMQ Worker
 * (including its dedicated blocking Redis connection) starts and stops once
 * per file within the same Jest process (--runInBand). A bare app.close()
 * doesn't wait for that blocking connection's in-flight read to actually
 * unblock -- it can throw an unhandled 'error' event asynchronously after
 * app.close() already resolved, landing in whichever spec file happens to
 * be running by then and failing it. Closing the worker directly first
 * lets BullMQ settle that connection deterministically inside this file's
 * own afterAll instead.
 *
 * Deliberately a *graceful* close (no force flag), not force-close: forcing
 * it was tried first and, under some timing, produced a native access
 * violation (Windows exit code 3221226505) rather than just failing a test
 * -- forcing the underlying socket closed while a blocking read was still
 * in flight at the native layer is a real crash risk, not just noise.
 * Graceful close waits for BullMQ's own shutdown sequence to unblock that
 * read properly instead of yanking the connection out from under it.
 */
export async function closeTestApp(app: INestApplication): Promise<void> {
  try {
    const processor = app.get(AiAnalysisProcessor, { strict: false });
    await processor.worker.close();
  } catch {
    // AiAnalysisProcessor isn't in every test's module graph in principle;
    // in practice it always is (AiModule is always part of AppModule), but
    // this stays defensive rather than assuming.
  }
  await app.close();
}
