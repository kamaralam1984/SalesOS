/*
 * SalesOS service worker.
 * POLICY (security): this worker NEVER caches /api responses, authenticated HTML, or any non-GET request.
 * It only caches immutable static assets (hashed Next bundles, icons, fonts) and serves a static offline page
 * when a navigation fails. Business data always comes from the network.
 */
const VERSION = 'salesos-static-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function isStaticAsset(url) {
  return url.pathname.startsWith('/_next/static/') || url.pathname.startsWith('/icons/');
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // never touch writes
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // API lives on another origin; never intercepted
  if (url.pathname.startsWith('/api')) return; // belt and braces

  if (isStaticAsset(url)) {
    // Cache-first for immutable static files only.
    event.respondWith(
      caches.open(VERSION).then(async (cache) => {
        const hit = await cache.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  if (req.mode === 'navigate') {
    // Network only. On failure show the static offline page. Authenticated HTML is never stored.
    event.respondWith(
      fetch(req).catch(
        async () => (await caches.match(OFFLINE_URL)) || new Response('Offline', { status: 503 }),
      ),
    );
  }
});
