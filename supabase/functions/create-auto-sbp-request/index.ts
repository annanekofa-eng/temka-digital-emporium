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
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 600) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

function validateTarget(raw: string): string | null {
  const t = String(raw || "").trim().replace(/^@/, "");
  if (!t) return null;
  if (/^\d{4,15}$/.test(t)) return t;
  if (/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(t)) return "@" + t;
  return null;
}

function decodeBase64Payload(input: string): Uint8Array {
  const pure = input.includes(",") ? input.split(",").pop() || "" : input;
  const binary = atob(pure);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

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
      productType,
      targetUser,
      premiumDuration,
      starsAmount,
      amountRub,
      receiptBase64,
      receiptMime,
      receiptFileName,
    } = body || {};

    if (!initData || !shopId) return errRes("Missing required fields");
    if (productType !== "telegram_premium" && productType !== "telegram_stars") {
      return errRes("Invalid product type");
    }
    const target = validateTarget(targetUser);
    if (!target) return errRes("Введите корректный username или ID");
    if (!receiptBase64) return errRes("Необходимо приложить чек об оплате");

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const ek = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!ek) return errRes("Server config error");

    const { data: shop } = await supabase
      .from("shops")
      .select("id, status, owner_id, name, bot_token_encrypted")
      .eq("id", shopId)
      .maybeSingle();
    if (!shop) return errRes("Shop not found");
    if (shop.status !== "active") return errRes("Магазин временно недоступен");

    const { data: botTokenData } = await supabase.rpc("decrypt_token", {
      p_encrypted: shop.bot_token_encrypted,
      p_key: ek,
    });
    const botToken = botTokenData || null;
    if (!botToken) return errRes("Магазин не сконфигурирован");

    // SBP must be enabled for this shop
    const { data: method } = await supabase
      .from("shop_payment_methods")
      .select("enabled")
      .eq("shop_id", shopId)
      .eq("method", "sbp_card")
      .maybeSingle();
    if (!method?.enabled) return errRes("Оплата по СБП в этом магазине не настроена");

    const tgUser = verifyTg(initData, botToken);
    if (!tgUser) return errRes("Invalid authentication");
    const buyerId = tgUser.id;

    // Block check
    const { data: customer } = await supabase
      .from("shop_customers")
      .select("is_blocked")
      .eq("shop_id", shopId)
      .eq("telegram_id", buyerId)
      .maybeSingle();
    if (customer?.is_blocked) return errRes("Account blocked");

    // Rate limit
    await supabase.from("rate_limits").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString());
    const { count: recent } = await supabase
      .from("rate_limits")
      .select("id", { count: "exact", head: true })
      .eq("identifier", String(buyerId))
      .eq("action", "create_auto_sbp_request")
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (recent && recent >= 10) return errRes("Слишком много запросов, попробуйте позже");
    await supabase.from("rate_limits").insert({ identifier: String(buyerId), action: "create_auto_sbp_request" });

    // Load auto product config
    const { data: ap } = await supabase
      .from("shop_auto_products" as any)
      .select("*")
      .eq("shop_id", shopId)
      .eq("product_type", productType)
      .eq("is_enabled", true)
      .maybeSingle();
    if (!ap) return errRes("Товар недоступен");

    let amount = 0;
    let extra: { premium_duration?: string; stars_amount?: number } = {};
    let productLabel = "";

    if (productType === "telegram_premium") {
      const dur = ["3m", "6m", "12m"].includes(premiumDuration) ? premiumDuration : null;
      if (!dur) return errRes("Выберите срок подписки");
      amount = Number((ap as any)[`price_${dur}`] || 0);
      if (amount <= 0) return errRes("Срок недоступен");
      extra.premium_duration = dur;
      const label = dur === "3m" ? "3 мес" : dur === "6m" ? "6 мес" : "12 мес";
      productLabel = `Telegram Premium (${label}) для ${target}`;
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
      productLabel = `${stars} Telegram Stars для ${target}`;
    }

    if (amount <= 0) return errRes("Некорректная сумма");

    // Ensure shop_customer exists
    await supabase.rpc("ensure_shop_customer", {
      p_shop_id: shopId,
      p_telegram_id: buyerId,
      p_first_name: tgUser.first_name || "",
      p_username: tgUser.username || null,
    });

    const orderNumber = `AS-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

    // Create order awaiting manual payment verification
    const { data: order, error: orderError } = await supabase
      .from("shop_orders")
      .insert({
        order_number: orderNumber,
        buyer_telegram_id: buyerId,
        shop_id: shopId,
        status: "awaiting_payment",
        payment_status: "pending_verification",
        total_amount: amount,
        currency: "USD",
        payment_method: "sbp_card",
        product_type: productType,
        target_user: target,
        premium_duration: extra.premium_duration || null,
        stars_amount: extra.stars_amount || null,
        fulfillment_status: "none",
      })
      .select()
      .single();

    if (orderError || !order) {
      console.error("[create-auto-sbp-request] order insert error:", orderError);
      return errRes("Failed to create order");
    }

    // Upload receipt to owner via shop bot, fallback through buyer chat
    const fileBytes = decodeBase64Payload(String(receiptBase64));
    const contentType = receiptMime || "image/jpeg";
    const fileName = receiptFileName || "receipt.jpg";
    let receiptFileId: string | null = null;

    if (shop.owner_id) {
      const { data: pUser } = await supabase
        .from("platform_users")
        .select("telegram_id")
        .eq("id", shop.owner_id)
        .maybeSingle();
      if (pUser?.telegram_id) {
        const caption =
          `🧾 <b>Новая заявка на оплату (Авто-товар)</b>\n\n` +
          `🏪 Магазин: <b>${shop.name || shopId}</b>\n` +
          `📦 Заказ: <code>${order.order_number}</code>\n` +
          `🎯 ${productLabel}\n` +
          `👤 TG: <code>${buyerId}</code>\n` +
          `💰 Сумма: <b>$${amount.toFixed(2)}</b>${amountRub ? ` (~${Number(amountRub).toFixed(0)} ₽)` : ""}\n\n` +
          `Откройте /admin → Заявки для проверки.`;

        receiptFileId = await uploadReceiptToTelegram(
          botToken,
          pUser.telegram_id,
          fileBytes,
          contentType,
          fileName,
          caption,
        );
      }
    }

    if (!receiptFileId) {
      const form = new FormData();
      form.append("chat_id", String(buyerId));
      form.append("photo", new Blob([fileBytes], { type: contentType }), fileName);
      form.append("disable_notification", "true");
      const res = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, { method: "POST", body: form });
      const rd = await res.json();
      if (rd.ok && rd.result?.photo?.length) {
        receiptFileId = rd.result.photo[rd.result.photo.length - 1].file_id;
        await fetch(`https://api.telegram.org/bot${botToken}/deleteMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: buyerId, message_id: rd.result.message_id }),
        }).catch(() => {});
      }
    }

    const { data: requestRow, error: reqErr } = await supabase
      .from("shop_payment_requests")
      .insert({
        shop_id: shopId,
        order_id: order.id,
        buyer_telegram_id: buyerId,
        payment_method: "sbp_card",
        amount_usd: Number(amount.toFixed(2)),
        amount_rub: amountRub ? Number(amountRub) : null,
        status: "pending",
        receipt_url: null,
        receipt_path: receiptFileId || null,
        receipt_mime: contentType,
        note: productLabel,
      })
      .select("id")
      .single();

    if (reqErr || !requestRow) {
      console.error("[create-auto-sbp-request] request insert error:", reqErr);
      return errRes("Failed to create payment request");
    }

    return jsonRes({
      ok: true,
      orderId: order.id,
      orderNumber: order.order_number,
      requestId: requestRow.id,
      status: "pending",
      paymentStatus: "pending_verification",
      amountUsd: Number(amount.toFixed(2)),
      amountRub: amountRub ? Number(amountRub) : null,
    });
  } catch (error) {
    console.error("create-auto-sbp-request error:", error);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});