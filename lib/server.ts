import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";
import { supabaseUrl } from "@/lib/env";
export function admin() {
  const url = supabaseUrl(),
    key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw Error("Supabase не настроен");
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
export function pushClient() {
  const pub = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    priv = process.env.VAPID_PRIVATE_KEY,
    subject = process.env.VAPID_SUBJECT;
  if (!pub || !priv || !subject) throw Error("Web Push не настроен");
  webpush.setVapidDetails(subject, pub, priv);
  return webpush;
}
export async function authenticate(request: Request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer /, "");
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  return error ? null : data.user;
}
export async function deliver(
  userId: string,
  payload: { tag?: string; title: string; body: string },
) {
  const db = admin(),
    client = pushClient();
  const { data, error } = await db
    .from("push_subscriptions")
    .select("*")
    .eq("user_id", userId);
  if (error) throw error;
  let sent = 0;
  for (const row of data ?? []) {
    if (payload.tag && row.hidden_task_ids?.includes(payload.tag)) continue;
    try {
      await client.sendNotification(row.subscription, JSON.stringify(payload), {
        TTL: 3600,
      });
      sent++;
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode;
      if (status === 410 || status === 404)
        await db.from("push_subscriptions").delete().eq("id", row.id);
      else throw e;
    }
  }
  return sent;
}
