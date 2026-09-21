export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_FILES = 6;
export const fileTypes: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  txt: "text/plain",
  zip: "application/zip",
};
export type Attachment = {
  id: string;
  task_id: string | null;
  user_id: string | null;
  object_key: string;
  name: string;
  content_type: string;
  size_bytes: number;
  status: "pending" | "ready" | "deleting";
  created_at: string;
  url?: string;
  preview_url?: string;
};
export function validateFile(name: string, size: number) {
  const ext = name.split(".").pop()?.toLowerCase() || "";
  if (!name || name.length > 180 || /[\x00-\x1f]/.test(name))
    throw Error("Слишком длинное или недопустимое имя файла");
  if (!Number.isInteger(size) || size < 1 || size > MAX_FILE_SIZE)
    throw Error("Файл должен быть не больше 10 МБ");
  if (!fileTypes[ext])
    throw Error("Поддерживаются фото, PDF, Office, TXT и ZIP");
  return fileTypes[ext];
}
export const fileAccept = Object.keys(fileTypes)
  .map((ext) => "." + ext)
  .join(",");
export const sizeLabel = (bytes: number) =>
  bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} МБ`
    : `${Math.ceil(bytes / 1024)} КБ`;
