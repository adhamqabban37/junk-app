/**
 * Every e2e spec file boots a full Nest app (BullMQ Worker + Queue) in the
 * same Jest process (--runInBand). closeTestApp() already closes the Worker
 * gracefully before app.close() to avoid most teardown races (see its own
 * comment), but BullMQ's internal RedisConnection class -- a *separate*
 * EventEmitter from the Worker/Queue objects our own code listens on (see
 * node_modules/bullmq/dist/cjs/classes/redis-connection.js) -- can still
 * have its connect-time `initializing` promise reject after teardown, with
 * no listener left on that specific internal object. Node wraps a
 * zero-listener EventEmitter 'error' in its own ERR_UNHANDLED_ERROR (the
 * original error lands in `.context`, not `.message`) and throws it
 * synchronously, which crashes the entire Jest process (not just the
 * current test) and takes down whichever spec happens to be running by
 * then -- confirmed via CI (GitHub Actions, Linux) hitting this
 * deterministically, matching the same failure signature documented from
 * local Windows runs (docs/PROGRESS.md's Phase 4 "Test-infrastructure
 * note").
 *
 * This is BullMQ vendor-internals teardown timing, not an app bug -- by the
 * time it fires, every already-completed spec file has already reported its
 * real pass/fail. Deliberately silent (no console output) for the matched
 * case: Jest fails a run for *any* console output logged after all test
 * suites finish ("Cannot log after tests are done"), so even a warning
 * here would itself become the failure it's trying to avoid. Anything else
 * still crashes loudly, since only this exact known signature is matched.
 */
process.on('uncaughtException', (error: unknown) => {
  const context =
    error instanceof Error &&
    (error as Error & { code?: string; context?: unknown }).code ===
      'ERR_UNHANDLED_ERROR'
      ? (error as Error & { context?: unknown }).context
      : undefined;

  const isKnownBullMqTeardownRace =
    context instanceof Error &&
    context.message === 'Connection is closed.' &&
    error instanceof Error &&
    error.stack?.includes('bullmq') &&
    error.stack?.includes('redis-connection');

  if (isKnownBullMqTeardownRace) {
    return;
  }

  // Registering this listener at all suppresses Node's own default
  // "crash the process" behavior for every uncaught exception, not just the
  // one matched above -- so anything else must still fail the run exactly
  // as it would have with no listener installed, rather than silently
  // continuing.
  console.error(error);
  process.exit(1);
});
