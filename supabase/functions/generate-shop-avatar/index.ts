import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function verifyAndExtractUser(initData: string, botToken: string): { id: number } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  if (createHmac("sha256", secretKey).update(dcs).digest("hex") !== hash) return null;
  const authDate = params.get("auth_date");
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 300) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

const SHOP_AVATAR_SYSTEM_PROMPT = `Ты — генератор логотипов для Telegram-магазинов.
Создай минималистичный, современный логотип-аватар:
— квадратный формат, чистая композиция, центральный объект;
— яркий, узнаваемый цвет (предпочтительно сине-фиолетовая или градиентная палитра);
— без текста и без водяных знаков;
— подходит как аватарка чата (хорошо читается в круге размером 64×64);
— стиль: flat / soft 3D / glass, премиальный e-commerce.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { initData, shopId, prompt } = await req.json().catch(() => ({}));
    if (!initData) return jsonRes({ error: "Откройте через Telegram" }, 401);
    if (!shopId) return jsonRes({ error: "shopId обязателен" }, 400);
    if (!prompt || typeof prompt !== "string" || prompt.length < 3 || prompt.length > 300) {
      return jsonRes({ error: "Опишите магазин (3–300 символов)" }, 400);
    }

    const botToken = Deno.env.get("PLATFORM_BOT_TOKEN");
    if (!botToken) return jsonRes({ error: "Бот не настроен" }, 500);
    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Ошибка авторизации" }, 401);
    const telegramId = tgUser.id;

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) return jsonRes({ error: "AI не настроен" }, 500);

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Verify entitlement
    const { data: entitled } = await supabase.rpc("has_entitlement", { p_telegram_id: telegramId, p_feature: "ai_avatar" });
    if (!entitled) return jsonRes({ error: "AI-аватарка доступна только на Премиум" }, 403);

    // Verify ownership of shop
    const { data: pUser } = await supabase.from("platform_users").select("id").eq("telegram_id", telegramId).maybeSingle();
    if (!pUser?.id) return jsonRes({ error: "Пользователь не найден" }, 404);
    const { data: shop } = await supabase.from("shops").select("id, owner_id, ai_avatar_generated_at").eq("id", shopId).maybeSingle();
    if (!shop || shop.owner_id !== pUser.id) return jsonRes({ error: "Магазин не найден или не принадлежит вам" }, 403);

    // Rate limit: max 5 / hour
    if (shop.ai_avatar_generated_at) {
      const ago = Date.now() - new Date(shop.ai_avatar_generated_at).getTime();
      if (ago < 30_000) return jsonRes({ error: "Подождите 30 секунд между генерациями" }, 429);
    }

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash-image",
        messages: [
          { role: "user", content: `${SHOP_AVATAR_SYSTEM_PROMPT}\n\nОписание магазина: ${prompt}` },
        ],
        modalities: ["image", "text"],
      }),
    });

    if (aiRes.status === 429) return jsonRes({ error: "Слишком много запросов к AI. Попробуйте позже." }, 429);
    if (aiRes.status === 402) return jsonRes({ error: "Лимит AI исчерпан. Обратитесь в поддержку." }, 402);
    if (!aiRes.ok) {
      const t = await aiRes.text();
      console.error("[generate-shop-avatar] AI err:", aiRes.status, t.slice(0, 200));
      return jsonRes({ error: "Ошибка генерации" }, 502);
    }

    const aiJson = await aiRes.json();
    const dataUrl = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (!dataUrl || !dataUrl.startsWith("data:image/")) {
      return jsonRes({ error: "AI не вернул изображение" }, 502);
    }

    // Upload to bot-avatars bucket
    const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
    if (!m) return jsonRes({ error: "Неверный формат изображения" }, 502);
    const mime = m[1];
    const ext = mime.split("/")[1] || "png";
    const bytes = Uint8Array.from(atob(m[2]), c => c.charCodeAt(0));
    const path = `ai/${shopId}-${Date.now()}.${ext}`;

    const { error: upErr } = await supabase.storage.from("bot-avatars").upload(path, bytes, {
      contentType: mime, upsert: false,
    });
    if (upErr) {
      console.error("[generate-shop-avatar] upload err:", upErr);
      return jsonRes({ error: "Не удалось сохранить картинку" }, 500);
    }
    const { data: pub } = supabase.storage.from("bot-avatars").getPublicUrl(path);
    const publicUrl = pub.publicUrl;

    await supabase.from("shops").update({
      bot_avatar_url: publicUrl,
      ai_avatar_generated_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("id", shopId);

    return jsonRes({ avatarUrl: publicUrl });
  } catch (e: any) {
    console.error("[generate-shop-avatar] error:", e?.message || e);
    return jsonRes({ error: "Внутренняя ошибка" }, 500);
  }
});