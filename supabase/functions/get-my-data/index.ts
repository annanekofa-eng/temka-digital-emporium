import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function verifyAndExtractUser(initData: string, botToken: string): { id: number } | null {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const entries = Array.from(params.entries());
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dcs = entries.map(([k, v]) => `${k}=${v}`).join("\n");
  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  if (createHmac("sha256", secretKey).update(dcs).digest("hex") !== hash) return null;
  // TTL: 600s for data reads (10 minutes)
  const authDate = params.get("auth_date");
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 600) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

async function resolveBotToken(supabase: any, shopId?: string): Promise<string | null> {
  if (!shopId) return Deno.env.get("TELEGRAM_BOT_TOKEN") || null;
  const ek = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!ek) return null;
  const { data: shop } = await supabase.from("shops").select("bot_token_encrypted").eq("id", shopId).maybeSingle();
  if (!shop?.bot_token_encrypted) return null;
  const { data } = await supabase.rpc("decrypt_token", { p_encrypted: shop.bot_token_encrypted, p_key: ek });
  return data || null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json();
    const { initData, action, orderId, shopId } = body;
    const isShop = !!shopId;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (action === "check-promo-usage") {
      if (!initData) return jsonRes({ error: "Authentication required" }, 401);
      const { code, shopId: promoShopId } = body;
      if (!code) return jsonRes({ count: 0 });
      const botToken = await resolveBotToken(supabase, promoShopId);
      if (!botToken) return jsonRes({ error: "Bot not configured" }, 500);
      const tgUser = verifyAndExtractUser(initData, botToken);
      if (!tgUser) return jsonRes({ error: "Invalid authentication" }, 401);
      const telegramId = tgUser.id;
      if (promoShopId) {
        // Shop-scoped promo usage check
        const { count } = await supabase.from("shop_orders").select("id", { count: "exact", head: true })
          .eq("buyer_telegram_id", telegramId).eq("shop_id", promoShopId).ilike("promo_code", code);
        return jsonRes({ count: count || 0 });
      }
      const { count } = await supabase.from("orders").select("id", { count: "exact", head: true })
        .eq("telegram_id", telegramId).eq("promo_code", code);
      return jsonRes({ count: count || 0 });
    }

    // Authenticated actions
    if (!initData) return jsonRes({ error: "Authentication required" }, 401);

    // For platform-profile, use PLATFORM_BOT_TOKEN since the Mini App is launched from the platform bot
    const isPlatformAction = action === "platform-profile" || action === "validate-sub-promo";
    const botToken = isPlatformAction
      ? (Deno.env.get("PLATFORM_BOT_TOKEN") || await resolveBotToken(supabase, shopId))
      : await resolveBotToken(supabase, shopId);
    if (!botToken) return jsonRes({ error: "Bot not configured" }, 500);

    const tgUser = verifyAndExtractUser(initData, botToken);
    if (!tgUser) {
      return jsonRes({ error: "Invalid authentication" }, 401);
    }
    const telegramId = tgUser.id;

    switch (action) {
      case "profile": {
        if (isShop) {
          // Ensure shop customer exists on profile fetch (first-touch from storefront)
          await supabase.rpc("ensure_shop_customer", { p_shop_id: shopId, p_telegram_id: telegramId });
          const { data: customer } = await supabase.from("shop_customers")
            .select("balance, role, is_blocked").eq("shop_id", shopId).eq("telegram_id", telegramId).maybeSingle();
          return jsonRes({ profile: customer });
        }
        const { data: profile } = await supabase.from("user_profiles")
          .select("balance, role, is_blocked").eq("telegram_id", telegramId).maybeSingle();
        return jsonRes({ profile });
      }

      case "orders": {
        if (isShop) {
          const { data: orders } = await supabase.from("shop_orders").select("*")
            .eq("buyer_telegram_id", telegramId).eq("shop_id", shopId)
            .order("created_at", { ascending: false });
          const normalized = (orders || []).map((o: any) => ({
            id: o.id, order_number: o.order_number, telegram_id: o.buyer_telegram_id,
            status: o.status, payment_status: o.payment_status, total_amount: o.total_amount,
            currency: o.currency, invoice_id: o.invoice_id, pay_url: o.pay_url,
            notes: null, discount_amount: Number(o.discount_amount) || 0,
            promo_code: o.promo_code || null, balance_used: Number(o.balance_used) || 0,
            created_at: o.created_at, updated_at: o.updated_at,
          }));
          return jsonRes({ orders: normalized });
        }
        const { data: orders } = await supabase.from("orders").select("*")
          .eq("telegram_id", telegramId).order("created_at", { ascending: false });
        return jsonRes({ orders: orders || [] });
      }

      case "order-items": {
        if (!orderId) return jsonRes({ error: "Missing orderId" }, 400);
        if (isShop) {
          const { data: order } = await supabase.from("shop_orders").select("id")
            .eq("id", orderId).eq("buyer_telegram_id", telegramId).eq("shop_id", shopId).maybeSingle();
          if (!order) return jsonRes({ error: "Order not found" }, 404);
          const { data: items } = await supabase.from("shop_order_items").select("*").eq("order_id", orderId);
          const normalized = (items || []).map((i: any) => ({
            id: i.id, order_id: i.order_id, product_id: i.product_id,
            product_title: i.product_name, product_price: i.product_price,
            quantity: i.quantity, created_at: i.created_at,
          }));
          return jsonRes({ items: normalized });
        }
        const { data: order } = await supabase.from("orders").select("id")
          .eq("id", orderId).eq("telegram_id", telegramId).maybeSingle();
        if (!order) return jsonRes({ error: "Order not found" }, 404);
        const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId);
        return jsonRes({ items: items || [] });
      }

      case "order-inventory": {
        if (!orderId) return jsonRes({ error: "Missing orderId" }, 400);
        if (isShop) {
          const { data: order } = await supabase.from("shop_orders").select("id, status")
            .eq("id", orderId).eq("buyer_telegram_id", telegramId).eq("shop_id", shopId).maybeSingle();
          if (!order) return jsonRes({ error: "Order not found" }, 404);
          if (!["delivered", "completed", "paid"].includes(order.status)) return jsonRes({ items: [] });
          const { data: items } = await supabase.from("shop_inventory").select("id, content, status, sold_at").eq("order_id", orderId);
          return jsonRes({ items: items || [] });
        }
        const { data: order } = await supabase.from("orders").select("id, status")
          .eq("id", orderId).eq("telegram_id", telegramId).maybeSingle();
        if (!order) return jsonRes({ error: "Order not found" }, 404);
        if (!["delivered", "completed", "paid"].includes(order.status)) return jsonRes({ items: [] });
        const { data: items } = await supabase.from("inventory_items").select("id, content, status, sold_at").eq("order_id", orderId);
        return jsonRes({ items: items || [] });
      }

      case "balance-history": {
        if (isShop) {
          // Shop-scoped balance history
          const { data: history } = await supabase.from("shop_balance_history").select("*")
            .eq("shop_id", shopId).eq("telegram_id", telegramId).order("created_at", { ascending: false });
          return jsonRes({ history: history || [] });
        }
        // Platform balance history
        const { data: history } = await supabase.from("balance_history").select("*")
          .eq("telegram_id", telegramId).order("created_at", { ascending: false });
        return jsonRes({ history: history || [] });
      }

      case "platform-profile": {
        // Platform-level profile: user + subscription + balance + shops + stats
        const { data: pUser } = await supabase.from("platform_users").select("*")
          .eq("telegram_id", telegramId).maybeSingle();
        if (!pUser) return jsonRes({ error: "Platform user not found" }, 404);

        const { data: shops } = await supabase.from("shops").select("id, name, slug, status, bot_username, webhook_status, created_at")
          .eq("owner_id", pUser.id).order("created_at", { ascending: false });

        // Fetch stats per shop
        const shopsWithStats = await Promise.all((shops || []).map(async (s: any) => {
          const [prodRes, ordRes, custRes, revRes] = await Promise.all([
            supabase.from("shop_products").select("id", { count: "exact", head: true }).eq("shop_id", s.id),
            supabase.from("shop_orders").select("id", { count: "exact", head: true }).eq("shop_id", s.id),
            supabase.from("shop_customers").select("id", { count: "exact", head: true }).eq("shop_id", s.id),
            supabase.from("shop_orders").select("total_amount").eq("shop_id", s.id).eq("payment_status", "paid"),
          ]);
          const revenue = (revRes.data || []).reduce((sum: number, o: any) => sum + Number(o.total_amount), 0);
          return {
            id: s.id, name: s.name, slug: s.slug, status: s.status,
            bot_username: s.bot_username, webhook_status: s.webhook_status, created_at: s.created_at,
            stats: { products: prodRes.count || 0, orders: ordRes.count || 0, customers: custRes.count || 0, revenue },
          };
        }));

        // Fetch subscription settings for context
        const { data: settingsRows } = await supabase.from("shop_settings").select("key, value").like("key", "sub_%");
        const settingsMap: Record<string, string> = {};
        for (const r of settingsRows || []) settingsMap[r.key] = r.value;

        // Get subscription price
        let subPrice = pUser.billing_price_usd;
        let subTier = pUser.pricing_tier;
        if (subPrice == null) {
          const earlyPrice = settingsMap.sub_early_price_usd ? parseFloat(settingsMap.sub_early_price_usd) : 3;
          const standardPrice = settingsMap.sub_standard_price_usd ? parseFloat(settingsMap.sub_standard_price_usd) : 5;
          const earlyLimit = settingsMap.sub_early_slots_limit ? parseInt(settingsMap.sub_early_slots_limit) : 10;
          const { count: paidCount } = await supabase.from("platform_users").select("id", { count: "exact", head: true }).not("first_paid_at", "is", null);
          if ((paidCount || 0) < earlyLimit) {
            subPrice = earlyPrice;
            subTier = "early_3";
          } else {
            subPrice = standardPrice;
            subTier = "standard_5";
          }
        }

        // Fetch subscription settings for context
        const trialDays = settingsMap.sub_trial_days ? parseInt(settingsMap.sub_trial_days) : 7;
        const trialEnabled = settingsMap.sub_trial_enabled ? settingsMap.sub_trial_enabled === "true" : true;
        const maxShops = settingsMap.sub_max_shops_per_user ? parseInt(settingsMap.sub_max_shops_per_user) : 1;

        return jsonRes({
          user: {
            id: pUser.id, telegram_id: pUser.telegram_id, first_name: pUser.first_name,
            last_name: pUser.last_name, username: pUser.username, photo_url: pUser.photo_url,
            is_premium: pUser.is_premium, language_code: pUser.language_code, created_at: pUser.created_at,
          },
          subscription: {
            status: pUser.subscription_status, expires_at: pUser.subscription_expires_at,
            trial_started_at: pUser.trial_started_at, has_used_trial: pUser.has_used_trial,
            pricing_tier: subTier, billing_price_usd: subPrice,
            first_paid_at: pUser.first_paid_at,
          },
          balance: Number(pUser.balance) || 0,
          shops: shopsWithStats,
          settings: { trial_days: trialDays, trial_enabled: trialEnabled, max_shops: maxShops },
        });
      }

      case "stats": {
        if (isShop) {
          const { data: orders } = await supabase.from("shop_orders").select("total_amount, discount_amount, status")
            .eq("buyer_telegram_id", telegramId).eq("shop_id", shopId);
          const paid = (orders || []).filter((o: any) => ["paid", "processing", "delivered", "completed"].includes(o.status));
          return jsonRes({ stats: { orderCount: (orders || []).length, totalSpent: paid.reduce((s: number, o: any) => s + Number(o.total_amount) - Number(o.discount_amount || 0), 0) } });
        }
        const { data: orders } = await supabase.from("orders").select("total_amount, status").eq("telegram_id", telegramId);
        const paid = (orders || []).filter((o: any) => ["paid", "processing", "delivered", "completed"].includes(o.status));
        return jsonRes({ stats: { orderCount: (orders || []).length, totalSpent: paid.reduce((s: number, o: any) => s + Number(o.total_amount), 0) } });
      }

      case "my-review": {
        if (isShop) {
          const { data: review } = await supabase
            .from("shop_reviews")
            .select("id")
            .eq("shop_id", shopId)
            .eq("telegram_id", telegramId)
            .limit(1)
            .maybeSingle();
          return jsonRes({ reviewId: review?.id || null });
        }

        const { data: review } = await supabase
          .from("reviews")
          .select("id")
          .eq("telegram_id", telegramId)
          .limit(1)
          .maybeSingle();
        return jsonRes({ reviewId: review?.id || null });
      }

      case "validate-sub-promo": {
        const { promoCode: pc } = body;
        if (!pc) return jsonRes({ valid: false, error: "Введите промокод" });
        const { data: result } = await supabase.rpc("validate_platform_subscription_promo", { p_code: pc, p_telegram_id: telegramId });
        const r = result as any;
        if (!r || !r.valid) return jsonRes({ valid: false, error: r?.error || "Промокод не найден" });
        return jsonRes({ valid: true, code: r.code, discount_type: r.discount_type, discount_value: r.discount_value });
      }

      case "referral-stats": {
        if (!isShop) return jsonRes({ error: "Shop required" }, 400);

        // Settings (whether enabled, percent)
        const { data: settings } = await supabase.from("shop_referral_settings")
          .select("is_enabled, reward_percent").eq("shop_id", shopId).maybeSingle();
        const isEnabled = settings?.is_enabled ?? true;
        const rewardPercent = Number(settings?.reward_percent ?? 10);

        // Bot username for referral link
        const { data: shopRow } = await supabase.from("shops")
          .select("bot_username, support_link").eq("id", shopId).maybeSingle();

        // Count of referred users
        const { count: referredCount } = await supabase.from("shop_referrals")
          .select("id", { count: "exact", head: true })
          .eq("shop_id", shopId).eq("referrer_telegram_id", telegramId);

        // Earnings sums
        const { data: earnings } = await supabase.from("shop_referral_earnings")
          .select("reward_amount, status")
          .eq("shop_id", shopId).eq("referrer_telegram_id", telegramId);
        const totalEarned = (earnings || []).reduce((s: number, e: any) => s + Number(e.reward_amount), 0);
        const pendingPayout = (earnings || [])
          .filter((e: any) => e.status === "pending")
          .reduce((s: number, e: any) => s + Number(e.reward_amount), 0);

        const botUsername = shopRow?.bot_username || "";
        const referralLink = botUsername
          ? `https://t.me/${botUsername}?start=ref_${telegramId}`
          : "";

        return jsonRes({
          stats: {
            isEnabled,
            rewardPercent,
            referredCount: referredCount || 0,
            totalEarned,
            pendingPayout,
            referralLink,
            supportLink: shopRow?.support_link || "",
          },
        });
      }

      default:
        return jsonRes({ error: "Unknown action" }, 400);
    }
  } catch (error) {
    console.error("Get my data error:", error);
    return jsonRes({ error: "Internal server error" }, 500);
  }
});
