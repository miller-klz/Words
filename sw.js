const CACHE_NAME = 'word-journal-v3';
const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './db.js',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

importScripts('./db.js');

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting())
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
  // Only handle same-origin GETs (the app shell). Cross-origin requests,
  // like dictionary API lookups, are left to the browser's normal network
  // handling so a caching hiccup here never breaks them.
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith(self.location.origin)) return;

  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return res;
      }).catch(() => cached);
    })
  );
});

async function showWordOfDayNotification() {
  const { word } = await wjPickWordOfDay();
  if (!word) return;

  const bodyParts = [];
  if (word.definition) bodyParts.push(word.definition);
  if (word.quote) {
    bodyParts.push(`"${word.quote}"${word.author ? ' — ' + word.author : ''}${word.book ? ` (${word.book})` : ''}`);
  }

  await self.registration.showNotification(`Word of the day: ${word.word}`, {
    body: bodyParts.join('\n\n'),
    icon: './icons/icon-192.png',
    badge: './icons/icon-192.png',
    tag: 'word-of-day',
    data: { wordId: word.id },
  });
}

// Best-effort background trigger. Only supported on installed PWAs in
// Chromium-based browsers (mainly Android); iOS Safari does not support it.
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'daily-word') {
    event.waitUntil(showWordOfDayNotification());
  }
});

// Manual trigger from the page (used as a fallback where periodic sync
// isn't available, and to let the page ask the SW to show it right away).
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SHOW_WORD_OF_DAY') {
    event.waitUntil(showWordOfDayNotification());
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) return client.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('./index.html');
    })
  );
});
