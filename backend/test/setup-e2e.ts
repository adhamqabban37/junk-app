/**
 * Every e2e spec file boots a full Nest app (BullMQ Worker + Queue) in the
 * same Jest process (--runInBand). closeTestApp() already closes the Worker
 * gracefully before app.close() to avoid most teardown races (see its own
 * comment), but BullMQ's internal RedisConnection class -- a *separate*
 * EventEmitter from the Worker/Queue objects our own code listens on (see
 * node_modules/bullmq/dist/cjs/classes/redis-connection.js) -- can still
 * have its connect-time `initializing` promise reject after teardown, with
 * no listener left on that specific internal object. A Node EventEmitter
 * with zero 'error' listeners throws synchronously instead of just logging,
 * which crashes the entire Jest process (not just the current test) and
 * takes down whichever spec happens to be running by then -- confirmed via
 * CI (GitHub Actions, Linux) hitting this deterministically on
 * auth.e2e-spec.ts's concurrent-request test, matching the same failure
 * signature documented from local Windows runs (docs/PROGRESS.md's Phase 4
 * "Test-infrastructure note").
 *
 * This is BullMQ vendor-internals teardown timing, not an app bug -- by the
 * time it fires, every already-completed spec file has already reported its
 * real pass/fail. Downgrading it to a warning here keeps that real signal
 * intact without crashing the whole suite; anything else still crashes
 * loudly, since only this exact known signature is swallowed.
 */
process.on('uncaughtException', (error: unknown) => {
  const isKnownBullMqTeardownRace =
    error instanceof Error &&
    error.message === 'Connection is closed.' &&
    error.stack?.includes('bullmq') &&
    error.stack?.includes('redis-connection');

  if (isKnownBullMqTeardownRace) {
    console.warn(
      '[test/setup-e2e] Ignored known BullMQ RedisConnection teardown race:',
      error.message,
    );
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
