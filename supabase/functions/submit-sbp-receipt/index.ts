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

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return arr;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { initData, paymentId, fileBase64, contentType, fileName } = await req.json();
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return jsonRes({ error: "Bot not configured" }, 500);
    if (!initData) return jsonRes({ error: "Authentication required" }, 401);

    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Invalid authentication" }, 401);
    const tgId = tgUser.id;

    if (!paymentId || !fileBase64) return jsonRes({ error: "Missing required fields" }, 400);

    const { data: payment } = await supabase.from("sbp_payments").select("*").eq("id", paymentId).maybeSingle();
    if (!payment) return jsonRes({ error: "Payment not found" }, 404);
    if (payment.telegram_id !== tgId) return jsonRes({ error: "Forbidden" }, 403);
    if (!["awaiting_receipt", "rejected"].includes(payment.status))
      return jsonRes({ error: "Payment is not awaiting receipt" }, 400);

    const bytes = b64ToBytes(fileBase64);
    if (bytes.byteLength > 10 * 1024 * 1024) return jsonRes({ error: "Файл слишком большой (макс 10 МБ)" }, 400);
    const safeType = (contentType || "image/jpeg").toLowerCase();
    if (!["image/jpeg", "image/jpg", "image/png", "image/webp", "application/pdf"].includes(safeType))
      return jsonRes({ error: "Допустимы только JPG, PNG, WEBP, PDF" }, 400);
    const ext = safeType === "application/pdf" ? "pdf"
      : safeType === "image/png" ? "png"
      : safeType === "image/webp" ? "webp" : "jpg";

    const path = `${tgId}/${payment.order_id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("sbp-receipts")
      .upload(path, bytes, { contentType: safeType, upsert: true });
    if (upErr) {
      console.error("upload error", upErr);
      return jsonRes({ error: "Failed to upload receipt" }, 500);
    }

    await supabase.from("sbp_payments").update({
      receipt_url: path, status: "pending_review", reject_reason: null,
      updated_at: new Date().toISOString(),
    }).eq("id", paymentId);

    // Reopen order if it was marked failed after previous rejection
    await supabase.from("orders").update({
      status: "pending", payment_status: "awaiting",
      updated_at: new Date().toISOString(),
    }).eq("id", payment.order_id).eq("payment_status", "failed");

    // Order details for notification
    const { data: order } = await supabase.from("orders").select("order_number, total_amount").eq("id", payment.order_id).maybeSingle();
    const { data: items } = await supabase.from("order_items").select("product_title, quantity").eq("order_id", payment.order_id);

    // Notify admins
    const adminIds = (Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "")
      .split(",").map((s) => s.trim()).filter(Boolean);
    const itemsText = (items || []).map((i: any) => `• ${i.product_title} ×${i.quantity}`).join("\n");
    const adminText = `🆕 <b>Новая заявка СБП</b>\n\nЗаказ: <code>${order?.order_number || ""}</code>\n${itemsText}\nСумма: $${Number(payment.amount_usd).toFixed(2)} = <b>${payment.amount_rub} ₽</b>\nПокупатель: <code>${tgId}</code>\n\nОткройте «📥 Заявки СБП» в /admin.`;

    for (const aid of adminIds) {
      try {
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: Number(aid), parse_mode: "HTML", text: adminText,
            reply_markup: { inline_keyboard: [[{ text: "📥 Открыть заявку", callback_data: `a:sbp:v:${paymentId}` }]] },
          }),
        });
      } catch (e) { console.error("notify admin:", e); }
    }

    // Confirm to buyer
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: tgId, parse_mode: "HTML",
          text: `🕓 <b>Чек получен!</b>\n\nЗаказ <code>${order?.order_number || ""}</code> отправлен на проверку. Мы сообщим, как только подтвердим оплату.`,
        }),
      });
    } catch (e) { console.error(e); }

    return jsonRes({ ok: true });
  } catch (e) {
    console.error("submit-sbp-receipt error:", e);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
