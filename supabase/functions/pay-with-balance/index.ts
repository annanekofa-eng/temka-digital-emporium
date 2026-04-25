import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
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
  if (createHmac("sha256", secretKey).update(dcs).digest("hex") !== hash) return null;
  const authDate = params.get("auth_date");
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 300) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

async function resolveTokens(supabase: any, shopId?: string) {
  if (!shopId) return { botToken: Deno.env.get("TELEGRAM_BOT_TOKEN") || null };
  const ek = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!ek) throw new Error("Server config error");
  const { data: shop } = await supabase.from("shops").select("bot_token_encrypted, bot_username").eq("id", shopId).maybeSingle();
  if (!shop?.bot_token_encrypted) throw new Error("Shop bot not configured");
  const { data } = await supabase.rpc("decrypt_token", { p_encrypted: shop.bot_token_encrypted, p_key: ek });
  return { botToken: data || null, botUsername: shop.bot_username || "" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { initData, orderNumber, items, promoCode, shopId } = await req.json();
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

    if (!orderNumber || !items?.length) return jsonRes({ error: "Missing required fields" }, 400);

    // Validate shop operational state for shop orders
    if (isShop) {
      const { data: shopData } = await supabase.from("shops").select("status, owner_id").eq("id", shopId).maybeSingle();
      if (!shopData || shopData.status !== "active") {
        return jsonRes({ error: "Магазин временно недоступен для приёма заказов" }, 400);
      }
      if (shopData.owner_id) {
        const { data: owner } = await supabase.from("platform_users").select("subscription_status, subscription_expires_at").eq("id", shopData.owner_id).maybeSingle();
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
    const { count } = await supabase.from("rate_limits").select("id", { count: "exact", head: true })
      .eq("identifier", String(telegramUserId)).eq("action", "create_order")
      .gte("created_at", new Date(Date.now() - 3600000).toISOString());
    if (count && count >= 15) return jsonRes({ error: "Too many requests" }, 429);
    await supabase.from("rate_limits").insert({ identifier: String(telegramUserId), action: "create_order" });

    // User profile — tenant-scoped for shops
    let balance = 0;
    if (isShop) {
      const { data: customer } = await supabase.from("shop_customers")
        .select("balance, is_blocked").eq("shop_id", shopId).eq("telegram_id", telegramUserId).maybeSingle();
      if (customer?.is_blocked) return jsonRes({ error: "Account blocked" }, 403);
      balance = Number(customer?.balance || 0);
    } else {
      const { data: profile } = await supabase.from("user_profiles")
        .select("balance, is_blocked").eq("telegram_id", telegramUserId).single();
      if (!profile) return jsonRes({ error: "User not found" }, 400);
      if (profile.is_blocked) return jsonRes({ error: "Account blocked" }, 403);
      balance = Number(profile.balance || 0);
    }

    // Validate products
    let serverTotal = 0;
    const validatedItems: { productId: string; productTitle: string; productPrice: number; quantity: number }[] = [];

    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0 || item.quantity > 100)
        return jsonRes({ error: "Invalid item" }, 400);

      if (isShop) {
        const { data: product } = await supabase.from("shop_products").select("id, name, price, stock, is_active, shop_id")
          .eq("id", item.productId).single();
        if (!product || !product.is_active || product.shop_id !== shopId) return jsonRes({ error: "Product not found" }, 400);
        if (product.stock < item.quantity) return jsonRes({ error: `${product.name} — insufficient stock` }, 400);
        serverTotal += Number(product.price) * item.quantity;
        validatedItems.push({ productId: product.id, productTitle: product.name, productPrice: Number(product.price), quantity: item.quantity });
      } else {
        const { data: product } = await supabase.from("products").select("id, title, price, stock, is_active")
          .eq("id", item.productId).single();
        if (!product || !product.is_active) return jsonRes({ error: "Product not found" }, 400);
        if (product.stock < item.quantity) return jsonRes({ error: `${product.title} — insufficient stock` }, 400);
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
              const { count: c } = await supabase.from("shop_orders").select("id", { count: "exact", head: true })
                .eq("buyer_telegram_id", telegramUserId).eq("shop_id", shopId)
                .ilike("promo_code", trimmedCode).in("payment_status", ["paid", "awaiting"]);
              if (c !== null && c >= promo.max_uses_per_user) perUserOk = false;
            }
            if (perUserOk) {
              validatedPromoCode = trimmedCode;
              discountAmount = promo.discount_type === "percent"
                ? serverTotal * (Number(promo.discount_value) / 100) : Math.min(Number(promo.discount_value), serverTotal);
            }
          }
        }
      } else {
        const { data: promo } = await supabase.from("promocodes").select("*").eq("code", trimmedCode).eq("is_active", true).maybeSingle();
        if (promo) {
          const now = new Date().toISOString();
          const isValid = (!promo.valid_from || now >= promo.valid_from) && (!promo.valid_until || now <= promo.valid_until) &&
            (promo.max_uses === null || promo.used_count < promo.max_uses);
          if (isValid) {
            let perUserOk = true;
            if (promo.max_uses_per_user) {
              const { count: c } = await supabase.from("orders").select("id", { count: "exact", head: true })
                .eq("telegram_id", telegramUserId).eq("promo_code", trimmedCode).in("payment_status", ["paid", "awaiting"]);
              if (c !== null && c >= promo.max_uses_per_user) perUserOk = false;
            }
            if (perUserOk) {
              validatedPromoCode = trimmedCode;
              discountAmount = promo.discount_type === "percent"
                ? serverTotal * (Number(promo.discount_value) / 100) : Math.min(Number(promo.discount_value), serverTotal);
            }
          }
        }
      }
    }
    // If promoCode was provided but not validated, return error
    if (promoCode && !validatedPromoCode) {
      return jsonRes({ error: "Промокод больше недоступен, проверьте заказ" }, 400);
    }

    const totalAfterDiscount = Math.max(0, serverTotal - discountAmount);
    if (balance < totalAfterDiscount) return jsonRes({ error: "Insufficient balance" }, 400);
    const balanceUsed = totalAfterDiscount;

    // Create order
    let order: any;
    if (isShop) {
      const { data, error } = await supabase.from("shop_orders").insert({
        order_number: orderNumber, buyer_telegram_id: telegramUserId, shop_id: shopId,
        status: "paid", payment_status: "paid", total_amount: serverTotal,
        currency: "USD", balance_used: balanceUsed,
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
        status: "paid", payment_status: "paid", total_amount: serverTotal,
        currency: "USD", discount_amount: discountAmount, promo_code: validatedPromoCode, balance_used: balanceUsed,
      }).select().single();
      if (error) { console.error("Order error:", error); return jsonRes({ error: "Failed to create order" }, 500); }
      order = data;
      await supabase.from("order_items").insert(validatedItems.map(i => ({
        order_id: order.id, product_id: i.productId, product_title: i.productTitle,
        product_price: i.productPrice, quantity: i.quantity,
      })));
    }

    // Deduct balance — tenant-scoped for shops
    let newBalance: number;
    if (isShop) {
      const { data: nb, error: balError } = await supabase.rpc("shop_deduct_balance", {
        p_shop_id: shopId, p_telegram_id: telegramUserId, p_amount: balanceUsed,
      });
      if (balError) {
        await supabase.from("shop_orders").delete().eq("id", order.id);
        return jsonRes({ error: "Insufficient balance" }, 400);
      }
      newBalance = nb;
      const balComment = validatedPromoCode
        ? `Заказ ${orderNumber} (промо ${validatedPromoCode}, скидка $${discountAmount.toFixed(2)})`
        : `Заказ ${orderNumber}`;
      await supabase.from("shop_balance_history").insert({
        shop_id: shopId, telegram_id: telegramUserId, amount: -balanceUsed, balance_after: newBalance,
        type: "purchase", comment: balComment, admin_telegram_id: telegramUserId,
      });
    } else {
      const { data: nb, error: balError } = await supabase.rpc("deduct_balance", {
        p_telegram_id: telegramUserId, p_amount: balanceUsed,
      });
      if (balError) {
        await supabase.from("orders").delete().eq("id", order.id);
        return jsonRes({ error: "Insufficient balance" }, 400);
      }
      newBalance = nb;
      const balCommentP = validatedPromoCode
        ? `Заказ ${orderNumber} (промо ${validatedPromoCode}, скидка $${discountAmount.toFixed(2)})`
        : `Заказ ${orderNumber}`;
      await supabase.from("balance_history").insert({
        telegram_id: telegramUserId, amount: -balanceUsed, balance_after: newBalance,
        type: "purchase", comment: balCommentP, admin_telegram_id: telegramUserId,
      });
    }

    // Promo usage increment
    if (validatedPromoCode) {
      if (isShop) {
        await supabase.rpc("increment_shop_promo_usage", { p_shop_id: shopId, p_code: validatedPromoCode });
      } else {
        await supabase.rpc("increment_promo_usage", { p_code: validatedPromoCode });
      }
    }

    // Auto-deliver inventory
    const itemsTable = isShop ? "shop_order_items" : "order_items";
    const titleCol = isShop ? "product_name" : "product_title";
    const { data: oItems } = await supabase.from(itemsTable).select(`product_id, quantity, ${titleCol}`).eq("order_id", order.id);

    const deliveredContent: string[] = [];
    let allDelivered = true;
    const inventoryTable = isShop ? "shop_inventory" : "inventory_items";
    const productsTable = isShop ? "shop_products" : "products";
    const reserveRpc = isShop ? "reserve_shop_inventory" : "reserve_inventory";

    if (oItems) {
      for (const item of oItems) {
        const itemTitle = (item as any)[titleCol];
        const { data: reserved } = await supabase.rpc(reserveRpc, {
          p_product_id: item.product_id, p_quantity: item.quantity, p_order_id: order.id,
        });
        if (reserved && reserved.length > 0) {
          deliveredContent.push(`📦 <b>${itemTitle}</b> (×${reserved.length}):\n${reserved.map((i: any) => `<code>${i.content}</code>`).join("\n")}`);
          const { count: remaining } = await supabase.from(inventoryTable).select("id", { count: "exact", head: true })
            .eq("product_id", item.product_id).eq("status", "available");
          await supabase.from(productsTable).update({ stock: remaining || 0, updated_at: new Date().toISOString() }).eq("id", item.product_id);
          if (reserved.length < item.quantity) allDelivered = false;
        } else { allDelivered = false; }
      }
    }

    const finalStatus = allDelivered && deliveredContent.length > 0 ? "delivered" : "paid";
    const orderTable = isShop ? "shop_orders" : "orders";
    if (finalStatus !== "paid") {
      await supabase.from(orderTable).update({ status: finalStatus, updated_at: new Date().toISOString() }).eq("id", order.id);
    }

    // TG notification
    const notifyBotToken = tokens.botToken;
    if (notifyBotToken) {
      let message = `✅ <b>Оплата балансом подтверждена!</b>\n\n📦 Заказ: <code>${orderNumber}</code>\n💰 Списано: $${balanceUsed.toFixed(2)}\n`;
      if (discountAmount > 0) {
        message += `🏷 Промокод: ${validatedPromoCode} (скидка $${discountAmount.toFixed(2)})\n`;
      }
      if (deliveredContent.length > 0) {
        message += `\n🎁 <b>Ваши товары:</b>\n\n${deliveredContent.join("\n\n")}\n\n⚠️ Сохраните данные!`;
      } else { message += `\nВаш товар будет доставлен в ближайшее время.`; }
      message += `\n\nСпасибо за покупку!`;
      await fetch(`https://api.telegram.org/bot${notifyBotToken}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegramUserId, text: message, parse_mode: "HTML" }),
      });
    }

    return jsonRes({ ok: true, orderNumber, orderId: order.id });
  } catch (error) {
    console.error("Pay with balance error:", error);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
