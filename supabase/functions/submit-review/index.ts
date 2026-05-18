import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function verifyAndExtractUser(initData: string, botToken: string): any | null {
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

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const body = await req.json().catch(() => ({}));
    const { initData, action, rating, text, productId, reviewId } = body || {};
    console.log("[submit-review] incoming", { hasInitData: !!initData, action, rating, textLen: text?.length, productId });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) { console.error("[submit-review] no bot token"); return jsonRes({ error: "Бот не настроен" }, 500); }
    if (!initData) { console.warn("[submit-review] missing initData"); return jsonRes({ error: "Откройте через Telegram" }, 401); }
    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) { console.warn("[submit-review] initData verify failed"); return jsonRes({ error: "Сессия Telegram истекла, перезайдите" }, 401); }

    if (action === "delete") {
      if (!reviewId) return jsonRes({ error: "reviewId required" }, 400);
      await supabase.from("reviews").delete().eq("id", reviewId).eq("telegram_id", tgUser.id);
      return jsonRes({ ok: true });
    }

    const r = Number(rating);
    const t = String(text || "").trim();
    if (!r || r < 1 || r > 5) return jsonRes({ error: "Некорректный рейтинг" }, 400);
    if (t.length < 3 || t.length > 1000) return jsonRes({ error: "Текст отзыва должен быть от 3 до 1000 символов" }, 400);

    // Allow one review per (user, product). Global product (00..) treated as separate slot.
    const effectiveProductId = productId || "00000000-0000-0000-0000-000000000000";
    const { data: existing } = await supabase
      .from("reviews")
      .select("id")
      .eq("telegram_id", tgUser.id)
      .eq("product_id", effectiveProductId)
      .maybeSingle();
    if (existing) return jsonRes({ error: "Вы уже оставили отзыв на этот товар" }, 400);

    const author = tgUser.username ? `@${tgUser.username}` : `${tgUser.first_name || "User"}${tgUser.last_name ? ` ${tgUser.last_name}` : ""}`;
    const { error } = await supabase.from("reviews").insert({
      product_id: effectiveProductId,
      telegram_id: tgUser.id,
      author,
      avatar: tgUser.photo_url || "",
      rating: r,
      text: t,
      verified: false,
      moderation_status: "pending",
    });
    if (error) { console.error("[submit-review] insert error", error); return jsonRes({ error: error.message }, 500); }
    return jsonRes({ ok: true });
  } catch (e) {
    console.error("[submit-review] fatal", e);
    return jsonRes({ error: "Internal error" }, 500);
  }
});
