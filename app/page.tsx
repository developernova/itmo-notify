"use client";
import { useEffect, useState } from "react";
import {
  Archive,
  ArrowLeft,
  Bell,
  BellOff,
  CalendarDays,
  Check,
  ChevronDown,
  Copy,
  Info,
  Pencil,
  Plus,
  Repeat,
  RotateCcw,
  Trash2,
  Users,
  UserRound,
} from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Item, ItemActions, ItemGroup } from "@/components/ui/item";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Panel } from "@/components/panel";
import { TaskForm, type TaskValues } from "@/components/task-form";
import { useDeadlines } from "@/hooks/use-deadlines";
import {
  Task,
  dayLabel,
  errorText,
  fullLabel,
  isOverdue,
  nextDue,
  relativeLabel,
  reminderLabel,
  repeatLabel,
  timeLabel,
} from "@/lib/deadlines";
import { supabase } from "@/lib/supabase";

export default function Home() {
  const data = useDeadlines();
  const [scope, setScope] = useState<"group" | "personal">("group");
  const [archive, setArchive] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Task | null>(null);
  const [selected, setSelected] = useState<Task | null>(null);
  const [removing, setRemoving] = useState<Task | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groupMode, setGroupMode] = useState("join");
  const [groupInput, setGroupInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [push, setPush] = useState(false);
  const group = data.groups.find((g) => g.id === data.groupId);

  useEffect(() => {
    if ("serviceWorker" in navigator)
      navigator.serviceWorker
        .register("/sw.js")
        .then((registration) => registration.pushManager?.getSubscription())
        .then((subscription) => setPush(!!subscription))
        .catch(() => {});
    const invite = new URLSearchParams(window.location.search).get("join");
    if (invite) {
      setGroupInput(invite);
      setGroupOpen(true);
    }
  }, []);

  const inScope = (task: Task) =>
    scope === "personal" ? !task.group_id : task.group_id === group?.id;
  const isArchived = (task: Task) =>
    task.completed || data.hidden.includes(task.id);
  const scoped = data.tasks.filter(inScope);
  const visible = scoped
    .filter((task) => (archive ? isArchived(task) : !isArchived(task)))
    .sort(
      (a, b) =>
        (+new Date(a.due_at) - +new Date(b.due_at)) * (archive ? -1 : 1),
    );
  const archivedCount = scoped.filter(isArchived).length;
  const buckets = visible.reduce<Record<string, Task[]>>((all, task) => {
    const day = dayLabel(task.due_at);
    (all[day] ??= []).push(task);
    return all;
  }, {});
  // Повторяющееся своё задание не уходит в архив, а переезжает на следующий раз.
  const selectedNext =
    selected && data.isMine(selected) && !isArchived(selected)
      ? nextDue(selected.due_at, selected.repeat_rule)
      : null;
  const busyDates = scoped
    .filter((task) => !isArchived(task))
    .map((task) => new Date(task.due_at));

  function openForm(task: Task | null) {
    setEditing(task);
    setFormOpen(true);
  }

  async function submitTask(values: TaskValues) {
    if (values.scope === "group" && !group) return;
    setBusy(true);
    const payload = {
      title: values.title.trim(),
      subject: values.subject.trim() || "Без предмета",
      due_at: values.due.toISOString(),
      reminder_minutes: Number(values.reminder),
      repeat_rule: values.repeat,
      notes: values.notes.trim(),
    };
    try {
      if (editing) {
        await data.updateTask(editing.id, payload);
        setSelected((current) =>
          current?.id === editing.id ? { ...current, ...payload } : current,
        );
        toast.success("Изменения сохранены");
      } else {
        await data.createTask({
          ...payload,
          id: crypto.randomUUID(),
          group_id: values.scope === "group" ? group!.id : null,
          completed: false,
          priority: "normal",
        });
        setScope(values.scope);
        setArchive(false);
        toast.success(
          values.scope === "group"
            ? "Добавлено для всей группы"
            : "Личный дедлайн добавлен",
        );
      }
      setFormOpen(false);
      setEditing(null);
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function groupAction(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result =
        groupMode === "create"
          ? await data.createGroup(groupInput)
          : await data.joinGroup(groupInput);
      setGroupOpen(false);
      setGroupInput("");
      setScope("group");
      setArchive(false);
      window.history.replaceState(null, "", window.location.pathname);
      toast.success(
        groupMode === "create"
          ? `Группа ${result.name} создана`
          : `Ты в группе ${result.name}`,
      );
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function copyInvite() {
    if (!group?.invite_code) return;
    try {
      await navigator.clipboard.writeText(
        `${window.location.origin}/?join=${group.invite_code}`,
      );
      toast.success("Приглашение скопировано");
    } catch {
      toast.error("Не удалось скопировать. Код есть в настройках группы.");
    }
  }

  async function pushAction(test = false) {
    if (!data.cloud || !supabase) {
      toast.info(
        data.authError ||
          "Уведомления работают только с подключённым Supabase.",
      );
      return;
    }
    if (!("PushManager" in window)) {
      toast.info("На iPhone добавь сайт на экран «Домой» и открой его оттуда.");
      return;
    }
    setBusy(true);
    try {
      const token = (await supabase.auth.getSession()).data.session
        ?.access_token;
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      };
      if (test) {
        const response = await fetch("/api/push", { method: "PUT", headers });
        if (!response.ok) throw Error((await response.json()).error);
        toast.success("Тестовый push отправлен");
        return;
      }
      const key = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
      if (!key) throw Error("Ключи Web Push ещё не настроены");
      if ((await Notification.requestPermission()) !== "granted")
        throw Error("Разреши уведомления в настройках браузера");
      const registration = await navigator.serviceWorker.ready;
      const subscription =
        (await registration.pushManager.getSubscription()) ||
        (await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: Uint8Array.from(
            atob(key.replace(/-/g, "+").replace(/_/g, "/")),
            (c) => c.charCodeAt(0),
          ),
        }));
      const response = await fetch("/api/push", {
        method: "POST",
        headers,
        body: JSON.stringify({ subscription, hiddenTaskIds: data.hidden }),
      });
      if (!response.ok) throw Error((await response.json()).error);
      setPush(true);
      toast.success("Напоминания включены");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  async function disablePush() {
    setBusy(true);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const subscription = await registration?.pushManager.getSubscription();
      if (subscription) await subscription.unsubscribe();
      setPush(false);
      toast.success("Уведомления на этом устройстве выключены");
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-background">
      <div className="mx-auto max-w-2xl px-5 pb-28 sm:px-8">
        <header className="flex h-22 items-center justify-between">
          <a href="/" className="text-2xl font-semibold tracking-tighter">
            срок<span className="text-muted-foreground">.</span>
          </a>
          <div className="flex items-center gap-2">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="secondary"
                  className="h-11 max-w-48 gap-2 px-4"
                >
                  <Users className="size-4 shrink-0" />
                  <span className="truncate">
                    {group?.name || "Моя группа"}
                  </span>
                  <ChevronDown className="size-4 shrink-0" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                {data.groups.length > 1 && (
                  <DropdownMenuLabel>Мои группы</DropdownMenuLabel>
                )}
                {data.groups.length > 1 &&
                  data.groups.map((item) => (
                    <DropdownMenuItem
                      key={item.id}
                      onSelect={() => {
                        data.setGroupId(item.id);
                        setScope("group");
                        setArchive(false);
                      }}
                    >
                      {item.name}
                      {item.id === data.groupId && (
                        <Check className="ml-auto" />
                      )}
                    </DropdownMenuItem>
                  ))}
                {group?.invite_code && (
                  <DropdownMenuItem onSelect={copyInvite}>
                    <Copy />
                    Пригласить по ссылке
                  </DropdownMenuItem>
                )}
                {(data.groups.length > 1 || group?.invite_code) && (
                  <DropdownMenuSeparator />
                )}
                <DropdownMenuItem
                  onSelect={() => {
                    setGroupMode("join");
                    setGroupInput("");
                    setGroupOpen(true);
                  }}
                >
                  <Plus />
                  Присоединиться или создать
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button
              variant="ghost"
              size="icon"
              className="size-11"
              aria-label="Настройки и уведомления"
              onClick={() => setSettingsOpen(true)}
            >
              <UserRound className="size-5" />
            </Button>
          </div>
        </header>

        <main>
          <div className="mt-5 mb-6 flex items-center justify-between gap-2">
            <h1 className="text-3xl font-semibold tracking-tight">
              {archive ? "Архив" : "Дедлайны"}
            </h1>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Обновить"
                onClick={() => void data.refresh()}
              >
                <RotateCcw className="size-5" />
              </Button>
              <Button
                variant={archive ? "secondary" : "ghost"}
                className="h-11 gap-2 px-4"
                onClick={() => setArchive(!archive)}
              >
                {archive ? (
                  <>
                    <ArrowLeft className="size-4" />К дедлайнам
                  </>
                ) : (
                  <>
                    <Archive className="size-4" />
                    Архив
                    {archivedCount > 0 && (
                      <Badge variant="secondary">{archivedCount}</Badge>
                    )}
                  </>
                )}
              </Button>
            </div>
          </div>

          <Tabs
            value={scope}
            onValueChange={(value) => {
              setScope(value as "group" | "personal");
              setArchive(false);
            }}
          >
            <TabsList className="mb-7 h-12! w-full">
              <TabsTrigger value="group" className="text-base">
                <Users />
                Группа
              </TabsTrigger>
              <TabsTrigger value="personal" className="text-base">
                <UserRound />
                Личные
              </TabsTrigger>
            </TabsList>
          </Tabs>

          {!data.cloud && (
            <p className="mb-5 text-sm text-muted-foreground">
              {data.authError ||
                "Сейчас только на этом устройстве: облако не подключено."}
            </p>
          )}

          {data.loading ? (
            <div className="space-y-4">
              <Skeleton className="h-6 w-24" />
              <Skeleton className="h-28 w-full rounded-3xl" />
              <Skeleton className="h-28 w-full rounded-3xl" />
            </div>
          ) : data.loadError ? (
            <Empty className="px-4">
              <EmptyHeader>
                <EmptyTitle>Не удалось загрузить</EmptyTitle>
                <EmptyDescription>{data.loadError}</EmptyDescription>
              </EmptyHeader>
              <Button variant="outline" onClick={() => data.refresh()}>
                Попробовать ещё раз
              </Button>
            </Empty>
          ) : scope === "group" && !group ? (
            <Empty className="px-4 py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Users />
                </EmptyMedia>
                <EmptyTitle>Одна группа. Общие сроки.</EmptyTitle>
                <EmptyDescription>
                  Вступи по приглашению или создай группу для своих.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button
                  size="lg"
                  className="h-12 w-full"
                  onClick={() => setGroupOpen(true)}
                >
                  Подключить группу
                  <Plus />
                </Button>
                {!data.cloud && (
                  <Button variant="ghost" onClick={data.demo}>
                    Посмотреть пример
                  </Button>
                )}
              </EmptyContent>
            </Empty>
          ) : !visible.length ? (
            <Empty className="px-4 py-14">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  {archive ? <Archive /> : <CalendarDays />}
                </EmptyMedia>
                <EmptyTitle>
                  {archive ? "Архив пуст" : "Пока без дедлайнов"}
                </EmptyTitle>
                <EmptyDescription>
                  {archive
                    ? "Сюда попадают убранные задания. Ничего не удаляется само."
                    : scope === "group"
                      ? "Добавь первое задание — его увидит вся группа."
                      : "Здесь задания только для тебя."}
                </EmptyDescription>
              </EmptyHeader>
              {!archive && (
                <Button variant="outline" onClick={() => openForm(null)}>
                  <Plus />
                  Добавить
                </Button>
              )}
            </Empty>
          ) : (
            <div className="space-y-7">
              {Object.entries(buckets).map(([day, items]) => (
                <section key={day} aria-label={day}>
                  <h2
                    className={`mb-3 px-1 text-sm font-medium ${day === "Просрочено" ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {day}
                  </h2>
                  <ItemGroup className="gap-3">
                    {items.map((task) => (
                      <Item
                        key={task.id}
                        variant="outline"
                        className="gap-1 rounded-3xl bg-card p-0 pr-2 pl-4 shadow-xs"
                      >
                        <Button
                          variant="ghost"
                          className="h-auto min-h-27 min-w-0 flex-1 justify-start rounded-2xl px-0 py-4 text-left whitespace-normal hover:bg-transparent"
                          onClick={() => setSelected(task)}
                        >
                          <div className="min-w-0 space-y-2">
                            <p className="flex flex-wrap items-center gap-x-2 text-sm font-normal text-muted-foreground">
                              {task.subject}
                              {task.repeat_rule !== "none" && (
                                <span className="flex items-center gap-1">
                                  <Repeat className="size-3" />
                                  {repeatLabel(task.repeat_rule)}
                                </span>
                              )}
                            </p>
                            <h3 className="text-base leading-snug font-medium break-words">
                              {task.title}
                            </h3>
                            <p
                              className={`text-sm font-normal ${isOverdue(task) ? "text-destructive" : "text-muted-foreground"}`}
                            >
                              {timeLabel(task.due_at)} ·{" "}
                              {isOverdue(task)
                                ? `срок прошёл ${relativeLabel(task.due_at)}`
                                : relativeLabel(task.due_at)}
                            </p>
                          </div>
                        </Button>
                        <ItemActions>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="size-11 shrink-0 text-muted-foreground"
                            aria-label={
                              archive
                                ? `Вернуть ${task.title}`
                                : task.group_id
                                  ? `Убрать у себя: ${task.title}`
                                  : `Убрать в архив: ${task.title}`
                            }
                            onClick={() =>
                              archive
                                ? void data.restore(task.id)
                                : void data.archive(task)
                            }
                          >
                            {archive ? (
                              <RotateCcw className="size-5" />
                            ) : (
                              <Check className="size-5" />
                            )}
                          </Button>
                        </ItemActions>
                      </Item>
                    ))}
                  </ItemGroup>
                </section>
              ))}
            </div>
          )}
        </main>
      </div>

      {!archive && (scope === "personal" || group) && (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-linear-to-t from-background via-background to-background/0 px-5 pt-8 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
          <div className="mx-auto max-w-2xl sm:px-8">
            <Button
              size="lg"
              className="h-14 w-full text-base shadow-lg"
              onClick={() => openForm(null)}
            >
              <Plus className="size-5" />
              Добавить дедлайн
            </Button>
          </div>
        </div>
      )}

      <Panel
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) setEditing(null);
        }}
        title={editing ? "Изменить задание" : "Новый дедлайн"}
        description={
          editing
            ? editing.group_id
              ? "Изменения увидит вся группа."
              : "Видно только тебе."
            : "Срок, напоминание и заметка — всё в одном месте."
        }
      >
        <TaskForm
          key={editing?.id ?? "new"}
          task={editing}
          scope={group ? scope : "personal"}
          groupName={group?.name}
          busyDates={busyDates}
          busy={busy}
          onSubmit={submitTask}
        />
      </Panel>

      <Panel
        open={!!selected}
        onOpenChange={(open) => !open && setSelected(null)}
        title={selected?.title || "Задание"}
        description={selected?.subject || "Подробности"}
      >
        {selected && (
          <div className="space-y-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">
                {selected.group_id ? "Для группы" : "Личное"}
              </Badge>
              {isOverdue(selected) && (
                <Badge variant="destructive">Срок прошёл</Badge>
              )}
              {selected.repeat_rule !== "none" && (
                <Badge variant="outline">
                  <Repeat />
                  {repeatLabel(selected.repeat_rule)}
                </Badge>
              )}
              <span className="text-sm text-muted-foreground">
                {fullLabel(selected.due_at)}
              </span>
            </div>
            {selected.notes && (
              <p className="text-base leading-relaxed break-words whitespace-pre-wrap">
                {selected.notes}
              </p>
            )}
            <p className="text-sm text-muted-foreground">
              Push: {reminderLabel(selected.reminder_minutes)}
              {selected.repeat_rule !== "none" &&
                `, затем ${repeatLabel(selected.repeat_rule)}`}
            </p>
            <Separator />
            <p className="text-sm text-muted-foreground">
              {selectedNext
                ? `Отметка «выполнено» перенесёт напоминание на ${fullLabel(selectedNext)}. Ничего не удаляется.`
                : selected.group_id
                  ? "«Убрать» скроет задание только у тебя на этом устройстве — у группы оно останется."
                  : "«Убрать» отправит задание в архив. Оттуда его всегда можно вернуть."}
            </p>
            <div className="grid gap-2">
              {data.isMine(selected) && (
                <Button
                  variant="outline"
                  className="h-12 w-full"
                  onClick={() => {
                    const task = selected;
                    setSelected(null);
                    openForm(task);
                  }}
                >
                  <Pencil />
                  Изменить
                </Button>
              )}
              <Button
                variant="secondary"
                className="h-12 w-full"
                onClick={() => {
                  if (isArchived(selected)) void data.restore(selected.id);
                  else void data.archive(selected);
                  setSelected(null);
                }}
              >
                {isArchived(selected) ? (
                  <RotateCcw />
                ) : selectedNext ? (
                  <Check />
                ) : (
                  <Archive />
                )}
                {isArchived(selected)
                  ? "Вернуть в список"
                  : selectedNext
                    ? "Выполнено на этот раз"
                    : selected.group_id
                      ? "Убрать у себя"
                      : "Убрать в архив"}
              </Button>
              {data.isMine(selected) && (
                <Button
                  variant="ghost"
                  className="h-12 w-full text-destructive hover:text-destructive"
                  onClick={() => setRemoving(selected)}
                >
                  <Trash2 />
                  Удалить навсегда
                </Button>
              )}
            </div>
          </div>
        )}
      </Panel>

      <Panel
        open={groupOpen}
        onOpenChange={setGroupOpen}
        title="Твоя группа"
        description="Общие задания видят все участники."
      >
        <form onSubmit={groupAction} className="space-y-5">
          <Tabs
            value={groupMode}
            onValueChange={(value) => {
              setGroupMode(value);
              setGroupInput("");
            }}
          >
            <TabsList className="h-11! w-full">
              <TabsTrigger value="join">Вступить</TabsTrigger>
              <TabsTrigger value="create">Создать</TabsTrigger>
            </TabsList>
          </Tabs>
          <Field>
            <FieldLabel htmlFor="group-input">
              {groupMode === "join" ? "Код приглашения" : "Название группы"}
            </FieldLabel>
            <Input
              id="group-input"
              className="h-12 text-base"
              required
              maxLength={groupMode === "join" ? 200 : 60}
              value={groupInput}
              onChange={(event) => {
                const value = event.target.value;
                let code = value;
                try {
                  code = new URL(value).searchParams.get("join") || value;
                } catch {}
                setGroupInput(code);
              }}
              placeholder={
                groupMode === "join"
                  ? "Вставь код или ссылку"
                  : "Например, M3101"
              }
            />
            <FieldDescription>
              {groupMode === "join"
                ? "Код даёт тот, кто уже в группе."
                : "Название видят все, кто вступит по ссылке."}
            </FieldDescription>
          </Field>
          <Button
            className="h-12 w-full"
            type="submit"
            disabled={busy || !groupInput.trim()}
          >
            {busy
              ? "Подключаем…"
              : groupMode === "join"
                ? "Присоединиться"
                : "Создать группу"}
          </Button>
        </form>
      </Panel>

      <Panel
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        title="Настройки"
        description={data.cloud ? "Аккаунт этого браузера" : "Локальный режим"}
      >
        <div className="space-y-5">
          <div className="space-y-3">
            <div className="flex items-center gap-2 font-medium">
              <Bell className="size-4" />
              Напоминания
            </div>
            <Button
              variant="secondary"
              className="h-12 w-full"
              disabled={busy}
              onClick={() => pushAction(push)}
            >
              {busy ? "Подожди…" : push ? "Проверить push" : "Включить push"}
            </Button>
            {push && (
              <Button
                variant="ghost"
                className="w-full"
                disabled={busy}
                onClick={disablePush}
              >
                <BellOff />
                Выключить на этом устройстве
              </Button>
            )}
            <p className="text-sm text-muted-foreground">
              На iPhone сначала добавь сайт на экран «Домой».
            </p>
          </div>
          {group?.invite_code && (
            <>
              <Separator />
              <div className="space-y-3">
                <p className="font-medium">Пригласить в {group.name}</p>
                <Button
                  variant="outline"
                  className="h-12 w-full"
                  onClick={copyInvite}
                >
                  <Copy />
                  Скопировать приглашение
                </Button>
                <p className="text-sm break-all text-muted-foreground">
                  {group.invite_code}
                </p>
              </div>
            </>
          )}
          <Separator />
          <Button
            variant="ghost"
            className="h-12 w-full justify-between"
            onClick={() => {
              setArchive(true);
              setSettingsOpen(false);
            }}
          >
            <span className="flex items-center gap-2">
              <Archive className="size-4" />
              Архив
            </span>
            <Badge variant="secondary">{archivedCount}</Badge>
          </Button>
          <p className="flex gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" />
            Просроченные задания никуда не пропадают: они остаются в списке, а
            убранные лежат в архиве, пока ты сам их не удалишь.
          </p>
          <p className="text-sm text-muted-foreground">
            {data.cloud
              ? "Вход не нужен: аккаунт создаётся автоматически для этого браузера. Общие задания доступны всем в группе — на другом устройстве вступи в неё по ссылке-приглашению."
              : data.authError ||
                "Supabase не подключён, поэтому задания хранятся только в этом браузере."}
          </p>
        </div>
      </Panel>

      <AlertDialog
        open={!!removing}
        onOpenChange={(open) => !open && setRemoving(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить навсегда?</AlertDialogTitle>
            <AlertDialogDescription>
              {removing?.group_id
                ? "Задание исчезнет у всей группы, вернуть его будет нельзя. Чтобы убрать только у себя, используй архив."
                : "Задание исчезнет без возможности восстановления. Чтобы просто убрать его из списка, используй архив."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                const task = removing;
                setRemoving(null);
                if (!task) return;
                try {
                  await data.removeTask(task.id);
                  setSelected(null);
                  toast.success("Задание удалено");
                } catch (e) {
                  toast.error(errorText(e));
                }
              }}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Toaster position="top-center" />
    </div>
  );
}
