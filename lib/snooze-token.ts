import { createHmac, timingSafeEqual } from "node:crypto";
function sign(value: string) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw Error("Missing cron secret");
  return createHmac("sha256", secret)
    .update("srok:snooze:v1:" + value)
    .digest("base64url");
}
export function makeSnoozeToken(userId: string, taskId: string) {
  const value = Buffer.from(
    JSON.stringify({ userId, taskId, exp: Date.now() + 86400000 }),
  ).toString("base64url");
  return `${value}.${sign(value)}`;
}
export function readSnoozeToken(token: string) {
  try {
    const [value, signature] = token.split(".");
    const actual = sign(value);
    if (
      !signature ||
      signature.length !== actual.length ||
      !timingSafeEqual(Buffer.from(signature), Buffer.from(actual))
    )
      return null;
    const data = JSON.parse(Buffer.from(value, "base64url").toString());
    if (
      data.exp < Date.now() ||
      typeof data.userId !== "string" ||
      typeof data.taskId !== "string"
    )
      return null;
    return data as { userId: string; taskId: string };
  } catch {
    return null;
  }
}
