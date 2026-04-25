import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const XROCKET_API = "https://pay.xrocket.tg/";
const XROCKET_BOT = "xrocket"; // default bot username for pay link

/** Strip secret tokens from logs */
function maskToken(s: string): string {
  return s.replace(/[A-Za-z0-9_-]{32,}/g, "***");
}

function verifyAndExtractUser(initData: string, botToken: string): { id: number } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const entries = Array.from(params.entries());
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hmac = createHmac("sha256", secretKey).update(dcs).digest("hex");
  if (hmac !== hash) return null;
  const authDate = params.get("auth_date");
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 600) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

async function fetchUsdRate(currency: string): Promise<number> {
  // Resolve USD value of 1 unit of `currency` via xrocket-rates function (cached, with fallback).
  const c = currency.toUpperCase();
  if (c === "USDT") return 1;
  try {
    const url = `${Deno.env.get("SUPABASE_URL")}/functions/v1/xrocket-rates`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` } });
    const data = await res.json();
    const r = Number(data?.rates?.[c]);
    if (Number.isFinite(r) && r > 0) return r;
  } catch (e) {
    console.error("fetchUsdRate fallback:", e);
  }
  throw new Error(`Курс для ${c} временно недоступен`);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { initData, shopId, orderNumber, items, promoCode, balanceUsed: clientBalanceUsed, currency, description } = await req.json();
    if (!shopId) return jsonRes({ error: "shopId is required" }, 400);
    if (!orderNumber || !items?.length) return jsonRes({ error: "Missing required fields" }, 400);
    if (!currency || typeof currency !== "string") return jsonRes({ error: "currency is required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!encKey) return jsonRes({ error: "Server config error" }, 500);

    // ── Resolve shop & bot token ───────────────────────────────
    const { data: shop } = await supabase
      .from("shops")
      .select("id, name, status, owner_id, bot_token_encrypted, bot_username")
      .eq("id", shopId)
      .maybeSingle();
    if (!shop) return jsonRes({ error: "Shop not found" }, 404);
    if (shop.status !== "active") return jsonRes({ error: "Магазин временно недоступен для приёма заказов" }, 400);
    if (!shop.bot_token_encrypted) return jsonRes({ error: "Bot not configured" }, 500);

    const { data: botToken } = await supabase.rpc("decrypt_token", { p_encrypted: shop.bot_token_encrypted, p_key: encKey });
    if (!botToken) return jsonRes({ error: "Bot token decryption failed" }, 500);

    // ── Auth via Telegram WebApp initData ──────────────────────
    if (!initData) return jsonRes({ error: "Authentication required" }, 401);
    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Invalid authentication" }, 401);
    const telegramUserId = tgUser.id;

    // ── Verify xRocket method enabled & token configured ───────
    const { data: xrMethod } = await supabase
      .from("shop_payment_methods")
      .select("enabled, config_encrypted, config_masked")
      .eq("shop_id", shopId)
      .eq("method", "xrocket")
      .maybeSingle();
    if (!xrMethod?.enabled || !xrMethod?.config_encrypted) {
      return jsonRes({ error: "xRocket Pay не подключён для этого магазина" }, 400);
    }
    // Принудительно используем только USDT (выбор валюты отключён на фронтенде).
    const cur = "USDT";

    const { data: xrToken } = await supabase.rpc("decrypt_token", { p_encrypted: xrMethod.config_encrypted, p_key: encKey });
    if (!xrToken) return jsonRes({ error: "xRocket token decryption failed" }, 500);

    // ── Owner subscription check ───────────────────────────────
    if (shop.owner_id) {
      const { data: owner } = await supabase
        .from("platform_users")
        .select("subscription_status, subscription_expires_at")
        .eq("id", shop.owner_id)
        .maybeSingle();
      if (!owner || !["active", "trial", "grace_period"].includes(owner.subscription_status)) {
        return jsonRes({ error: "Магазин временно недоступен для приёма заказов" }, 400);
      }
    }

    // ── Rate limit ─────────────────────────────────────────────
    await supabase.from("rate_limits").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString());
    const { count: recentRequests } = await supabase
      .from("rate_limits").select("id", { count: "exact", head: true })
      .eq("identifier", String(telegramUserId)).eq("action", "create_order")
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (recentRequests && recentRequests >= 30) {
      return jsonRes({ error: "Слишком много попыток. Подождите немного и попробуйте снова." }, 429);
    }
    // NOTE: rate-limit slot is consumed only AFTER successful invoice creation (see below)

    // ── Buyer block + balance check ────────────────────────────
    const { data: customer } = await supabase
      .from("shop_customers").select("is_blocked, balance")
      .eq("shop_id", shopId).eq("telegram_id", telegramUserId).maybeSingle();
    if (customer?.is_blocked) return jsonRes({ error: "Account blocked" }, 403);
    const serverBalance = Number(customer?.balance || 0);

    // ── Validate items + compute total (USD) ───────────────────
    let serverTotal = 0;
    const validatedItems: { productId: string; productTitle: string; productPrice: number; quantity: number }[] = [];
    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0 || item.quantity > 100) {
        return jsonRes({ error: "Invalid item data" }, 400);
      }
      const { data: product } = await supabase
        .from("shop_products").select("id, name, price, stock, is_active, shop_id")
        .eq("id", item.productId).single();
      if (!product || !product.is_active || product.shop_id !== shopId) {
        return jsonRes({ error: "Product not found or inactive" }, 400);
      }
      if (product.stock < item.quantity) {
        return jsonRes({ error: `${product.name} — insufficient stock (${product.stock})` }, 400);
      }
      serverTotal += Number(product.price) * item.quantity;
      validatedItems.push({
        productId: product.id, productTitle: product.name,
        productPrice: Number(product.price), quantity: item.quantity,
      });
    }

    // ── Promo (tenant-scoped) ──────────────────────────────────
    let discountAmount = 0;
    let validatedPromoCode: string | null = null;
    if (promoCode) {
      const trimmedCode = String(promoCode).trim().toUpperCase();
      const { data: promo } = await supabase
        .from("shop_promocodes").select("*")
        .eq("shop_id", shopId).ilike("code", trimmedCode)
        .eq("is_active", true).maybeSingle();
      if (promo) {
        const now = new Date().toISOString();
        const isValid =
          (!promo.valid_from || now >= promo.valid_from) &&
          (!promo.valid_until || now <= promo.valid_until) &&
          (promo.max_uses === null || promo.used_count < promo.max_uses);
        if (isValid) {
          let perUserOk = true;
          if (promo.max_uses_per_user) {
            const { count } = await supabase.from("shop_orders").select("id", { count: "exact", head: true })
              .eq("buyer_telegram_id", telegramUserId).eq("shop_id", shopId)
              .ilike("promo_code", trimmedCode).in("payment_status", ["paid", "awaiting"]);
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
      if (!validatedPromoCode) return jsonRes({ error: "Промокод больше недоступен, проверьте заказ" }, 400);
    }

    const totalAfterDiscount = Math.max(0, serverTotal - discountAmount);
    const balanceUsed = Math.min(Math.max(0, Number(clientBalanceUsed) || 0), serverBalance, totalAfterDiscount);
    const toPayUsd = Math.max(0, totalAfterDiscount - balanceUsed);
    if (toPayUsd <= 0) return jsonRes({ error: "Use pay-with-balance endpoint for full balance payments" }, 400);

    // ── USD → crypto amount via dynamic rate ───────────────────
    const usdPerUnit = await fetchUsdRate(cur);
    const cryptoAmount = Number((toPayUsd / usdPerUnit).toFixed(8));
    if (!Number.isFinite(cryptoAmount) || cryptoAmount <= 0) {
      return jsonRes({ error: "Не удалось рассчитать сумму инвойса" }, 500);
    }

    // ── Create shop_order in 'pending' state ───────────────────
    const { data: order, error: orderErr } = await supabase.from("shop_orders").insert({
      order_number: orderNumber,
      buyer_telegram_id: telegramUserId,
      shop_id: shopId,
      status: "pending",
      payment_status: "unpaid",
      total_amount: serverTotal,
      currency: "USD",
      balance_used: balanceUsed,
      discount_amount: discountAmount,
      promo_code: validatedPromoCode,
      payment_method: "xrocket",
    }).select().single();
    if (orderErr || !order) {
      console.error("create-xrocket-invoice: order insert failed", orderErr);
      return jsonRes({ error: "Failed to create order" }, 500);
    }
    await supabase.from("shop_order_items").insert(validatedItems.map(i => ({
      order_id: order.id, product_id: i.productId, product_name: i.productTitle,
      product_price: i.productPrice, quantity: i.quantity,
    })));

    // ── Create xRocket Pay tg-invoice ──────────────────────────
    // Spec: POST /tg-invoices  with header `Rocket-Pay-Key: <token>`
    // Body: { amount, currency, description, payload, numPayments=1, hiddenMessage }
    const xrPayload = JSON.stringify({
      shopId, orderId: order.id, balanceUsed, type: "shop_order_xrocket",
    }).slice(0, 4000);

    const tgRes = await fetch(`${XROCKET_API}tg-invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Rocket-Pay-Key": xrToken,
      },
      body: JSON.stringify({
        amount: cryptoAmount,
        currency: cur,
        description: (description || `Заказ ${orderNumber} в ${shop.name}`).slice(0, 250),
        payload: xrPayload,
        numPayments: 1,
      }),
    });
    const tgData = await tgRes.json().catch(() => ({}));
    if (!tgRes.ok || tgData?.success !== true || !tgData?.data) {
      // Roll back the order so the user isn't stuck with a phantom 'pending'
      await supabase.from("shop_orders").update({ status: "error" }).eq("id", order.id);
      console.error("xRocket createInvoice failed:", tgRes.status, maskToken(JSON.stringify(tgData)));
      const msg = (tgData as any)?.message || (tgData as any)?.errors?.[0]?.message || "Failed to create xRocket invoice";
      return jsonRes({ error: String(msg) }, 502);
    }

    const invoice = tgData.data;
    const invoiceId = String(invoice.id ?? invoice.invoice_id ?? "");
    const payLink = String(invoice.link || invoice.payLink || `https://t.me/${XROCKET_BOT}?start=inv_${invoiceId}`);

    await supabase.from("shop_orders").update({
      invoice_id: invoiceId,
      pay_url: payLink,
      status: "awaiting_payment",
      payment_status: "awaiting",
    }).eq("id", order.id);

    // Consume rate-limit slot only after successful invoice creation,
    // so that aborted/failed attempts don't lock the user out.
    await supabase.from("rate_limits").insert({
      identifier: String(telegramUserId), action: "create_order",
    }).then(() => null, (e) => { console.warn("rate_limits insert failed:", e); });

    return jsonRes({
      invoiceId,
      payUrl: payLink,
      orderNumber,
      orderId: order.id,
      currency: cur,
      cryptoAmount,
      usdPerUnit,
      toPayUsd,
    });
  } catch (error) {
    console.error("create-xrocket-invoice error:", error);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
