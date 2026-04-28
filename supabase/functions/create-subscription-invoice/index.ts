import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CRYPTOBOT_API_URL = "https://pay.crypt.bot/api";
const PLATFORM_NAME = "TeleStore";
const ALLOWED_MONTHS = [1, 3, 6, 12];
const ALLOWED_PLANS = ['start', 'basic', 'premium'] as const;
type Plan = typeof ALLOWED_PLANS[number];

const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function verifyAndExtractUser(initData: string, botToken: string): { id: number } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const entries = Array.from(params.entries());
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  if (createHmac("sha256", secretKey).update(dcs).digest("hex") !== hash) return null;
  const authDate = params.get("auth_date");
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 300) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

// ─── Subscription Settings (same as platform-bot) ──
interface SubSettings {
  standard_price_usd: number;
  early_price_usd: number;
  early_slots_limit: number;
}

const SUB_DEFAULTS: SubSettings = {
  standard_price_usd: 5,
  early_price_usd: 3,
  early_slots_limit: 10,
};

async function getSubSettings(supabase: any): Promise<SubSettings> {
  const { data: rows } = await supabase.from("shop_settings").select("key, value").like("key", "sub_%");
  const map: Record<string, string> = {};
  for (const r of rows || []) map[r.key] = r.value;
  const g = (k: string, def: number) => { const v = map[`sub_${k}`]; return v != null ? parseFloat(v) : def; };
  return {
    standard_price_usd: g("standard_price_usd", SUB_DEFAULTS.standard_price_usd),
    early_price_usd: g("early_price_usd", SUB_DEFAULTS.early_price_usd),
    early_slots_limit: g("early_slots_limit", SUB_DEFAULTS.early_slots_limit),
  };
}

async function getPlanPrice(supabase: any, plan: Plan): Promise<{ price: number; enabled: boolean }> {
  const { data: row } = await supabase.from("tariff_prices").select("price_usd, is_enabled").eq("plan", plan).maybeSingle();
  if (!row) return { price: 0, enabled: false };
  return { price: Number(row.price_usd) || 0, enabled: !!row.is_enabled };
}

