// Blockbound — bump with GAME_VERSION in js/config.js
const CACHE = 'blockbound-1.3.000';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/config.js',
  './js/rng.js',
  './js/world.js',
  './js/player.js',
  './js/inventory.js',
  './js/interact.js',
  './js/entities.js',
  './js/textures.js',
  './js/particles.js',
  './js/render.js',
  './js/input.js',
  './js/audio.js',
  './js/save.js',
  './js/game.js',
  './js/main.js',
  './manifest.webmanifest',
  './icons/icon-180.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './apple-touch-icon.png',
  './art/cover.jpg',
  './assets/player/hero.png',
  './assets/bg/clouds.png',
  './assets/tiles/atlas.png',
  './assets/tiles/grass.png',
  './assets/tiles/dirt.png',
  './assets/tiles/stone.png',
  './assets/tiles/sand.png',
  './assets/tiles/wood.png',
  './assets/tiles/leaves.png',
  './assets/tiles/coal.png',
  './assets/tiles/iron.png',
  './assets/tiles/gold.png',
  './assets/tiles/copper.png',
  './assets/tiles/lava.png',
  './assets/tiles/bedrock.png',
  './assets/tiles/water.png',
  './assets/tiles/snow.png',
  './assets/tiles/clay.png',
  './assets/tiles/ladder.png',
  './assets/tiles/torch.png',
  './assets/tiles/workbench.png',
  './assets/tiles/planks.png',
  './assets/tiles/glass.png',
  './assets/tiles/brick.png',
];

function precacheAll(cache) {
  return Promise.allSettled(
    ASSETS.map(url =>
      cache.add(url).catch(err => console.warn('[sw] precache failed', url, err))
    )
  );
}

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(precacheAll).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', e => {
  if (e.data === 'SKIP_WAITING' || (e.data && e.data.type === 'SKIP_WAITING')) {
    self.skipWaiting();
  }
});

function sameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; }
  catch { return false; }
}

function networkFirst(request) {
  return fetch(request, { cache: 'no-store' }).then(res => {
    if (res.ok && sameOrigin(request.url)) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(request, copy));
    }
    return res;
  }).catch(() => caches.match(request).then(hit => hit || Response.error()));
}

function cacheFirst(request) {
  return caches.match(request).then(hit => {
    if (hit) return hit;
    return fetch(request).then(res => {
      if (res.ok && sameOrigin(request.url)) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(request, copy));
      }
      return res;
    });
  });
}

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.endsWith('/sw.js')) return;
  // Always fresh shell HTML / config for version checks
  if (url.pathname.endsWith('.html') || url.pathname.endsWith('/') || url.pathname.endsWith('config.js')) {
    e.respondWith(networkFirst(request));
    return;
  }
  e.respondWith(cacheFirst(request));
});
