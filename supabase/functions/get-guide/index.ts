import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Plan = "start" | "basic" | "premium";
const PLAN_RANK: Record<Plan, number> = { start: 0, basic: 1, premium: 2 };

/** Guides catalog. Add new entries here when ready. */
const GUIDES: Record<string, { required_plan: Plan; section: string; title: string; body: string; public?: boolean }> = {
  "mailing-manual": {
    required_plan: "start",
    section: "attraction",
    title: "📩 Мануал по рассылке",
    public: true,
    body: [
      "📩 <b>Мануал по рассылке</b>",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "🕐 <b>Шаг 1. Выбор интервала</b>",
      "Работай блоками по <b>~2 часа</b>.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "⚙️ <b>Шаг 2. Настройка отправки</b>",
      "• Расставь сообщения во все нужные чаты",
      "• Используй <b>отложенную отправку</b> с ежедневным КД",
      "  <i>(нужен Telegram Premium)</i>",
      "• Интервал между сообщениями: <b>15–20 минут</b>",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "💤 <b>Шаг 3. После блока</b>",
      "Дай аккаунту отдохнуть <b>пару часов</b>.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "🔁 <b>Шаг 4. Повтор</b>",
      "После паузы запускай следующий цикл.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "📅 <b>Ежедневная работа</b>",
      "• Ставь рассылки заранее через отложку",
      "  с ежедневным КД при помощи <b>Telegram Premium</b>",
      "• Если аккаунт новый — <b>2–3 цикла</b> в день",
      "• Дальше увеличивай по мере прогрева аккаунта",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "✅ <b>Главное правило:</b> прогревай аккаунт постепенно, не спеши с объёмами.",
    ].join("\n"),
  },
  "audience-management": {
    required_plan: "start",
    section: "clients",
    title: "👥 Гайд по работе с аудиторией",
    public: true,
    body: [
      "👥 <b>Гайд по работе с аудиторией</b>",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "🔒 <b>Удержание аудитории</b>",
      "Используй обязательную подписку (<code>/admin</code> → <b>ОП</b>),",
      "чтобы сохранять трафик и не терять пользователей.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "📰 <b>Контент</b>",
      "Регулярно публикуй новости и обновления,",
      "чтобы поддерживать активность аудитории.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "📨 <b>Рассылки</b>",
      "Не забывай использовать функцию рассылки",
      "(<code>/admin</code> → <b>рассылка</b>) для взаимодействия",
      "с аудиторией и возврата пользователей.",
      "",
      "━━━━━━━━━━━━━━━━━━",
      "",
      "📌 <b>Важно</b>",
      "Если не удерживать аудиторию — трафик просто уходит:",
      "люди приходят и уходят без возврата.",
      "",
      "Грамотная работа с <b>подпиской</b>, <b>контентом</b> и <b>рассылками</b>",
      "позволяет не только сохранять пользователей, но и постепенно",
      "увеличивать их вовлечённость и ценность.",
    ].join("\n"),
  },
};

function verifyTelegramInitData(initData: string, botToken: string): { ok: boolean; userId?: number } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { ok: false };
    params.delete("hash");
    const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const hmac = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (hmac !== hash) return { ok: false };
    const authDate = params.get("auth_date");
    if (!authDate) return { ok: false };
    const now = Math.floor(Date.now() / 1000);
    if (now - Number(authDate) > 300) return { ok: false };
    const userStr = params.get("user");
    const user = userStr ? JSON.parse(userStr) : null;
    if (!user?.id) return { ok: false };
    return { ok: true, userId: Number(user.id) };
  } catch {
    return { ok: false };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { initData, guideId } = body || {};

    if (!guideId || typeof guideId !== "string") {
      return json({ ok: false, error: "missing_guide_id" }, 400);
    }
    const guide = GUIDES[guideId];
    if (!guide) return json({ ok: false, error: "not_found" }, 404);

    const botToken = Deno.env.get("PLATFORM_BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ ok: false, error: "server_config" }, 500);

    let userPlan: Plan | null = null;
    if (initData && typeof initData === "string") {
      const v = verifyTelegramInitData(initData, botToken);
      if (v.ok && v.userId) {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data: u } = await supabase
          .from("platform_users")
          .select("subscription_plan, subscription_status, subscription_expires_at")
          .eq("telegram_id", v.userId)
          .maybeSingle();
        if (u) {
          const active =
            ["active", "trial", "grace_period"].includes(String(u.subscription_status)) &&
            (!u.subscription_expires_at || new Date(u.subscription_expires_at) > new Date());
          if (active && (u.subscription_plan === "start" || u.subscription_plan === "basic" || u.subscription_plan === "premium")) {
            userPlan = u.subscription_plan as Plan;
          }
        }
      }
    }

    const required = guide.required_plan;
    const hasAccess =
      guide.public === true ||
      (userPlan !== null && PLAN_RANK[userPlan] >= PLAN_RANK[required]);

    if (!hasAccess) {
      return json({
        ok: false,
        error: "forbidden",
        required_plan: required,
        user_plan: userPlan,
      }, 403);
    }

    return json({
      ok: true,
      guide: {
        id: guideId,
        title: guide.title,
        body: guide.body || "Контент скоро будет добавлен.",
        required_plan: required,
      },
    });
  } catch (e) {
    console.error("get-guide error", String(e));
    return json({ ok: false, error: "internal" }, 500);
  }
});