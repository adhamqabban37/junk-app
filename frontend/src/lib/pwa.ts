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
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !navigator.serviceWorker) {
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
