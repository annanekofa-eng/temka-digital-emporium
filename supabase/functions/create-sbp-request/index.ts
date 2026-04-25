import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

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
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 600) return null;
  try {
    return JSON.parse(params.get("user") || "");
  } catch {
    return null;
  }
}

async function resolveShopBotToken(supabase: any, shopId: string): Promise<string | null> {
  const ek = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!ek) return null;
  const { data: shop } = await supabase.from("shops").select("bot_token_encrypted").eq("id", shopId).maybeSingle();
  if (!shop?.bot_token_encrypted) return null;
  const { data } = await supabase.rpc("decrypt_token", { p_encrypted: shop.bot_token_encrypted, p_key: ek });
  return data || null;
}

function decodeBase64Payload(input: string): Uint8Array {
  const pure = input.includes(",") ? input.split(",").pop() || "" : input;
  const binary = atob(pure);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Upload photo to Telegram via sendPhoto and return file_id */
async function uploadReceiptToTelegram(
  botToken: string,
  chatId: number,
  photoBytes: Uint8Array,
  mime: string,
  fileName: string,
  caption: string,
): Promise<string | null> {
  const form = new FormData();
  form.append("chat_id", String(chatId));
  form.append("photo", new Blob([photoBytes], { type: mime }), fileName);
  form.append("caption", caption);
  form.append("parse_mode", "HTML");

  const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
    method: "POST",
    body: form,
  });
  const data = await res.json();
  if (!data.ok || !data.result?.photo?.length) return null;
  const photos = data.result.photo;
  return photos[photos.length - 1].file_id;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const {
      initData,
      shopId,
      orderNumber,
      items,
      promoCode,
      balanceUsed,
      amountUsd,
      amountRub,
      receiptBase64,
      receiptMime,
      receiptFileName,
      description,
    } = body || {};

    if (!initData || !shopId || !orderNumber || !Array.isArray(items) || !items.length) {
      return jsonRes({ error: "Missing required fields" }, 400);
    }
    if (!receiptBase64) return jsonRes({ error: "Receipt file required" }, 400);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const botToken = await resolveShopBotToken(supabase, shopId);
    if (!botToken) return jsonRes({ error: "Bot not configured" }, 500);

    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Invalid authentication" }, 401);
    const telegramUserId = tgUser.id;

    const { data: shop } = await supabase.from("shops").select("id, status, owner_id, name").eq("id", shopId).maybeSingle();
    if (!shop || shop.status !== "active") return jsonRes({ error: "Shop is not active" }, 400);

    const { data: method } = await supabase
      .from("shop_payment_methods")
      .select("enabled")
      .eq("shop_id", shopId)
      .eq("method", "sbp_card")
      .maybeSingle();
    if (!method?.enabled) return jsonRes({ error: "SBP payment method is disabled" }, 400);

    let serverTotal = 0;
    const validatedItems: { productId: string; productTitle: string; productPrice: number; quantity: number }[] = [];

    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0 || item.quantity > 100) {
        return jsonRes({ error: "Invalid item data" }, 400);
      }

      const { data: product } = await supabase
        .from("shop_products")
        .select("id, name, price, stock, is_active, shop_id")
        .eq("id", item.productId)
        .single();

      if (!product || !product.is_active || product.shop_id !== shopId) {
        return jsonRes({ error: "Product not found or inactive" }, 400);
      }
      if (product.stock < item.quantity) {
        return jsonRes({ error: `${product.name} — insufficient stock (${product.stock})` }, 400);
      }

      serverTotal += Number(product.price) * item.quantity;
      validatedItems.push({
        productId: product.id,
        productTitle: product.name,
        productPrice: Number(product.price),
        quantity: item.quantity,
      });
    }

    let discountAmount = 0;
    let validatedPromoCode: string | null = null;
    if (promoCode) {
      const trimmedCode = String(promoCode).trim().toUpperCase();
      const { data: promo } = await supabase
        .from("shop_promocodes")
        .select("*")
        .eq("shop_id", shopId)
        .ilike("code", trimmedCode)
        .eq("is_active", true)
        .maybeSingle();

      if (promo) {
        const now = new Date().toISOString();
        const isValid =
          (!promo.valid_from || now >= promo.valid_from) &&
          (!promo.valid_until || now <= promo.valid_until) &&
          (promo.max_uses === null || promo.used_count < promo.max_uses);

        if (isValid) {
          validatedPromoCode = trimmedCode;
          discountAmount =
            promo.discount_type === "percent"
              ? serverTotal * (Number(promo.discount_value) / 100)
              : Math.min(Number(promo.discount_value), serverTotal);
        }
      }
    }

    if (promoCode && !validatedPromoCode) {
      return jsonRes({ error: "Промокод больше недоступен, проверьте заказ" }, 400);
    }

    const totalAfterDiscount = Math.max(0, serverTotal - discountAmount);

    const { data: customer } = await supabase
      .from("shop_customers")
      .select("is_blocked, balance")
      .eq("shop_id", shopId)
      .eq("telegram_id", telegramUserId)
      .maybeSingle();

    if (customer?.is_blocked) return jsonRes({ error: "Account blocked" }, 403);

    const serverBalance = Number(customer?.balance || 0);
    const safeBalanceUsed = Math.min(Math.max(0, Number(balanceUsed) || 0), serverBalance, totalAfterDiscount);
    const toPay = Math.max(0, totalAfterDiscount - safeBalanceUsed);

    if (toPay <= 0) {
      return jsonRes({ error: "Use pay-with-balance endpoint for full balance payments" }, 400);
    }

    const { data: order, error: orderError } = await supabase
      .from("shop_orders")
      .insert({
        order_number: orderNumber,
        buyer_telegram_id: telegramUserId,
        shop_id: shopId,
        status: "awaiting_payment",
        payment_status: "pending_verification",
        total_amount: serverTotal,
        currency: "USD",
        balance_used: safeBalanceUsed,
        discount_amount: discountAmount,
        promo_code: validatedPromoCode,
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error("[create-sbp-request] create order error", orderError);
      return jsonRes({ error: "Failed to create order" }, 500);
    }

    await supabase.from("shop_order_items").insert(
      validatedItems.map((i) => ({
        order_id: order.id,
        product_id: i.productId,
        product_name: i.productTitle,
        product_price: i.productPrice,
        quantity: i.quantity,
      })),
    );

    // Upload receipt photo to Telegram via the owner and get file_id
    const fileBytes = decodeBase64Payload(String(receiptBase64));
    const contentType = receiptMime || "image/jpeg";
    const fileName = receiptFileName || "receipt.jpg";
    let receiptFileId: string | null = null;

    if (shop.owner_id) {
      const { data: pUser } = await supabase.from("platform_users").select("telegram_id").eq("id", shop.owner_id).maybeSingle();
      if (pUser?.telegram_id) {
        const caption =
          `🧾 <b>Новая заявка на оплату</b>\n\n` +
          `🏪 Магазин: <b>${shop.name || shopId}</b>\n` +
          `📦 Заказ: <code>${order.order_number}</code>\n` +
          `👤 TG: <code>${telegramUserId}</code>\n` +
          `💰 Сумма: <b>$${Number(toPay).toFixed(2)}</b>\n\n` +
          `Откройте /admin → Заявки для проверки.`;

        receiptFileId = await uploadReceiptToTelegram(botToken, pUser.telegram_id, fileBytes, contentType, fileName, caption);
      }
    }

    if (!receiptFileId) {
      const form = new FormData();
      form.append("chat_id", String(telegramUserId));
      form.append("photo", new Blob([fileBytes], { type: contentType }), fileName);
      form.append("disable_notification", "true");
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: "POST", body: form });
      const rd = await res.json();
      if (rd.ok && rd.result?.photo?.length) {
        receiptFileId = rd.result.photo[rd.result.photo.length - 1].file_id;
        await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: telegramUserId, message_id: rd.result.message_id }),
        }).catch(() => {});
      }
    }

    const { data: requestRow, error: reqErr } = await supabase
      .from("shop_payment_requests")
      .insert({
        shop_id: shopId,
        order_id: order.id,
        buyer_telegram_id: telegramUserId,
        payment_method: "sbp_card",
        amount_usd: Number(toPay.toFixed(2)),
        amount_rub: amountRub ? Number(amountRub) : null,
        status: "pending",
        receipt_url: null,
        receipt_path: receiptFileId || null,
        receipt_mime: contentType,
        note: description || null,
      })
      .select("id")
      .single();

    if (reqErr || !requestRow) {
      console.error("[create-sbp-request] request insert error", reqErr);
      return jsonRes({ error: "Failed to create payment request" }, 500);
    }

    return jsonRes({
      ok: true,
      orderId: order.id,
      orderNumber: order.order_number,
      requestId: requestRow.id,
      status: "pending",
      paymentStatus: "pending_verification",
      amountUsd: Number(toPay.toFixed(2)),
      amountRub: amountRub ? Number(amountRub) : null,
      amountRequestedUsd: amountUsd ? Number(amountUsd) : Number(toPay.toFixed(2)),
    });
  } catch (error) {
    console.error("create-sbp-request error:", error);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});