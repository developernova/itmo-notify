import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { admin, authenticate, accessibleTask } from "@/lib/server";
import { supabaseUrl } from "@/lib/env";
import { Attachment, validateFile, MAX_FILES } from "@/lib/attachment-rules";
import {
  localFiles,
  localOwner,
  localRows,
  saveLocal,
  removeLocal,
  uploadUrl,
  downloadUrl,
  objectSize,
  removeObject,
} from "@/lib/file-storage";
export const runtime = "nodejs";
const uuid = (value: unknown): value is string =>
  typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);
async function identity(req: Request) {
  if (localFiles()) return localOwner(req) || null;
  return (await authenticate(req))?.id || null;
}
async function find(id: string) {
  if (localFiles()) return (await localRows()).find((x) => x.id === id);
  const { data, error } = await admin()
    .from("task_attachments")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data as Attachment | null;
}
async function mayRead(user: string, row: Attachment) {
  return localFiles()
    ? row.user_id === user
    : row.task_id && (await accessibleTask(user, row.task_id));
}
export async function GET(req: Request) {
  try {
    const taskId = new URL(req.url).searchParams.get("task");
    if (!uuid(taskId))
      return Response.json({ error: "Неверное задание" }, { status: 400 });
    const user = await identity(req);
    if (!user) {
      if (localFiles()) return Response.json({ files: [], local: true });
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!localFiles() && !(await accessibleTask(user, taskId)))
      return Response.json({ error: "Нет доступа" }, { status: 403 });
    let files: Attachment[];
    if (localFiles())
      files = (await localRows()).filter(
        (r) =>
          r.task_id === taskId && r.user_id === user && r.status === "ready",
      );
    else {
      const { data, error } = await admin()
        .from("task_attachments")
        .select("*")
        .eq("task_id", taskId)
        .eq("status", "ready")
        .order("created_at");
      if (error) throw error;
      files = data;
    }
    const result = await Promise.all(
      files.map(async (row) => ({
        id: row.id,
        name: row.name,
        content_type: row.content_type,
        size_bytes: row.size_bytes,
        url: await downloadUrl(row),
        preview_url: ["image/jpeg", "image/png", "image/webp"].includes(
          row.content_type,
        )
          ? await downloadUrl(row, true)
          : undefined,
      })),
    );
    return Response.json(
      { files: result, local: localFiles() },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return Response.json(
      { error: "Не удалось загрузить вложения" },
      { status: 500 },
    );
  }
}
export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!uuid(body.taskId))
      return Response.json({ error: "Неверное задание" }, { status: 400 });
    let mime: string;
    try {
      mime = validateFile(body.name, body.size);
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
    let row: Attachment;
    let owner = await identity(req);
    if (localFiles()) {
      owner ||= randomUUID();
      const existing = await localRows();
      if (
        existing.filter(
          (r) =>
            r.task_id === body.taskId &&
            r.user_id === owner &&
            r.status !== "deleting",
        ).length >= MAX_FILES
      )
        return Response.json(
          { error: "Не больше 6 файлов на задание" },
          { status: 400 },
        );
      if (
        existing
          .filter((r) => r.user_id === owner)
          .reduce((sum, r) => sum + r.size_bytes, 0) +
          body.size >
        209715200
      )
        return Response.json(
          { error: "Лимит вложений: 200 МБ" },
          { status: 400 },
        );
      const id = randomUUID();
      row = {
        id,
        task_id: body.taskId,
        user_id: owner,
        object_key: id,
        name: body.name,
        content_type: mime,
        size_bytes: body.size,
        status: "pending",
        created_at: new Date().toISOString(),
      };
      await saveLocal(row);
    } else {
      if (!owner)
        return Response.json({ error: "Unauthorized" }, { status: 401 });
      const client = createClient(
        supabaseUrl(),
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
        {
          global: {
            headers: { Authorization: req.headers.get("authorization")! },
          },
          auth: { persistSession: false },
        },
      );
      const { data, error } = await client.rpc("reserve_attachment", {
        target: body.taskId,
        file_name: body.name,
        mime,
        bytes: body.size,
      });
      if (error)
        return Response.json({ error: error.message }, { status: 403 });
      row = data;
    }
    const url = await uploadUrl(row);
    return Response.json(
      { id: row.id, url, contentType: mime },
      {
        headers: localFiles()
          ? {
              "Set-Cookie": `srok_files=${owner}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
            }
          : {},
      },
    );
  } catch {
    return Response.json(
      { error: "Хранилище недоступно. Проверь настройки S3." },
      { status: 500 },
    );
  }
}
export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    if (!uuid(body.id))
      return Response.json({ error: "Invalid ID" }, { status: 400 });
    const user = await identity(req),
      row = await find(body.id);
    if (!user || !row || row.user_id !== user || !(await mayRead(user, row)))
      return Response.json({ error: "Нет доступа" }, { status: 403 });
    if (row.status === "ready") return Response.json({ ok: true });
    if (row.status !== "pending")
      return Response.json({ error: "Загрузка отменена" }, { status: 409 });
    if ((await objectSize(row)) !== row.size_bytes) {
      await removeObject(row);
      throw Error("Size mismatch");
    }
    if (localFiles()) await saveLocal({ ...row, status: "ready" });
    else {
      const { error } = await admin()
        .from("task_attachments")
        .update({ status: "ready" })
        .eq("id", row.id)
        .eq("status", "pending");
      if (error) throw error;
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json(
      { error: "Файл не загружен полностью. Повтори загрузку." },
      { status: 400 },
    );
  }
}
export async function DELETE(req: Request) {
  try {
    const body = await req.json();
    if (!uuid(body.id))
      return Response.json({ error: "Invalid ID" }, { status: 400 });
    const user = await identity(req),
      row = await find(body.id);
    if (!user || !row || row.user_id !== user || !(await mayRead(user, row)))
      return Response.json({ error: "Нет доступа" }, { status: 403 });
    if (localFiles()) {
      await removeObject(row);
      await removeLocal(row.id);
    } else {
      const { error } = await admin()
        .from("task_attachments")
        .update({ status: "deleting" })
        .eq("id", row.id);
      if (error) throw error;
      await removeObject(row);
    }
    return Response.json({ ok: true });
  } catch {
    return Response.json({ error: "Не удалось удалить файл" }, { status: 500 });
  }
}
