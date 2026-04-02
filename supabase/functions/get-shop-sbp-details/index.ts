import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type SbpConfig = {
  bankName?: string;
  cardNumber?: string;
  recipientName?: string;
  phone?: string;
  comment?: string;
};

const normalizeDetails = (config: SbpConfig | null | undefined) => {
  if (!config) return null;

  return {
    bankName: String(config.bankName ?? ""),
    cardNumber: String(config.cardNumber ?? ""),
    recipientName: String(config.recipientName ?? ""),
    phone: String(config.phone ?? ""),
    comment: String(config.comment ?? ""),
  };
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { shopId } = await req.json().catch(() => ({}));

    if (!shopId || typeof shopId !== "string") {
      return jsonRes({ error: "shopId is required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: isActive, error: activeError } = await supabase.rpc("is_shop_active", {
      p_shop_id: shopId,
    });

    if (activeError) throw activeError;
    if (!isActive) return jsonRes({ enabled: false, details: null }, 404);

    const { data: method, error: methodError } = await supabase
      .from("shop_payment_methods")
      .select("enabled, config_masked, config_encrypted")
      .eq("shop_id", shopId)
      .eq("method", "sbp_card")
      .maybeSingle();

    if (methodError) throw methodError;
    if (!method?.enabled) return jsonRes({ enabled: false, details: null }, 404);

    let details = normalizeDetails(method.config_masked as SbpConfig | null | undefined);
    const encryptionKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");

    if (method.config_encrypted && encryptionKey) {
      const { data: decrypted, error: decryptError } = await supabase.rpc("decrypt_token", {
        p_encrypted: method.config_encrypted,
        p_key: encryptionKey,
      });

      if (decryptError) {
        console.error("Failed to decrypt SBP config:", decryptError.message);
      } else {
        try {
          details = normalizeDetails(JSON.parse(decrypted) as SbpConfig) ?? details;
        } catch (parseError) {
          console.error("Failed to parse SBP config:", parseError);
        }
      }
    }

    return jsonRes({ enabled: true, details });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("get-shop-sbp-details error:", message);
    return jsonRes({ error: message }, 500);
  }
});