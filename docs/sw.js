/* Service worker for Mom's Kitchen.
 * Network-first for same-origin GETs (so deploys show up immediately when online)
 * with a cache fallback so the app shell still opens offline. Supabase requests
 * and non-GETs pass straight through — never cached. */
const CACHE = 'moms-kitchen-v3';
const SHELL = [
  '/', '/index.html', '/recipe.html', '/edit.html', '/admin.html', '/manifest.json',
  '/css/tokens.css', '/css/base.css', '/css/components.css', '/css/pages.css',
  '/js/app.js', '/js/store.js', '/js/supabase.js', '/js/units.js',
  '/js/pages/browse.js', '/js/pages/recipe.js', '/js/pages/edit.js', '/js/pages/admin.js',
  '/js/vendor/alpine.esm.js',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // Only handle our own static GETs; let Supabase (auth/db/storage/functions) and
  // any non-GET request go straight to the network untouched.
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return;

  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      })
      .catch(() => caches.match(e.request).then((r) => r || caches.match('/index.html')))
  );
});
