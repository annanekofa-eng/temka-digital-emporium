import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CRYPTOBOT_API_URL = "https://pay.crypt.bot/api";
const TOPUP_COMMENT_PREFIX = "Пополнение через CryptoBot";

const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const topupComment = (id: string) => `${TOPUP_COMMENT_PREFIX} (invoice:${id})`;

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
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 600) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

async function notify(botToken: string | null, chatId: number, text: string) {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
  } catch (e) { console.error("[check-payment] notify:", e); }
}

async function processPaidTopup(supabase: any, botToken: string | null, invoice: any, payload: any, telegramId: number) {
  const invoiceId = String(invoice.invoice_id);
  const amount = Number(payload.amount ?? invoice.amount ?? 0);
  if (!amount || amount <= 0) throw new Error("Invalid amount");

  const { data: existing } = await supabase.from("processed_invoices").select("invoice_id").eq("invoice_id", invoiceId).maybeSingle();
  if (existing) return { topupStatus: "paid", paymentStatus: "paid", amount };

  const { error: claimErr } = await supabase.from("processed_invoices").insert({
    invoice_id: invoiceId, type: "topup", order_id: null, telegram_id: telegramId, amount,
  });
  if (claimErr && (claimErr as any).code !== "23505") throw claimErr;

  const { data: nb, error } = await supabase.rpc("credit_balance", { p_telegram_id: telegramId, p_amount: amount });
  if (error) throw new Error(`credit_balance: ${error.message}`);
  await supabase.from("balance_history").insert({
    telegram_id: telegramId, amount, balance_after: nb, type: "credit",
    comment: topupComment(invoiceId), admin_telegram_id: telegramId,
  });
  await notify(botToken, telegramId,
    `✅ <b>Баланс пополнен!</b>\n\n💰 Сумма: $${amount.toFixed(2)}\n💳 Новый баланс: $${Number(nb).toFixed(2)}`);
  return { topupStatus: "paid", paymentStatus: "paid", amount, balance: nb };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const { orderId, invoiceId, initData } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || null;
    const cryptobotToken = Deno.env.get("CRYPTOBOT_API_TOKEN") || null;

    if (!botToken) return jsonRes({ error: "Bot not configured" }, 500);
    if (!initData) return jsonRes({ error: "Authentication required" }, 401);
    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Invalid auth" }, 401);

    const { data: profile } = await supabase.from("user_profiles").select("is_blocked").eq("telegram_id", tgUser.id).maybeSingle();
    if ((profile as any)?.is_blocked) return jsonRes({ error: "Account blocked" }, 403);

    // Topup polling path
    if (invoiceId && !orderId) {
      if (!cryptobotToken) return jsonRes({ topupStatus: "awaiting", paymentStatus: "awaiting" });
      const r = await fetch(`${CRYPTOBOT_API_URL}/getInvoices`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": cryptobotToken },
        body: JSON.stringify({ invoice_ids: String(invoiceId) }),
      });
      const data = await r.json();
      if (!data.ok || !data.result?.items?.length) return jsonRes({ topupStatus: "awaiting", paymentStatus: "awaiting" });
      const inv = data.result.items[0];
      let payload: any = {};
      try { payload = JSON.parse(inv.payload || "{}"); } catch {}
      if (payload.type !== "topup") return jsonRes({ error: "Invalid invoice type" }, 400);
      if (Number(payload.telegramUserId) !== tgUser.id) return jsonRes({ error: "Owner mismatch" }, 403);
      if (inv.status === "paid") return jsonRes(await processPaidTopup(supabase, botToken, inv, payload, tgUser.id));
      if (inv.status === "expired") return jsonRes({ topupStatus: "expired", paymentStatus: "expired" });
      return jsonRes({ topupStatus: inv.status || "awaiting", paymentStatus: "awaiting" });
    }

    // Order payment polling
    if (!orderId) return jsonRes({ error: "Missing orderId or invoiceId" }, 400);
    const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).eq("telegram_id", tgUser.id).maybeSingle();
    if (!order) return jsonRes({ error: "Order not found" }, 404);
    if (order.payment_status === "paid")
      return jsonRes({ paymentStatus: "paid", status: order.status, orderNumber: order.order_number });
    if (!order.invoice_id || !cryptobotToken)
      return jsonRes({ paymentStatus: order.payment_status || "awaiting", status: order.status });

    const r = await fetch(`${CRYPTOBOT_API_URL}/getInvoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": cryptobotToken },
      body: JSON.stringify({ invoice_ids: String(order.invoice_id) }),
    });
    const data = await r.json();
    if (!data.ok || !data.result?.items?.length) return jsonRes({ paymentStatus: "awaiting", status: order.status });
    const inv = data.result.items[0];
    if (inv.status === "expired") {
      await supabase.from("orders").update({ status: "cancelled", payment_status: "expired", updated_at: new Date().toISOString() }).eq("id", orderId);
      return jsonRes({ paymentStatus: "expired", status: "cancelled" });
    }
    if (inv.status !== "paid") return jsonRes({ paymentStatus: "awaiting", status: order.status });

    // Webhook usually handles fulfillment; do a fallback claim+process here in case webhook hasn't fired.
    const { error: claimErr } = await supabase.from("processed_invoices").insert({
      invoice_id: String(order.invoice_id), type: "payment", order_id: orderId,
      telegram_id: tgUser.id, amount: Number(inv.amount) || Number(order.total_amount),
    });
    const alreadyClaimed = claimErr && (claimErr as any).code === "23505";
    if (claimErr && !alreadyClaimed) {
      console.error("[check-payment] claim error:", claimErr);
      return jsonRes({ paymentStatus: "awaiting", status: order.status });
    }
    if (alreadyClaimed) return jsonRes({ paymentStatus: "paid", status: "processing", orderNumber: order.order_number });

    try {
      await supabase.from("orders").update({
        status: "processing", payment_status: "paid", updated_at: new Date().toISOString(),
      }).eq("id", orderId);
      if (order.promo_code) await supabase.rpc("increment_promo_usage", { p_code: order.promo_code });

      const balanceUsed = Number(order.balance_used || 0);
      if (balanceUsed > 0) {
        const { data: nb, error } = await supabase.rpc("deduct_balance", { p_telegram_id: tgUser.id, p_amount: balanceUsed });
        if (!error) {
          await supabase.from("balance_history").insert({
            telegram_id: tgUser.id, amount: -balanceUsed, balance_after: nb, type: "order",
            comment: `Оплата заказа ${order.order_number}`, admin_telegram_id: tgUser.id,
          });
        }
      }

      const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId);
      let allDelivered = true;
      const deliveredContent: string[] = [];
      for (const item of items || []) {
        const { data: reserved } = await supabase.rpc("reserve_inventory", {
          p_product_id: item.product_id, p_quantity: item.quantity, p_order_id: orderId,
        });
        if (!reserved || reserved.length < item.quantity) { allDelivered = false; }
        else {
          reserved.forEach((rr: any) => deliveredContent.push(`${item.product_title}: ${rr.content}`));
          const { count: remaining } = await supabase.from("inventory_items").select("id", { count: "exact", head: true })
            .eq("product_id", item.product_id).eq("status", "available");
          await supabase.from("products").update({ stock: remaining || 0, updated_at: new Date().toISOString() }).eq("id", item.product_id);
        }
      }
      await supabase.from("orders").update({
        status: allDelivered ? "completed" : "processing", updated_at: new Date().toISOString(),
      }).eq("id", orderId);

      if (allDelivered && deliveredContent.length) {
        await notify(botToken, tgUser.id, `✅ <b>Заказ ${order.order_number} оплачен и выполнен!</b>\n\n<pre>${deliveredContent.join("\n")}</pre>`);
      } else {
        await notify(botToken, tgUser.id, `✅ Заказ ${order.order_number} оплачен. Мы выдадим товар вручную в ближайшее время.`);
      }
    } catch (e) {
      console.error("[check-payment] order processing error:", e);
      try { await supabase.from("processed_invoices").delete().eq("invoice_id", String(order.invoice_id)); } catch {}
      return jsonRes({ paymentStatus: "awaiting", status: order.status });
    }

    return jsonRes({ paymentStatus: "paid", status: "processing", orderNumber: order.order_number });
  } catch (e) {
    console.error("[check-payment] error:", e);
    return jsonRes({ error: "Internal error" }, 500);
  }
});
