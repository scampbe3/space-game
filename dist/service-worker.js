const CACHE_NAME = 'space-site-cache-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './main.js',
  './service-worker.js',
  './viewer.js',
  './libs/build/three.module.js',
  './libs/examples/jsm/loaders/GLTFLoader.js',
  './scene/curve.json',
  './scene/spawns.json',
  './textures/sky/space_4k.jpg',
  './shader-manifest.json'
];
let dynamicCoreAssets = [];
let lateAssets = [];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll([...new Set([...CORE_ASSETS, ...dynamicCoreAssets])]))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  const { type, assets = [] } = event.data || {};
  if (type === 'seed-cache') {
    dynamicCoreAssets = assets;
    caches.open(CACHE_NAME).then(cache => cache.addAll(assets)).catch(() => {});
  }
  if (type === 'warm-late-assets') {
    lateAssets = assets;
    caches.open(CACHE_NAME).then(cache => cache.addAll(assets)).catch(() => {});
  }
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== location.origin) return;

  event.respondWith(cacheFirst(event.request));
});

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) {
    fetchAndUpdate(cache, request);
    return cached;
  }
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (err) {
    return cached;
  }
}

async function fetchAndUpdate(cache, request) {
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
  } catch (err) {
    // ignore network errors; keep cached copy
  }
}
