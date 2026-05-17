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

function verifyAndExtractUser(initData: string, botToken: string): { id: number; first_name: string } | null {
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
    const { initData, amount, currency, description, orderNumber, items, promoCode, balanceUsed: clientBalanceUsed } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    const cryptobotToken = Deno.env.get("CRYPTOBOT_API_TOKEN");
    const botUsername = Deno.env.get("BOT_USERNAME") || "Tele_Store_Robot";
    if (!botToken) return jsonRes({ error: "Bot not configured" }, 500);
    if (!cryptobotToken) return jsonRes({ error: "Платежи не настроены." }, 500);
    if (!initData) return jsonRes({ error: "Authentication required" }, 401);

    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Invalid authentication" }, 401);
    const telegramUserId = tgUser.id;

    if (!items?.length || !orderNumber) return jsonRes({ error: "Missing required fields" }, 400);

    // Rate limit
    await supabase.from("rate_limits").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString());
    const { count } = await supabase.from("rate_limits").select("id", { count: "exact", head: true })
      .eq("identifier", String(telegramUserId)).eq("action", "create_order")
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (count && count >= 15) return jsonRes({ error: "Too many requests" }, 429);
    await supabase.from("rate_limits").insert({ identifier: String(telegramUserId), action: "create_order" });

    // Blocked + balance
    const { data: profile } = await supabase.from("user_profiles").select("is_blocked, balance").eq("telegram_id", telegramUserId).maybeSingle();
    if ((profile as any)?.is_blocked) return jsonRes({ error: "Account blocked" }, 403);
    const serverBalance = Number(profile?.balance || 0);

    // Validate items (with special-type pricing rules)
    const AUTO_TYPES = new Set(["premium_term", "stars"]);
    let serverTotal = 0;
    let hasAuto = false;
    let hasRegular = false;
    const validatedItems: { productId: string; productTitle: string; productPrice: number; quantity: number; productType: string; recipientUsername: string | null }[] = [];
    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0 || item.quantity > 100)
        return jsonRes({ error: "Invalid item data" }, 400);
      const { data: product } = await supabase.from("products")
        .select("id, title, price, stock, is_active, product_type, term_options, min_qty, max_qty")
        .eq("id", item.productId).single();
      if (!product || !product.is_active) return jsonRes({ error: "Product not found or inactive" }, 400);

      const ptype = String(product.product_type || "simple");
      const isAuto = AUTO_TYPES.has(ptype);
      if (isAuto) hasAuto = true; else hasRegular = true;
      if (!isAuto && product.stock < item.quantity) {
        return jsonRes({ error: `${product.title} — insufficient stock (${product.stock})` }, 400);
      }

      let unitPrice = Number(product.price);
      const clientPrice = Number(item.productPrice);

      if (ptype === "premium_term") {
        const opts = (product.term_options as Array<{ months: number; price: number }>) || [];
        const match = opts.find((o) => Math.abs(Number(o.price) - clientPrice) < 0.01);
        if (!match) return jsonRes({ error: `${product.title} — invalid term price` }, 400);
        unitPrice = Number(match.price);
      } else if (ptype === "stars") {
        const base = Number(product.price);
        const minQty = Math.max(1, Number(product.min_qty) || 1);
        const maxQty = Math.max(minQty, Number(product.max_qty) || 10000);
        const inferredQty = base > 0 ? Math.round(clientPrice / base) : 0;
        if (inferredQty < minQty || inferredQty > maxQty)
          return jsonRes({ error: `${product.title} — invalid stars amount` }, 400);
        const expected = +(inferredQty * base).toFixed(2);
        if (Math.abs(expected - clientPrice) > 0.05)
          return jsonRes({ error: `${product.title} — stars price mismatch` }, 400);
        unitPrice = clientPrice;
      }

      let recipient: string | null = null;
      if (isAuto) {
        const raw = String(item.recipientUsername || "").trim().replace(/^@+/, "");
        if (!/^[A-Za-z0-9_]{5,32}$/.test(raw)) {
          return jsonRes({ error: `${product.title} — укажите корректный @username получателя` }, 400);
        }
        recipient = raw;
      }

      serverTotal += unitPrice * item.quantity;
      validatedItems.push({
        productId: product.id,
        productTitle: item.productTitle || product.title,
        productPrice: unitPrice,
        quantity: item.quantity,
        productType: ptype,
        recipientUsername: recipient,
      });
    }

    if (hasAuto && hasRegular) {
      return jsonRes({ error: "Авто-товары оформляются отдельным заказом" }, 400);
    }

    // Promo
    let discountAmount = 0;
    let validatedPromoCode: string | null = null;
    if (promoCode) {
      const trimmedCode = String(promoCode).trim().toUpperCase();
      const { data: promo } = await supabase.from("promocodes").select("*").eq("code", trimmedCode).eq("is_active", true).maybeSingle();
      if (promo) {
        const now = new Date().toISOString();
        const valid = (!promo.valid_from || now >= promo.valid_from) &&
          (!promo.valid_until || now <= promo.valid_until) &&
          (promo.max_uses === null || promo.used_count < promo.max_uses);
        if (valid) {
          let perUserOk = true;
          if (promo.max_uses_per_user) {
            const { count } = await supabase.from("orders").select("id", { count: "exact", head: true })
              .eq("telegram_id", telegramUserId).eq("promo_code", trimmedCode).in("payment_status", ["paid", "awaiting"]);
            if (count !== null && count >= promo.max_uses_per_user) perUserOk = false;
          }
          if (perUserOk) {
            validatedPromoCode = trimmedCode;
            discountAmount = promo.discount_type === "percent"
              ? serverTotal * (Number(promo.discount_value) / 100)
              : Math.min(Number(promo.discount_value), serverTotal);
          }
        }
      }
      if (!validatedPromoCode) return jsonRes({ error: "Промокод недоступен" }, 400);
    }

    const totalAfterDiscount = Math.max(0, serverTotal - discountAmount);
    const balanceUsed = Math.min(Math.max(0, Number(clientBalanceUsed) || 0), serverBalance, totalAfterDiscount);
    const toPay = Math.max(0, totalAfterDiscount - balanceUsed);
    if (toPay <= 0) return jsonRes({ error: "Use balance-only payment endpoint" }, 400);

    const { data: order, error } = await supabase.from("orders").insert({
      order_number: orderNumber, telegram_id: telegramUserId,
      status: "pending", payment_status: "unpaid", total_amount: serverTotal,
      currency: currency || "USD", discount_amount: discountAmount,
      promo_code: validatedPromoCode, balance_used: balanceUsed,
      is_auto: hasAuto, auto_status: hasAuto ? "pending" : null,
    }).select().single();
    if (error) { console.error("Order error:", error); return jsonRes({ error: "Failed to create order" }, 500); }

    await supabase.from("order_items").insert(validatedItems.map(i => ({
      order_id: order.id, product_id: i.productId, product_title: i.productTitle,
      product_price: i.productPrice, quantity: i.quantity,
      recipient_username: i.recipientUsername,
    })));

    const response = await fetch(`${CRYPTOBOT_API_URL}/createInvoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": cryptobotToken },
      body: JSON.stringify({
        currency_type: "fiat", fiat: "USD",
        amount: String(toPay.toFixed(2)),
        description: description || "Order payment",
        payload: JSON.stringify({ orderId: order.id, orderNumber, telegramUserId, balanceUsed }),
        paid_btn_name: "callback",
        paid_btn_url: `https://t.me/${botUsername}`,
      }),
    });
    const data = await response.json();
    if (!data.ok) {
      await supabase.from("orders").update({ status: "error" }).eq("id", order.id);
      console.error("CryptoBot error:", data);
      return jsonRes({ error: data.error?.name || "Failed to create invoice" }, 400);
    }

    await supabase.from("orders").update({
      invoice_id: String(data.result.invoice_id), pay_url: data.result.pay_url,
      status: "awaiting_payment", payment_status: "awaiting",
    }).eq("id", order.id);

    return jsonRes({
      invoiceId: data.result.invoice_id, payUrl: data.result.pay_url,
      miniAppUrl: data.result.mini_app_invoice_url, orderNumber, orderId: order.id,
    });
  } catch (e) {
    console.error("Invoice error:", e);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
