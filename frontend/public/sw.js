// Hand-written service worker (no Workbox library at runtime).
//
// @ducanh2912/next-pwa (already a dependency) generates its service worker
// via a webpack() config hook + workbox-webpack-plugin -- but this project
// builds exclusively with Turbopack (package.json has no --webpack flag,
// and Turbopack does not execute webpack() config or support webpack
// plugins at all, per Next.js's own Turbopack docs). That plugin is
// therefore dead weight here, not a working PWA build step. This file
// implements the same two named strategies from BUILD_PLAN's Phase 7 line
// item directly against the standard Cache API instead, so the offline
// mobile PWA shell actually works under this project's real build.

const CACHE_VERSION = "v1";
const STATIC_CACHE = `junkyard-static-${CACHE_VERSION}`;
const PAGES_CACHE = `junkyard-pages-${CACHE_VERSION}`;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key !== STATIC_CACHE && key !== PAGES_CACHE)
          .map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => undefined);
  return cached ?? (await networkFetch) ?? Response.error();
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // never cache the backend API's cross-origin, tenant-scoped responses

  // Next.js's hashed build assets are immutable by filename -- safe to
  // cache indefinitely and never re-validate.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  // App shell navigations: serve instantly from cache when offline-launched,
  // refresh in the background when a network is available.
  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidate(request, PAGES_CACHE));
  }
});
