import { supabase } from "@/lib/supabase";
export async function api(path: string, init: RequestInit = {}) {
  const token = (await supabase?.auth.getSession())?.data.session?.access_token;
  if (!token) throw Error("Для этого нужно подключение к облаку");
  const r = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
      Authorization: `Bearer ${token}`,
    },
  });
  const result = await r.json();
  if (!r.ok) throw Error(result.error || "Не удалось выполнить запрос");
  return result;
}
