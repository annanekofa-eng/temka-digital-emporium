import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function validateTarget(raw: string): string | null {
  const t = String(raw || "").trim().replace(/^@/, "");
  if (!t) return null;
  if (/^\d{4,15}$/.test(t)) return t;
  if (/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(t)) return "@" + t;
  return null;
}

function maskToken(s: string): string {
  return s.replace(/\d{6,}:[A-Za-z0-9_-]{20,}/g, "***");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { shopId, query } = body || {};
    if (!shopId || !query) return json({ ok: false, error: "Missing fields" });

    const target = validateTarget(query);
    if (!target) return json({ ok: false, error: "invalid_format" });

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const ek = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!ek) return json({ ok: false, error: "server_config" });

    const { data: shop } = await supabase
      .from("shops").select("bot_token_encrypted, status")
      .eq("id", shopId).maybeSingle();
    if (!shop || shop.status !== "active") return json({ ok: false, error: "shop_unavailable" });
    if (!shop.bot_token_encrypted) return json({ ok: false, error: "bot_not_configured" });

    const { data: botToken } = await supabase.rpc("decrypt_token", {
      p_encrypted: shop.bot_token_encrypted, p_key: ek,
    });
    if (!botToken) return json({ ok: false, error: "bot_not_configured" });

    // Telegram getChat — works for usernames & numeric chat_ids that the bot has seen / public.
    const chatId = target; // "@username" or "12345"
    const url = `https://api.telegram.org/bot${botToken}/getChat`;
    let resp: Response;
    try {
      resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: chatId }),
      });
    } catch (e) {
      console.error("getChat network", maskToken(String(e)));
      return json({ ok: false, error: "network" });
    }
    const tgData: any = await resp.json().catch(() => ({}));
    if (!tgData?.ok || !tgData?.result) {
      const desc = String(tgData?.description || "").toLowerCase();
      if (desc.includes("not found") || desc.includes("chat not found") || desc.includes("invalid")) {
        return json({ ok: false, error: "not_found" });
      }
      return json({ ok: false, error: "unavailable" });
    }

    const r = tgData.result;
    // Reject channels/groups — only private users allowed for stars/premium
    if (r.type && r.type !== "private") {
      return json({ ok: false, error: "not_a_user" });
    }

    // Try to fetch profile photo
    let photoUrl: string | null = null;
    try {
      if (r.photo?.small_file_id) {
        const fr = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_id: r.photo.small_file_id }),
        });
        const fd: any = await fr.json().catch(() => ({}));
        if (fd?.ok && fd?.result?.file_path) {
          photoUrl = `https://api.telegram.org/file/bot${botToken}/${fd.result.file_path}`;
          // Proxy via data URL to avoid leaking token to client
          try {
            const imgResp = await fetch(photoUrl);
            if (imgResp.ok) {
              const buf = new Uint8Array(await imgResp.arrayBuffer());
              const b64 = btoa(String.fromCharCode(...buf));
              const ct = imgResp.headers.get("content-type") || "image/jpeg";
              photoUrl = `data:${ct};base64,${b64}`;
            } else {
              photoUrl = null;
            }
          } catch {
            photoUrl = null;
          }
        }
      }
    } catch (e) {
      console.error("photo fetch", maskToken(String(e)));
    }

    return json({
      ok: true,
      user: {
        id: r.id,
        username: r.username || null,
        firstName: r.first_name || null,
        lastName: r.last_name || null,
        photoUrl,
      },
    });
  } catch (e) {
    console.error("resolve-telegram-user", maskToken(String(e)));
    return json({ ok: false, error: "internal" });
  }
});