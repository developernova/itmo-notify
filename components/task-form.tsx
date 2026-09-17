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
import { DateTimePicker } from "@/components/date-time-picker";
import { Task, defaultDue, reminders, repeats } from "@/lib/deadlines";

export type TaskValues = {
  title: string;
  subject: string;
  due: Date;
  reminder: string;
  repeat: string;
  notes: string;
  scope: "group" | "personal";
};

export function TaskForm({
  task,
  scope,
  groupName,
  busyDates,
  busy,
  onSubmit,
}: {
  task?: Task | null;
  scope: "group" | "personal";
  groupName?: string;
  busyDates?: Date[];
  busy: boolean;
  onSubmit: (values: TaskValues) => void;
}) {
  const [values, setValues] = useState<TaskValues>({
    title: task?.title ?? "",
    subject:
      task?.subject && task.subject !== "Без предмета" ? task.subject : "",
    due: task ? new Date(task.due_at) : defaultDue(),
    reminder: String(task?.reminder_minutes ?? 1440),
    repeat: task?.repeat_rule ?? "none",
    notes: task?.notes ?? "",
    scope: task ? (task.group_id ? "group" : "personal") : scope,
  });
  const set = (patch: Partial<TaskValues>) =>
    setValues((current) => ({ ...current, ...patch }));

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
            value={values.subject}
            onChange={(e) => set({ subject: e.target.value })}
            placeholder="Программирование"
          />
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
          <FieldLabel htmlFor="repeat">Повторять push</FieldLabel>
          <Select
            value={values.repeat}
            onValueChange={(repeat) => set({ repeat })}
          >
            <SelectTrigger id="repeat" className="h-12 w-full text-base">
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
          <FieldDescription>
            «Каждый день» — push будет приходить каждый день, пока задание не
            удалишь. Задание остаётся в списке и само переезжает на следующий
            раз.
          </FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="reminder">За сколько до срока</FieldLabel>
          <Select
            value={values.reminder}
            onValueChange={(reminder) => set({ reminder })}
          >
            <SelectTrigger id="reminder" className="h-12 w-full text-base">
              <SelectValue />
            </SelectTrigger>
            <SelectContent position="popper">
              {reminders.map((reminder) => (
                <SelectItem key={reminder.value} value={reminder.value}>
                  {reminder.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldDescription>
            Когда прислать push. Нужны включённые уведомления на устройстве.
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
