import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

// Cache rates in module memory for 60s to avoid hammering CoinGecko
type Rates = Record<string, number>; // ticker -> usd value of 1 unit
let cache: { ts: number; rates: Rates } | null = null;

const COINGECKO_IDS: Record<string, string> = {
  TONCOIN: "the-open-network",
  TON: "the-open-network",
  USDT: "tether",
  BTC: "bitcoin",
  ETH: "ethereum",
  BNB: "binancecoin",
  TRX: "tron",
  SOL: "solana",
  NOT: "notcoin",
  HMSTR: "hamster-kombat",
  DOGS: "dogs-2",
  CATI: "catizen",
  MAJOR: "major",
  PX: "not-pixel",
};

async function fetchRates(): Promise<Rates> {
  if (cache && Date.now() - cache.ts < 60_000) return cache.rates;
  const ids = Object.values(COINGECKO_IDS).join(",");
  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
  );
  if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
  const data = await res.json();
  const rates: Rates = {};
  for (const [ticker, id] of Object.entries(COINGECKO_IDS)) {
    const v = data?.[id]?.usd;
    if (typeof v === "number" && v > 0) rates[ticker] = v;
  }
  // Sanity: USDT pinned to 1 if missing
  if (!rates.USDT) rates.USDT = 1;
  cache = { ts: Date.now(), rates };
  return rates;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const rates = await fetchRates();
    return jsonRes({ rates, ts: Date.now() });
  } catch (e) {
    console.error("xrocket-rates error:", e);
    // Fallback: USDT=1 only
    return jsonRes({ rates: { USDT: 1 }, ts: Date.now(), warning: "fallback" });
  }
});
