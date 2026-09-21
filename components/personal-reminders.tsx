"use client";
import { useEffect, useState } from "react";
import { Bell, Clock } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleTrigger,
  CollapsibleContent,
} from "@/components/ui/collapsible";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Switch } from "@/components/ui/switch";
import { Task, reminders, pushLabel } from "@/lib/deadlines";
import { ReminderPreference, nextEvening } from "@/lib/personal-reminders";
import { supabase } from "@/lib/supabase";
import { api } from "@/lib/api-client";
export function PersonalReminders({
  task,
  cloud,
  userId,
}: {
  task: Task;
  cloud: boolean;
  userId?: string;
}) {
  const [pref, setPref] = useState<ReminderPreference>({
    task_id: task.id,
    reminder_offsets: null,
    repeat_rule: null,
    repeat_time: null,
    evening_before: false,
    snooze_until: null,
  });
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        let value;
        if (cloud && supabase && userId) {
          const { data, error } = await supabase
            .from("task_reminder_preferences")
            .select("*")
            .eq("task_id", task.id)
            .eq("user_id", userId)
            .maybeSingle();
          if (error) throw error;
          value = data;
        } else
          value = JSON.parse(
            localStorage.getItem("srok-reminder-" + task.id) || "null",
          );
        if (active) {
          if (value) setPref(value);
          setReady(true);
        }
      } catch {
        toast.error("Не удалось загрузить личные напоминания");
      }
    })();
    return () => {
      active = false;
    };
  }, [task.id, cloud, userId]);
  async function save(next: ReminderPreference) {
    setBusy(true);
    try {
      if (cloud && supabase && userId) {
        const { error } = await supabase
          .from("task_reminder_preferences")
          .upsert({ ...next, user_id: userId });
        if (error) throw error;
      } else
        localStorage.setItem("srok-reminder-" + task.id, JSON.stringify(next));
      setPref(next);
    } catch {
      toast.error("Не удалось сохранить напоминания");
    } finally {
      setBusy(false);
    }
  }
  const custom = pref.reminder_offsets !== null;
  return (
    <div className="space-y-2">
      <Button
        variant="secondary"
        className="w-full h-11"
        disabled={!ready || busy || task.completed}
        onClick={async () => {
          setBusy(true);
          try {
            if (cloud) {
              const result = await api("/api/snooze", {
                method: "POST",
                body: JSON.stringify({ taskId: task.id }),
              });
              setPref((p) => ({ ...p, snooze_until: result.until }));
              toast.success("Напомним в 19:00 МСК");
            } else {
              await save({
                ...pref,
                snooze_until: nextEvening().toISOString(),
              });
              toast.info("Сохранено локально. Для push подключи Supabase.");
            }
          } catch {
            toast.error("Не удалось отложить напоминание");
          } finally {
            setBusy(false);
          }
        }}
      >
        <Clock />
        Напомнить{" "}
        {nextEvening().toDateString() === new Date().toDateString()
          ? "вечером"
          : "завтра вечером"}
      </Button>
      {pref.snooze_until && new Date(pref.snooze_until) > new Date() && (
        <p className="text-xs text-muted-foreground">
          Отложено до{" "}
          {new Date(pref.snooze_until).toLocaleString("ru", {
            timeZone: "Europe/Moscow",
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          })}{" "}
          МСК
        </p>
      )}
      <Collapsible defaultOpen>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" className="w-full justify-start">
            <Bell />
            Мои напоминания ·{" "}
            {custom ? "свои" : task.group_id ? "как у группы" : "по заданию"}
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-2">
          <label className="flex items-center justify-between text-sm">
            Свои настройки
            <Switch
              checked={custom}
              disabled={!ready || busy}
              onCheckedChange={(v) =>
                void save({
                  ...pref,
                  reminder_offsets: v ? task.reminder_offsets : null,
                  repeat_rule: v ? "none" : null,
                  repeat_time: null,
                  evening_before: false,
                })
              }
            />
          </label>
          {custom ? (
            <>
              <ToggleGroup
                type="multiple"
                variant="outline"
                className="flex flex-wrap"
                value={pref.reminder_offsets!.map(String)}
                onValueChange={(v) => {
                  if (v.length > 5) {
                    toast.info("До 5 напоминаний");
                    return;
                  }
                  void save({ ...pref, reminder_offsets: v.map(Number) });
                }}
                disabled={busy}
              >
                {reminders.map((r) => (
                  <ToggleGroupItem
                    className="h-10 px-3"
                    key={r.value}
                    value={String(r.value)}
                  >
                    {r.chip}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <label className="flex items-center justify-between text-sm">
                Накануне в 19:00 МСК
                <Switch
                  checked={pref.evening_before}
                  disabled={busy}
                  onCheckedChange={(v) =>
                    void save({ ...pref, evening_before: v })
                  }
                />
              </label>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{pushLabel(task)}</p>
          )}
          <p className="text-xs text-muted-foreground">
            Только для тебя. Срок и уведомления группы не изменятся.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
