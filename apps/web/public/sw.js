// Shows alarm notifications while the page is closed, and opens the app when one is tapped.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const { title, body, tag, url } = event.data.json();
  event.waitUntil(self.registration.showNotification(title, { body, tag, renotify: true, data: { url } }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
      const open = windows[0];
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});
