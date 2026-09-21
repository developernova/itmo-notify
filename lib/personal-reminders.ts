export type ReminderPreference = {
  task_id: string;
  user_id?: string;
  reminder_offsets: number[] | null;
  repeat_rule: string | null;
  repeat_time: string | null;
  evening_before: boolean;
  snooze_until: string | null;
};
/** App scheduling consistently uses Moscow time. */
export function nextEvening(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) => parts.find((p) => p.type === name)!.value;
  const date = new Date(
    `${part("year")}-${part("month")}-${part("day")}T19:00:00+03:00`,
  );
  if (date <= now) date.setUTCDate(date.getUTCDate() + 1);
  return date;
}
export function safeSubmissionUrl(value: string) {
  if (!value.trim()) return "";
  const url = new URL(value.trim());
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    throw Error("Нужна ссылка http:// или https:// без логина и пароля");
  return url.href;
}
