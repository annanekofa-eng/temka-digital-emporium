import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function verifyAndExtractUser(initData: string, botToken: string): { id: number; first_name?: string; last_name?: string; username?: string; photo_url?: string; language_code?: string; is_premium?: boolean } | null {
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

async function ensureProfile(supabase: any, u: any) {
  await supabase.from("user_profiles").upsert({
    telegram_id: u.id,
    first_name: u.first_name || "",
    last_name: u.last_name || null,
    username: u.username || null,
    photo_url: u.photo_url || null,
    language_code: u.language_code || null,
    is_premium: !!u.is_premium,
    updated_at: new Date().toISOString(),
  }, { onConflict: "telegram_id", ignoreDuplicates: false });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json();
    const { initData, action } = body;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return jsonRes({ error: "Bot not configured" }, 500);
    if (!initData) return jsonRes({ error: "Auth required" }, 401);
    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Invalid auth" }, 401);
    const tgId = tgUser.id;
    await ensureProfile(supabase, tgUser);

    switch (action) {
      case "profile": {
        const { data } = await supabase.from("user_profiles")
          .select("balance, role, is_blocked")
          .eq("telegram_id", tgId).maybeSingle();
        return jsonRes({ profile: data || { balance: 0, role: "user", is_blocked: false } });
      }
      case "orders": {
        const { data } = await supabase.from("orders").select("*")
          .eq("telegram_id", tgId).order("created_at", { ascending: false }).limit(100);
        return jsonRes({ orders: data || [] });
      }
      case "order-items": {
        const { orderId } = body;
        if (!orderId) return jsonRes({ error: "orderId required" }, 400);
        const { data: order } = await supabase.from("orders").select("id").eq("id", orderId).eq("telegram_id", tgId).maybeSingle();
        if (!order) return jsonRes({ items: [] });
        const { data } = await supabase.from("order_items").select("*").eq("order_id", orderId);
        return jsonRes({ items: data || [] });
      }
      case "order-inventory": {
        const { orderId } = body;
        if (!orderId) return jsonRes({ error: "orderId required" }, 400);
        const { data: order } = await supabase.from("orders").select("id, payment_status").eq("id", orderId).eq("telegram_id", tgId).maybeSingle();
        if (!order || order.payment_status !== "paid") return jsonRes({ items: [] });
        const { data } = await supabase.from("inventory_items").select("*").eq("order_id", orderId);
        return jsonRes({ items: data || [] });
      }
      case "stats": {
        const { data } = await supabase.from("orders")
          .select("total_amount, discount_amount, payment_status")
          .eq("telegram_id", tgId);
        const paid = (data || []).filter((o: any) => o.payment_status === "paid");
        const totalSpent = paid.reduce((s: number, o: any) => s + Math.max(0, Number(o.total_amount) - Number(o.discount_amount || 0)), 0);
        return jsonRes({ stats: { orderCount: (data || []).length, totalSpent } });
      }
      case "balance-history": {
        const { data } = await supabase.from("balance_history").select("*")
          .eq("telegram_id", tgId).order("created_at", { ascending: false }).limit(100);
        return jsonRes({ history: data || [] });
      }
      case "my-review": {
        const { data } = await supabase.from("reviews").select("id").eq("telegram_id", tgId).maybeSingle();
        return jsonRes({ reviewId: data?.id || null });
      }
      case "check-promo-usage": {
        const { code } = body;
        if (!code) return jsonRes({ count: 0 });
        const { count } = await supabase.from("orders").select("id", { count: "exact", head: true })
          .eq("telegram_id", tgId).eq("promo_code", String(code).trim().toUpperCase())
          .in("payment_status", ["paid", "awaiting"]);
        return jsonRes({ count: count || 0 });
      }
      default:
        return jsonRes({ error: "Unknown action" }, 400);
    }
  } catch (e) {
    console.error("[get-my-data]", e);
    return jsonRes({ error: "Internal error" }, 500);
  }
});
