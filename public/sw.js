// FUEL service worker — shell cache-first, API network-only.
const CACHE = 'fuel-v4';
const SHELL = ['./', 'index.html', 'css/styles.css', 'js/app.js', 'js/store.js', 'js/off.js', 'js/programs.js', 'js/train.js', 'manifest.webmanifest', 'icons/icon.svg'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.pathname.startsWith('/api/') || url.hostname === 'world.openfoodfacts.org' || url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    return; // network handles these
  }
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(e.request).then((hit) => {
        const net = fetch(e.request)
          .then((r) => {
            if (r.ok) caches.open(CACHE).then((c) => c.put(e.request, r.clone()));
            return r;
          })
          .catch(() => hit);
        return hit || net;
      })
    );
  }
});
