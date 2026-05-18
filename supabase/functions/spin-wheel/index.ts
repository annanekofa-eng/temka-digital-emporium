import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Probability table — sums to 100
const PRIZES: Array<{ value: number; weight: number }> = [
  { value: 75, weight: 3 },
  { value: 50, weight: 5 },
  { value: 25, weight: 8 },
  { value: 15, weight: 12 },
  { value: 10, weight: 20 },
  { value: 5, weight: 22 },
  { value: 0, weight: 30 },
];

function pickPrize(): number {
  const total = PRIZES.reduce((s, p) => s + p.weight, 0);
  let r = Math.random() * total;
  for (const p of PRIZES) {
    if (r < p.weight) return p.value;
    r -= p.weight;
  }
  return 0;
}

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
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 86400) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return jsonRes({ error: "Bot not configured" }, 500);

    const body = await req.json().catch(() => ({}));
    const { initData, action } = body as { initData?: string; action?: string };
    if (!initData) return jsonRes({ error: "Auth required" }, 401);
    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser?.id) return jsonRes({ error: "Invalid auth" }, 401);

    const tgId = Number(tgUser.id);

    // GET STATUS
    if (action === "status") {
      const { data, error } = await supabase.rpc("get_wheel_status", { p_telegram_id: tgId });
      if (error) return jsonRes({ error: error.message }, 500);
      return jsonRes(data);
    }

    // SPIN
    const { data: status, error: statusErr } = await supabase.rpc("get_wheel_status", { p_telegram_id: tgId });
    if (statusErr) return jsonRes({ error: statusErr.message }, 500);
    if (!status.canSpin) {
      return jsonRes({ error: "cooldown", nextSpinAt: status.nextSpinAt }, 429);
    }

    const prize = pickPrize();
    let promoCode: string | null = null;

    if (prize > 0) {
      // Generate unique promo code, single-use, valid 24h
      const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = `WHEEL${prize}-${randomCode()}`;
        const { error: insErr } = await supabase.from("promocodes").insert({
          code,
          discount_type: "percent",
          discount_value: prize,
          is_active: true,
          max_uses: 1,
          max_uses_per_user: 1,
          valid_until: validUntil,
        });
        if (!insErr) {
          promoCode = code;
          break;
        }
        // retry on unique conflict
      }
    }

    const { error: spinErr } = await supabase.from("wheel_spins").insert({
      telegram_id: tgId,
      prize_value: prize,
      promo_code: promoCode,
    });
    if (spinErr) return jsonRes({ error: spinErr.message }, 500);

    const nextSpinAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    return jsonRes({ ok: true, prize, promoCode, nextSpinAt });
  } catch (e) {
    console.error("[spin-wheel]", e);
    return jsonRes({ error: "Internal error" }, 500);
  }
});
