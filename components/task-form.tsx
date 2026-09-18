"use client";
import { useState } from "react";
import { Users, UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { DateTimePicker, TimeFields } from "@/components/date-time-picker";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Task,
  defaultDue,
  offsetsLabel,
  reminders,
  repeats,
} from "@/lib/deadlines";

export type TaskValues = {
  title: string;
  subject: string;
  due: Date;
  /** Минуты до срока: сколько напоминаний, столько и push. */
  offsets: number[];
  repeat: string;
  /** «20:00», время повтора push. */
  repeatTime: string;
  notes: string;
  scope: "group" | "personal";
};

const defaultTime = (task?: Task | null) => {
  const due = task ? new Date(task.due_at) : defaultDue();
  return `${String(due.getHours()).padStart(2, "0")}:${String(due.getMinutes()).padStart(2, "0")}`;
};

export function TaskForm({
  task,
  scope,
  groupName,
  busyDates,
  subjects = [],
  busy,
  onSubmit,
}: {
  task?: Task | null;
  scope: "group" | "personal";
  groupName?: string;
  busyDates?: Date[];
  subjects?: string[];
  busy: boolean;
  onSubmit: (values: TaskValues) => void;
}) {
  const [values, setValues] = useState<TaskValues>({
    title: task?.title ?? "",
    subject:
      task?.subject && task.subject !== "Без предмета" ? task.subject : "",
    due: task ? new Date(task.due_at) : defaultDue(),
    offsets: task?.reminder_offsets ?? [1440],
    repeat: task?.repeat_rule ?? "none",
    repeatTime: (task?.repeat_time ?? "").slice(0, 5) || defaultTime(task),
    notes: task?.notes ?? "",
    scope: task ? (task.group_id ? "group" : "personal") : scope,
  });
  const set = (patch: Partial<TaskValues>) =>
    setValues((current) => ({ ...current, ...patch }));
  // Подсказываем уже заведённые предметы, пока пользователь не набрал точное совпадение.
  const query = values.subject.trim().toLowerCase();
  const hints = subjects
    .filter((s) => s.toLowerCase() !== query && s.toLowerCase().includes(query))
    .slice(0, 5);

  return (
    <form
      className="space-y-7"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(values);
      }}
    >
      <FieldGroup className="gap-6">
        {!task && (
          <Tabs
            value={values.scope}
            onValueChange={(value) =>
              set({ scope: value as TaskValues["scope"] })
            }
          >
            <TabsList className="h-11! w-full">
              <TabsTrigger value="group" disabled={!groupName}>
                <Users />
                Для группы
              </TabsTrigger>
              <TabsTrigger value="personal">
                <UserRound />
                Личный
              </TabsTrigger>
            </TabsList>
          </Tabs>
        )}
        <Field>
          <FieldLabel htmlFor="title">Задание</FieldLabel>
          <Input
            id="title"
            className="h-12 text-base"
            required
            autoFocus={!task}
            maxLength={160}
            value={values.title}
            onChange={(e) => set({ title: e.target.value })}
            placeholder="Сдать лабораторную № 3"
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="subject">Предмет</FieldLabel>
          <Input
            id="subject"
            className="h-12 text-base"
            maxLength={80}
            autoComplete="off"
            value={values.subject}
            onChange={(e) => set({ subject: e.target.value })}
            placeholder="Программирование"
          />
          {hints.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {hints.map((subject) => (
                <Badge
                  key={subject}
                  asChild
                  variant="outline"
                  className="h-8 cursor-pointer px-3 text-sm font-normal hover:bg-muted"
                >
                  <button type="button" onClick={() => set({ subject })}>
                    {subject}
                  </button>
                </Badge>
              ))}
            </div>
          )}
        </Field>
        <Field>
          <FieldLabel>Срок</FieldLabel>
          <DateTimePicker
            value={values.due}
            busyDates={busyDates}
            onChange={(due) => set({ due })}
          />
        </Field>
        <Field>
          <FieldLabel htmlFor="repeat">Push-уведомление</FieldLabel>
          <div className="flex gap-2">
            <Select
              value={values.repeat}
              onValueChange={(repeat) => set({ repeat })}
            >
              <SelectTrigger
                id="repeat"
                className="h-12 min-w-0 flex-1 text-base"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent position="popper">
                {repeats.map((repeat) => (
                  <SelectItem key={repeat.value} value={repeat.value}>
                    {repeat.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {values.repeat !== "none" && (
              <TimeFields
                hour={Number(values.repeatTime.slice(0, 2))}
                minute={Number(values.repeatTime.slice(3, 5))}
                onChange={(hour, minute) =>
                  set({
                    repeatTime: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`,
                  })
                }
              />
            )}
          </div>
          {values.repeat === "none" && (
            <ToggleGroup
              type="multiple"
              variant="outline"
              className="flex w-full flex-wrap"
              value={values.offsets.map(String)}
              onValueChange={(picked) =>
                set({ offsets: picked.map(Number).sort((a, b) => b - a) })
              }
            >
              {reminders.map((reminder) => (
                <ToggleGroupItem
                  key={reminder.value}
                  value={String(reminder.value)}
                  className="h-10 px-3 text-sm"
                >
                  {reminder.chip}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          )}
          <FieldDescription>
            {values.repeat === "none"
              ? `Придёт ${offsetsLabel(values.offsets)}.`
              : "Время по Москве. Push приходит до срока, потом задание уходит в архив."}
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="notes">
            Заметка{" "}
            <span className="text-muted-foreground">· необязательно</span>
          </FieldLabel>
          <Textarea
            id="notes"
            className="text-base"
            maxLength={2000}
            value={values.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="Ссылка или подробности"
          />
        </Field>
      </FieldGroup>
      <Button
        type="submit"
        className="h-12 w-full text-base"
        disabled={busy || !values.title.trim()}
      >
        {busy ? "Сохраняем…" : task ? "Сохранить" : "Добавить"}
      </Button>
    </form>
  );
}
