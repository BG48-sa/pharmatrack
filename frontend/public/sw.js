const CACHE_NAME = 'pharmatrack-cache-v3';

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

  // Runtime data snapshots (/data/*.json): always network-first so the app never
  // shows a snapshot older than what's published. Falls back to cache (then the
  // app's bundled data) when offline.
  if (url.pathname.includes('/data/') && url.pathname.endsWith('.json')) {
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
    return;
  }

  if (sameOrigin) {
    const isHTMLShell =
      request.mode === 'navigate' ||
      url.pathname === '/' ||
      url.pathname.endsWith('/') ||
      url.pathname.endsWith('.html');

    if (isHTMLShell) {
      // The HTML shell is network-first: a new deploy references freshly-hashed
      // JS/CSS, so serving stale HTML would pin the old UI for a whole session.
      // Fresh HTML → latest assets → new UI immediately. Cached index.html is
      // the offline fallback.
      event.respondWith(
        fetch(request)
          .then((res) => {
            if (res && res.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, res.clone()));
            return res;
          })
          .catch(() => caches.match(request).then((r) => r || caches.match('./index.html')))
      );
      return;
    }

    // Hashed build assets (content-hashed filenames are immutable per build):
    // stale-while-revalidate — instant from cache, refreshed in the background.
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((res) => {
            if (res && res.ok) cache.put(request, res.clone());
            return res;
          })
          .catch(() => cached);
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
