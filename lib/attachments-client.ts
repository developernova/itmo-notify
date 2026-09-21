import { supabase } from "@/lib/supabase";
import { validateFile } from "@/lib/attachment-rules";
export async function attachmentApi(init: RequestInit = {}, query = "") {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  const r = await fetch("/api/attachments" + query, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    credentials: "same-origin",
  });
  const data = await r.json();
  if (!r.ok) throw Error(data.error || "Ошибка загрузки");
  return data;
}
export async function uploadAttachment(
  taskId: string,
  file: File,
  onProgress?: (n: number) => void,
) {
  validateFile(file.name, file.size);
  const reservation = await attachmentApi({
    method: "POST",
    body: JSON.stringify({ taskId, name: file.name, size: file.size }),
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", reservation.url);
      xhr.setRequestHeader("Content-Type", reservation.contentType);
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable)
          onProgress?.(Math.round((e.loaded / e.total) * 100));
      };
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(
              Error("Загрузка не удалась. Проверь подключение и CORS бакета."),
            );
      xhr.onerror = () => reject(Error("Ошибка сети при загрузке файла"));
      xhr.timeout = 120000;
      xhr.ontimeout = () =>
        reject(Error("Загрузка заняла слишком много времени"));
      xhr.send(file);
    });
    await attachmentApi({
      method: "PATCH",
      body: JSON.stringify({ id: reservation.id }),
    });
  } catch (e) {
    await attachmentApi({
      method: "DELETE",
      body: JSON.stringify({ id: reservation.id }),
    }).catch(() => {});
    throw e;
  }
}
