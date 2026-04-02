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

async function fetchUsdtRubRate(): Promise<number> {
  const cryptobotToken = Deno.env.get("CRYPTOBOT_API_TOKEN");
  if (!cryptobotToken) throw new Error("CRYPTOBOT_API_TOKEN not configured");

  for (const base of ["https://pay.crypt.bot/api", "https://testnet-pay.crypt.bot/api"]) {
    try {
      const res = await fetch(`${base}/getExchangeRates`, {
        headers: { "Crypto-Pay-API-Token": cryptobotToken },
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        const data = await res.json();
        const usdtRub = data?.result?.find(
          (r: any) => r.source === "USDT" && r.target === "RUB" && r.is_valid
        );
        if (usdtRub?.rate) return Number(usdtRub.rate);
      }
    } catch { /* try next endpoint */ }
  }

  throw new Error("Could not fetch USDT/RUB rate from CryptoBot");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rate = await fetchUsdtRubRate();

    return jsonRes({
      rate,
      source: "USDT",
      target: "RUB",
      updated_at: new Date().toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("Exchange rate error:", message);
    return jsonRes({ error: message }, 500);
  }
});