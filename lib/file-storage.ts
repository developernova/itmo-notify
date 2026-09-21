import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  readdir,
  unlink,
  stat,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Attachment } from "@/lib/attachment-rules";
export const localFiles = () =>
  process.env.NODE_ENV !== "production" &&
  (process.env.S3_DRIVER === "local" || !process.env.S3_ACCESS_KEY_ID);
export const localRoot = () => join(tmpdir(), "srok-attachments");
let localSecret: string | undefined;
async function secret() {
  if (localSecret) return localSecret;
  await mkdir(localRoot(), { recursive: true, mode: 0o700 });
  const path = join(localRoot(), ".secret");
  try {
    await writeFile(path, randomUUID() + randomUUID(), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
  }
  localSecret = await readFile(path, "utf8");
  return localSecret;
}
export function localOwner(req: Request) {
  const match = req.headers
    .get("cookie")
    ?.match(/(?:^|; )srok_files=([a-f0-9-]{36})(?:;|$)/);
  return match?.[1] || null;
}
export async function localRows() {
  await mkdir(localRoot(), { recursive: true, mode: 0o700 });
  const names = await readdir(localRoot());
  return Promise.all(
    names
      .filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))
      .map(
        async (n) =>
          JSON.parse(
            await readFile(join(localRoot(), n), "utf8"),
          ) as Attachment,
      ),
  );
}
export async function saveLocal(row: Attachment) {
  await mkdir(localRoot(), { recursive: true, mode: 0o700 });
  await writeFile(join(localRoot(), row.id + ".json"), JSON.stringify(row), {
    mode: 0o600,
  });
}
export async function removeLocal(id: string) {
  await unlink(join(localRoot(), id + ".json")).catch(() => {});
}
async function localUrl(
  row: Attachment,
  action: "put" | "get",
  inline = false,
) {
  const value = Buffer.from(
    JSON.stringify({ id: row.id, action, exp: Date.now() + 300000, inline }),
  ).toString("base64url");
  const signature = createHmac("sha256", await secret())
    .update(value)
    .digest("base64url");
  return `/api/local-files?token=${value}.${signature}`;
}
export async function verifyLocalToken(token: string) {
  try {
    const [value, sig] = token.split(".");
    const actual = createHmac("sha256", await secret())
      .update(value)
      .digest("base64url");
    if (
      !sig ||
      sig.length !== actual.length ||
      !timingSafeEqual(Buffer.from(sig), Buffer.from(actual))
    )
      return null;
    const data = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      data.exp < Date.now() ||
      !/^[-a-f0-9]{36}$/.test(data.id) ||
      !["get", "put"].includes(data.action)
    )
      return null;
    return data as { id: string; action: string; inline: boolean };
  } catch {
    return null;
  }
}
function s3() {
  if (!process.env.S3_ACCESS_KEY_ID || !process.env.S3_SECRET_ACCESS_KEY)
    throw Error("S3 не настроен");
  return new S3Client({
    region: process.env.S3_REGION || "ru-1",
    endpoint: process.env.S3_ENDPOINT || "https://s3.twcstorage.ru",
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });
}
const bucket = () => process.env.S3_BUCKET || "itmo";
export function disposition(row: Attachment, inline = false) {
  return `${inline ? "inline" : "attachment"}; filename="download"; filename*=UTF-8''${encodeURIComponent(row.name).replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16))}`;
}
export async function uploadUrl(row: Attachment) {
  if (localFiles()) return localUrl(row, "put");
  return getSignedUrl(
    s3(),
    new PutObjectCommand({
      Bucket: bucket(),
      Key: row.object_key,
      ContentType: row.content_type,
      ContentLength: row.size_bytes,
    }),
    {
      expiresIn: 300,
      signableHeaders: new Set(["content-type", "content-length"]),
    },
  );
}
export async function downloadUrl(row: Attachment, inline = false) {
  if (localFiles()) return localUrl(row, "get", inline);
  return getSignedUrl(
    s3(),
    new GetObjectCommand({
      Bucket: bucket(),
      Key: row.object_key,
      ResponseContentDisposition: disposition(row, inline),
      ResponseContentType: row.content_type,
    }),
    { expiresIn: 300 },
  );
}
export async function objectSize(row: Attachment) {
  if (localFiles())
    return (await stat(join(localRoot(), row.id + ".blob"))).size;
  const head = await s3().send(
    new HeadObjectCommand({ Bucket: bucket(), Key: row.object_key }),
  );
  if (head.ContentType !== row.content_type)
    throw Error("Тип файла не совпадает");
  return head.ContentLength;
}
export async function removeObject(row: Attachment) {
  if (localFiles()) {
    await unlink(join(localRoot(), row.id + ".blob")).catch((e) => {
      if (e.code !== "ENOENT") throw e;
    });
  } else
    await s3().send(
      new DeleteObjectCommand({ Bucket: bucket(), Key: row.object_key }),
    );
}
