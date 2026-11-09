/* ForYou service worker: shows notifications for pushes while the app is closed.
   Push payloads never contain message text — only who and what kind. */

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch (e) { data = {}; }
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windows.some((w) => w.visibilityState === 'visible')) return; // the open app rings by itself
    const isCall = data.type === 'call';
    const from = typeof data.from === 'string' ? data.from : 'Someone';
    await self.registration.showNotification(isCall ? `Incoming ${data.video ? 'video' : 'voice'} call` : 'ForYou', {
      body: isCall ? `${from} is calling you` : `New message from ${from}`,
      tag: typeof data.tag === 'string' ? data.tag : 'foryou',
      renotify: true,
      requireInteraction: isCall,
      icon: '/icons/icon-192.webp',
      badge: '/icons/icon-192.webp',
      vibrate: isCall ? [600, 300, 600, 300, 600, 300, 600] : [120],
      data: { url: '/' },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const w of windows) if ('focus' in w) return w.focus();
    return self.clients.openWindow('/');
  })());
});
