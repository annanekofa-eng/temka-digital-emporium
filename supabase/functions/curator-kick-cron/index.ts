// Cron job: kick curator-chat members whose Basic/Premium subscription is no
// longer active. Runs hourly via pg_cron. Idempotent: skips already-kicked
// members and re-tries failed kicks on the next run.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOKEN = Deno.env.get("CURATOR_BOT_TOKEN") || "";
const CHAT_ID = Deno.env.get("CURATOR_CHAT_ID") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const TG = `https://api.telegram.org/bot${TOKEN}`;

function planAllowsChat(plan: string | null | undefined): boolean {
  return plan === "basic" || plan === "premium";
}

async function isStillEntitled(supabase: any, telegramId: number): Promise<boolean> {
  const { data: u } = await supabase
    .from("platform_users")
    .select("subscription_plan, subscription_status, subscription_expires_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!u) return false;
  if (!planAllowsChat(u.subscription_plan)) return false;
  if (!["active", "grace_period"].includes(u.subscription_status)) return false;
  if (u.subscription_expires_at && new Date(u.subscription_expires_at).getTime() < Date.now()) return false;
  return true;
}

async function kick(telegramId: number): Promise<{ ok: boolean; error?: string }> {
  // ban + unban = remove without permanent ban
  try {
    const banRes = await fetch(`${TG}/banChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, user_id: telegramId, revoke_messages: false }),
    });
    const banJson = await banRes.json().catch(() => ({}));
    if (!banJson?.ok) return { ok: false, error: String(banJson?.description || banRes.status) };
    // Unban so they can rejoin later when they renew
    await fetch(`${TG}/unbanChatMember`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, user_id: telegramId, only_if_banned: true }),
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!TOKEN || !CHAT_ID) {
    return new Response(JSON.stringify({ ok: false, reason: "not_configured" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

  // Get all known active members (joined, not yet kicked)
  const { data: members } = await supabase
    .from("curator_chat_members")
    .select("telegram_id")
    .is("kicked_at", null);

  let checked = 0;
  let kicked = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const m of members || []) {
    checked++;
    const stillOk = await isStillEntitled(supabase, m.telegram_id);
    if (stillOk) {
      await supabase
        .from("curator_chat_members")
        .update({ last_checked_at: new Date().toISOString() })
        .eq("telegram_id", m.telegram_id);
      continue;
    }
    const res = await kick(m.telegram_id);
    if (res.ok) {
      kicked++;
      await supabase
        .from("curator_chat_members")
        .update({
          kicked_at: new Date().toISOString(),
          kick_reason: "subscription_expired",
          last_checked_at: new Date().toISOString(),
        })
        .eq("telegram_id", m.telegram_id);
    } else {
      failed++;
      errors.push(`tg=${m.telegram_id}: ${res.error || "unknown"}`);
    }
  }

  return new Response(
    JSON.stringify({ ok: true, checked, kicked, failed, errors: errors.slice(0, 10) }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
  );
});