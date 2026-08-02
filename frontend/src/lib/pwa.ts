/**
 * Registers the hand-written service worker (public/sw.js) that makes the
 * mobile intake PWA launchable offline. Must run before
 * `registerSyncTriggers()`'s `navigator.serviceWorker.ready` check can ever
 * resolve. Safe no-op in unsupported browsers/environments.
 */
export function registerServiceWorker(): void {
  if (typeof window === "undefined" || !navigator.serviceWorker) {
    return;
  }
  void navigator.serviceWorker.register("/sw.js").catch(() => {
    // Registration failure (unsupported browser, blocked by user settings,
    // etc.) is non-fatal -- the app still works online, just without the
    // offline-launch shell.
  });
}
