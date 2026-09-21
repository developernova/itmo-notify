import { admin } from "@/lib/server";
import { removeObject } from "@/lib/file-storage";
export async function cleanupAttachments() {
  const db = admin();
  const { data, error } = await db
    .from("task_attachments")
    .select("*")
    .lt("created_at", new Date(Date.now() - 3600000).toISOString())
    .or("status.eq.pending,status.eq.deleting,task_id.is.null")
    .limit(20);
  if (error) throw error;
  for (const row of data || []) {
    await removeObject(row);
    const { error } = await db
      .from("task_attachments")
      .delete()
      .eq("id", row.id);
    if (error) throw error;
  }
}
