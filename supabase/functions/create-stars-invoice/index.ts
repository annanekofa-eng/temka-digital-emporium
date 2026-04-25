import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

/** Strip bot tokens from anything we log */
function maskToken(s: string): string {
  return s.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***:***");
}

function verifyAndExtractUser(initData: string, botToken: string): { id: number; first_name: string } | null {
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
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 300) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

async function ensureStarsWebhook(botToken: string, shopId: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const webhookSecret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
  if (!supabaseUrl || !webhookSecret) return;

  const webhookUrl = `${supabaseUrl}/functions/v1/seller-bot-webhook?shop_id=${shopId}`;
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: webhookSecret,
      drop_pending_updates: false,
      allowed_updates: ["message", "callback_query", "pre_checkout_query"],
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data?.ok !== true) {
    console.error("ensureStarsWebhook failed:", maskToken(JSON.stringify(data)));
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { initData, shopId, orderNumber, items, promoCode, balanceUsed: clientBalanceUsed, description } = await req.json();
    if (!shopId) return jsonRes({ error: "shopId is required" }, 400);
    if (!orderNumber || !items?.length) return jsonRes({ error: "Missing required fields" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!encKey) return jsonRes({ error: "Server config error" }, 500);

    // ── Resolve shop and bot token ─────────────────────────────
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
    await ensureStarsWebhook(botToken, shopId);

    // ── Auth via Telegram WebApp initData ──────────────────────
    if (!initData) return jsonRes({ error: "Authentication required" }, 401);
    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Invalid authentication" }, 401);
    const telegramUserId = tgUser.id;

    // ── Verify Stars method is enabled for the shop ────────────
    const { data: starsMethod } = await supabase
      .from("shop_payment_methods")
      .select("enabled, config_masked")
      .eq("shop_id", shopId)
      .eq("method", "stars")
      .maybeSingle();
    if (!starsMethod?.enabled) {
      return jsonRes({ error: "Telegram Stars не подключены для этого магазина" }, 400);
    }
    const usdPerStar = Number((starsMethod.config_masked as any)?.usd_per_star);
    if (!Number.isFinite(usdPerStar) || usdPerStar <= 0) {
      return jsonRes({ error: "Курс Stars не настроен" }, 400);
    }

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
    if (recentRequests && recentRequests >= 15) return jsonRes({ error: "Too many requests" }, 429);
    await supabase.from("rate_limits").insert({ identifier: String(telegramUserId), action: "create_order" });

    // ── Buyer block + balance check ────────────────────────────
    const { data: customer } = await supabase
      .from("shop_customers").select("is_blocked, balance")
      .eq("shop_id", shopId).eq("telegram_id", telegramUserId).maybeSingle();
    if (customer?.is_blocked) return jsonRes({ error: "Account blocked" }, 403);
    const serverBalance = Number(customer?.balance || 0);

    // ── Validate items + compute total ─────────────────────────
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

    // ── USD → Stars (XTR), round up to whole stars ─────────────
    const stars = Math.max(1, Math.ceil(toPayUsd / usdPerStar));
    if (stars > 2_500_000_000) return jsonRes({ error: "Сумма превышает лимит Stars" }, 400);

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
      payment_method: "stars",
    }).select().single();
    if (orderErr || !order) {
      console.error("create-stars-invoice: order insert failed", orderErr);
      return jsonRes({ error: "Failed to create order" }, 500);
    }
    await supabase.from("shop_order_items").insert(validatedItems.map(i => ({
      order_id: order.id, product_id: i.productId, product_name: i.productTitle,
      product_price: i.productPrice, quantity: i.quantity,
    })));

    // ── Create Telegram Stars invoice link ─────────────────────
    // payload max 128 bytes — encode shopId + orderId + balanceUsed
    const invoicePayload = JSON.stringify({
      shopId, orderId: order.id, orderNumber, telegramUserId, balanceUsed, type: "shop_order_stars",
    });
    if (invoicePayload.length > 128) {
      // payload too long, fallback to compact form (orderId only)
      // (orderId is enough; webhook can reload everything from DB)
    }
    const compactPayload = `s_o:${order.id}`;

    const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/createInvoiceLink`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: `Заказ ${orderNumber}`.slice(0, 32),
        description: (description || `Оплата заказа в ${shop.name}`).slice(0, 255),
        payload: compactPayload,                  // we look up the order by this in webhook
        currency: "XTR",
        prices: [{ label: `Заказ ${orderNumber}`.slice(0, 32), amount: stars }],
      }),
    });
    const tgData = await tgRes.json();
    if (!tgData.ok || !tgData.result) {
      // Roll back the order so the user isn't stuck with a phantom 'pending'
      await supabase.from("shop_orders").update({ status: "error" }).eq("id", order.id);
      console.error("createInvoiceLink failed:", maskToken(JSON.stringify(tgData)));
      return jsonRes({ error: "Failed to create Stars invoice" }, 502);
    }

    const invoiceLink = String(tgData.result);
    // Use the slug after the last '/' as a stable invoice identifier for polling
    const invoiceId = invoiceLink.split("/").pop() || invoiceLink;

    await supabase.from("shop_orders").update({
      invoice_id: invoiceId,
      pay_url: invoiceLink,
      status: "awaiting_payment",
      payment_status: "awaiting",
    }).eq("id", order.id);

    return jsonRes({
      invoiceLink,
      invoiceId,
      orderNumber,
      orderId: order.id,
      stars,
      usdPerStar,
    });
  } catch (error) {
    console.error("create-stars-invoice error:", error);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});