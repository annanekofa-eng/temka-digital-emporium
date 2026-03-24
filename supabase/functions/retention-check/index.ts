import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

serve(async (req) => {
  try {
    const jobSecret = Deno.env.get("RETENTION_JOB_SECRET");
    const headerSecret = req.headers.get("x-retention-secret");
    if (!jobSecret || headerSecret !== jobSecret) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), { status: 403 });
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceKey);

    // Check if retention is enabled
    const { data: enabledSetting } = await db
      .from("shop_settings")
      .select("value")
      .eq("key", "retention_enabled")
      .maybeSingle();
    if (enabledSetting?.value !== "true") {
      return new Response(JSON.stringify({ ok: true, skipped: true, reason: "disabled" }));
    }

    // Get config
    const getVal = async (k: string, def: string) => {
      const { data } = await db.from("shop_settings").select("value").eq("key", k).maybeSingle();
      return data?.value || def;
    };
    const delayMinutes = parseInt(await getVal("retention_delay_minutes", "1440")) || 1440;
    const messageText = await getVal(
      "retention_message_text",
      "Вы зарегистрировались в TeleStore, но ещё не создали магазин.\n\nЗапустите свой Telegram-магазин за несколько минут — бот, витрина и автопродажи уже готовы.",
    );
    const buttonText = await getVal("retention_button_text", "🚀 Создать магазин");
    const botToken = Deno.env.get("PLATFORM_BOT_TOKEN");
    if (!botToken) {
      console.error("retention-check: PLATFORM_BOT_TOKEN not set");
      return new Response(JSON.stringify({ ok: false, error: "no bot token" }), { status: 500 });
    }

    // Calculate cutoff time
    const cutoff = new Date(Date.now() - delayMinutes * 60 * 1000).toISOString();

    // Get all shop owner IDs
    const { data: shops } = await db.from("shops").select("owner_id");
    const ownerIds = new Set((shops || []).map((s: any) => s.owner_id));

    // Get already-notified telegram IDs
    const { data: notified } = await db.from("platform_retention_log").select("telegram_id");
    const notifiedSet = new Set((notified || []).map((n: any) => n.telegram_id));

    // Get eligible users: registered before cutoff, not a shop owner, not notified
    const { data: users } = await db
      .from("platform_users")
      .select("id, telegram_id, first_name")
      .lte("created_at", cutoff)
      .limit(50);

    if (!users?.length) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }));
    }

    let sent = 0;
    const botUsername = Deno.env.get("PLATFORM_BOT_USERNAME") || "";
    const tgApi = (method: string, body: Record<string, unknown>) =>
      fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then((r) => r.json());

    for (const user of users) {
      // Skip if already a shop owner
      if (ownerIds.has(user.id)) continue;
      // Skip if already notified
      if (notifiedSet.has(user.telegram_id)) continue;

      try {
        // Send the retention message
        const personalizedText = messageText.replace(/{name}/gi, user.first_name || "друг");
        await tgApi("sendMessage", {
          chat_id: user.telegram_id,
          text: personalizedText,
          parse_mode: "HTML",
          reply_markup: {
            inline_keyboard: [
              [{ text: buttonText, callback_data: "p:create" }],
            ],
          },
        });

        // Log as sent (unique index prevents duplicates)
        await db.from("platform_retention_log").insert({
          telegram_id: user.telegram_id,
          message_text: personalizedText.slice(0, 500),
        });

        sent++;
      } catch (e) {
        console.error(`retention-check: failed for ${user.telegram_id}:`, (e as Error).message);
      }
    }

    // Update sent count in settings for stats display
    const { data: curCount } = await db.from("shop_settings").select("value").eq("key", "retention_sent_count").maybeSingle();
    const newCount = (parseInt(curCount?.value || "0") || 0) + sent;
    await db.from("shop_settings").upsert(
      { key: "retention_sent_count", value: String(newCount), updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );

    console.log(`retention-check: sent ${sent} messages`);
    return new Response(JSON.stringify({ ok: true, sent }));
  } catch (e) {
    console.error("retention-check error:", e);
    return new Response(JSON.stringify({ ok: false, error: (e as Error).message }), { status: 500 });
  }
});
