import { admin, authenticate, accessibleTask } from "@/lib/server";
import { readSnoozeToken } from "@/lib/snooze-token";
import { nextEvening } from "@/lib/personal-reminders";
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const signed =
      typeof body.token === "string" ? readSnoozeToken(body.token) : null;
    const userId = signed?.userId || (await authenticate(req))?.id;
    const taskId = signed?.taskId || body.taskId;
    if (!userId)
      return Response.json(
        { error: "Войдите снова, чтобы отложить напоминание" },
        { status: 401 },
      );
    const task = await accessibleTask(userId, taskId);
    if (!task || task.completed)
      return Response.json({ error: "Задание недоступно" }, { status: 404 });
    const until = nextEvening().toISOString();
    const { error } = await admin()
      .from("task_reminder_preferences")
      .upsert(
        { task_id: taskId, user_id: userId, snooze_until: until },
        { onConflict: "task_id,user_id" },
      );
    if (error) throw error;
    return Response.json({ until });
  } catch {
    return Response.json(
      { error: "Не удалось отложить напоминание" },
      { status: 500 },
    );
  }
}
