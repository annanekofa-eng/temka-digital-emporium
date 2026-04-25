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

async function resolveTokens(supabase: any, shopId?: string) {
  if (!shopId) {
    return {
      botToken: Deno.env.get("TELEGRAM_BOT_TOKEN") || null,
      cryptobotToken: Deno.env.get("CRYPTOBOT_API_TOKEN") || null,
      botUsername: Deno.env.get("BOT_USERNAME") || "Tele_Store_Robot",
    };
  }
  const ek = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!ek) throw new Error("Server config error");
  const { data: shop } = await supabase
    .from("shops").select("bot_token_encrypted, cryptobot_token_encrypted, bot_username")
    .eq("id", shopId).maybeSingle();
  if (!shop) throw new Error("Shop not found");
  const decrypt = async (enc: string) => {
    const { data } = await supabase.rpc("decrypt_token", { p_encrypted: enc, p_key: ek });
    return data;
  };
  const shopCryptobot = shop.cryptobot_token_encrypted ? await decrypt(shop.cryptobot_token_encrypted) : null;
  return {
    botToken: shop.bot_token_encrypted ? await decrypt(shop.bot_token_encrypted) : null,
    cryptobotToken: shopCryptobot,
    botUsername: shop.bot_username || "",
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { initData, amount, currency, description, orderNumber, items, promoCode, balanceUsed: clientBalanceUsed, shopId } = await req.json();
    const isShop = !!shopId;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let tokens;
    try { tokens = await resolveTokens(supabase, shopId); }
    catch (e) { return jsonRes({ error: e.message }, 500); }

    if (!tokens.botToken) return jsonRes({ error: "Bot not configured" }, 500);
    if (!initData) return jsonRes({ error: "Authentication required" }, 401);

    const tgUser = verifyAndExtractUser(initData, tokens.botToken);
    if (!tgUser) return jsonRes({ error: "Invalid authentication" }, 401);
    const telegramUserId = tgUser.id;

    if (!items?.length || !orderNumber) return jsonRes({ error: "Missing required fields" }, 400);
    if (!tokens.cryptobotToken) return jsonRes({ error: "Платежи не настроены. Владельцу магазина необходимо подключить CryptoBot токен." }, 500);

    // Validate shop operational state for shop orders
    if (isShop) {
      const { data: shopData } = await supabase.from("shops").select("status").eq("id", shopId).maybeSingle();
      if (!shopData || shopData.status !== "active") {
        return jsonRes({ error: "Магазин временно недоступен для приёма заказов" }, 400);
      }
      // Check owner subscription
      const { data: shopFull } = await supabase.from("shops").select("owner_id").eq("id", shopId).maybeSingle();
      if (shopFull?.owner_id) {
        const { data: owner } = await supabase.from("platform_users").select("subscription_status, subscription_expires_at").eq("id", shopFull.owner_id).maybeSingle();
        if (owner && !["active", "trial", "grace_period"].includes(owner.subscription_status)) {
          return jsonRes({ error: "Магазин временно недоступен для приёма заказов" }, 400);
        }
        if (owner?.subscription_expires_at && new Date(owner.subscription_expires_at) < new Date() && owner.subscription_status !== "grace_period") {
          return jsonRes({ error: "Магазин временно недоступен для приёма заказов" }, 400);
        }
      }
    }

    // Rate limiting
    await supabase.from("rate_limits").delete().lt("created_at", new Date(Date.now() - 3600000).toISOString());
    const { count: recentRequests } = await supabase
      .from("rate_limits").select("id", { count: "exact", head: true })
      .eq("identifier", String(telegramUserId)).eq("action", "create_order")
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (recentRequests && recentRequests >= 15) return jsonRes({ error: "Too many requests" }, 429);
    await supabase.from("rate_limits").insert({ identifier: String(telegramUserId), action: "create_order" });

    // Check blocked & balance — tenant-scoped for shops
    let serverBalance = 0;
    if (isShop) {
      const { data: customer } = await supabase.from("shop_customers")
        .select("is_blocked, balance").eq("shop_id", shopId).eq("telegram_id", telegramUserId).maybeSingle();
      if (customer?.is_blocked) return jsonRes({ error: "Account blocked" }, 403);
      serverBalance = Number(customer?.balance || 0);
    } else {
      const { data: userProfile } = await supabase
        .from("user_profiles").select("is_blocked, balance").eq("telegram_id", telegramUserId).maybeSingle();
      if (userProfile?.is_blocked) return jsonRes({ error: "Account blocked" }, 403);
      serverBalance = Number(userProfile?.balance || 0);
    }

    // Validate products
    let serverTotal = 0;
    const validatedItems: { productId: string; productTitle: string; productPrice: number; quantity: number }[] = [];

    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0 || item.quantity > 100)
        return jsonRes({ error: "Invalid item data" }, 400);

      if (isShop) {
        const { data: product } = await supabase
          .from("shop_products").select("id, name, price, stock, is_active, shop_id")
          .eq("id", item.productId).single();
        if (!product || !product.is_active || product.shop_id !== shopId)
          return jsonRes({ error: `Product not found or inactive` }, 400);
        if (product.stock < item.quantity)
          return jsonRes({ error: `${product.name} — insufficient stock (${product.stock})` }, 400);
        serverTotal += Number(product.price) * item.quantity;
        validatedItems.push({ productId: product.id, productTitle: product.name, productPrice: Number(product.price), quantity: item.quantity });
      } else {
        const { data: product } = await supabase
          .from("products").select("id, title, price, stock, is_active")
          .eq("id", item.productId).single();
        if (!product || !product.is_active)
          return jsonRes({ error: `Product not found or inactive` }, 400);
        if (product.stock < item.quantity)
          return jsonRes({ error: `${product.title} — insufficient stock (${product.stock})` }, 400);
        serverTotal += Number(product.price) * item.quantity;
        validatedItems.push({ productId: product.id, productTitle: product.title, productPrice: Number(product.price), quantity: item.quantity });
      }
    }

    // Promo — tenant-scoped for shops
    let discountAmount = 0;
    let validatedPromoCode: string | null = null;
    if (promoCode) {
      const trimmedCode = String(promoCode).trim().toUpperCase();
      if (isShop) {
        const { data: promo } = await supabase.from("shop_promocodes").select("*")
          .eq("shop_id", shopId).ilike("code", trimmedCode).eq("is_active", true).maybeSingle();
        if (promo) {
          const now = new Date().toISOString();
          const isValid = (!promo.valid_from || now >= promo.valid_from) && (!promo.valid_until || now <= promo.valid_until) &&
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
      } else {
        const { data: promo } = await supabase
          .from("promocodes").select("*").eq("code", trimmedCode).eq("is_active", true).maybeSingle();
        if (promo) {
          const now = new Date().toISOString();
          const isValid = (!promo.valid_from || now >= promo.valid_from) &&
            (!promo.valid_until || now <= promo.valid_until) &&
            (promo.max_uses === null || promo.used_count < promo.max_uses);
          if (isValid) {
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
      }
    }
    // If promoCode was provided but not validated, return error (don't silently ignore)
    if (promoCode && !validatedPromoCode) {
      return jsonRes({ error: "Промокод больше недоступен, проверьте заказ" }, 400);
    }

    const totalAfterDiscount = Math.max(0, serverTotal - discountAmount);

    // Balance
    const balanceUsed = Math.min(Math.max(0, Number(clientBalanceUsed) || 0), serverBalance, totalAfterDiscount);
    const toPay = Math.max(0, totalAfterDiscount - balanceUsed);

    if (toPay <= 0) return jsonRes({ error: "Use pay-with-balance endpoint for full balance payments" }, 400);

    // Create order
    let order: any;
    if (isShop) {
      const { data, error } = await supabase.from("shop_orders").insert({
        order_number: orderNumber, buyer_telegram_id: telegramUserId, shop_id: shopId,
        status: "pending", payment_status: "unpaid", total_amount: serverTotal,
        currency: currency || "USD", balance_used: balanceUsed,
        discount_amount: discountAmount, promo_code: validatedPromoCode,
      }).select().single();
      if (error) { console.error("Shop order error:", error); return jsonRes({ error: "Failed to create order" }, 500); }
      order = data;
      await supabase.from("shop_order_items").insert(validatedItems.map(i => ({
        order_id: order.id, product_id: i.productId, product_name: i.productTitle,
        product_price: i.productPrice, quantity: i.quantity,
      })));
    } else {
      const { data, error } = await supabase.from("orders").insert({
        order_number: orderNumber, telegram_id: telegramUserId,
        status: "pending", payment_status: "unpaid", total_amount: serverTotal,
        currency: currency || "USD", discount_amount: discountAmount,
        promo_code: validatedPromoCode, balance_used: balanceUsed,
      }).select().single();
      if (error) { console.error("Order error:", error); return jsonRes({ error: "Failed to create order" }, 500); }
      order = data;
      await supabase.from("order_items").insert(validatedItems.map(i => ({
        order_id: order.id, product_id: i.productId, product_title: i.productTitle,
        product_price: i.productPrice, quantity: i.quantity,
      })));
    }

    // CryptoBot invoice
    const invoicePayload: any = { orderId: order.id, orderNumber, telegramUserId, balanceUsed };
    if (isShop) invoicePayload.shopId = shopId;

    const response = await fetch(`${CRYPTOBOT_API_URL}/createInvoice`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": tokens.cryptobotToken },
      body: JSON.stringify({
        currency_type: "fiat", fiat: "USD",
        amount: String(toPay.toFixed(2)),
        description: description || "Order payment",
        payload: JSON.stringify(invoicePayload),
        paid_btn_name: "callback",
        paid_btn_url: `https://t.me/${tokens.botUsername}`,
      }),
    });

    const data = await response.json();
    if (!data.ok) {
      const table = isShop ? "shop_orders" : "orders";
      await supabase.from(table).update({ status: "error" }).eq("id", order.id);
      console.error("CryptoBot error:", data);
      return jsonRes({ error: data.error?.name || "Failed to create invoice" }, 400);
    }

    const table = isShop ? "shop_orders" : "orders";
    await supabase.from(table).update({
      invoice_id: String(data.result.invoice_id), pay_url: data.result.pay_url,
      status: "awaiting_payment", payment_status: "awaiting",
    }).eq("id", order.id);

    return jsonRes({
      invoiceId: data.result.invoice_id, payUrl: data.result.pay_url,
      miniAppUrl: data.result.mini_app_invoice_url, orderNumber, orderId: order.id,
    });
  } catch (error) {
    console.error("Invoice creation error:", error);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
