/* ============================================================
   DreamCar HQ — Service Worker v13 (audit nuke)
   ============================================================ */
// v13 (2026-05-28 audit): bump після хвилі mobile UX rebuild +
// drawer/FAB унифікації + chip-стиль скрізь + Tasks/Analytics/Survey
// + security fixes (RLS approver bypass, cron-reminders actor_id/delegate_to).
// Юзери досі тримали v2-20260514 (2 тижні застарілий код).
// Network-first для HTML/JS, cache-first для статики.

const CACHE_VERSION = 'hq-v13-' + '20260528';
const RUNTIME_CACHE = 'hq-runtime-v13';

const PRECACHE = [
  '/dreamcar-team/hq/',
  '/dreamcar-team/hq/index.html',
  '/dreamcar-team/hq/manifest.webmanifest',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  // NUCLEAR: delete ВСІ старі кеші (hq-v1, hq-runtime — все)
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_VERSION && k !== RUNTIME_CACHE).map((k) => {
        console.log('SW: deleting old cache', k);
        return caches.delete(k);
      })
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (
    url.hostname.includes('supabase.co') ||
    url.hostname.includes('telegram.org') ||
    url.hostname.includes('anthropic.com') ||
    req.method !== 'GET'
  ) {
    return;
  }

  const isCode = req.destination === 'document' ||
                 req.destination === 'script' ||
                 url.pathname.endsWith('.html') ||
                 url.pathname.endsWith('.js');
  if (isCode) {
    // Network-first для JS — завжди свіже
    event.respondWith(
      fetch(req).then((resp) => {
        const copy = resp.clone();
        caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
        return resp;
      }).catch(() => caches.match(req).then((cached) => cached || new Response('Offline', { status: 503 })))
    );
    return;
  }

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((resp) => {
        if (resp.ok) {
          const copy = resp.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
        }
        return resp;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
});

self.addEventListener('push', (event) => {
  let data = { title: 'DreamCar HQ', body: 'Новe сповіщення', url: '/dreamcar-team/hq/' };
  try { if (event.data) data = Object.assign(data, event.data.json()); } catch (_) {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: 'https://etron.dreamcar.ua/etron/assets/img/dreamcar-avatar-mark.ico',
      badge: 'https://etron.dreamcar.ua/etron/assets/img/dreamcar-avatar-mark.ico',
      data: { url: data.url },
      tag: data.tag || 'hq-default',
      requireInteraction: data.requireInteraction || false,
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/dreamcar-team/hq/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clients) => {
      for (const client of clients) {
        if (client.url.includes('/dreamcar-team/hq/')) {
          client.navigate(url);
          return client.focus();
        }
      }
      return self.clients.openWindow(url);
    })
  );
});
