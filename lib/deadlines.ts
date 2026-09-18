export type Task = {
  id: string;
  user_id?: string | null;
  group_id: string | null;
  title: string;
  subject: string;
  due_at: string;
  /** Минуты до срока, за сколько слать push. Пусто — уведомлений нет. */
  reminder_offsets: number[];
  /** Легаси одного напоминания: колонка осталась в базе, но не читается. */
  reminder_minutes?: number;
  notes: string;
  completed: boolean;
  priority: string;
  repeat_rule: string;
  /** Время повтора push по Москве, «20:00». У разовых заданий — null. */
  repeat_time: string | null;
};
export type StudyGroup = { id: string; name: string; invite_code: string };

export const localGroup = {
  id: "demo-group",
  name: "Пример группы",
  invite_code: "",
};

// Values must stay in sync with the reminder_minutes check constraint.
// Значения должны совпадать с check-ограничением reminder_offsets.
export const reminders = [
  { value: 0, label: "В момент дедлайна", chip: "в срок" },
  { value: 10, label: "За 10 минут", chip: "за 10 мин" },
  { value: 60, label: "За час", chip: "за час" },
  { value: 180, label: "За 3 часа", chip: "за 3 часа" },
  { value: 1440, label: "За день", chip: "за день" },
  { value: 4320, label: "За 3 дня", chip: "за 3 дня" },
  { value: 10080, label: "За неделю", chip: "за неделю" },
];

export const reminderChip = (minutes: number) =>
  reminders.find((r) => r.value === minutes)?.chip ?? `за ${minutes} мин`;

/** «за 3 дня, за день и за час» — человеческий список напоминаний. */
export function offsetsLabel(offsets: number[]) {
  if (!offsets.length) return "без уведомлений";
  const parts = [...offsets].sort((a, b) => b - a).map(reminderChip);
  return parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(", ")} и ${parts[parts.length - 1]}`;
}

// Значения должны совпадать с check-ограничением repeat_rule.
export const repeats = [
  { value: "none", label: "Один раз", short: "" },
  { value: "daily", label: "Каждый день", short: "каждый день" },
  { value: "weekdays", label: "По будням, пн–пт", short: "по будням" },
  { value: "weekly", label: "Каждую неделю", short: "каждую неделю" },
];

export const repeatLabel = (rule: string) =>
  repeats.find((r) => r.value === rule)?.short ?? "";

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
      reminder_offsets: [1440],
      notes: "",
      completed: false,
      priority: "normal",
      repeat_rule: "none",
      repeat_time: null,
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

/** Одна строка про push: «каждый день в 20:00» или «за час». */
export function pushLabel(
  task: Pick<
    Task,
    "due_at" | "reminder_offsets" | "repeat_rule" | "repeat_time"
  >,
) {
  if (task.repeat_rule === "none" || !task.repeat_time)
    return offsetsLabel(task.reminder_offsets);
  const time = task.repeat_time.slice(0, 5);
  if (task.repeat_rule === "weekly")
    return `каждый ${new Date(task.due_at).toLocaleDateString("ru", { weekday: "long" })} в ${time}`;
  return `${repeatLabel(task.repeat_rule)} в ${time}`;
}

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

/** Предметы из заданий: без повторов по регистру, частые выше. */
export function subjectList(tasks: Task[]) {
  const seen = new Map<string, { name: string; count: number }>();
  for (const task of tasks) {
    const name = task.subject.trim();
    if (!name || name === "Без предмета") continue;
    const key = name.toLowerCase();
    const found = seen.get(key);
    if (found) found.count++;
    else seen.set(key, { name, count: 1 });
  }
  return [...seen.values()]
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ru"))
    .map((s) => s.name);
}

/** Подтягивает ввод к известному написанию, чтобы не плодить «матан» и «Матанализ». */
export function canonicalSubject(value: string, known: string[]) {
  const name = value.trim();
  return known.find((k) => k.toLowerCase() === name.toLowerCase()) ?? name;
}

export const errorText = (error: unknown) =>
  error instanceof Error
    ? error.message
    : (error as { message?: string })?.message ||
      "Не удалось выполнить действие";
