/* eslint-disable no-restricted-globals */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const safeJson = async (data) => {
  if (!data) return null;
  try {
    return await data.json();
  } catch {
    try {
      return JSON.parse(String(data));
    } catch {
      return null;
    }
  }
};

self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    const payload = await safeJson(event?.data);

    const title = (payload && typeof payload.title === 'string' && payload.title) || 'リマインド';
    const body = (payload && typeof payload.body === 'string' && payload.body) || '';
    const url = (payload && typeof payload.url === 'string' && payload.url) || '/';

    await self.registration.showNotification(title, {
      body,
      icon: '/icon.png',
      badge: '/icon.png',
      data: {
        url,
      },
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification?.close();

  event.waitUntil((async () => {
    const url = event?.notification?.data?.url || '/';
    const targetUrl = new URL(String(url), self.location.origin).toString();

    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const windowClients = clientList.filter((c) => c && 'focus' in c);

    // 既に開いているタブがあれば「表示中/フォーカス中」を優先して使う
    const preferredClient =
      windowClients.find((c) => c.focused) ||
      windowClients.find((c) => c.visibilityState === 'visible') ||
      windowClients[0];

    if (preferredClient) {
      try {
        if (preferredClient.url !== targetUrl && 'navigate' in preferredClient) {
          preferredClient.navigate(targetUrl).catch(() => {});
        }
        await preferredClient.focus();
        return;
      } catch {
        // fallthrough to openWindow
      }
    }

    if (self.clients.openWindow) {
      await self.clients.openWindow(targetUrl);
    }
  })());
});
