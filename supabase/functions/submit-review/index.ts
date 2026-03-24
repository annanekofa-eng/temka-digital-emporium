import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// ─── Telegram initData verification ───────────
function verifyAndExtractUser(initData: string, botToken: string): { id: number; first_name: string; last_name?: string; photo_url?: string } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;

  params.delete("hash");
  const entries = Array.from(params.entries());
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const hmac = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");

  if (hmac !== hash) return null;

  const authDate = params.get("auth_date");
  if (authDate) {
    const now = Math.floor(Date.now() / 1000);
    if (now - Number(authDate) > 600) return null;
  }

  const userStr = params.get("user");
  if (!userStr) return null;
  try {
    return JSON.parse(userStr);
  } catch {
    return null;
  }
}

// ─── Text sanitization ────────────────────────
function sanitizeText(text: string): string {
  return text
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, 1000);
}

// ─── Fetch avatar helper ──────────────────────
async function fetchAvatar(botToken: string, telegramId: number, profilePhotoUrl?: string): Promise<string> {
  if (profilePhotoUrl) return profilePhotoUrl;
  try {
    const photosRes = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: telegramId, limit: 1 }),
    }).then(r => r.json());
    if (photosRes.ok && photosRes.result?.total_count > 0) {
      // Don't return bot file URLs — they leak the bot token.
      // Instead, just return empty; avatars are optional.
      return "";
    }
  } catch (e) { console.error("Avatar fetch error:", e); }
  return "";
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const isShopReview = !!body.shopId;

    // ─── Determine bot token for verification ────
    let botToken: string | undefined;

    if (isShopReview) {
      // For shop reviews, we need the seller's bot token to verify initData
      // But the buyer opened the mini app via the seller's bot, so initData is signed with seller's token
      // We need to decrypt the seller's token
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { data: shop } = await supabase
        .from("shops")
        .select("bot_token_encrypted")
        .eq("id", body.shopId)
        .single();

      if (shop?.bot_token_encrypted) {
        const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
        if (encKey) {
          const { data: decrypted } = await supabase.rpc("decrypt_token", {
            p_encrypted: shop.bot_token_encrypted,
            p_key: encKey,
          });
          botToken = decrypted || undefined;
        }
      }

      // Fallback to platform bot token if seller bot token not available
      if (!botToken) botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    } else {
      botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    }

    if (!botToken) return jsonRes({ error: "Bot token not configured" }, 500);

    if (!body.initData) {
      return jsonRes({ error: "Authentication required" }, 401);
    }

    const tgUser = verifyAndExtractUser(body.initData, botToken);
    if (!tgUser) {
      // If shop review verification failed with seller token, try platform token
      if (isShopReview) {
        const platformToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
        if (platformToken && platformToken !== botToken) {
          const tgUser2 = verifyAndExtractUser(body.initData, platformToken);
          if (!tgUser2) return jsonRes({ error: "Invalid authentication data" }, 401);
          // Use tgUser2 going forward
          return handleReview(body, tgUser2, isShopReview, botToken);
        }
      }
      return jsonRes({ error: "Invalid authentication data" }, 401);
    }

    return handleReview(body, tgUser, isShopReview, botToken);
  } catch (error) {
    console.error("Submit review error:", error);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});

