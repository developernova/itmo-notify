import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  localFiles,
  localRoot,
  localRows,
  localOwner,
  verifyLocalToken,
  disposition,
} from "@/lib/file-storage";
export const runtime = "nodejs";
async function check(req: Request, action: string) {
  if (!localFiles()) return null;
  const signed = await verifyLocalToken(
    new URL(req.url).searchParams.get("token") || "",
  );
  if (!signed || signed.action !== action) return null;
  const row = (await localRows()).find(
    (r) => r.id === signed.id && r.user_id === localOwner(req),
  );
  if (!row) return null;
  return { row, signed };
}
export async function PUT(req: Request) {
  const data = await check(req, "put");
  if (!data || data.row.status !== "pending")
    return new Response("Forbidden", { status: 403 });
  if (!req.body) return new Response("Empty", { status: 400 });
  const reader = req.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > data.row.size_bytes) {
      await reader.cancel();
      return new Response("Too large", { status: 413 });
    }
    chunks.push(value);
  }
  if (size !== data.row.size_bytes)
    return new Response("Size mismatch", { status: 400 });
  await writeFile(
    join(localRoot(), data.row.id + ".blob"),
    Buffer.concat(chunks),
    { mode: 0o600 },
  );
  return new Response(null, { status: 200 });
}
export async function GET(req: Request) {
  const data = await check(req, "get");
  if (!data || data.row.status !== "ready")
    return new Response("Forbidden", { status: 403 });
  try {
    const file = await readFile(join(localRoot(), data.row.id + ".blob"));
    return new Response(file, {
      headers: {
        "Content-Type": data.row.content_type,
        "Content-Disposition": disposition(data.row, data.signed.inline),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
