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

const SHOP_AVATAR_SYSTEM_PROMPT = `Ты — арт-директор Telegram-магазинов. Создай готовую аватарку магазина, а не общий арт.
Формат: квадрат 1:1, один крупный центральный знак/маскот/предмет, читаемый внутри круглой аватарки 64×64.
Без текста, букв, логотипов брендов, водяных знаков, мелких деталей и интерфейсов.
Стиль: премиальный e-commerce, чистые формы, выразительный силуэт, аккуратный свет, контрастный фон.
Выбирай визуальную метафору строго по нише магазина. Если пользователь просит game/esports — делай игровую эмблему/контроллер/маскота без надписей.
Качество: crisp icon, polished, 4K.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { initData, shopId, prompt, action, parentId, applyImageUrl } = await req.json().catch(() => ({}));
    if (!initData) return jsonRes({ error: "Откройте через Telegram" }, 401);
    if (!shopId) return jsonRes({ error: "shopId обязателен" }, 400);

    const botToken = Deno.env.get("PLATFORM_BOT_TOKEN");
    if (!botToken) return jsonRes({ error: "Бот не настроен" }, 500);
    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) return jsonRes({ error: "Ошибка авторизации" }, 401);
    const telegramId = tgUser.id;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Verify ownership of shop (доступно всем владельцам с любой подпиской)
    const { data: pUser } = await supabase.from("platform_users").select("id").eq("telegram_id", telegramId).maybeSingle();
    if (!pUser?.id) return jsonRes({ error: "Пользователь не найден" }, 404);
    const { data: shop } = await supabase.from("shops").select("id, owner_id").eq("id", shopId).maybeSingle();
    if (!shop || shop.owner_id !== pUser.id) return jsonRes({ error: "Магазин не найден или не принадлежит вам" }, 403);

    // ── action: quota — вернуть лимит ────────
    const quotaRes = await supabase.rpc("get_shop_ai_avatar_quota" as any, { p_shop_id: shopId });
    const quota = (quotaRes.data as any) || { limit: 3, used: 0, remaining: 3, cycle_start: null };

    if (action === "quota") {
      return jsonRes({ quota });
    }

    // ── action: apply — установить выбранную картинку как аватарку ───
    if (action === "apply") {
      if (!applyImageUrl || typeof applyImageUrl !== "string") {
        return jsonRes({ error: "applyImageUrl обязателен" }, 400);
      }
      await supabase.from("shops").update({
        bot_avatar_url: applyImageUrl,
        ai_avatar_generated_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq("id", shopId);
      return jsonRes({ ok: true, avatarUrl: applyImageUrl });
    }

    // ── action: generate (default) ───────
    if (!prompt || typeof prompt !== "string" || prompt.length < 3 || prompt.length > 500) {
      return jsonRes({ error: "Опишите магазин (3–500 символов)" }, 400);
    }
    if (quota.remaining <= 0) {
      return jsonRes({ error: `Лимит исчерпан: ${quota.used}/${quota.limit} в этом цикле подписки. Лимит обновится при продлении.`, quota }, 402);
    }

    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) return jsonRes({ error: "AI не настроен" }, 500);

    // Если parentId — это «правка» предыдущей картинки: добавляем её как контекст для image-edit
    let parentImageUrl: string | null = null;
    if (parentId) {
      const { data: parent } = await supabase
        .from("shop_ai_avatar_generations")
        .select("image_url, prompt")
        .eq("id", parentId)
        .maybeSingle();
      parentImageUrl = (parent as any)?.image_url || null;
    }

    const userContent: any[] = [
      { type: "text", text: `${SHOP_AVATAR_SYSTEM_PROMPT}\n\n${parentImageUrl ? "Внеси изменения в существующую картинку согласно описанию." : "Описание магазина:"} ${prompt}` },
    ];
    if (parentImageUrl) {
      userContent.push({ type: "image_url", image_url: { url: parentImageUrl } });
    }

    const models = [
      "google/gemini-2.5-flash-image",
      "google/gemini-3.1-flash-image-preview",
      "google/gemini-3-pro-image-preview",
    ];
    let aiRes: Response | null = null;
    let dataUrl: string | null = null;
    let lastStatus = 0;
    for (const model of models) {
      aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: userContent }],
          modalities: ["image", "text"],
        }),
      });
      lastStatus = aiRes.status;
      if (!aiRes.ok) {
        const errText = await aiRes.text().catch(() => "");
        console.error("[generate-shop-avatar] AI err:", model, aiRes.status, errText.slice(0, 200));
        if (aiRes.status !== 429 && aiRes.status !== 503) break;
        continue;
      }
      const aiJson = await aiRes.json().catch(() => null);
      const url = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
      if (typeof url === "string" && url.startsWith("data:image/")) {
        dataUrl = url;
        break;
      }
      console.error("[generate-shop-avatar] no image from", model, "finish:", aiJson?.choices?.[0]?.finish_reason);
    }
    if (!dataUrl) {
      if (lastStatus === 429) return jsonRes({ error: "Слишком много запросов к AI. Попробуйте через минуту." }, 429);
      if (lastStatus === 402) return jsonRes({ error: "Лимит AI исчерпан. Обратитесь в поддержку." }, 402);
      return jsonRes({ error: "AI не вернул изображение. Попробуйте другой prompt." }, 502);
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

    // Записываем генерацию в историю с привязкой к циклу
    const cycleStart = quota.cycle_start || new Date().toISOString();
    const { data: gen, error: genError } = await supabase.from("shop_ai_avatar_generations").insert({
      shop_id: shopId,
      owner_telegram_id: telegramId,
      prompt,
      parent_id: parentId || null,
      image_url: publicUrl,
      subscription_cycle_start: cycleStart,
    }).select("id").single();
    if (genError) {
      console.error("[generate-shop-avatar] generation log err:", genError.message);
      await supabase.storage.from("bot-avatars").remove([path]).catch(() => null);
      return jsonRes({ error: "Не удалось учесть генерацию. Попробуйте позже." }, 500);
    }

    // Получаем обновлённую квоту
    const newQuotaRes = await supabase.rpc("get_shop_ai_avatar_quota" as any, { p_shop_id: shopId });
    const newQuota = (newQuotaRes.data as any) || quota;

    return jsonRes({
      avatarUrl: publicUrl,
      generationId: (gen as any)?.id || null,
      quota: newQuota,
    });
  } catch (e: any) {
    console.error("[generate-shop-avatar] error:", e?.message || e);
    return jsonRes({ error: "Внутренняя ошибка" }, 500);
  }
});