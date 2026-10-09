// Service worker: makes the store installable and lets it open offline
// with the last loaded catalog. Bump VERSION to drop old caches.
const VERSION = 'v1';
const CACHE = 'cheddadi-' + VERSION;
const PRECACHE = [
  '/',
  '/css/style.css',
  '/js/i18n.js',
  '/js/app.js',
  '/img/logo.jpg',
  '/img/icon-192.png',
  '/manifest.webmanifest',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('cheddadi-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, cache as fallback: always fresh prices/stock when online.
async function networkFirst(req, fallbackUrl) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(fallbackUrl || req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(fallbackUrl || req);
    if (hit) return hit;
    throw err;
  }
}

// Serve from cache right away, refresh the cache in the background.
async function staleWhileRevalidate(e) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(e.request);
  const net = fetch(e.request).then((res) => {
    if (res.ok || res.type === 'opaque') cache.put(e.request, res.clone());
    return res;
  });
  if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
  return net;
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.origin === location.origin) {
    // Admin panel and order APIs always go straight to the network.
    if (url.pathname.startsWith('/admin') || (url.pathname.startsWith('/api/') && url.pathname !== '/api/store')) return;
    if (req.mode === 'navigate') return e.respondWith(networkFirst(req, '/'));
    if (url.pathname === '/sw.js' || url.pathname === '/health') return;
    // Images rarely change: cache first. Code and data: network first, so a deploy
    // never pairs new HTML with old scripts.
    if (url.pathname.startsWith('/img/') || url.pathname.startsWith('/uploads/')) return e.respondWith(staleWhileRevalidate(e));
    return e.respondWith(networkFirst(req));
  }

  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    return e.respondWith(staleWhileRevalidate(e));
  }
});
