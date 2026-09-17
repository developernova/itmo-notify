self.addEventListener("push", (event) => {
  let data = { title: "Срок", body: "Пора проверить дедлайны" };
  try {
    data = { ...data, ...event.data.json() };
  } catch {}
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: data.tag || "deadline",
      data: { url: "/" },
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        for (const w of windows)
          if (new URL(w.url).origin === self.location.origin) return w.focus();
        return clients.openWindow("/");
      }),
  );
});
