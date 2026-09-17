import { timingSafeEqual } from "node:crypto";
import { admin, deliver } from "@/lib/server";
export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  const supplied = req.headers.get("authorization") || "";
  const expected = `Bearer ${secret}`;
  if (
    !secret ||
    Buffer.byteLength(supplied) !== Buffer.byteLength(expected) ||
    !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))
  )
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const db = admin();
    const { data, error } = await db.rpc("claim_reminders");
    if (error) throw error;
    let sent = 0,
      failed = 0;
    for (const task of data ?? []) {
      try {
        const { data: current } = await db
          .from("tasks")
          .select("completed,due_at,reminder_minutes,notification_claimed_at")
          .eq("id", task.task_id)
          .single();
        if (
          !current ||
          current.completed ||
          current.due_at !== task.due_at ||
          current.reminder_minutes !== task.reminder_minutes
        )
          continue;
        const count = await deliver(task.user_id, {
          title: task.title,
          body: `${task.subject} · срок ${new Date(task.due_at).toLocaleString("ru-RU", { timeZone: "Europe/Moscow", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" })} МСК`,
          tag: task.task_id,
        });
        if (!count) throw Error("No subscriptions");
        const { error: updateError } = await db
          .from("reminder_deliveries")
          .update({
            sent_at: new Date().toISOString(),
            claimed_at: null,
          })
          .eq("task_id", task.task_id)
          .eq("user_id", task.user_id)
          .eq("claimed_at", task.claimed_at);
        if (updateError) throw updateError;
        sent++;
      } catch {
        failed++;
        await db
          .from("reminder_deliveries")
          .update({ claimed_at: null })
          .eq("task_id", task.task_id)
          .eq("user_id", task.user_id)
          .eq("claimed_at", task.claimed_at);
      }
    }
    // Сдвиг повторов — после рассылки: текущее напоминание уже ушло.
    const { data: rolled } = await db.rpc("roll_repeating_tasks");
    return Response.json({ sent, failed, rolled: rolled ?? null });
  } catch {
    return Response.json(
      { error: "Reminder processing failed" },
      { status: 500 },
    );
  }
}
export const POST = GET;
