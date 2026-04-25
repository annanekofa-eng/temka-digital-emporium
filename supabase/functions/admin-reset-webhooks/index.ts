import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PLATFORM_BOT_TOKEN = Deno.env.get("PLATFORM_BOT_TOKEN")!;
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET")!;
const TOKEN_ENCRYPTION_KEY = Deno.env.get("TOKEN_ENCRYPTION_KEY")!;
const ENFORCE_JOB_SECRET = Deno.env.get("ENFORCE_JOB_SECRET")!;

const PLATFORM_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/platform-bot`;
const SELLER_WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/seller-bot-webhook`;

const maskToken = (s: string) => s.replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, "***");

async function setWebhook(botToken: string, url: string) {
  const res = await fetch(`https://api.telegram.org/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: TELEGRAM_WEBHOOK_SECRET,
      drop_pending_updates: true,
      allowed_updates: ["message", "callback_query", "pre_checkout_query", "my_chat_member", "chat_member"],
    }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, ok: res.ok && data?.ok === true, data };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    // One-shot maintenance endpoint — auth via service-role bearer (only Lovable internal tools have it)
    const auth = req.headers.get("authorization") || "";
    const expected = `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`;
    const jobSecret = req.headers.get("x-job-secret");
    if (auth !== expected && jobSecret !== ENFORCE_JOB_SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const results: any = { platform: null, shops: [] };

    // 1) Platform bot
    try {
      const r = await setWebhook(PLATFORM_BOT_TOKEN, PLATFORM_WEBHOOK_URL);
      results.platform = { ok: r.ok, status: r.status, response: r.data };
    } catch (e) {
      results.platform = { ok: false, error: maskToken(String(e)) };
    }

    // 2) Shop bots
    const { data: shops, error: shopsErr } = await supabase
      .from("shops")
      .select("id, slug, name, bot_username, bot_token_encrypted, status");

    if (shopsErr) throw shopsErr;

    for (const shop of shops ?? []) {
      const entry: any = {
        id: shop.id,
        slug: shop.slug,
        name: shop.name,
        bot_username: shop.bot_username,
        status: shop.status,
      };

      if (!shop.bot_token_encrypted) {
        entry.skipped = "no_token";
        results.shops.push(entry);
        continue;
      }

      try {
        const { data: decrypted, error: decErr } = await supabase.rpc("decrypt_token", {
          p_encrypted: shop.bot_token_encrypted,
          p_key: TOKEN_ENCRYPTION_KEY,
        });
        if (decErr || !decrypted) {
          entry.error = "decrypt_failed";
          results.shops.push(entry);
          continue;
        }
        const r = await setWebhook(decrypted as string, `${SELLER_WEBHOOK_URL}?shop_id=${shop.id}`);
        entry.ok = r.ok;
        entry.status = r.status;
        entry.response = r.data;

        await supabase
          .from("shops")
          .update({ webhook_status: r.ok ? "ok" : "error" })
          .eq("id", shop.id);
      } catch (e) {
        entry.error = maskToken(String(e));
      }
      results.shops.push(entry);
    }

    return new Response(JSON.stringify(results, null, 2), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return new Response(JSON.stringify({ error: maskToken(msg) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});