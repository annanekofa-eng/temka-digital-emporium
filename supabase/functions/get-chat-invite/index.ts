import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function verifyAndExtractUser(initData: string, botToken: string): { id: number } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  if (createHmac("sha256", secretKey).update(dcs).digest("hex") !== hash) return null;
  const authDate = params.get("auth_date");
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 300) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { initData } = await req.json().catch(() => ({}));
    if (!initData) return jsonRes({ error: "Откройте через Telegram" }, 401);

    const botToken = Deno.env.get("PLATFORM_BOT_TOKEN");
    if (!botToken) return jsonRes({ error: "Бот не настроен" }, 500);

    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Ошибка авторизации" }, 401);
    const telegramId = tgUser.id;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Rate limit: 5 requests / 10 min
    await supabase.from("rate_limits").delete().lt("created_at", new Date(Date.now() - 600_000).toISOString());
    const { count } = await supabase.from("rate_limits").select("id", { count: "exact", head: true })
      .eq("identifier", String(telegramId)).eq("action", "chat_invite")
      .gte("created_at", new Date(Date.now() - 600_000).toISOString());
    if (count && count >= 5) return jsonRes({ error: "Слишком много запросов. Подождите." }, 429);
    await supabase.from("rate_limits").insert({ identifier: String(telegramId), action: "chat_invite" });

    // Check entitlement
    const { data: entitled } = await supabase.rpc("has_entitlement", { p_telegram_id: telegramId, p_feature: "private_chat" });
    if (!entitled) return jsonRes({ error: "Доступ к закрытому чату только для тарифов Плюс и Премиум" }, 403);

    // Reuse existing invite for this user — 1 link per user, navсегда.
    // Старые ссылки специально НЕ протухают, чтобы по обновлённой ссылке
    // не заходили посторонние, которым она когда-то «утекла».
    const { data: existing } = await supabase.from("chat_invites")
      .select("id, invite_link, expires_at")
      .eq("telegram_id", telegramId)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (existing?.invite_link) {
      return jsonRes({ inviteLink: existing.invite_link, expiresAt: existing.expires_at });
    }

    // Get private chat id
    const { data: chatRow } = await supabase.from("platform_settings").select("value").eq("key", "private_chat_id").maybeSingle();
    const chatId = (chatRow?.value || "").trim();
    if (!chatId) return jsonRes({ error: "Закрытый чат не настроен. Обратитесь к администратору." }, 503);

    // Persistent one-time link: без expire_date, member_limit=1.
    // Telegram сам инвалидирует ссылку после одного успешного входа.
    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/createChatInviteLink`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        member_limit: 1,
        name: `u${telegramId}`.slice(0, 32),
      }),
    });
    const tgJson = await tgRes.json().catch(() => ({}));
    if (!tgJson?.ok || !tgJson?.result?.invite_link) {
      console.error("[get-chat-invite] TG error:", tgJson);
      return jsonRes({ error: `Не удалось создать ссылку: ${tgJson?.description || "ошибка Telegram"}` }, 502);
    }

    const inviteLink = tgJson.result.invite_link as string;
    // Сохраняем символический «срок действия» далеко в будущем — колонка NOT NULL.
    const expiresAt = new Date(Date.now() + 365 * 24 * 3600 * 1000 * 10).toISOString();

    await supabase.from("chat_invites").insert({
      telegram_id: telegramId, invite_link: inviteLink, expires_at: expiresAt, used: false,
    });

    return jsonRes({ inviteLink, expiresAt });
  } catch (e: any) {
    console.error("[get-chat-invite] error:", e?.message || e);
    return jsonRes({ error: "Внутренняя ошибка" }, 500);
  }
});