import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHash, createHmac } from "node:crypto";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, crypto-pay-api-signature",
};

const safeJson = <T,>(raw: string, fb: T): T => { try { return JSON.parse(raw) as T; } catch { return fb; } };
const topupComment = (id: string) => `Пополнение через CryptoBot (invoice:${id})`;

async function claimInvoice(supabase: any, invoiceId: string, type: string, telegramId: number | null, amount: number, orderId: string | null) {
  const { error } = await supabase.from("processed_invoices").insert({ invoice_id: invoiceId, type, order_id: orderId, telegram_id: telegramId, amount });
  if (!error) return true;
  if ((error as any)?.code === "23505") return false;
  throw new Error(`claimInvoice: ${error.message}`);
}
async function releaseClaim(supabase: any, invoiceId: string) {
  try { await supabase.from("processed_invoices").delete().eq("invoice_id", invoiceId); } catch (e) { console.error(e); }
}

async function notify(botToken: string | null, chatId: number, text: string) {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) { console.error("notify:", e); }
}

async function handleTopup(supabase: any, orderData: any, invoiceId: string) {
  const amount = Number(orderData.amount);
  const tgId = Number(orderData.telegramUserId);
  if (!tgId || !amount || amount <= 0) throw new Error(`[topup] invalid invoice=${invoiceId}`);
  const claimed = await claimInvoice(supabase, invoiceId, "topup", tgId, amount, null);
  if (!claimed) return;
  try {
    const { data: nb, error } = await supabase.rpc("credit_balance", { p_telegram_id: tgId, p_amount: amount });
    if (error) throw new Error(`credit_balance: ${error.message}`);
    await supabase.from("balance_history").insert({
      telegram_id: tgId, amount, balance_after: nb, type: "credit",
      comment: topupComment(invoiceId), admin_telegram_id: tgId,
    });
    await notify(Deno.env.get("TELEGRAM_BOT_TOKEN") || null, tgId,
      `✅ <b>Баланс пополнен!</b>\n\n💰 Сумма: $${amount.toFixed(2)}\n💳 Новый баланс: $${Number(nb).toFixed(2)}`);
  } catch (e) {
    await releaseClaim(supabase, invoiceId);
    throw e;
  }
}

