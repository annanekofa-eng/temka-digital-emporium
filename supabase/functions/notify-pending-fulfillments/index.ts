// Cron-invoked worker. Reads pending_notifications and delivers them via Telegram.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const escapeHtml = (s: unknown) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function tgSend(botToken: string, chatId: number, text: string) {
  const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
  });
  if (!r.ok) {
    const body = await r.text();
    throw new Error(`tg ${r.status}: ${body.slice(0, 200)}`);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) {
    return new Response(JSON.stringify({ error: "Bot not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Clean up old delivered/failed entries (>7 days)
  await supabase.from("pending_notifications").delete()
    .lt("created_at", new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString())
    .not("sent_at", "is", null);

  const { data: rows } = await supabase.from("pending_notifications")
    .select("*").is("sent_at", null).lt("attempts", 5)
    .order("created_at", { ascending: true }).limit(50);

  let sent = 0, failed = 0;
  for (const row of rows ?? []) {
    try {
      const p = row.payload || {};
      const items: Array<{ content: string }> = Array.isArray(p.items) ? p.items : [];
      const lines = items.map((g) => `<code>${escapeHtml(g.content)}</code>`).join("\n");
      const productTitle = escapeHtml(p.product_title || "Товар");
      const orderNumber = escapeHtml(p.order_number || "");
      const text =
        `🎁 <b>Товар выдан!</b>\n` +
        `📦 Заказ: <code>${orderNumber}</code>\n\n` +
        `<b>${productTitle}</b> (×${items.length}):\n${lines}\n\n` +
        `⚠️ <b>Сохраните данные!</b>`;
      await tgSend(botToken, Number(row.telegram_id), text);
      await supabase.from("pending_notifications").update({
        sent_at: new Date().toISOString(),
        attempts: (row.attempts || 0) + 1,
      }).eq("id", row.id);
      sent++;
    } catch (e: any) {
      failed++;
      await supabase.from("pending_notifications").update({
        attempts: (row.attempts || 0) + 1,
        last_error: String(e?.message || e).slice(0, 500),
      }).eq("id", row.id);
    }
  }

  return new Response(JSON.stringify({ ok: true, sent, failed, scanned: rows?.length ?? 0 }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
