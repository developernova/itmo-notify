import { createClient } from "@supabase/supabase-js";
import { supabaseUrl } from "@/lib/env";
const url = supabaseUrl(),
  key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
export const supabase = url && key ? createClient(url, key) : null;
