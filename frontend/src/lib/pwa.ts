/**
 * Registers the hand-written service worker (public/sw.js) that makes the
 * mobile intake PWA launchable offline. Must run before
 * `registerSyncTriggers()`'s `navigator.serviceWorker.ready` check can ever
 * resolve. Safe no-op in unsupported browsers/environments.
 *
 * Deferred until the window `load` event (not called eagerly on mount): a
 * live browser walkthrough found that registering immediately lets sw.js's
 * `skipWaiting()` + `clients.claim()` take control of the *same* page while
 * it's still fetching its own JS chunks, which raced Turbopack's dev-mode
 * chunk requests into a reload loop that never let the app hydrate. This is
 * also the standard documented pattern (web.dev/workbox) for this exact
 * reason, independent of the dev-mode symptom that surfaced it.
 */
/**
 * Dev-only teardown. Skipping registration is not enough on its own: a
 * browser that already installed sw.js from an earlier session keeps
 * running *that* copy, cache and all, and no amount of fixing the
 * registration path reaches it retroactively. That is why the reload loop
 * kept coming back on machines that had ever run the app before, and why
 * recovering from it meant hand-running this same pair of calls in DevTools.
 * Doing it automatically in dev makes the loop unable to recur.
 */
async function tearDownServiceWorkerForDev(): Promise<void> {
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((r) => r.unregister()));
    if (typeof caches !== "undefined") {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
  } catch {
    // Best-effort: a browser that won't let us enumerate registrations is
    // no worse off than before.
  }
}

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !navigator.serviceWorker) {
    return;
  }

  // The service worker exists to make the installed PWA launchable offline,
  // which is a production concern only -- in dev it buys nothing and costs a
  // documented, recurring reload loop under Turbopack HMR (sw.js's
  // skipWaiting()/clients.claim() racing the page's own chunk requests).
  // `process.env.NODE_ENV` is statically inlined by Next, so this whole
  // branch is eliminated from the production bundle.
  if (process.env.NODE_ENV === "development") {
    void tearDownServiceWorkerForDev();
    return;
  }

  const register = () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {
      // Registration failure (unsupported browser, blocked by user settings,
      // etc.) is non-fatal -- the app still works online, just without the
      // offline-launch shell.
    });
  };
  if (document.readyState === "complete") {
    register();
  } else {
    window.addEventListener("load", register, { once: true });
  }
}
