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
      data: {
        url: data.tag ? "/?task=" + encodeURIComponent(data.tag) : "/",
        snoozeToken: data.snoozeToken,
      },
      actions: data.snoozeToken
        ? [{ action: "evening", title: "Напомнить в 19:00" }]
        : [],
    }),
  );
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const data = event.notification.data || {};
      if (event.action === "evening" && data.snoozeToken) {
        try {
          const r = await fetch("/api/snooze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ token: data.snoozeToken }),
          });
          if (!r.ok) throw Error();
          const result = await r.json();
          await self.registration.showNotification("Напоминание отложено", {
            body:
              new Date(result.until).toLocaleString("ru", {
                timeZone: "Europe/Moscow",
                day: "numeric",
                month: "long",
                hour: "2-digit",
                minute: "2-digit",
              }) + " МСК",
            icon: "/icon-192.png",
            data: { url: data.url },
          });
          return;
        } catch {
          await self.registration.showNotification("Не удалось отложить", {
            body: "Открой задание и попробуй снова",
            data: { url: data.url },
          });
        }
      }
      const url = new URL(data.url || "/", self.location.origin).href;
      for (const window of await clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      })) {
        if (new URL(window.url).origin === self.location.origin) {
          await window.navigate(url);
          return window.focus();
        }
      }
      return clients.openWindow(url);
    })(),
  );
});
