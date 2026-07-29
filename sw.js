const CACHE_NAME = 'recall-cache-v1';
const CORE_ASSETS = [
  './',
  './index.html',
  './style.css',
  './app.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(CORE_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fetchPromise = fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Best-effort daily reminder. The browser decides when (if ever) this actually
// fires — Periodic Background Sync is opportunistic, Chrome/Android only, and
// requires the PWA to be installed with reasonable site engagement. There is
// no guaranteed-timer API available to a plain web app without a push server.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'daily-reminder') {
    event.waitUntil(checkAndNotify());
  }
});

// Fallback some browsers expose one-off background sync instead.
self.addEventListener('sync', (event) => {
  if (event.tag === 'daily-reminder') {
    event.waitUntil(checkAndNotify());
  }
});

async function checkAndNotify() {
  try {
    const clientsList = await self.clients.matchAll({ type: 'window' });
    // If the app is already open and visible, let the page itself handle it
    // to avoid a duplicate notification.
    const visible = clientsList.some((c) => c.visibilityState === 'visible');
    if (visible) return;

    const store = await getDueCountFromCache();
    if (store === null) return;
    if (store <= 0) return;

    await self.registration.showNotification('Recall', {
      body: store === 1 ? 'You have 1 topic due for review today.' : `You have ${store} topics due for review today.`,
      icon: './icons/icon-192.png',
      badge: './icons/icon-192.png',
      tag: 'daily-reminder',
      renotify: true,
      data: { url: './index.html' }
    });
  } catch (e) {
    // silent — background sync failures shouldn't surface anywhere
  }
}

// The page writes a small snapshot into IndexedDB-free storage (a cached
// JSON response) each time it computes due counts, so the SW can read it
// without needing full app logic duplicated here.
async function getDueCountFromCache() {
  const cache = await caches.open(CACHE_NAME);
  const res = await cache.match('./__due_count__');
  if (!res) return null;
  const data = await res.json();
  const today = new Date().toISOString().slice(0, 10);
  if (data.date !== today) return null;
  return data.count;
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window' }).then((clientsList) => {
      for (const client of clientsList) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