async function handleReview(
  body: any,
  tgUser: { id: number; first_name: string; last_name?: string; photo_url?: string },
  isShopReview: boolean,
  botToken: string,
): Promise<Response> {
  const telegramId = tgUser.id;
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // ─── SHOP REVIEWS ──────────────────────────
  if (isShopReview) {
    const shopId = body.shopId;

    // DELETE action
    if (body.action === "delete") {
      const { reviewId } = body;
      if (!reviewId) return jsonRes({ error: "Missing reviewId" }, 400);
      const { data: review } = await supabase
        .from("shop_reviews")
        .select("id, telegram_id")
        .eq("id", reviewId)
        .single();
      if (!review || review.telegram_id !== telegramId) {
        return jsonRes({ error: "Отзыв не найден" }, 404);
      }
      const { error } = await supabase.from("shop_reviews").delete().eq("id", reviewId);
      if (error) return jsonRes({ error: error.message }, 500);
      return jsonRes({ ok: true });
    }

    // CREATE action
    const { rating, text } = body;
    if (!rating || !text) return jsonRes({ error: "Missing required fields" }, 400);

    const numRating = Math.min(5, Math.max(1, Math.floor(Number(rating))));
    if (isNaN(numRating)) return jsonRes({ error: "Invalid rating" }, 400);

    const sanitizedText = sanitizeText(String(text));
    if (!sanitizedText || sanitizedText.length < 3) {
      return jsonRes({ error: "Текст отзыва слишком короткий" }, 400);
    }

    // Check existing review for this shop
    const { count } = await supabase
      .from("shop_reviews")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("telegram_id", telegramId);
    if (count && count > 0) {
      return jsonRes({ error: "Вы уже оставили отзыв" }, 400);
    }

    // Get user info
    const { data: profile } = await supabase
      .from("user_profiles")
      .select("photo_url, first_name, last_name")
      .eq("telegram_id", telegramId)
      .maybeSingle();

    const displayName = profile
      ? `${profile.first_name}${profile.last_name ? ' ' + profile.last_name : ''}`
      : (tgUser.first_name || "Пользователь");

    const avatarUrl = await fetchAvatar(botToken, telegramId, profile?.photo_url || undefined);

    const { error } = await supabase.from("shop_reviews").insert({
      shop_id: shopId,
      telegram_id: telegramId,
      rating: numRating,
      text: sanitizedText,
      author: displayName,
      avatar: avatarUrl,
      verified: false,
      moderation_status: "pending",
    });

    if (error) {
      console.error("Shop review insert error:", error);
      return jsonRes({ error: error.message }, 500);
    }
    return jsonRes({ ok: true });
  }

  // ─── PLATFORM REVIEWS (original logic) ─────
  // DELETE action
  if (body.action === "delete") {
    const { reviewId } = body;
    if (!reviewId) return jsonRes({ error: "Missing reviewId" }, 400);
    const { data: review } = await supabase
      .from("reviews")
      .select("id, telegram_id")
      .eq("id", reviewId)
      .single();
    if (!review || review.telegram_id !== telegramId) {
      return jsonRes({ error: "Отзыв не найден" }, 404);
    }
    const { error } = await supabase.from("reviews").delete().eq("id", reviewId);
    if (error) return jsonRes({ error: error.message }, 500);
    return jsonRes({ ok: true });
  }

  // CREATE action
  const { rating, text } = body;
  if (!rating || !text) return jsonRes({ error: "Missing required fields" }, 400);

  const numRating = Math.min(5, Math.max(1, Math.floor(Number(rating))));
  if (isNaN(numRating)) return jsonRes({ error: "Invalid rating" }, 400);

  const sanitizedText = sanitizeText(String(text));
  if (!sanitizedText || sanitizedText.length < 3) {
    return jsonRes({ error: "Текст отзыва слишком короткий" }, 400);
  }

  const { count: existingCount } = await supabase
    .from("reviews")
    .select("id", { count: "exact", head: true })
    .eq("telegram_id", telegramId);
  if (existingCount && existingCount > 0) {
    return jsonRes({ error: "Вы уже оставили отзыв" }, 400);
  }

  const { data: profile } = await supabase
    .from("user_profiles")
    .select("photo_url, first_name, last_name")
    .eq("telegram_id", telegramId)
    .maybeSingle();

  const { data: products } = await supabase
    .from("products")
    .select("id")
    .eq("is_active", true)
    .limit(1);

  const productId = products?.[0]?.id;
  if (!productId) return jsonRes({ error: "No products available" }, 400);

  const displayName = profile
    ? `${profile.first_name}${profile.last_name ? ' ' + profile.last_name : ''}`
    : (tgUser.first_name || "Пользователь");

  const avatarUrl = await fetchAvatar(botToken, telegramId, profile?.photo_url || undefined);

  const { error } = await supabase.from("reviews").insert({
    telegram_id: telegramId,
    rating: numRating,
    text: sanitizedText,
    author: displayName,
    avatar: avatarUrl,
    product_id: productId,
    verified: false,
    moderation_status: "pending",
  });

  if (error) {
    console.error("Review insert error:", error);
    return jsonRes({ error: error.message }, 500);
  }
  return jsonRes({ ok: true });
}
