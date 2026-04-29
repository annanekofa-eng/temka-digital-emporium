import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CRYPTOBOT_API_URL = "https://pay.crypt.bot/api";
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
// Business errors are returned with 200 so supabase.functions.invoke surfaces the error message
// instead of the generic "non-2xx status code".
const errRes = (message: string) => jsonRes({ error: message }, 200);

function verifyTg(initData: string, botToken: string): { id: number; first_name?: string; username?: string } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hmac = createHmac("sha256", secretKey).update(dcs).digest("hex");
  if (hmac !== hash) return null;
  const authDate = params.get("auth_date");
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 300) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

function validateTarget(raw: string): string | null {
  const t = String(raw || "").trim().replace(/^@/, "");
  if (!t) return null;
  if (/^\d{4,15}$/.test(t)) return t;
  if (/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(t)) return "@" + t;
  return null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { initData, shopId, productType, targetUser, premiumDuration, starsAmount, paymentMethod } = body || {};
    const payMethod: "balance" | "cryptobot" = paymentMethod === "balance" ? "balance" : "cryptobot";

    if (!shopId || !initData) return errRes("Missing required fields");
    if (productType !== "telegram_premium" && productType !== "telegram_stars") {
      return errRes("Invalid product type");
    }
    const target = validateTarget(targetUser);
    if (!target) return errRes("Введите корректный username или ID");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Load shop and decrypt tokens
    const ek = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!ek) return errRes("Server config error");
    const { data: shop } = await supabase
      .from("shops").select("id, status, owner_id, bot_username, bot_token_encrypted, cryptobot_token_encrypted")
      .eq("id", shopId).maybeSingle();
    if (!shop) return errRes("Shop not found");
    if (shop.status !== "active") return errRes("Магазин временно недоступен");

    const decrypt = async (enc: string | null) => {
      if (!enc) return null;
      const { data } = await supabase.rpc("decrypt_token", { p_encrypted: enc, p_key: ek });
      return data || null;
    };
    const botToken = await decrypt(shop.bot_token_encrypted);
    const cryptoToken = await decrypt(shop.cryptobot_token_encrypted);
    if (!botToken) return errRes("Магазин не сконфигурирован");
    if (payMethod === "cryptobot" && !cryptoToken) {
      return errRes("Оплата картой/криптой временно недоступна. Владелец магазина не настроил CryptoBot.");
    }

    const tgUser = verifyTg(initData, botToken);
    if (!tgUser) return errRes("Invalid authentication");
    const buyerId = tgUser.id;

    // Owner subscription check
    if (shop.owner_id) {
      const { data: owner } = await supabase.from("platform_users")
        .select("subscription_status, subscription_expires_at, subscription_plan").eq("id", shop.owner_id).maybeSingle();
      if (owner && !["active", "trial", "grace_period"].includes(owner.subscription_status)) {
        return errRes("Магазин временно недоступен");
      }
      // Stars/Premium продажа разрешена только владельцам Premium-тарифа
      if (owner && owner.subscription_plan !== "premium") {
        return errRes("Этот магазин недоступен для покупки Stars/Premium");
      }
    }

    // Block check
    const { data: customer } = await supabase.from("shop_customers")
      .select("is_blocked").eq("shop_id", shopId).eq("telegram_id", buyerId).maybeSingle();
    if (customer?.is_blocked) return errRes("Account blocked");

    // Rate limit
    await supabase.from("rate_limits").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString());
    const { count: recent } = await supabase.from("rate_limits").select("id", { count: "exact", head: true })
      .eq("identifier", String(buyerId)).eq("action", "create_auto_order")
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (recent && recent >= 15) return errRes("Слишком много запросов, попробуйте позже");
    await supabase.from("rate_limits").insert({ identifier: String(buyerId), action: "create_auto_order" });

    // Load auto product config
    const { data: ap } = await supabase.from("shop_auto_products" as any)
      .select("*").eq("shop_id", shopId).eq("product_type", productType).eq("is_enabled", true).maybeSingle();
    if (!ap) return errRes("Товар недоступен");

    // Compute amount
    let amount = 0;
    let description = "";
    let extra: { premium_duration?: string; stars_amount?: number } = {};

    if (productType === "telegram_premium") {
      const dur = ["3m", "6m", "12m"].includes(premiumDuration) ? premiumDuration : null;
      if (!dur) return errRes("Выберите срок подписки");
      amount = Number((ap as any)[`price_${dur}`] || 0);
      if (amount <= 0) return errRes("Срок недоступен");
      extra.premium_duration = dur;
      const label = dur === "3m" ? "3 мес" : dur === "6m" ? "6 мес" : "12 мес";
      description = `Telegram Premium (${label}) для ${target}`;
    } else {
      const stars = parseInt(String(starsAmount));
      const min = Number((ap as any).min_stars || 50);
      const max = Number((ap as any).max_stars || 100000);
      if (!Number.isInteger(stars) || stars < min || stars > max) {
        return errRes(`Количество от ${min} до ${max}`);
      }
      const perStar = Number((ap as any).price_per_star || 0);
      if (perStar <= 0) return errRes("Товар недоступен");
      amount = Math.round(stars * perStar * 100) / 100;
      extra.stars_amount = stars;
      description = `${stars} Telegram Stars для ${target}`;
    }

    if (amount <= 0) return errRes("Некорректная сумма");

    // Order number
    const orderNumber = `A-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // Ensure shop_customer exists
    await supabase.rpc("ensure_shop_customer", {
      p_shop_id: shopId, p_telegram_id: buyerId,
      p_first_name: tgUser.first_name || "",
      p_username: tgUser.username || null,
    });

    // ===== Branch A: Pay with balance =====
    if (payMethod === "balance") {
      // Check balance first (cheap pre-check; final check is atomic in RPC)
      const { data: cust } = await supabase.from("shop_customers")
        .select("balance").eq("shop_id", shopId).eq("telegram_id", buyerId).maybeSingle();
      const currentBalance = Number(cust?.balance || 0);
      if (currentBalance < amount) {
        return errRes(`Недостаточно средств на балансе. Доступно: $${currentBalance.toFixed(2)}, нужно: $${amount.toFixed(2)}`);
      }

      // Create order in paid/processing state
      const { data: order, error: orderErr } = await supabase.from("shop_orders").insert({
        order_number: orderNumber,
        buyer_telegram_id: buyerId,
        shop_id: shopId,
        status: "processing",
        payment_status: "paid",
        total_amount: amount,
        currency: "USD",
        payment_method: "balance",
        balance_used: amount,
        product_type: productType,
        target_user: target,
        premium_duration: extra.premium_duration || null,
        stars_amount: extra.stars_amount || null,
        fulfillment_status: "pending",
      }).select().single();

      if (orderErr || !order) {
        console.error("[create-auto-order] balance order insert error:", orderErr);
        return errRes("Failed to create order");
      }

      // Atomically deduct balance
      const { data: newBal, error: balErr } = await supabase.rpc("shop_deduct_balance", {
        p_shop_id: shopId, p_telegram_id: buyerId, p_amount: amount,
      });
      if (balErr) {
        await supabase.from("shop_orders").delete().eq("id", order.id);
        console.error("[create-auto-order] balance deduct error:", balErr);
        return errRes("Недостаточно средств на балансе");
      }

      await supabase.from("shop_balance_history").insert({
        shop_id: shopId, telegram_id: buyerId, amount: -amount, balance_after: Number(newBal || 0),
        type: "purchase", comment: `Заказ ${orderNumber}`, admin_telegram_id: buyerId,
      });

      // Referral reward (idempotent via UNIQUE order_id)
      try {
        await supabase.rpc("shop_credit_referral_for_order", {
          p_shop_id: shopId, p_order_id: order.id,
          p_referred_telegram_id: buyerId, p_order_amount: amount,
        });
      } catch (e) {
        console.error("[create-auto-order] referral error:", e);
      }

      // Compose product line for notifications
      const isPremium = productType === "telegram_premium";
      const durLabel = extra.premium_duration === "3m" ? "3 месяца"
        : extra.premium_duration === "6m" ? "6 месяцев"
        : extra.premium_duration === "12m" ? "12 месяцев" : "";
      const productLine = isPremium
        ? `⭐ <b>Telegram Premium</b> (${durLabel})`
        : `⭐ <b>${extra.stars_amount} Telegram Stars</b>`;

      // Notify buyer via shop bot
      try {
        const buyerMsg =
          `✅ <b>Оплата с баланса подтверждена!</b>\n\n` +
          `📦 Заказ: <code>${orderNumber}</code>\n` +
          `${productLine}\n` +
          `👤 Получатель: <code>${target}</code>\n` +
          `💰 Списано с баланса: $${amount.toFixed(2)}\n` +
          `💳 Остаток: $${Number(newBal || 0).toFixed(2)}\n\n` +
          `⏳ Заказ передан продавцу для исполнения.\n` +
          `Мы уведомим вас, как только товар будет выдан.`;
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: buyerId, text: buyerMsg, parse_mode: "HTML" }),
        }).catch((e) => console.error("[auto-order] notify buyer error:", e));
      } catch (e) { console.error("[auto-order] buyer notify error:", e); }

      // Notify shop owner via the SHOP bot
      try {
        if (shop.owner_id) {
          const { data: owner } = await supabase.from("platform_users")
            .select("telegram_id").eq("id", shop.owner_id).maybeSingle();
          if (owner?.telegram_id && botToken) {
            const ownerMsg =
              `🆕 <b>Новый авто-заказ (с баланса)</b>\n\n` +
              `📦 Заказ: <code>${orderNumber}</code>\n` +
              `${productLine}\n` +
              `👤 Получатель: <code>${target}</code>\n` +
              `💰 Сумма: $${amount.toFixed(2)}\n\n` +
              `⚙️ Откройте раздел «Авто-заказы» в админке магазина, чтобы выдать товар.`;
            try {
              const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ chat_id: owner.telegram_id, text: ownerMsg, parse_mode: "HTML" }),
              });
              if (!r.ok) {
                const t = await r.text();
                console.error("[auto-order] notify owner failed:", r.status, t);
              }
            } catch (e) { console.error("[auto-order] notify owner error:", e); }
          }
        }
      } catch (e) { console.error("[auto-order] owner notify error:", e); }

      return jsonRes({
        orderId: order.id,
        orderNumber,
        paid: true,
        paymentMethod: "balance",
        newBalance: Number(newBal || 0),
      });
    }

    // ===== Branch B: Pay with CryptoBot (existing flow) =====
    // Create order
    const { data: order, error: orderErr } = await supabase.from("shop_orders").insert({
      order_number: orderNumber,
      buyer_telegram_id: buyerId,
      shop_id: shopId,
      status: "pending",
      payment_status: "unpaid",
      total_amount: amount,
      currency: "USD",
      payment_method: "cryptobot",
      product_type: productType,
      target_user: target,
      premium_duration: extra.premium_duration || null,
      stars_amount: extra.stars_amount || null,
      fulfillment_status: "none",
    }).select().single();

    if (orderErr || !order) {
      console.error("[create-auto-order] order insert error:", orderErr);
      return errRes("Failed to create order");
    }

    // Create CryptoBot invoice
    const invoicePayload = { orderId: order.id, orderNumber, telegramUserId: buyerId, shopId, autoOrder: true };
    const resp = await fetch(`${CRYPTOBOT_API_URL}/createInvoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": cryptoToken },
      body: JSON.stringify({
        currency_type: "fiat", fiat: "USD",
        amount: String(amount.toFixed(2)),
        description,
        payload: JSON.stringify(invoicePayload),
        paid_btn_name: "callback",
        paid_btn_url: `https://t.me/${shop.bot_username || ""}`,
      }),
    });
    const data = await resp.json();
    if (!data.ok) {
      await supabase.from("shop_orders").update({ status: "error" }).eq("id", order.id);
      console.error("[create-auto-order] CryptoBot error:", data);
      return errRes(data.error?.name || "Failed to create invoice");
    }

    await supabase.from("shop_orders").update({
      invoice_id: String(data.result.invoice_id),
      pay_url: data.result.pay_url,
      status: "awaiting_payment",
      payment_status: "awaiting",
    }).eq("id", order.id);

    return jsonRes({
      orderId: order.id,
      orderNumber,
      invoiceId: data.result.invoice_id,
      payUrl: data.result.pay_url,
      miniAppUrl: data.result.mini_app_invoice_url,
    });
  } catch (e: any) {
    console.error("[create-auto-order] error:", e?.message || e);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