async function handleOrder(supabase: any, invoice: any, orderData: any): Promise<boolean> {
  const orderId = orderData.orderId;
  const tgId = Number(orderData.telegramUserId);
  const balanceUsed = Number(orderData.balanceUsed || 0);
  if (!orderId || !tgId) return false;

  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) return false;
  if (order.payment_status === "paid") return true;

  // Mark paid
  await supabase.from("orders").update({
    status: "processing", payment_status: "paid", updated_at: new Date().toISOString(),
  }).eq("id", orderId);

  // Promo usage
  if (order.promo_code) {
    await supabase.rpc("increment_promo_usage", { p_code: order.promo_code });
  }

  // Deduct balance used
  if (balanceUsed > 0) {
    const { data: nb, error } = await supabase.rpc("deduct_balance", { p_telegram_id: tgId, p_amount: balanceUsed });
    if (!error) {
      await supabase.from("balance_history").insert({
        telegram_id: tgId, amount: -balanceUsed, balance_after: nb, type: "order",
        comment: `Оплата заказа ${order.order_number}`, admin_telegram_id: tgId,
      });
    }
  }

  // Reserve inventory and deliver (skip auto items)
  const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId);
  let allDelivered = true;
  const deliveredContent: string[] = [];
  const autoItems: any[] = [];
  for (const item of items || []) {
    // Auto items (Stars/Premium) are fulfilled manually by admin
    const prod = await supabase.from("products").select("product_type").eq("id", item.product_id).maybeSingle();
    const ptype = String(prod.data?.product_type || "simple");
    if (ptype === "premium_term" || ptype === "stars") {
      autoItems.push(item);
      continue;
    }
    const { data: reserved } = await supabase.rpc("reserve_inventory", {
      p_product_id: item.product_id, p_quantity: item.quantity, p_order_id: orderId,
    });
    if (!reserved || reserved.length < item.quantity) {
      allDelivered = false;
    } else {
      reserved.forEach((r: any) => deliveredContent.push(`${item.product_title}: ${r.content}`));
      const { count: remaining } = await supabase.from("inventory_items").select("id", { count: "exact", head: true })
        .eq("product_id", item.product_id).eq("status", "available");
      await supabase.from("products").update({ stock: remaining || 0, updated_at: new Date().toISOString() }).eq("id", item.product_id);
    }
  }

  const isAutoOrder = order.is_auto || autoItems.length > 0;
  await supabase.from("orders").update({
    status: isAutoOrder ? "processing" : (allDelivered ? "completed" : "processing"),
    updated_at: new Date().toISOString(),
  }).eq("id", orderId);

  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || null;
  if (isAutoOrder) {
    const itemsText = autoItems
      .map((i: any) => `• ${i.product_title} → @${i.recipient_username || "—"}`).join("\n");
    await notify(botToken, tgId,
      `📦 <b>Заказ принят</b>\n\nНомер: <code>${order.order_number}</code>\n${itemsText}\nСумма: $${Number(order.total_amount).toFixed(2)}\n\n⏳ Ожидайте выдачи — мы уведомим, как только товар будет передан.`);
    // Notify admins
    const adminIds = (Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    if (botToken) {
      const adminText = `🆕 <b>Новый авто-заказ</b>\n\nНомер: <code>${order.order_number}</code>\n${itemsText}\nПокупатель: <code>${tgId}</code>\nСумма: $${Number(order.total_amount).toFixed(2)}`;
      for (const aid of adminIds) {
        try {
          await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chat_id: Number(aid), parse_mode: "HTML", text: adminText,
              reply_markup: { inline_keyboard: [[{ text: "🤖 Открыть авто-заказ", callback_data: `a:ao:v:${orderId}` }]] },
            }),
          });
        } catch (e) { console.error("notify admin:", e); }
      }
    }
  } else if (allDelivered && deliveredContent.length) {
    await notify(botToken, tgId, `✅ <b>Заказ ${order.order_number} оплачен и выполнен!</b>\n\n<pre>${deliveredContent.join("\n")}</pre>`);
  } else {
    await notify(botToken, tgId, `✅ Заказ ${order.order_number} оплачен. Мы выдадим товар вручную в ближайшее время.`);
  }
  return true;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.text();
    const signature = req.headers.get("crypto-pay-api-signature");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const parsed = safeJson<any>(body, null);
    if (!parsed) return new Response(JSON.stringify({ error: "Invalid payload" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const token = Deno.env.get("CRYPTOBOT_API_TOKEN");
    let verified = false;
    if (token && signature) {
      const secret = createHash("sha256").update(token).digest();
      if (createHmac("sha256", secret).update(body).digest("hex") === signature) verified = true;
    }
    if (!verified) return new Response(JSON.stringify({ error: "Invalid signature" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (parsed.update_type === "invoice_paid") {
      const invoice = parsed.payload;
      const invoiceId = String(invoice.invoice_id);
      const orderData = safeJson<any>(invoice?.payload || "{}", {});

      if (orderData.type === "topup") {
        await handleTopup(supabase, orderData, invoiceId);
      } else if (orderData.orderId) {
        const claimed = await claimInvoice(supabase, invoiceId, "payment", orderData.telegramUserId || null, Number(invoice.amount) || 0, orderData.orderId);
        if (claimed) {
          try {
            const ok = await handleOrder(supabase, invoice, orderData);
            if (!ok) await releaseClaim(supabase, invoiceId);
          } catch (e) {
            await releaseClaim(supabase, invoiceId);
            throw e;
          }
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (e: any) {
    console.error("[cryptobot-webhook] error:", e?.message || e);
    return new Response(JSON.stringify({ error: "Internal error" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
