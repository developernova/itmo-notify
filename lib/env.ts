/**
 * Корень проекта Supabase. В дашборде рядом лежит RESTful-адрес с /rest/v1 —
 * его копируют по ошибке, и клиент потом стучится в /rest/v1/auth/v1. Режем хвост.
 */
export function supabaseUrl() {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL || "")
    .trim()
    .replace(/\/(rest|auth|storage|realtime)\/v\d+\/?$/, "")
    .replace(/\/+$/, "");
}
