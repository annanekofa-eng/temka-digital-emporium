import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Fallback if CryptoBot rate API is unavailable.
const USD_RUB_RATE_FALLBACK = 80;

async function fetchUsdRubRate(): Promise<number> {
  const token = Deno.env.get("CRYPTOBOT_API_TOKEN");
  if (!token) return USD_RUB_RATE_FALLBACK;
  for (const base of ["https://pay.crypt.bot/api", "https://testnet-pay.crypt.bot/api"]) {
    try {
      const res = await fetch(`${base}/getExchangeRates`, {
        headers: { "Crypto-Pay-API-Token": token },
        signal: AbortSignal.timeout(4000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const row = data?.result?.find(
        (r: any) => r.source === "USDT" && r.target === "RUB" && r.is_valid,
      );
      const v = Number(row?.rate);
      if (Number.isFinite(v) && v > 30 && v < 500) return v;
    } catch { /* try next */ }
  }
  return USD_RUB_RATE_FALLBACK;
}

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
    const { initData, orderNumber, items, promoCode } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return jsonRes({ error: "Bot not configured" }, 500);
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

    // Profile
    const { data: profile } = await supabase.from("user_profiles").select("is_blocked").eq("telegram_id", telegramUserId).maybeSingle();
    if ((profile as any)?.is_blocked) return jsonRes({ error: "Account blocked" }, 403);

    // Validate items — SBP forbidden for auto-products (stars/premium)
    const AUTO_TYPES = new Set(["premium_term", "stars"]);
    let serverTotal = 0;
    const validatedItems: { productId: string; productTitle: string; productPrice: number; quantity: number }[] = [];
    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0 || item.quantity > 100)
        return jsonRes({ error: "Invalid item data" }, 400);
      const { data: product } = await supabase.from("products")
        .select("id, title, price, stock, is_active, product_type")
        .eq("id", item.productId).single();
      if (!product || !product.is_active) return jsonRes({ error: "Product not found or inactive" }, 400);
      const ptype = String(product.product_type || "simple");
      if (AUTO_TYPES.has(ptype)) {
        return jsonRes({ error: "СБП недоступен для Stars / Premium — используйте баланс или CryptoBot" }, 400);
      }
      if (product.stock < item.quantity) {
        return jsonRes({ error: `${product.title} — insufficient stock (${product.stock})` }, 400);
      }
      const unitPrice = Number(product.price);
      serverTotal += unitPrice * item.quantity;
      validatedItems.push({
        productId: product.id, productTitle: product.title,
        productPrice: unitPrice, quantity: item.quantity,
      });
    }

    // Promo — atomic claim under row lock
    let discountAmount = 0;
    let validatedPromoCode: string | null = null;
    if (promoCode) {
      const trimmedCode = String(promoCode).trim().toUpperCase();
      const { data: claim, error: claimErr } = await supabase.rpc("try_claim_promo", {
        p_code: trimmedCode,
        p_telegram_id: telegramUserId,
      });
      if (claimErr || !claim?.ok) {
        return jsonRes({ error: "Промокод недоступен" }, 400);
      }
      validatedPromoCode = trimmedCode;
      discountAmount = claim.discount_type === "percent"
        ? serverTotal * (Number(claim.discount_value) / 100)
        : Math.min(Number(claim.discount_value), serverTotal);
    }

    const totalAfterDiscount = Math.max(0, serverTotal - discountAmount);
    const amountRub = Math.round(totalAfterDiscount * USD_RUB_RATE);

    // Create order (awaiting SBP payment)
    const { data: order, error } = await supabase.from("orders").insert({
      order_number: orderNumber, telegram_id: telegramUserId,
      status: "pending", payment_status: "awaiting",
      total_amount: serverTotal, currency: "USD",
      discount_amount: discountAmount, promo_code: validatedPromoCode,
      balance_used: 0, notes: "Оплата СБП",
    }).select().single();
    if (error) {
      if (validatedPromoCode) await supabase.rpc("release_promo", { p_code: validatedPromoCode });
      return jsonRes({ error: "Failed to create order" }, 500);
    }

    await supabase.from("order_items").insert(validatedItems.map((i) => ({
      order_id: order.id, product_id: i.productId, product_title: i.productTitle,
      product_price: i.productPrice, quantity: i.quantity,
    })));

    const { data: payment, error: pErr } = await supabase.from("sbp_payments").insert({
      order_id: order.id, telegram_id: telegramUserId,
      amount_usd: totalAfterDiscount, amount_rub: amountRub, rate: USD_RUB_RATE,
      status: "awaiting_receipt",
    }).select().single();
    if (pErr) {
      if (validatedPromoCode) await supabase.rpc("release_promo", { p_code: validatedPromoCode });
      return jsonRes({ error: "Failed to create payment" }, 500);
    }

    // Load current requisites
    const { data: requisites } = await supabase.from("sbp_requisites").select("*").eq("key", "current").maybeSingle();

    return jsonRes({
      orderId: order.id,
      orderNumber: order.order_number,
      paymentId: payment.id,
      amountUsd: totalAfterDiscount,
      amountRub,
      rate: USD_RUB_RATE,
      requisites: {
        bank: requisites?.bank || "",
        card: requisites?.card || "",
        holderName: requisites?.holder_name || "",
        phone: requisites?.phone || "",
      },
    });
  } catch (e) {
    console.error("create-sbp-order error:", e);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
