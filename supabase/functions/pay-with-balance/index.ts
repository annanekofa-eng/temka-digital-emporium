import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

    // Profile + balance
    const { data: profile } = await supabase.from("user_profiles").select("is_blocked, balance").eq("telegram_id", telegramUserId).maybeSingle();
    if ((profile as any)?.is_blocked) return jsonRes({ error: "Account blocked" }, 403);
    const serverBalance = Number(profile?.balance || 0);

    // Validate items (same logic as create-invoice)
    let serverTotal = 0;
    const validatedItems: { productId: string; productTitle: string; productPrice: number; quantity: number }[] = [];
    for (const item of items) {
      if (!item.productId || !item.quantity || item.quantity <= 0 || item.quantity > 100)
        return jsonRes({ error: "Invalid item data" }, 400);
      const { data: product } = await supabase.from("products")
        .select("id, title, price, stock, is_active, product_type, term_options, nft_variants, min_qty, max_qty")
        .eq("id", item.productId).single();
      if (!product || !product.is_active) return jsonRes({ error: "Product not found or inactive" }, 400);
      if (product.stock < item.quantity) return jsonRes({ error: `${product.title} — insufficient stock (${product.stock})` }, 400);

      let unitPrice = Number(product.price);
      const clientPrice = Number(item.productPrice);
      const ptype = String(product.product_type || "simple");

      if (ptype === "premium_term") {
        const opts = (product.term_options as Array<{ months: number; price: number }>) || [];
        const match = opts.find((o) => Math.abs(Number(o.price) - clientPrice) < 0.01);
        if (!match) return jsonRes({ error: `${product.title} — invalid term price` }, 400);
        unitPrice = Number(match.price);
      } else if (ptype === "nft_variant") {
        const vars = (product.nft_variants as Array<{ price: number }>) || [];
        if (clientPrice <= 0) return jsonRes({ error: `${product.title} — invalid price` }, 400);
        if (vars.length > 0) {
          const match = vars.find((v) => Math.abs(Number(v.price) - clientPrice) < 0.01);
          unitPrice = match ? Number(match.price) : clientPrice;
        } else {
          unitPrice = clientPrice;
        }
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

      serverTotal += unitPrice * item.quantity;
      validatedItems.push({ productId: product.id, productTitle: item.productTitle || product.title, productPrice: unitPrice, quantity: item.quantity });
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
    if (serverBalance < totalAfterDiscount) return jsonRes({ error: "Insufficient balance" }, 400);

    // Atomic deduct
    const { data: newBalance, error: deductErr } = await supabase.rpc("deduct_balance", {
      p_telegram_id: telegramUserId,
      p_amount: totalAfterDiscount,
    });
    if (deductErr) {
      console.error("Deduct error:", deductErr);
      return jsonRes({ error: "Failed to charge balance" }, 400);
    }

    // Create paid order
    const { data: order, error } = await supabase.from("orders").insert({
      order_number: orderNumber, telegram_id: telegramUserId,
      status: "paid", payment_status: "paid", total_amount: serverTotal,
      currency: "USD", discount_amount: discountAmount,
      promo_code: validatedPromoCode, balance_used: totalAfterDiscount,
    }).select().single();
    if (error) {
      console.error("Order error:", error);
      // refund
      await supabase.rpc("credit_balance", { p_telegram_id: telegramUserId, p_amount: totalAfterDiscount });
      return jsonRes({ error: "Failed to create order" }, 500);
    }

    await supabase.from("order_items").insert(validatedItems.map((i) => ({
      order_id: order.id, product_id: i.productId, product_title: i.productTitle,
      product_price: i.productPrice, quantity: i.quantity,
    })));

    // Promo usage
    if (validatedPromoCode) {
      await supabase.rpc("increment_promo_usage", { p_code: validatedPromoCode });
    }

    // Balance history
    await supabase.from("balance_history").insert({
      telegram_id: telegramUserId,
      amount: -totalAfterDiscount,
      type: "debit",
      balance_after: Number(newBalance ?? (serverBalance - totalAfterDiscount)),
      comment: `Order ${orderNumber}`,
      admin_telegram_id: 0,
    });

    return jsonRes({
      orderId: order.id,
      orderNumber,
      paid: true,
    });
  } catch (e) {
    console.error("pay-with-balance error:", e);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
