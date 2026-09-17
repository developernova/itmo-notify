export type Task = {
  id: string;
  user_id?: string | null;
  group_id: string | null;
  title: string;
  subject: string;
  due_at: string;
  reminder_minutes: number;
  notes: string;
  completed: boolean;
  priority: string;
  repeat_rule: string;
};
export type StudyGroup = { id: string; name: string; invite_code: string };

export const localGroup = {
  id: "demo-group",
  name: "Пример группы",
  invite_code: "",
};

// Values must stay in sync with the reminder_minutes check constraint.
export const reminders = [
  { value: "0", label: "В момент дедлайна", short: "в срок" },
  { value: "10", label: "За 10 минут", short: "за 10 минут" },
  { value: "60", label: "За час", short: "за час" },
  { value: "180", label: "За 3 часа", short: "за 3 часа" },
  { value: "1440", label: "За день", short: "за день" },
  { value: "4320", label: "За 3 дня", short: "за 3 дня" },
  { value: "10080", label: "За неделю", short: "за неделю" },
];

// Значения должны совпадать с check-ограничением repeat_rule.
export const repeats = [
  { value: "none", label: "Один раз", short: "" },
  { value: "daily", label: "Каждый день", short: "каждый день" },
  { value: "weekdays", label: "По будням, пн–пт", short: "по будням" },
  { value: "weekly", label: "Каждую неделю", short: "каждую неделю" },
  { value: "monthly", label: "Каждый месяц", short: "каждый месяц" },
];

export const repeatLabel = (rule: string) =>
  repeats.find((r) => r.value === rule)?.short ?? "";

/** Ближайший повтор строго после `after`; для разовых заданий — null. */
export function nextDue(from: string | Date, rule: string, after = new Date()) {
  if (!rule || rule === "none") return null;
  const next = new Date(from);
  for (let guard = 0; guard < 500; guard++) {
    if (rule === "weekly") next.setDate(next.getDate() + 7);
    else if (rule === "monthly") next.setMonth(next.getMonth() + 1);
    else next.setDate(next.getDate() + 1);
    if (rule === "weekdays")
      while (next.getDay() === 0 || next.getDay() === 6)
        next.setDate(next.getDate() + 1);
    if (next > after) return next;
  }
  return null;
}

export const reminderLabel = (minutes: number) =>
  reminders.find((r) => r.value === String(minutes))?.short ?? "в срок";

export function exampleTasks(): Task[] {
  return [
    ["Лабораторная № 3", "Программирование", 1],
    ["Задачи по интегралам", "Матанализ", 2],
    ["Презентация о себе", "Английский", 4],
  ].map(([title, subject, days]) => {
    const date = new Date();
    date.setDate(date.getDate() + Number(days));
    date.setHours(23, 59, 0, 0);
    return {
      id: crypto.randomUUID(),
      group_id: localGroup.id,
      title: String(title),
      subject: String(subject),
      due_at: date.toISOString(),
      reminder_minutes: 1440,
      notes: "",
      completed: false,
      priority: "normal",
      repeat_rule: "none",
    };
  });
}

export function defaultDue() {
  const date = new Date();
  date.setHours(23, 59, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date;
}

export const isOverdue = (task: Task) => new Date(task.due_at) < new Date();

/** Просроченные собираются вместе сверху и остаются в списке, пока их не уберут. */
export function dayLabel(value: string) {
  const date = new Date(value),
    today = new Date();
  if (date < new Date()) return "Просрочено";
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date.toDateString() === today.toDateString()) return "Сегодня";
  if (date.toDateString() === tomorrow.toDateString()) return "Завтра";
  return date.toLocaleDateString("ru", {
    day: "numeric",
    month: "long",
    weekday: "short",
  });
}

export const timeLabel = (value: string | Date) =>
  new Date(value).toLocaleTimeString("ru", {
    hour: "2-digit",
    minute: "2-digit",
  });

export const dateLabel = (value: string | Date) =>
  new Date(value).toLocaleDateString("ru", {
    day: "numeric",
    month: "long",
    year:
      new Date(value).getFullYear() === new Date().getFullYear()
        ? undefined
        : "numeric",
  });

export const fullLabel = (value: string | Date) =>
  `${dateLabel(value)}, ${timeLabel(value)}`;

/** "через 2 дня" / "срок прошёл 3 часа назад" — для подписи под заданием. */
export function relativeLabel(value: string) {
  const diff = new Date(value).getTime() - Date.now();
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["minute", 60000],
    ["hour", 3600000],
    ["day", 86400000],
  ];
  const format = new Intl.RelativeTimeFormat("ru", { numeric: "auto" });
  let [unit, size] = units[0];
  for (const [nextUnit, nextSize] of units)
    if (Math.abs(diff) >= nextSize) [unit, size] = [nextUnit, nextSize];
  return format.format(Math.round(diff / size), unit);
}

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : (error as { message?: string })?.message ||
      "Не удалось выполнить действие";
