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
    const { initData, shopId, description } = await req.json().catch(() => ({}));
    if (!initData) return jsonRes({ error: "Откройте через Telegram" }, 401);
    if (!shopId) return jsonRes({ error: "shopId обязателен" }, 400);
    if (!description || typeof description !== "string" || description.trim().length < 10 || description.length > 2000) {
      return jsonRes({ error: "Опишите запрос (10–2000 символов)" }, 400);
    }

    const botToken = Deno.env.get("PLATFORM_BOT_TOKEN");
    if (!botToken) return jsonRes({ error: "Бот не настроен" }, 500);
    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Ошибка авторизации" }, 401);
    const telegramId = tgUser.id;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const { data: entitled } = await supabase.rpc("has_entitlement", { p_telegram_id: telegramId, p_feature: "shop_customization" });
    if (!entitled) return jsonRes({ error: "Кастомизация доступна только на Премиум" }, 403);

    const { data: pUser } = await supabase.from("platform_users").select("id").eq("telegram_id", telegramId).maybeSingle();
    if (!pUser?.id) return jsonRes({ error: "Пользователь не найден" }, 404);
    const { data: shop } = await supabase.from("shops").select("id, owner_id, name").eq("id", shopId).maybeSingle();
    if (!shop || shop.owner_id !== pUser.id) return jsonRes({ error: "Магазин не найден или не ваш" }, 403);

    // Rate limit: 3/day
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();
    const { count } = await supabase.from("customization_requests").select("id", { count: "exact", head: true })
      .eq("owner_telegram_id", telegramId).gte("created_at", since);
    if (count && count >= 3) return jsonRes({ error: "Лимит 3 заявки в сутки" }, 429);

    const { data: created, error } = await supabase.from("customization_requests").insert({
      shop_id: shopId, owner_telegram_id: telegramId,
      description: description.trim(), status: "pending",
    }).select("id").single();
    if (error) return jsonRes({ error: error.message }, 500);

    // Notify curator (если настроен) — best-effort
    try {
      const { data: curatorRow } = await supabase.from("platform_settings").select("value").eq("key", "global_curator_username").maybeSingle();
      const adminIds = (Deno.env.get("ADMIN_TELEGRAM_IDS") || "").split(",").map(s => s.trim()).filter(Boolean);
      const text = `🛠 <b>Заявка на кастомизацию</b>\nМагазин: ${shop.name}\nОт: @${tgUser.id}\nКуратор: @${curatorRow?.value || "не назначен"}\n\n${description.trim().slice(0, 500)}`;
      for (const aid of adminIds) {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: aid, text, parse_mode: "HTML" }),
        }).catch(() => {});
      }
    } catch {}

    return jsonRes({ ok: true, id: created.id });
  } catch (e: any) {
    console.error("[submit-customization-request] error:", e?.message || e);
    return jsonRes({ error: "Внутренняя ошибка" }, 500);
  }
});