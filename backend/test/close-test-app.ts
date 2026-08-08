import { INestApplication } from '@nestjs/common';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import {
  AiAnalysisProcessor,
  AI_ANALYSIS_QUEUE,
} from '../src/ai/ai-analysis.processor';

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
  await settleBullMqConnections(app);

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

/**
 * The actual root cause of the long-standing "BullMQ/ioredis teardown flake"
 * (docs/PROGRESS.md, Phase 4) -- which is NOT a cross-file race, despite how
 * it presented. app.e2e-spec.ts reproduces it running entirely alone, 2 runs
 * in 3.
 *
 * BullMQ's RedisConnection constructor does, verbatim
 * (node_modules/bullmq/dist/cjs/classes/redis-connection.js:86-87):
 *
 *     this.initializing = this.init();
 *     this.initializing.catch(err => this.emit('error', err));
 *
 * and its close() ends with a `finally` block that calls
 * `this.removeAllListeners()` (same file, :452) after disconnecting the
 * client (:429). Disconnecting is what makes an *in-flight* init() reject,
 * with `Error: Connection is closed.`
 *
 * So if init() is still pending when teardown starts, two things race:
 *   - the constructor's .catch callback, which emits 'error' on the
 *     connection, and
 *   - removeAllListeners(), which strips the only listener there is (the one
 *     QueueBase installs via forwardConnectionError()).
 *
 * Lose that race and the emit has zero listeners, so Node wraps it in
 * ERR_UNHANDLED_ERROR ("Unhandled error. (Error: Connection is closed...)")
 * and throws it. How many microtask hops the rejection takes to get out of
 * init() is what makes it nondeterministic. BullMQ's close() *does* guard
 * the sibling case -- it attaches its own `initializing?.catch(() => {})` at
 * :432 so the rejection isn't an unhandled *rejection* -- but that does
 * nothing about the constructor's separate catch handler still firing and
 * emitting on a by-then-listenerless emitter.
 *
 * This also explains the flake's signature perfectly: app.e2e-spec.ts is the
 * one suite that does essentially nothing between app.init() and teardown
 * (a single GET /health), so its connections are the most likely to still be
 * initializing when close() runs. Suites doing real DB/queue work give
 * init() time to settle on its own, which is why they mostly pass -- and why
 * this looked for so long like unrelated files taking collateral damage.
 *
 * The fix is to force init() to settle *before* close() can strip the
 * listeners, by awaiting it while forwardConnectionError()'s listener is
 * still attached. `RedisConnection.get client()` returns that exact
 * `initializing` promise (:160-162), so awaiting it is awaiting init().
 * allSettled, not all: a genuinely failed connection must still reach the
 * close path below rather than throwing out of teardown.
 */
async function settleBullMqConnections(app: INestApplication): Promise<void> {
  const pending: Promise<unknown>[] = [];

  try {
    const worker = app.get(AiAnalysisProcessor, { strict: false }).worker;
    // Two distinct connections: the shared one QueueBase owns (worker.client)
    // and the Worker's own dedicated blocking one.
    pending.push(worker.client);

    // `blockingConnection` is private on Worker, so this reaches past the
    // public API on purpose. It is the connection most exposed to the race
    // (it is the one still mid-init while a blocking read is in flight), and
    // BullMQ exposes no public way to await it. Narrowed to just the `client`
    // promise rather than cast to `any`, and guarded, so a future BullMQ
    // rename degrades to "no longer awaited" instead of a teardown crash.
    const internals = worker as unknown as {
      blockingConnection?: { client?: Promise<unknown> };
    };
    const blockingClient = internals.blockingConnection?.client;
    if (blockingClient) {
      pending.push(blockingClient);
    }
  } catch {
    // See the equivalent catch above.
  }

  try {
    // The producer-side Queue registered by PartsModule/VehiclesModule. It
    // has its own third connection, closed by app.close() and subject to the
    // same race.
    const queue = app.get<Queue>(getQueueToken(AI_ANALYSIS_QUEUE), {
      strict: false,
    });
    pending.push(queue.client);
  } catch {
    // Not every test module registers the queue token.
  }

  await Promise.allSettled(pending);
}
