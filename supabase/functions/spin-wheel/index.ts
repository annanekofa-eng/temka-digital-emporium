import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const PRIZES: Array<{ value: number; weight: number }> = [
  { value: 75, weight: 2 },
  { value: 50, weight: 4 },
  { value: 25, weight: 8 },
  { value: 15, weight: 14 },
  { value: 10, weight: 28 },
  { value: 5,  weight: 44 },
];

function pickPrize(): number {
  const total = PRIZES.reduce((s, p) => s + p.weight, 0);
  // Cryptographically random for fairness
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  let r = (buf[0] / 0xffffffff) * total;
  for (const p of PRIZES) {
    if (r < p.weight) return p.value;
    r -= p.weight;
  }
  return 0;
}

function verifyAndExtractUser(initData: string, botToken: string): any | null {
  try {
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
    return JSON.parse(params.get("user") || "");
  } catch {
    return null;
  }
}

function randomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const buf = new Uint8Array(8);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < 8; i++) s += alphabet[buf[i] % alphabet.length];
  return s;
}

// Promo TTL: give the user enough room to actually use it (72h)
const PROMO_TTL_MS = 72 * 60 * 60 * 1000;

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

    if (action === "status") {
      const { data, error } = await supabase.rpc("get_wheel_status", { p_telegram_id: tgId });
      if (error) return jsonRes({ error: error.message }, 500);
      return jsonRes(data);
    }

    if (action !== "spin") return jsonRes({ error: "Unknown action" }, 400);

    // Pick prize, then ATOMICALLY claim a spin slot
    const prize = pickPrize();
    const { data: claim, error: claimErr } = await supabase.rpc("try_claim_wheel_spin", {
      p_telegram_id: tgId,
      p_prize: prize,
    });
    if (claimErr) {
      console.error("[spin-wheel] claim", claimErr);
      return jsonRes({ error: claimErr.message }, 500);
    }
    if (!claim?.ok) {
      // Return 200 with `cooldown` flag so the frontend can show the timer cleanly
      return jsonRes({ cooldown: true, nextSpinAt: claim?.nextSpinAt ?? null });
    }

    let promoCode: string | null = null;
    if (prize > 0) {
      const validUntil = new Date(Date.now() + PROMO_TTL_MS).toISOString();
      for (let attempt = 0; attempt < 6; attempt++) {
        const code = `WHEEL${prize}-${randomCode()}`;
        const { error: insErr } = await supabase.from("promocodes").insert({
          code,
          discount_type: "percent",
          discount_value: prize,
          is_active: true,
          max_uses: 1,
          max_uses_per_user: 1,
          owner_telegram_id: tgId,
          valid_until: validUntil,
        });
        if (!insErr) { promoCode = code; break; }
      }
      if (promoCode) {
        await supabase.rpc("attach_wheel_promo", {
          p_spin_id: claim.spinId,
          p_telegram_id: tgId,
          p_code: promoCode,
        });
      } else {
        console.error("[spin-wheel] failed to mint promo after retries");
      }
    }

    return jsonRes({ ok: true, prize, promoCode, nextSpinAt: claim.nextSpinAt });
  } catch (e) {
    console.error("[spin-wheel]", e);
    return jsonRes({ error: "Internal error" }, 500);
  }
});
