import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CRYPTOBOT_API_URL = "https://pay.crypt.bot/api";
const MIN_TOPUP = 0.1;
const MAX_TOPUP = 1000;

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
    const { initData, amount } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const cryptobotToken = Deno.env.get("CRYPTOBOT_API_TOKEN");
    const botUsername = Deno.env.get("BOT_USERNAME") || "Tele_Store_Robot";
    if (!botToken) return new Response(JSON.stringify({ error: "Бот не настроен." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!cryptobotToken) return new Response(JSON.stringify({ error: "Платёжная система не настроена." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    if (!initData) return new Response(JSON.stringify({ error: "Откройте приложение через Telegram" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return new Response(JSON.stringify({ error: "Ошибка авторизации." }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    const telegramUserId = tgUser.id;

    const num = Number(amount);
    if (!num || num < MIN_TOPUP || num > MAX_TOPUP || !isFinite(num))
      return new Response(JSON.stringify({ error: `Сумма должна быть от $${MIN_TOPUP} до $${MAX_TOPUP}` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    await supabase.from("rate_limits").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString());
    const { count } = await supabase.from("rate_limits").select("id", { count: "exact", head: true })
      .eq("identifier", String(telegramUserId)).eq("action", "topup")
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (count && count >= 10) return new Response(JSON.stringify({ error: "Слишком много запросов." }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    await supabase.from("rate_limits").insert({ identifier: String(telegramUserId), action: "topup" });

    const { data: profile } = await supabase.from("user_profiles").select("is_blocked").eq("telegram_id", telegramUserId).maybeSingle();
    if ((profile as any)?.is_blocked) return new Response(JSON.stringify({ error: "Ваш аккаунт заблокирован" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const response = await fetch(`${CRYPTOBOT_API_URL}/createInvoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": cryptobotToken },
      body: JSON.stringify({
        currency_type: "fiat", fiat: "USD",
        amount: String(num.toFixed(2)),
        description: `Пополнение баланса на $${num.toFixed(2)}`,
        payload: JSON.stringify({ type: "topup", telegramUserId, amount: num }),
        paid_btn_name: "callback", paid_btn_url: `https://t.me/${botUsername}`,
      }),
    });
    const data = await response.json();
    if (!data.ok) return new Response(JSON.stringify({ error: `Ошибка платёжной системы (${data.error?.name || "UNKNOWN"}).` }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    return new Response(JSON.stringify({ invoiceId: data.result.invoice_id, payUrl: data.result.pay_url, miniAppUrl: data.result.mini_app_invoice_url, amount: data.result.amount }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e) {
    console.error("[topup] error:", e);
    return new Response(JSON.stringify({ error: "Внутренняя ошибка сервера." }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
