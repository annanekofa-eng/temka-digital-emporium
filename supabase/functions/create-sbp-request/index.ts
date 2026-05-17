// Create SBP (RUB) payment request. Builds order in awaiting state, inserts a
// row into sbp_requests for manual moderation, and notifies admins via TG.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function verifyAndExtractUser(initData: string, botToken: string) {
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

async function fetchUsdtRubRate(): Promise<number> {
  const token = Deno.env.get("CRYPTOBOT_API_TOKEN");
  if (token) {
    try {
      const r = await fetch("https://pay.crypt.bot/api/getExchangeRates", {
        headers: { "Crypto-Pay-API-Token": token },
      });
      const j = await r.json();
      const row = j?.result?.find((x: any) => x.source === "USDT" && x.target === "RUB" && x.is_valid);
      if (row?.rate) return Number(row.rate);
    } catch (_) { /* fall through */ }
  }
  return 95;
}

async function notifyAdmins(text: string) {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  const ids = (Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!botToken || !ids.length) return;
  for (const id of ids) {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: id, text, parse_mode: "HTML" }),
      });
    } catch (_) { /* ignore */ }
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { initData, type, amount, orderNumber, items, promoCode, balanceUsed, receiptUrl, comment } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return jsonRes({ error: "Bot not configured" }, 500);
    if (!initData) return jsonRes({ error: "Authentication required" }, 401);

    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Invalid authentication" }, 401);
    const telegramUserId = tgUser.id;

    const reqType = type === "topup" ? "topup" : "order";

    // Rate limit
    await supabase.from("rate_limits").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString());
    const { count } = await supabase.from("rate_limits").select("id", { count: "exact", head: true })
      .eq("identifier", String(telegramUserId)).eq("action", "create_sbp")
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (count && count >= 10) return jsonRes({ error: "Too many requests" }, 429);
    await supabase.from("rate_limits").insert({ identifier: String(telegramUserId), action: "create_sbp" });

    const { data: profile } = await supabase.from("user_profiles").select("is_blocked, balance")
      .eq("telegram_id", telegramUserId).maybeSingle();
    if ((profile as any)?.is_blocked) return jsonRes({ error: "Account blocked" }, 403);

    const rate = await fetchUsdtRubRate();
    let amountUsd = 0;
    let orderId: string | null = null;

    if (reqType === "order") {
      if (!items?.length || !orderNumber) return jsonRes({ error: "Missing required fields" }, 400);
      const serverBalance = Number(profile?.balance || 0);

      let serverTotal = 0;
      const validated: { productId: string; productTitle: string; productPrice: number; quantity: number }[] = [];
      for (const item of items) {
        if (!item.productId || !item.quantity || item.quantity <= 0 || item.quantity > 100)
          return jsonRes({ error: "Invalid item data" }, 400);
        const { data: product } = await supabase.from("products")
          .select("id, title, price, stock, is_active, product_type, term_options, min_qty, max_qty")
          .eq("id", item.productId).single();
        if (!product || !product.is_active) return jsonRes({ error: "Product not found or inactive" }, 400);
        if (product.stock < item.quantity) return jsonRes({ error: `${product.title} — insufficient stock` }, 400);

        let unitPrice = Number(product.price);
        const clientPrice = Number(item.productPrice);
        const ptype = String(product.product_type || "simple");
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
          unitPrice = clientPrice;
        }
        serverTotal += unitPrice * item.quantity;
        validated.push({ productId: product.id, productTitle: item.productTitle || product.title, productPrice: unitPrice, quantity: item.quantity });
      }

      // Promo
      let discountAmount = 0;
      let validatedPromo: string | null = null;
      if (promoCode) {
        const code = String(promoCode).trim().toUpperCase();
        const { data: promo } = await supabase.from("promocodes").select("*").eq("code", code).eq("is_active", true).maybeSingle();
        if (promo) {
          const now = new Date().toISOString();
          const valid = (!promo.valid_from || now >= promo.valid_from) &&
            (!promo.valid_until || now <= promo.valid_until) &&
            (promo.max_uses === null || promo.used_count < promo.max_uses);
          if (valid) {
            validatedPromo = code;
            discountAmount = promo.discount_type === "percent"
              ? serverTotal * (Number(promo.discount_value) / 100)
              : Math.min(Number(promo.discount_value), serverTotal);
          }
        }
        if (!validatedPromo) return jsonRes({ error: "Промокод недоступен" }, 400);
      }

      const totalAfterDiscount = Math.max(0, serverTotal - discountAmount);
      const balUsed = Math.min(Math.max(0, Number(balanceUsed) || 0), serverBalance, totalAfterDiscount);
      amountUsd = Math.max(0, totalAfterDiscount - balUsed);
      if (amountUsd <= 0) return jsonRes({ error: "Nothing to pay via SBP" }, 400);

      const { data: order, error } = await supabase.from("orders").insert({
        order_number: orderNumber, telegram_id: telegramUserId,
        status: "awaiting_payment", payment_status: "awaiting",
        total_amount: serverTotal, currency: "USD",
        discount_amount: discountAmount, promo_code: validatedPromo, balance_used: balUsed,
        notes: "SBP (RUB) — ручная модерация",
      }).select().single();
      if (error) return jsonRes({ error: "Failed to create order" }, 500);
      orderId = order.id;

      await supabase.from("order_items").insert(validated.map(i => ({
        order_id: order.id, product_id: i.productId, product_title: i.productTitle,
        product_price: i.productPrice, quantity: i.quantity,
      })));
    } else {
      // Topup
      const amt = Number(amount);
      if (!amt || amt < 0.1) return jsonRes({ error: "Invalid amount" }, 400);
      amountUsd = +amt.toFixed(2);
    }

    const amountRub = Math.ceil(amountUsd * rate);

    const { data: sbp, error: sbpErr } = await supabase.from("sbp_requests").insert({
      telegram_id: telegramUserId,
      order_id: orderId,
      type: reqType,
      amount_usd: amountUsd,
      amount_rub: amountRub,
      rate,
      receipt_url: receiptUrl ? String(receiptUrl).slice(0, 1000) : null,
      comment: comment ? String(comment).slice(0, 500) : null,
      status: "pending",
    }).select("id").single();
    if (sbpErr) return jsonRes({ error: "Failed to create request" }, 500);

    const userMark = tgUser.username ? `@${tgUser.username}` : tgUser.first_name || `id ${telegramUserId}`;
    const lines = [
      `📨 <b>Новая заявка СБП</b>`,
      `Тип: ${reqType === "topup" ? "💰 Пополнение" : "🛒 Заказ"}`,
      `Сумма: <b>${amountRub} ₽</b> (≈ ${amountUsd.toFixed(2)}$, курс ${rate.toFixed(2)})`,
      `Покупатель: ${userMark} (id ${telegramUserId})`,
      orderId ? `Заказ: <code>${orderNumber}</code>` : "",
      receiptUrl ? `Чек: ${String(receiptUrl).slice(0, 200)}` : "",
      comment ? `Коммент: ${String(comment).slice(0, 200)}` : "",
    ].filter(Boolean).join("\n");
    notifyAdmins(lines).catch(() => {});

    return jsonRes({
      ok: true,
      requestId: sbp.id,
      amountRub,
      amountUsd,
      rate,
      orderNumber: reqType === "order" ? orderNumber : undefined,
    });
  } catch (e) {
    console.error("SBP request error:", e);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
