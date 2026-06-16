const CACHE_NAME = 'pharmatrack-cache-v2';

// App shell — cached on install so the UI loads offline. Hashed build assets
// (JS/CSS) are cached at runtime by the same-origin handler below, since their
// filenames change every build and can't be hardcoded here.
const APP_SHELL = ['./', './index.html', './manifest.json', './icon.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

// Clean up old cache versions on activate.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (sameOrigin) {
    // App shell + hashed build assets: stale-while-revalidate. Serve the cached
    // copy instantly, refresh it in the background. Falls back to cached
    // index.html for navigations when fully offline (SPA shell).
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached || (request.mode === 'navigate' ? cache.match('./index.html') : undefined));
        return cached || network;
      })
    );
  } else {
    // External regulatory APIs (openFDA, ClinicalTrials.gov): network-first so
    // data stays fresh, falling back to the last successful response offline.
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => caches.match(request))
    );
  }
});