function monthsLabel(m: number): string {
  if (m === 1) return "1 мес";
  return `${m} мес`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { initData, useBalance, promoCode, months: rawMonths, plan: rawPlan } = await req.json();
    if (!initData) return jsonRes({ error: "Откройте приложение через Telegram" }, 401);

    const months = ALLOWED_MONTHS.includes(Number(rawMonths)) ? Number(rawMonths) : 1;
    const plan: Plan = ALLOWED_PLANS.includes(rawPlan as Plan) ? (rawPlan as Plan) : 'start';

    const botToken = Deno.env.get("PLATFORM_BOT_TOKEN");
    if (!botToken) return jsonRes({ error: "Бот не настроен" }, 500);

    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Ошибка авторизации" }, 401);
    const telegramId = tgUser.id;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Rate limiting
    await supabase.from("rate_limits").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString());
    const { count: recentReqs } = await supabase.from("rate_limits").select("id", { count: "exact", head: true })
      .eq("identifier", String(telegramId)).eq("action", "sub_invoice").gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (recentReqs && recentReqs >= 10) return jsonRes({ error: "Слишком много запросов" }, 429);
    await supabase.from("rate_limits").insert({ identifier: String(telegramId), action: "sub_invoice" });

    // Get platform user
    const { data: pUser } = await supabase.from("platform_users").select("id, subscription_status, subscription_expires_at, balance, billing_price_usd, pricing_tier, first_paid_at, subscription_plan")
      .eq("telegram_id", telegramId).maybeSingle();
    if (!pUser) return jsonRes({ error: "Пользователь не найден" }, 404);

    // Check if pricing/subscriptions are enabled
    const { data: pricingRow } = await supabase.from("shop_settings").select("value").eq("key", "sub_pricing_enabled").maybeSingle();
    if (pricingRow?.value === "false") return jsonRes({ error: "Оформление подписки временно недоступно" }, 400);

    // Blocked users cannot renew
    if (pUser.subscription_status === "blocked") return jsonRes({ error: "Подписка заблокирована. Обратитесь в поддержку." }, 400);

    // Calculate price (per month * months) based on selected plan
    const planPrice = await getPlanPrice(supabase, plan);
    if (!planPrice.enabled) return jsonRes({ error: "Этот тариф сейчас недоступен" }, 400);
    if (planPrice.price <= 0) return jsonRes({ error: "Цена тарифа не задана" }, 400);
    const monthlyPrice = planPrice.price;
    const subscriptionPrice = Math.round(monthlyPrice * months * 100) / 100;
    const totalDays = months * 30;

    // Validate promo
    let discountAmount = 0;
    let validatedPromoCode: string | null = null;
    let promoId: string | null = null;
    if (promoCode) {
      const { data: promoResult } = await supabase.rpc("validate_platform_subscription_promo", { p_code: promoCode, p_telegram_id: telegramId });
      if (promoResult?.valid) {
        validatedPromoCode = promoResult.code;
        promoId = promoResult.id;
        if (promoResult.discount_type === "percent") {
          discountAmount = Math.round(subscriptionPrice * promoResult.discount_value / 100 * 100) / 100;
        } else {
          discountAmount = Math.min(promoResult.discount_value, subscriptionPrice);
        }
      }
    }

    const afterDiscount = Math.max(0, subscriptionPrice - discountAmount);
    
    // Calculate balance usage
    let balanceUsed = 0;
    const userBalance = Number(pUser.balance) || 0;
    if (useBalance && userBalance > 0) {
      balanceUsed = Math.min(userBalance, afterDiscount);
    }

    const finalAmount = Math.max(0, afterDiscount - balanceUsed);

    // Create subscription_payment record
    const { data: payment, error: payError } = await supabase.from("subscription_payments").insert({
      user_id: pUser.id,
      amount: subscriptionPrice,
      promo_code: validatedPromoCode,
      discount_amount: discountAmount,
      final_amount: finalAmount,
      status: finalAmount === 0 ? "paid" : "pending",
    }).select("id").single();
    if (payError || !payment) return jsonRes({ error: `Ошибка создания платежа: ${payError?.message || "unknown"}` }, 500);

    // NOTE: Promo usage is NOT incremented here. It's only incremented after confirmed payment.

    // If fully covered by discount + balance
    if (finalAmount === 0) {
      // Deduct balance if used
      if (balanceUsed > 0) {
        const { data: newBal, error: balErr } = await supabase.rpc("platform_deduct_balance", { p_telegram_id: telegramId, p_amount: balanceUsed });
        if (!balErr) {
          await supabase.from("platform_balance_history").insert({
            telegram_id: telegramId, amount: -balanceUsed, balance_after: newBal,
            type: "subscription", comment: `Подписка ${PLATFORM_NAME} (${monthsLabel(months)})`,
          });
        }
      }

      // Activate subscription — preserve remaining days
      const currentExpiry = pUser.subscription_expires_at ? new Date(pUser.subscription_expires_at).getTime() : 0;
      const baseDate = Math.max(currentExpiry, Date.now());
      const expiresAt = new Date(baseDate + totalDays * 24 * 60 * 60 * 1000).toISOString();
      const previousPlan = (pUser as any)?.subscription_plan || null;
      await supabase.from("platform_users").update({
        subscription_status: "active", subscription_expires_at: expiresAt,
        subscription_plan: plan,
        current_period_end: expiresAt,
        billing_price_usd: monthlyPrice, pricing_tier: plan,
        first_paid_at: pUser.first_paid_at || new Date().toISOString(),
        reminder_sent_at: null, expiry_notified_at: null, updated_at: new Date().toISOString(),
      }).eq("telegram_id", telegramId);

      // Increment promo usage after confirmed payment
      if (promoId && validatedPromoCode) {
        await supabase.rpc("increment_platform_promo_usage", {
          p_promo_id: promoId, p_telegram_id: telegramId, p_payment_id: payment.id, p_discount_amount: discountAmount,
        });
      }

      // Reactivate paused shops
      const { data: shops } = await supabase.from("shops").select("id").eq("owner_id", pUser.id).eq("status", "paused");
      for (const shop of shops || []) {
        await supabase.from("shops").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", shop.id);
      }

      // Mark payment as paid
      await supabase.from("subscription_payments").update({ status: "paid" }).eq("id", payment.id);

      // Notify
      const platformBotToken = Deno.env.get("PLATFORM_BOT_TOKEN");
      if (platformBotToken) {
        const planLabel = plan === 'premium' ? '💎 Премиум' : plan === 'basic' ? '⭐ Базовый' : '🚀 Старт';
        let msg = `✅ <b>Подписка ${pUser.subscription_status === 'active' ? 'продлена' : 'активирована'}!</b>\n\n${planLabel}\n📅 Действует до: ${new Date(expiresAt).toLocaleDateString("ru")}\n💰 Стоимость: $${subscriptionPrice.toFixed(2)} (${monthsLabel(months)})`;
        if (discountAmount > 0) msg += `\n🎫 Скидка: -$${discountAmount.toFixed(2)}`;
        if (balanceUsed > 0) msg += `\n💳 С баланса: -$${balanceUsed.toFixed(2)}`;
        try {
          await fetch(`https://api.telegram.org/bot${platformBotToken}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: telegramId, text: msg, parse_mode: "HTML" }),
          });
        } catch {}
      }

      // Deliver paid content (basic/premium) — call cryptobot-webhook helper inline via direct logic
      try {
        const eligible: string[] = [];
        if (plan === 'basic' || plan === 'premium') eligible.push('basic');
        if (plan === 'premium') eligible.push('premium');
        if (eligible.length > 0 && platformBotToken) {
          const { data: items } = await supabase.from('paid_content')
            .select('id, title, body').in('plan', eligible).eq('is_active', true).order('sort_order', { ascending: true });
          for (const it of items || []) {
            const { data: ex } = await supabase.from('paid_content_logs').select('id').eq('telegram_id', telegramId).eq('content_id', it.id).maybeSingle();
            if (ex) continue;
            let ok = false; let err = '';
            try {
              const r = await fetch(`https://api.telegram.org/bot${platformBotToken}/sendMessage`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: telegramId, text: `🎁 <b>${it.title}</b>\n\n${it.body}`, parse_mode: 'HTML', disable_web_page_preview: true }),
              });
              const j = await r.json().catch(() => ({})); ok = !!j?.ok; if (!ok) err = String(j?.description || r.status);
            } catch (e: any) { err = e?.message || 'send error'; }
            await supabase.from('paid_content_logs').insert({ telegram_id: telegramId, content_id: it.id, status: ok ? 'sent' : 'failed', error: ok ? null : err });
          }
        }
      } catch (e) { console.error('paid_content delivery error:', e); }

      return jsonRes({
        status: "paid",
        subscriptionStatus: "active",
        expiresAt,
        balanceUsed,
        discountAmount,
        finalAmount: 0,
        months,
        plan,
      });
    }

    // Create CryptoBot invoice for remaining amount
    const cryptobotToken = Deno.env.get("CRYPTOBOT_API_TOKEN");
    if (!cryptobotToken) return jsonRes({ error: "Платёжная система не настроена" }, 500);

    const botInfo = await fetch(`https://api.telegram.org/bot${botToken}/getMe`).then(r => r.json());

    const invoiceRes = await fetch(`${CRYPTOBOT_API_URL}/createInvoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": cryptobotToken },
      body: JSON.stringify({
        currency_type: "fiat", fiat: "USD",
        amount: finalAmount.toFixed(2),
        description: `Подписка ${PLATFORM_NAME} ${plan} (${monthsLabel(months)})${validatedPromoCode ? ` [промо: ${validatedPromoCode}]` : ""}`,
        payload: JSON.stringify({
          type: "subscription",
          paymentId: payment.id,
          telegramUserId: telegramId,
          balanceUsed,
          subscriptionPrice,
          tier: plan,
          plan,
          months,
        }),
        paid_btn_name: "callback",
        paid_btn_url: `https://t.me/${botInfo.result?.username || "bot"}`,
      }),
    }).then(r => r.json());

    if (!invoiceRes.ok) return jsonRes({ error: `Ошибка CryptoBot: ${invoiceRes.error?.name || "unknown"}` }, 400);

    const invoice = invoiceRes.result;
    await supabase.from("subscription_payments").update({
      invoice_id: String(invoice.invoice_id), status: "awaiting",
    }).eq("id", payment.id);

    return jsonRes({
      status: "awaiting",
      invoiceId: String(invoice.invoice_id),
      payUrl: invoice.pay_url,
      miniAppUrl: invoice.mini_app_invoice_url,
      paymentId: payment.id,
      finalAmount,
      balanceUsed,
      discountAmount,
      subscriptionPrice,
      months,
    });
  } catch (error) {
    console.error("[create-subscription-invoice] error:", error);
    return jsonRes({ error: "Внутренняя ошибка сервера" }, 500);
  }
});
