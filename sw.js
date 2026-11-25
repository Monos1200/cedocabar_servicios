const CACHE_NAME = 'cedocabar-soporte-v1';
const ASSETS = [
  './',
  './index.html',
  './dashboard.html',
  './css/styles.css',
  './js/supabase-config.js',
  './js/auth.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
});

self.addEventListener('fetch', (e) => {
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});