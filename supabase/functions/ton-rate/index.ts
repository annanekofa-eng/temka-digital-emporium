import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// In-memory cache (per-instance, ~5 min TTL)
let cachedRate: { usdPerTon: number; updatedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchUsdPerTon(): Promise<number> {
  // 1) TonAPI (no key required for /v2/rates)
  try {
    const res = await fetch(
      "https://tonapi.io/v2/rates?tokens=ton&currencies=usd",
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = await res.json();
      const rate = Number(data?.rates?.TON?.prices?.USD);
      if (Number.isFinite(rate) && rate > 0) return rate;
    }
  } catch (e) {
    console.warn("[ton-rate] tonapi failed:", (e as Error).message);
  }

  // 2) CoinGecko fallback
  try {
    const res = await fetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=the-open-network&vs_currencies=usd",
      { signal: AbortSignal.timeout(5000) },
    );
    if (res.ok) {
      const data = await res.json();
      const rate = Number(data?.["the-open-network"]?.usd);
      if (Number.isFinite(rate) && rate > 0) return rate;
    }
  } catch (e) {
    console.warn("[ton-rate] coingecko failed:", (e as Error).message);
  }

  throw new Error("Could not fetch TON/USD rate");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const now = Date.now();
    if (!cachedRate || now - cachedRate.updatedAt > CACHE_TTL_MS) {
      const usdPerTon = await fetchUsdPerTon();
      cachedRate = { usdPerTon, updatedAt: now };
    }
    return jsonRes({
      usdPerTon: cachedRate.usdPerTon,
      tonPerUsd: 1 / cachedRate.usdPerTon,
      updatedAt: new Date(cachedRate.updatedAt).toISOString(),
      cached: now - cachedRate.updatedAt < CACHE_TTL_MS && cachedRate.updatedAt !== now,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("ton-rate error:", message);
    return jsonRes({ error: message }, 500);
  }
});