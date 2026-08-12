/**
 * LEGACY bridge worker (filename sw.js).
 * Stuck iPads still poll sw.js?v=1.9.038 — when they receive THIS file they
 * activate immediately and navigate every open client to update.html.
 * New installs register sw-bb.js only.
 */
const BRIDGE = 'blockbound-legacy-bridge-042';

self.addEventListener('install', (e) => {
  e.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    (async () => {
      try {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      } catch (_) {}
      await self.clients.claim();
      const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const c of clients) {
        const dest = self.registration.scope + 'update.html?from=legacy-sw&t=' + Date.now();
        try {
          if (c.navigate) await c.navigate(dest);
          else c.postMessage({ type: 'BB_GOTO_UPDATE' });
        } catch (_) {
          try { c.postMessage({ type: 'BB_GOTO_UPDATE' }); } catch (__) {}
        }
      }
    })()
  );
});

// Always prefer network so we never keep feeding the broken shell
self.addEventListener('fetch', (e) => {
  e.respondWith(
    fetch(e.request, { cache: 'no-store' }).catch(() =>
      caches.match(e.request).then((h) => h || Response.error())
    )
  );
});
