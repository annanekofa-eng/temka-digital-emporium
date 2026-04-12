import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cron-callable edge function that enforces subscription/trial expiry.
 * Finds all platform_users whose subscription has expired but status is still
 * 'active' or 'trial', marks them as 'expired', pauses their shops,
 * deactivates seller-bot webhooks, and sends a notification.
 *
 * Call periodically (e.g. every 5–15 min) via external cron or pg_cron.
 * Auth: x-enforce-secret header must match ENFORCE_JOB_SECRET env var.
 */

const PLATFORM_NAME = "TeleStore";

async function removeSellerWebhook(botToken: string) {
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/deleteWebhook`, { method: "POST" });
  } catch {}
}

serve(async (req) => {
  try {
    // Auth: require ENFORCE_JOB_SECRET header OR apikey header matching anon key
    const secret = Deno.env.get("ENFORCE_JOB_SECRET");
    const headerSecret = req.headers.get("x-enforce-secret");
    const apikey = req.headers.get("apikey") || "";
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY") || "";
    const isSecretOk = secret && headerSecret === secret;
    const isApikeyOk = anonKey && apikey === anonKey;
    if (!isSecretOk && !isApikeyOk) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403 });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, svcKey);
    
    const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    const platformBotToken = Deno.env.get("PLATFORM_BOT_TOKEN");

    // Load subscription settings from shop_settings
    const getVal = async (k: string, def: string) => {
      const { data } = await db.from("shop_settings").select("value").eq("key", k).maybeSingle();
      return data?.value ?? def;
    };
    const b = async (k: string, def: boolean) => (await getVal(k, "")) === "" ? def : (await getVal(k, "")).toString() === "true";

    const onExpiryPauseShop = await b("on_expiry_pause_shop", true);
    const onExpiryDeactivateBot = await b("on_expiry_deactivate_bot", true);
    const expiredNotify = await b("expired_notify", true);
    const gracePeriodEnabled = await b("grace_period_enabled", false);
    const gracePeriodDays = parseInt(await getVal("grace_period_days", "3")) || 3;

    // Find users with expired subscriptions still marked active/trial
    const now = new Date().toISOString();
    const { data: expiredUsers, error: queryErr } = await db
      .from("platform_users")
      .select("id, telegram_id, subscription_status, subscription_expires_at, expiry_notified_at")
      .in("subscription_status", ["active", "trial"])
      .not("subscription_expires_at", "is", null)
      .lt("subscription_expires_at", now);

    if (queryErr) {
      console.error("subscription-enforce: query error", queryErr);
      return new Response(JSON.stringify({ ok: false, error: queryErr.message }), { status: 500 });
    }

    if (!expiredUsers?.length) {
      return new Response(JSON.stringify({ ok: true, processed: 0 }));
    }

    let processed = 0;
    let paused = 0;
    let notified = 0;

    for (const user of expiredUsers) {
      const expiresAt = new Date(user.subscription_expires_at!).getTime();
      const daysExpiredAgo = (Date.now() - expiresAt) / 86400000;

      // Grace period check (only for active, not trial)
      if (gracePeriodEnabled && user.subscription_status === "active") {
        if (daysExpiredAgo <= gracePeriodDays) {
          // Still in grace period — just update status
          await db.from("platform_users")
            .update({ subscription_status: "grace_period", updated_at: new Date().toISOString() })
            .eq("id", user.id)
            .eq("subscription_status", "active"); // prevent race
          continue;
        }
      }

      // Mark as expired
      await db.from("platform_users")
        .update({ subscription_status: "expired", updated_at: new Date().toISOString() })
        .eq("id", user.id);

      processed++;

      // Pause shops
      if (onExpiryPauseShop) {
        const { data: shops } = await db
          .from("shops")
          .select("id, bot_token_encrypted, name")
          .eq("owner_id", user.id)
          .eq("status", "active");

        for (const shop of shops || []) {
          await db.from("shops")
            .update({ status: "paused", updated_at: new Date().toISOString() })
            .eq("id", shop.id);
          paused++;

          // Deactivate bot webhook
          if (onExpiryDeactivateBot && shop.bot_token_encrypted && encKey) {
            try {
              const { data: rawToken } = await db.rpc("decrypt_token", {
                p_encrypted: shop.bot_token_encrypted,
                p_key: encKey,
              });
              if (rawToken) await removeSellerWebhook(rawToken);
            } catch {}
          }
        }

        // Send expiry notification
        if (expiredNotify && !user.expiry_notified_at && platformBotToken) {
          const shopNames = (shops || []).map((s: any) => s.name).join(", ") || "—";
          const msg = `❌ <b>Подписка закончилась</b>\n\nВаша подписка на <b>${PLATFORM_NAME}</b> истекла.\n\n🏪 Магазины переведены в ограниченный режим:\n${shopNames}\n\n🤖 Боты магазинов деактивированы.\n\nДля возобновления работы продлите подписку.`;
          try {
            await fetch(`https://api.telegram.org/bot${platformBotToken}/sendMessage`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: user.telegram_id, text: msg, parse_mode: "HTML" }),
            });
            notified++;
          } catch {}

          await db.from("platform_users")
            .update({ expiry_notified_at: new Date().toISOString() })
            .eq("id", user.id);
        }
      }
    }

    console.log(`subscription-enforce: processed=${processed}, paused=${paused}, notified=${notified}`);
    return new Response(JSON.stringify({ ok: true, processed, paused, notified }));
  } catch (e) {
    console.error("subscription-enforce error:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500 });
  }
});
