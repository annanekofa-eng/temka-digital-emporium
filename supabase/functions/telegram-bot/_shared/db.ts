import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function getSetting(key: string, fallback = ""): Promise<string> {
  const { data } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as string) ?? fallback;
}

export async function writeAuditLog(
  adminTelegramId: number,
  action: string,
  target: string | null,
  meta: Record<string, unknown> = {},
) {
  try {
    await supabase.from("admin_log").insert({
      admin_telegram_id: adminTelegramId,
      action,
      target,
      meta,
    });
  } catch (e) {
    console.error("[audit] insert failed:", e);
  }
}
