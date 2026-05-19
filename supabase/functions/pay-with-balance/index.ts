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

      // Auto products skip stock check (no inventory). Regular products require stock.
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

      // Recipient username validation for auto items
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

    // Promo — atomic claim under row lock (prevents race conditions)
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

    // Create paid order — balance already deducted atomically.
    const nowIso = new Date().toISOString();
    const { data: order, error } = await supabase.from("orders").insert({
      order_number: orderNumber, telegram_id: telegramUserId,
      status: hasAuto ? "processing" : "paid",
      payment_status: "paid", total_amount: serverTotal,
      currency: "USD", discount_amount: discountAmount,
      promo_code: validatedPromoCode, balance_used: totalAfterDiscount,
      balance_charged_at: nowIso,
      is_auto: hasAuto, auto_status: hasAuto ? "pending" : null,
    }).select().single();
    if (error) {
      console.error("Order error:", error);
      await supabase.rpc("credit_balance", { p_telegram_id: telegramUserId, p_amount: totalAfterDiscount });
      return jsonRes({ error: "Failed to create order" }, 500);
    }

    await supabase.from("order_items").insert(validatedItems.map((i) => ({
      order_id: order.id, product_id: i.productId, product_title: i.productTitle,
      product_price: i.productPrice, quantity: i.quantity,
      recipient_username: i.recipientUsername,
    })));

    if (validatedPromoCode) {
      await supabase.rpc("increment_promo_usage", { p_code: validatedPromoCode });
    }

    await supabase.from("balance_history").insert({
      telegram_id: telegramUserId,
      amount: -totalAfterDiscount,
      type: "debit",
      balance_after: Number(newBalance ?? (serverBalance - totalAfterDiscount)),
      comment: `Order ${orderNumber}`,
      admin_telegram_id: 0,
    });

    const escapeHtml = (s: string) =>
      String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // Auto order notifications (Stars/Premium — manual fulfilment)
    if (hasAuto) {
      const adminIds = (Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "")
        .split(",").map((s) => s.trim()).filter(Boolean);
      const itemsText = validatedItems
        .map((i) => `• ${i.productTitle} → @${i.recipientUsername}`).join("\n");

      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: telegramUserId, parse_mode: "HTML",
            text: `📦 <b>Заказ принят</b>\n\nНомер: <code>${orderNumber}</code>\n${itemsText}\nСумма: $${serverTotal.toFixed(2)}\n\n⏳ Ожидайте выдачи — мы уведомим, как только товар будет передан.`,
          }),
        });
      } catch (e) { console.error("notify buyer:", e); }

      const adminText = `🆕 <b>Новый авто-заказ</b>\n\nНомер: <code>${orderNumber}</code>\n${itemsText}\nПокупатель: <code>${telegramUserId}</code>\nСумма: $${serverTotal.toFixed(2)}\n\nОткройте «Авто-заказы» в /admin.`;
      for (const aid of adminIds) {
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: Number(aid), parse_mode: "HTML", text: adminText,
              reply_markup: { inline_keyboard: [[{ text: "🤖 Открыть авто-заказ", callback_data: `a:ao:v:${order.id}` }]] },
            }),
          });
        } catch (e) { console.error("notify admin:", e); }
      }
    } else {
      // Regular order — auto-fulfil from inventory (Склад). Trigger syncs products.stock.
      const deliveredBlocks: string[] = [];
      let allDelivered = true;

      for (const it of validatedItems) {
        const { data: reserved } = await supabase.rpc("reserve_inventory", {
          p_product_id: it.productId, p_quantity: it.quantity, p_order_id: order.id,
        });
        const got = (reserved as Array<{ content: string }> | null) ?? [];
        if (got.length < it.quantity) allDelivered = false;
        if (got.length) {
          const lines = got.map((g) => `<code>${escapeHtml(g.content)}</code>`).join("\n");
          deliveredBlocks.push(`📦 <b>${escapeHtml(it.productTitle)}</b> (×${got.length}):\n${lines}`);
        }
      }

      await supabase.from("orders").update({
        status: allDelivered ? "delivered" : "processing",
        fulfilled_at: allDelivered ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      }).eq("id", order.id);

      const header = `✅ <b>Оплата балансом подтверждена!</b>\n📦 Заказ: <code>${orderNumber}</code>\n💰 Списано: $${totalAfterDiscount.toFixed(2)}`;
      const body = deliveredBlocks.length
        ? `${header}\n\n🎁 <b>Ваши товары:</b>\n\n${deliveredBlocks.join("\n\n")}\n\n⚠️ <b>Сохраните данные!</b>\nСпасибо за покупку!`
        : `${header}\n\n⏳ Товара временно нет на складе — мы автоматически выдадим его, как только он появится.`;

      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: telegramUserId, parse_mode: "HTML", text: body }),
        });
      } catch (e) { console.error("notify buyer:", e); }
    }

    return jsonRes({
      orderId: order.id,
      orderNumber,
      paid: true,
      isAuto: hasAuto,
    });
  } catch (e) {
    console.error("pay-with-balance error:", e);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
