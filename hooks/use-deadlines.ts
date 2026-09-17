"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import {
  Task,
  StudyGroup,
  localGroup,
  exampleTasks,
  errorText,
  fullLabel,
  nextDue,
} from "@/lib/deadlines";

const TASKS_KEY = "srok-tasks";
const DEMO_KEY = "srok-demo-group";
const hiddenKey = (userId?: string) => `srok-hidden:${userId || "local"}`;

/**
 * Аккаунт создаётся молча: анонимная сессия Supabase, без формы входа.
 * Если Supabase не подключён или анонимный вход выключен — всё живёт в localStorage.
 */
export function useDeadlines() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [groups, setGroups] = useState<StudyGroup[]>([]);
  const [groupId, setGroupId] = useState("");
  const [hidden, setHidden] = useState<string[]>([]);
  const [loadError, setLoadError] = useState("");
  const [authError, setAuthError] = useState("");
  const identity = useRef<string | null>(null);
  const signingIn = useRef(false);
  // Тосты с кнопкой «Вернуть» живут дольше рендера — читаем состояние из ref.
  const tasksRef = useRef<Task[]>([]);
  const hiddenRef = useRef<string[]>([]);
  tasksRef.current = tasks;
  hiddenRef.current = hidden;

  useEffect(() => {
    const client = supabase;
    if (!client) {
      setReady(true);
      return;
    }
    let active = true;
    // Пока идёт первый вход, события подписки игнорируем: сессию ставим сами.
    signingIn.current = true;
    const { data: listener } = client.auth.onAuthStateChange((_e, session) => {
      if (!active || signingIn.current) return;
      setUser(session?.user ?? null);
      setReady(true);
    });
    void (async () => {
      const { data, error } = await client.auth.getSession();
      if (error) toast.error(errorText(error));
      let session = data.session;
      if (!session) {
        const anonymous = await client.auth.signInAnonymously();
        if (anonymous.error && active)
          // Отдельная подсказка только для реально частой причины; остальное — как есть.
          setAuthError(
            /anonymous|disabled/i.test(anonymous.error.message)
              ? "Облако недоступно: в Supabase включи Authentication → Sign In / Providers → Anonymous sign-ins."
              : `Облако недоступно: ${errorText(anonymous.error)}`,
          );
        session = anonymous.data.session;
      }
      signingIn.current = false;
      if (!active) return;
      setUser(session?.user ?? null);
      setReady(true);
    })();
    return () => {
      active = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  /**
   * Повторяющееся задание не «протухает»: через 10 минут после срока оно
   * переезжает на следующий раз. Чужие групповые сдвинет cron на сервере.
   */
  const rollRepeats = useCallback(async (list: Task[], uid: string | null) => {
    const cutoff = new Date(Date.now() - 10 * 60000);
    const moved: { id: string; due_at: string }[] = [];
    const next = list.map((task) => {
      if (task.repeat_rule === "none" || task.completed) return task;
      if (new Date(task.due_at) > cutoff) return task;
      if (uid && task.user_id && task.user_id !== uid) return task;
      const upcoming = nextDue(task.due_at, task.repeat_rule);
      if (!upcoming) return task;
      moved.push({ id: task.id, due_at: upcoming.toISOString() });
      return { ...task, due_at: upcoming.toISOString() };
    });
    if (!moved.length) return list;
    try {
      if (uid && supabase)
        await Promise.all(
          moved.map((task) =>
            supabase!
              .from("tasks")
              .update({ due_at: task.due_at })
              .eq("id", task.id),
          ),
        );
      else localStorage.setItem(TASKS_KEY, JSON.stringify(next));
    } catch (e) {
      toast.error(errorText(e));
      return list;
    }
    return next;
  }, []);

  const refresh = useCallback(async () => {
    if (!ready) return;
    const uid = user?.id ?? null;
    identity.current = uid;
    setLoadError("");
    try {
      if (user && supabase) {
        const [taskRows, groupRows] = await Promise.all([
          supabase.from("tasks").select("*").order("due_at"),
          supabase.from("study_groups").select("id,name,invite_code"),
        ]);
        if (identity.current !== uid) return;
        if (taskRows.error) throw taskRows.error;
        if (groupRows.error) throw groupRows.error;
        setTasks(await rollRepeats(taskRows.data ?? [], user.id));
        setGroups(groupRows.data ?? []);
        setGroupId((current) =>
          groupRows.data?.some((g) => g.id === current)
            ? current
            : (groupRows.data?.[0]?.id ?? ""),
        );
      } else {
        const stored = JSON.parse(
          localStorage.getItem(TASKS_KEY) || "[]",
        ) as Task[];
        setTasks(
          await rollRepeats(
            stored.map((t) => ({
              ...t,
              group_id: t.group_id ?? null,
              repeat_rule: t.repeat_rule ?? "none",
            })),
            null,
          ),
        );
        const demo = localStorage.getItem(DEMO_KEY) === "true";
        setGroups(demo ? [localGroup] : []);
        setGroupId(demo ? localGroup.id : "");
      }
    } catch (e) {
      setLoadError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [ready, user, rollRepeats]);

  useEffect(() => {
    if (!ready) return;
    setLoading(true);
    setTasks([]);
    setGroups([]);
    setGroupId("");
    try {
      setHidden(JSON.parse(localStorage.getItem(hiddenKey(user?.id)) || "[]"));
    } catch {
      setHidden([]);
    }
    void refresh();
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(onFocus, 30000);
    return () => {
      window.removeEventListener("focus", onFocus);
      clearInterval(timer);
    };
  }, [refresh, ready, user?.id]);

  function persistLocal(next: Task[]) {
    localStorage.setItem(TASKS_KEY, JSON.stringify(next));
    setTasks(next);
  }

  /** Push-сервер не будит устройство по заданиям, убранным на нём же. */
  async function syncHidden(ids: string[]) {
    if (!user || !supabase || !("serviceWorker" in navigator)) return;
    const registration = await navigator.serviceWorker.getRegistration();
    const subscription = await registration?.pushManager.getSubscription();
    if (!subscription) return;
    const token = (await supabase.auth.getSession()).data.session?.access_token;
    const response = await fetch("/api/push", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        endpoint: subscription.endpoint,
        hiddenTaskIds: ids,
      }),
    });
    if (!response.ok)
      throw Error(
        "Задание убрано, но настройки push не обновились. Повтори при подключении к сети.",
      );
  }

  async function setHiddenIds(next: string[]) {
    localStorage.setItem(hiddenKey(user?.id), JSON.stringify(next));
    setHidden(next);
    await syncHidden(next);
  }

  async function setCompleted(task: Task, completed: boolean) {
    if (user && supabase) {
      const { error } = await supabase
        .from("tasks")
        .update({ completed })
        .eq("id", task.id);
      if (error) throw error;
      setTasks((prev) =>
        prev.map((t) => (t.id === task.id ? { ...t, completed } : t)),
      );
    } else {
      persistLocal(
        tasksRef.current.map((t) =>
          t.id === task.id ? { ...t, completed } : t,
        ),
      );
    }
  }

  /**
   * «Убрать» ничего не удаляет. Личное задание уходит в архив отметкой
   * completed, общее — только скрывается на этом устройстве, у группы остаётся.
   */
  async function archive(task: Task) {
    try {
      const upcoming =
        isMine(task) && !task.completed
          ? nextDue(task.due_at, task.repeat_rule)
          : null;
      if (upcoming) {
        const previous = task.due_at;
        await updateTask(task.id, { due_at: upcoming.toISOString() });
        toast.success("Готово. Следующее напоминание:", {
          description: fullLabel(upcoming),
          action: {
            label: "Отменить",
            onClick: () =>
              void updateTask(task.id, { due_at: previous }).catch((e) =>
                toast.error(errorText(e)),
              ),
          },
        });
        return;
      }
      if (task.group_id)
        await setHiddenIds([...new Set([...hiddenRef.current, task.id])]);
      else await setCompleted(task, true);
      toast.success(task.group_id ? "Убрано только у тебя" : "В архиве", {
        description: "Задание не удалено — его можно вернуть из архива.",
        action: { label: "Вернуть", onClick: () => void restore(task.id) },
      });
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function restore(id: string) {
    try {
      const task = tasksRef.current.find((t) => t.id === id);
      if (task?.completed) await setCompleted(task, false);
      if (hiddenRef.current.includes(id))
        await setHiddenIds(hiddenRef.current.filter((x) => x !== id));
      toast.success("Задание снова в списке");
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  async function createTask(task: Task) {
    if (user && supabase) {
      const row = { ...task, user_id: user.id };
      const { error } = await supabase.from("tasks").insert(row);
      if (error) throw error;
      setTasks((prev) => [...prev, row]);
    } else {
      persistLocal([...tasksRef.current, task]);
    }
  }

  async function updateTask(id: string, patch: Partial<Task>) {
    if (user && supabase) {
      const { error } = await supabase.from("tasks").update(patch).eq("id", id);
      if (error) throw error;
      setTasks((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    } else {
      persistLocal(
        tasksRef.current.map((t) => (t.id === id ? { ...t, ...patch } : t)),
      );
    }
  }

  /** Единственное безвозвратное действие, и только для своего задания. */
  async function removeTask(id: string) {
    if (user && supabase) {
      const { error } = await supabase.from("tasks").delete().eq("id", id);
      if (error) throw error;
      setTasks((prev) => prev.filter((t) => t.id !== id));
    } else {
      persistLocal(tasksRef.current.filter((t) => t.id !== id));
    }
    if (hiddenRef.current.includes(id))
      await setHiddenIds(hiddenRef.current.filter((x) => x !== id)).catch(
        () => {},
      );
  }

  async function createGroup(name: string) {
    if (!user || !supabase) throw Error(authError || "Облако не подключено");
    const { data, error } = await supabase.rpc("create_study_group", {
      group_name: name,
    });
    if (error) throw error;
    await refresh();
    setGroupId(data.id);
    return data as StudyGroup;
  }

  async function joinGroup(code: string) {
    if (!user || !supabase) throw Error(authError || "Облако не подключено");
    const { data, error } = await supabase.rpc("join_study_group", { code });
    if (error) throw error;
    await refresh();
    setGroupId(data.id);
    return data as StudyGroup;
  }

  function demo() {
    try {
      const next = [
        ...tasksRef.current.filter((t) => t.group_id !== localGroup.id),
        ...exampleTasks(),
      ];
      localStorage.setItem(DEMO_KEY, "true");
      persistLocal(next);
      setGroups([localGroup]);
      setGroupId(localGroup.id);
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  const isMine = (task: Task) =>
    !user || !task.user_id || task.user_id === user.id;

  return {
    user,
    cloud: !!supabase && !!user,
    authError,
    ready,
    loading,
    loadError,
    tasks,
    groups,
    groupId,
    setGroupId,
    hidden,
    isMine,
    archive,
    restore,
    createTask,
    updateTask,
    removeTask,
    refresh,
    createGroup,
    joinGroup,
    demo,
  };
}
