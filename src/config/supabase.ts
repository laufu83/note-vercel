import { createClient } from "@supabase/supabase-js";
import { Env } from "../types/env";
export function createSupabase(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    throw new Error("请配置 SUPABASE_URL 和 SUPABASE_SERVICE_KEY 环境变量");
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY!);
}