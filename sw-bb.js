// Blockbound service worker v2 (new filename so stuck sw.js controllers are abandoned)
// Keep CACHE in sync with GAME_VERSION in js/core/constants.js
const CACHE = 'blockbound-1.9.043';

const ASSETS = [
  './',
  './index.html',
  './update.html',
  './css/style.css',
  './js/main.js',
  './js/core/constants.js',
  './js/core/worldSize.js',
  './js/core/rng.js',
  './js/core/seed.js',
  './js/core/difficulty.js',
  './js/content/blocks.js',
  './js/content/tools.js',
  './js/content/recipes.js',
  './js/content/milestones.js',
  './js/content/items.js',
  './js/world/index.js',
  './js/world/shelter.js',
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
  './js/systems/nav.js',
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
];

function precacheAll(cache) {
  return Promise.allSettled(
    ASSETS.map(url =>
      cache.add(url).catch(err => console.warn('[sw-bb] precache failed', url, err))
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
      .then(() => self.clients.matchAll({ type: 'window' }))
      .then(clients => {
        clients.forEach(c => {
          try { c.postMessage({ type: 'BB_RELOAD', cache: CACHE }); } catch (_) {}
        });
      })
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
  return caches.match(request).then(hit => hit ||
    fetch(request).then(res => {
      if (res.ok && sameOrigin(request.url)) {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(request, copy));
      }
      return res;
    }));
}

function isShell(url) {
  const path = new URL(url).pathname;
  return path.endsWith('.html') || path.endsWith('/') ||
    path.includes('/css/') || path.includes('/js/') ||
    path.endsWith('manifest.webmanifest') ||
    path.endsWith('/sw.js') || path.endsWith('/sw-bb.js');
}

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  if (!sameOrigin(request.url)) return;
  const url = new URL(request.url);
  // Never intercept the worker scripts
  if (url.pathname.endsWith('/sw.js') || url.pathname.endsWith('/sw-bb.js')) return;
  // update.html must always hit network (escape hatch)
  if (url.pathname.endsWith('/update.html')) {
    e.respondWith(fetch(request, { cache: 'no-store' }).catch(() => caches.match(request)));
    return;
  }
  if (request.mode === 'navigate' || isShell(request.url)) {
    e.respondWith(networkFirst(request));
    return;
  }
  e.respondWith(cacheFirst(request));
});
