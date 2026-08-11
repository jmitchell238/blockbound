// Blockbound — keep CACHE in sync with GAME_VERSION in js/core/constants.js
const CACHE = 'blockbound-1.6.003';

const ASSETS = [
  './',
  './index.html',
  './css/style.css',
  './js/main.js',
  './js/core/constants.js',
  './js/core/worldSize.js',
  './js/core/rng.js',
  './js/content/blocks.js',
  './js/content/tools.js',
  './js/content/recipes.js',
  './js/content/milestones.js',
  './js/content/items.js',
  './js/world/index.js',
  './js/player/index.js',
  './js/inventory/inventory.js',
  './js/interact/index.js',
  './js/interact/meta.js',
  './js/interact/use.js',
  './js/interact/stations.js',
  './js/interact/milestones.js',
  './js/entities/index.js',
  './js/entities/state.js',
  './js/entities/mobs.js',
  './js/entities/draw.js',
  './js/textures/textures.js',
  './js/particles/particles.js',
  './js/render/index.js',
  './js/input/input.js',
  './js/audio/audio.js',
  './js/save/save.js',
  './js/session/index.js',
  './js/session/GameController.js',
  './js/systems/survival.js',
  './js/systems/camera.js',
  './js/systems/weather.js',
  './js/systems/autosave.js',
  './js/ui/toast.js',
  './js/compat/api.js',
  './js/compat/entities_bridge.js',
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
  // Never intercept SW itself — browser handles update checks
  if (url.pathname.endsWith('/sw.js')) return;

  // Shell + all JS must stay fresh so ESM refactors / version bumps aren't stuck
  // behind an old cache-first entry (was stranding clients on v1.5.x).
  const path = url.pathname;
  if (
    path.endsWith('.html') ||
    path.endsWith('/') ||
    path.endsWith('.js') ||
    path.endsWith('.mjs') ||
    path.endsWith('manifest.webmanifest')
  ) {
    e.respondWith(networkFirst(request));
    return;
  }
  e.respondWith(cacheFirst(request));
});
