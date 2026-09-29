// DRIFT service worker — makes the app installable and shows job alerts.
// It deliberately does NOT cache the app, so every open gets the newest version.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => { /* network only — no offline cache */ });

// A push from DRIFT's server (e.g. "New plow request · $44").
self.addEventListener("push", (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { title: "DRIFT", body: event.data && event.data.text() }; }
  const title = data.title || "DRIFT";
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: data.tag || "drift",
    renotify: true,
    requireInteraction: data.sticky !== false,   // job alerts stay on screen until tapped; snow alerts don't
    vibrate: data.sticky === false ? [200, 100, 200] : [400, 200, 400, 200, 400, 200, 400],
    data: { url: data.url || "/" },
  }));
});

// Tapping the alert opens (or focuses) DRIFT.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const w of wins) { if ("focus" in w) { await w.focus(); return; } }
    await self.clients.openWindow(url);
  })());
});
