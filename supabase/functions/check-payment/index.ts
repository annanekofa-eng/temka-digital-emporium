import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const CRYPTOBOT_API_URL = "https://pay.crypt.bot/api";
const XROCKET_API_URL = "https://pay.xrocket.tg/";
const TONAPI_URL = "https://tonapi.io";
const TOPUP_COMMENT_PREFIX = "Пополнение через CryptoBot";

const jsonRes = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

function topupComment(invoiceId: string) {
  return `${TOPUP_COMMENT_PREFIX} (invoice:${invoiceId})`;
}

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
  const authDate = params.get("auth_date");
  // Keep TTL tighter to reduce replay window while still allowing status polling.
  if (authDate && Math.floor(Date.now() / 1000) - Number(authDate) > 600) return null;
  try { return JSON.parse(params.get("user") || ""); } catch { return null; }
}

async function resolveShopByHint(supabase: any, shopHint?: string) {
  if (!shopHint) return null;
  const normalized = String(shopHint).trim();
  if (!normalized) return null;
  const { data: byId } = await supabase.from("shops").select("id, bot_token_encrypted, cryptobot_token_encrypted").eq("id", normalized).maybeSingle();
  if (byId) return byId;
  const { data: bySlug } = await supabase.from("shops").select("id, bot_token_encrypted, cryptobot_token_encrypted").eq("slug", normalized).maybeSingle();
  return bySlug || null;
}

async function resolveTokens(supabase: any, shopHint?: string, platform?: boolean) {
  if (platform) {
    return {
      botToken: Deno.env.get("PLATFORM_BOT_TOKEN") || null,
      cryptobotToken: Deno.env.get("CRYPTOBOT_API_TOKEN") || null,
      resolvedShopId: undefined as string | undefined,
    };
  }
  if (!shopHint) {
    return {
      botToken: Deno.env.get("TELEGRAM_BOT_TOKEN") || null,
      cryptobotToken: Deno.env.get("CRYPTOBOT_API_TOKEN") || null,
      resolvedShopId: undefined as string | undefined,
    };
  }
  const ek = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!ek) throw new Error("Server config error");
  const shop = await resolveShopByHint(supabase, shopHint);
  if (!shop) throw new Error("Shop not found");
  const decrypt = async (enc: string | null) => {
    if (!enc) return null;
    const { data } = await supabase.rpc("decrypt_token", { p_encrypted: enc, p_key: ek });
    return data || null;
  };
  return {
    botToken: await decrypt(shop.bot_token_encrypted),
    cryptobotToken: await decrypt(shop.cryptobot_token_encrypted),
    resolvedShopId: shop.id as string,
  };
}

async function notifyTopup(botToken: string | null, telegramId: number, amount: number, newBalance: number, invoiceId: string) {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramId, parse_mode: "HTML",
        text: `✅ <b>Баланс пополнен!</b>\n\n💰 Сумма: $${amount.toFixed(2)}\n💳 Новый баланс: $${Number(newBalance).toFixed(2)}`,
      }),
    });
  } catch (e) {
    console.error(`[check-payment] notification exception invoice=${invoiceId}:`, e);
  }
}

async function hasTopupLedgerRecord(supabase: any, table: string, invoiceId: string, telegramId: number, amount: number, processedAt?: string | null, shopId?: string | null) {
  let query = supabase.from(table).select("id", { count: "exact", head: true })
    .eq("telegram_id", telegramId).eq("type", "credit").ilike("comment", `%invoice:${invoiceId}%`);
  if (shopId && table === "shop_balance_history") query = query.eq("shop_id", shopId);
  const { count: taggedCount } = await query;
  if ((taggedCount || 0) > 0) return true;

  if (!processedAt) return false;
  const center = new Date(processedAt).getTime();
  if (!Number.isFinite(center)) return false;
  const from = new Date(center - 15 * 60 * 1000).toISOString();
  const to = new Date(center + 15 * 60 * 1000).toISOString();

  let fbQuery = supabase.from(table).select("id", { count: "exact", head: true })
    .eq("telegram_id", telegramId).eq("type", "credit").eq("amount", amount)
    .gte("created_at", from).lte("created_at", to);
  if (shopId && table === "shop_balance_history") fbQuery = fbQuery.eq("shop_id", shopId);
  const { count: fallbackCount } = await fbQuery;
  return (fallbackCount || 0) > 0;
}

async function markTopupProcessed(supabase: any, invoiceId: string, telegramId: number, amount: number, hasExistingRow: boolean) {
  if (hasExistingRow) {
    await supabase.from("processed_invoices").update({
      type: "topup", order_id: null, telegram_id: telegramId, amount, processed_at: new Date().toISOString(),
    }).eq("invoice_id", invoiceId);
    return;
  }
  await supabase.from("processed_invoices").insert({
    invoice_id: invoiceId, type: "topup", order_id: null, telegram_id: telegramId, amount,
  });
}

async function processPaidTopup(params: {
  supabase: any;
  tokens: { botToken: string | null };
  invoice: any;
  payload: any;
  telegramId: number;
  shopId?: string | null;
}) {
  const { supabase, tokens, invoice, payload, telegramId, shopId } = params;
  const invoiceId = String(invoice.invoice_id);
  const topupAmount = Number(payload.amount ?? invoice.amount ?? 0);
  if (!topupAmount || topupAmount <= 0) throw new Error("Invalid invoice amount");

  const { data: existingProcessed } = await supabase.from("processed_invoices")
    .select("invoice_id, type, processed_at").eq("invoice_id", invoiceId).maybeSingle();

  const isShopTopup = !!shopId;
  const isPlatformTopup = payload.type === "platform_topup";
  const historyTable = isPlatformTopup ? "platform_balance_history" : (isShopTopup ? "shop_balance_history" : "balance_history");

  const alreadyCredited = await hasTopupLedgerRecord(supabase, historyTable, invoiceId, telegramId, topupAmount, existingProcessed?.processed_at || null, shopId);

  if (alreadyCredited) {
    if (!existingProcessed || existingProcessed.type !== "topup") {
      await markTopupProcessed(supabase, invoiceId, telegramId, topupAmount, Boolean(existingProcessed));
    }
    return { topupStatus: "paid", paymentStatus: "paid", amount: topupAmount };
  }

  // Credit balance — tenant-scoped or platform
  let newBalance: number;
  if (isPlatformTopup) {
    const { data: nb, error: balanceError } = await supabase.rpc("platform_credit_balance", {
      p_telegram_id: telegramId, p_amount: topupAmount,
    });
    if (balanceError) throw new Error(`platform_credit_balance failed: ${balanceError.message}`);
    newBalance = nb;
    await supabase.from("platform_balance_history").insert({
      telegram_id: telegramId, amount: topupAmount, balance_after: newBalance,
      type: "credit", comment: topupComment(invoiceId),
    });
  } else if (isShopTopup) {
    const { data: nb, error: balanceError } = await supabase.rpc("shop_credit_balance", {
      p_shop_id: shopId, p_telegram_id: telegramId, p_amount: topupAmount,
    });
    if (balanceError) throw new Error(`shop_credit_balance failed: ${balanceError.message}`);
    newBalance = nb;
    await supabase.from("shop_balance_history").insert({
      shop_id: shopId, telegram_id: telegramId, amount: topupAmount, balance_after: newBalance,
      type: "credit", comment: topupComment(invoiceId), admin_telegram_id: telegramId,
    });
  } else {
    const { data: nb, error: balanceError } = await supabase.rpc("credit_balance", {
      p_telegram_id: telegramId, p_amount: topupAmount,
    });
    if (balanceError) throw new Error(`credit_balance failed: ${balanceError.message}`);
    newBalance = nb;
    await supabase.from("balance_history").insert({
      telegram_id: telegramId, amount: topupAmount, balance_after: newBalance,
      type: "credit", comment: topupComment(invoiceId), admin_telegram_id: telegramId,
    });
  }

  let notifyBotToken = tokens.botToken;
  if (isPlatformTopup) notifyBotToken = Deno.env.get("PLATFORM_BOT_TOKEN") || tokens.botToken;
  await notifyTopup(notifyBotToken, telegramId, topupAmount, Number(newBalance) || 0, invoiceId);
  await markTopupProcessed(supabase, invoiceId, telegramId, topupAmount, Boolean(existingProcessed));

  return { topupStatus: "paid", paymentStatus: "paid", amount: topupAmount, balance: newBalance };
}

async function checkTopupPayment(params: {
  supabase: any;
  tokens: { botToken: string | null; cryptobotToken: string | null };
  invoiceId: string;
  telegramId: number;
  shopId?: string;
}) {
  const { supabase, tokens, invoiceId, telegramId, shopId } = params;
  if (!tokens.cryptobotToken) return jsonRes({ topupStatus: "awaiting", paymentStatus: "awaiting" });

  const response = await fetch(`${CRYPTOBOT_API_URL}/getInvoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": tokens.cryptobotToken },
    body: JSON.stringify({ invoice_ids: invoiceId }),
  });

  const data = await response.json();
  if (!data.ok || !data.result?.items?.length) return jsonRes({ topupStatus: "awaiting", paymentStatus: "awaiting" });

  const invoice = data.result.items[0];
  let payload: any = {};
  try { payload = JSON.parse(invoice.payload || "{}"); } catch {}

  if (payload.type !== "topup" && payload.type !== "platform_topup") return jsonRes({ error: "Invalid invoice type" }, 400);
  if (Number(payload.telegramUserId) !== telegramId) return jsonRes({ error: "Invoice owner mismatch" }, 403);

  if (invoice.status === "paid") {
    try {
      const result = await processPaidTopup({ supabase, tokens, invoice, payload, telegramId, shopId });
      return jsonRes(result);
    } catch (error) {
      console.error(`[check-payment] topup processing error invoice=${invoiceId}:`, error);
      return jsonRes({ error: "Failed to process topup" }, 500);
    }
  }

  if (invoice.status === "expired") return jsonRes({ topupStatus: "expired", paymentStatus: "expired" });
  return jsonRes({ topupStatus: invoice.status || "awaiting", paymentStatus: "awaiting" });
}

async function checkSubscriptionPayment(params: {
  supabase: any;
  tokens: { botToken: string | null; cryptobotToken: string | null };
  invoiceId: string;
  telegramId: number;
}) {
  const { supabase, tokens, invoiceId, telegramId } = params;
  if (!tokens.cryptobotToken) return jsonRes({ subscriptionStatus: "awaiting", paymentStatus: "awaiting" });

  const response = await fetch(`${CRYPTOBOT_API_URL}/getInvoices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": tokens.cryptobotToken },
    body: JSON.stringify({ invoice_ids: invoiceId }),
  });

  const data = await response.json();
  if (!data.ok || !data.result?.items?.length) return jsonRes({ subscriptionStatus: "awaiting", paymentStatus: "awaiting" });

  const invoice = data.result.items[0];
  let payload: any = {};
  try { payload = JSON.parse(invoice.payload || "{}"); } catch {}

  if (payload.type !== "subscription") return jsonRes({ error: "Invalid invoice type" }, 400);
  if (Number(payload.telegramUserId) !== telegramId) return jsonRes({ error: "Invoice owner mismatch" }, 403);

  if (invoice.status === "paid") {
    // Check if already processed
    const { data: existing } = await supabase.from("processed_invoices").select("invoice_id").eq("invoice_id", invoiceId).maybeSingle();
    if (existing) return jsonRes({ subscriptionStatus: "paid", paymentStatus: "paid" });

    // Process subscription payment (same logic as webhook)
    const months = Number(payload.months) || 1;
    const totalDays = months * 30;

    const { error: dedupError } = await supabase.from("processed_invoices").insert({
      invoice_id: invoiceId, type: "subscription", order_id: null,
      telegram_id: telegramId, amount: Number(payload.subscriptionPrice || invoice.amount),
    });
    if (dedupError) return jsonRes({ subscriptionStatus: "paid", paymentStatus: "paid" });

    const balanceUsed = Number(payload.balanceUsed || 0);
    if (balanceUsed > 0) {
      const { data: newBal, error: balErr } = await supabase.rpc("platform_deduct_balance", { p_telegram_id: telegramId, p_amount: balanceUsed });
      if (!balErr) {
        await supabase.from("platform_balance_history").insert({
          telegram_id: telegramId, amount: -balanceUsed, balance_after: newBal,
          type: "subscription", comment: `Подписка (invoice:${invoiceId})`,
        });
      }
    }

    // Activate subscription — preserve remaining days
    const { data: pUser } = await supabase.from("platform_users").select("first_paid_at, id, subscription_status, subscription_expires_at").eq("telegram_id", telegramId).maybeSingle();
    const currentExpiry = pUser?.subscription_expires_at ? new Date(pUser.subscription_expires_at).getTime() : 0;
    const baseDate = Math.max(currentExpiry, Date.now());
    const expiresAt = new Date(baseDate + totalDays * 24 * 60 * 60 * 1000).toISOString();
    const subscriptionPrice = Number(payload.subscriptionPrice || 0);
    await supabase.from("platform_users").update({
      subscription_status: "active", subscription_expires_at: expiresAt,
      billing_price_usd: months === 1 ? subscriptionPrice : Math.round(subscriptionPrice / months * 100) / 100,
      pricing_tier: payload.tier,
      first_paid_at: pUser?.first_paid_at || new Date().toISOString(),
      reminder_sent_at: null, expiry_notified_at: null, updated_at: new Date().toISOString(),
    }).eq("telegram_id", telegramId);

    // Increment promo usage for subscription promos
    const paymentId = payload.paymentId;
    if (paymentId) {
      const { data: subPayment } = await supabase.from("subscription_payments").select("promo_code, discount_amount").eq("id", paymentId).maybeSingle();
      if (subPayment?.promo_code) {
        const { data: promoRow } = await supabase.from("platform_subscription_promos").select("id").ilike("code", subPayment.promo_code).maybeSingle();
        if (promoRow) {
          await supabase.rpc("increment_platform_promo_usage", {
            p_promo_id: promoRow.id, p_telegram_id: telegramId, p_payment_id: paymentId, p_discount_amount: Number(subPayment.discount_amount || 0),
          });
        }
      }
    }

    if (pUser?.id) {
      const { data: shops } = await supabase.from("shops").select("id").eq("owner_id", pUser.id).eq("status", "paused");
      for (const shop of shops || []) {
        await supabase.from("shops").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", shop.id);
      }
    }

    await supabase.from("subscription_payments").update({ status: "paid" }).eq("id", payload.paymentId);

    const monthsLabel = months === 1 ? "1 мес" : `${months} мес`;
    const botToken = Deno.env.get("PLATFORM_BOT_TOKEN");
    if (botToken) {
      let msg = `✅ <b>Подписка ${pUser?.subscription_status === 'active' ? 'продлена' : 'активирована'}!</b>\n\n📅 До: ${new Date(expiresAt).toLocaleDateString("ru")} (${monthsLabel})`;
      if (balanceUsed > 0) msg += `\n💳 С баланса: -$${balanceUsed.toFixed(2)}`;
      try { await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ chat_id: telegramId, text: msg, parse_mode: "HTML" }) }); } catch {}
    }

    return jsonRes({ subscriptionStatus: "paid", paymentStatus: "paid", expiresAt });
  }

  if (invoice.status === "expired") return jsonRes({ subscriptionStatus: "expired", paymentStatus: "expired" });
  return jsonRes({ subscriptionStatus: invoice.status || "awaiting", paymentStatus: "awaiting" });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { orderId, invoiceId, initData, shopId, platform, type } = await req.json();
    const isShop = !!shopId;
    const isPlatform = !!platform;

    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    let tokens;
    try { tokens = await resolveTokens(supabase, shopId, isPlatform); }
    catch (e) { return jsonRes({ error: (e as Error).message }, 500); }

    if (!tokens.botToken) return jsonRes({ error: "Not configured" }, 500);
    if (!initData) return jsonRes({ error: "Authentication required" }, 401);

    const tgUser = verifyAndExtractUser(initData, tokens.botToken);
    if (!tgUser) return jsonRes({ error: "Invalid authentication" }, 401);

    // Block payments for blocked users
    if (isShop) {
      const { data: customer } = await supabase.from("shop_customers").select("is_blocked").eq("shop_id", shopId).eq("telegram_id", tgUser.id).maybeSingle();
      if (customer?.is_blocked) return jsonRes({ error: "Account is blocked" }, 403);
    } else if (!isPlatform) {
      const { data: profile } = await supabase.from("user_profiles").select("is_blocked").eq("telegram_id", tgUser.id).maybeSingle();
      if (profile?.is_blocked) return jsonRes({ error: "Account is blocked" }, 403);
    }

    if (!orderId && !invoiceId) return jsonRes({ error: "Missing orderId or invoiceId" }, 400);

    // Subscription payment check
    if (invoiceId && type === "subscription") {
      return await checkSubscriptionPayment({
        supabase, tokens, invoiceId: String(invoiceId), telegramId: tgUser.id,
      });
    }

    if (invoiceId) {
      return await checkTopupPayment({
        supabase, tokens, invoiceId: String(invoiceId),
        telegramId: tgUser.id, shopId: tokens.resolvedShopId || shopId,
      });
    }

    // Get order from correct table
    const orderTable = isShop ? "shop_orders" : "orders";
    const telegramCol = isShop ? "buyer_telegram_id" : "telegram_id";

    const { data: order, error: orderError } = await supabase
      .from(orderTable).select("*").eq("id", orderId).eq(telegramCol, tgUser.id).single();
    if (orderError || !order) return jsonRes({ error: "Order not found" }, 404);

    if (order.payment_status === "paid") return jsonRes({ status: order.status, paymentStatus: "paid" });
    if (!order.invoice_id) return jsonRes({ status: order.status, paymentStatus: order.payment_status });
    // Stars orders are settled by the seller-bot webhook (`successful_payment`). 
    // Don't poll CryptoBot for them — just return the current DB state.
    if (order.payment_method === "stars") {
      return jsonRes({ status: order.status, paymentStatus: order.payment_status });
    }
    // ── xRocket Pay polling (shop orders only) ────────────────
    if (isShop && order.payment_method === "xrocket") {
      try {
        const ek = Deno.env.get("TOKEN_ENCRYPTION_KEY");
        if (!ek) return jsonRes({ status: order.status, paymentStatus: order.payment_status });
        const { data: xrMethod } = await supabase
          .from("shop_payment_methods")
          .select("config_encrypted")
          .eq("shop_id", shopId)
          .eq("method", "xrocket")
          .maybeSingle();
        if (!xrMethod?.config_encrypted) {
          return jsonRes({ status: order.status, paymentStatus: order.payment_status });
        }
        const { data: xrToken } = await supabase.rpc("decrypt_token", { p_encrypted: xrMethod.config_encrypted, p_key: ek });
        if (!xrToken) return jsonRes({ status: order.status, paymentStatus: order.payment_status });

        const xrRes = await fetch(`${XROCKET_API_URL}tg-invoices/${encodeURIComponent(order.invoice_id)}`, {
          headers: { "Rocket-Pay-Key": xrToken },
        });
        const xrData = await xrRes.json().catch(() => ({}));
        console.log(`[check-payment][xrocket] invoice=${order.invoice_id} httpStatus=${xrRes.status} success=${xrData?.success} apiStatus=${xrData?.data?.status} payments=${Array.isArray(xrData?.data?.payments) ? xrData.data.payments.length : 'n/a'}`);
        if (!xrRes.ok || xrData?.success !== true || !xrData?.data) {
          console.log(`[check-payment][xrocket] body=`, JSON.stringify(xrData).slice(0, 500));
          return jsonRes({ status: order.status, paymentStatus: order.payment_status });
        }
        const inv = xrData.data;
        // status: 'active' | 'paid' | 'expired'
        const xrStatus = String(inv.status || "").toLowerCase();
        const isPaid = xrStatus === "paid" || (Array.isArray(inv.payments) && inv.payments.length > 0);

        if (isPaid && order.payment_status !== "paid") {
          const telegramId = order.buyer_telegram_id;
          const resolvedShopId = tokens.resolvedShopId || shopId;

          // Pre-flight check only — insert AFTER successful processing.
          const { data: alreadyProcessed } = await supabase.from("processed_invoices")
            .select("invoice_id").eq("invoice_id", `xr:${order.invoice_id}`).maybeSingle();
          if (alreadyProcessed) return jsonRes({ status: "paid", paymentStatus: "paid" });

          const { data: updatedRows } = await supabase.from("shop_orders")
            .update({ status: "paid", payment_status: "paid", updated_at: new Date().toISOString() })
            .eq("id", orderId).neq("payment_status", "paid").select("id");
          if (!updatedRows?.length) return jsonRes({ status: "paid", paymentStatus: "paid" });

          // Promo increment
          if (order.promo_code) {
            await supabase.rpc("increment_shop_promo_usage", { p_shop_id: resolvedShopId, p_code: order.promo_code });
          }

          // Balance deduction
          const balanceUsed = Number(order.balance_used || 0);
          if (balanceUsed > 0) {
            const { data: nb, error: be } = await supabase.rpc("shop_deduct_balance", {
              p_shop_id: resolvedShopId, p_telegram_id: telegramId, p_amount: balanceUsed,
            });
            if (!be) {
              const promoInfo = order.promo_code ? ` (промо ${order.promo_code}, скидка $${Number(order.discount_amount || 0).toFixed(2)})` : "";
              await supabase.from("shop_balance_history").insert({
                shop_id: resolvedShopId, telegram_id: telegramId, amount: -balanceUsed, balance_after: nb,
                type: "purchase", comment: `Заказ ${order.order_number}${promoInfo}`, admin_telegram_id: telegramId,
              });
            }
          }

          // Inventory reservation
          const { data: orderItems } = await supabase.from("shop_order_items")
            .select("product_id, quantity, product_name").eq("order_id", orderId);
          const deliveredContent: string[] = [];
          let allDelivered = true;
          if (orderItems) {
            for (const item of orderItems) {
              const { data: reserved } = await supabase.rpc("reserve_shop_inventory", {
                p_product_id: item.product_id, p_quantity: item.quantity, p_order_id: orderId,
              });
              if (reserved?.length) {
                deliveredContent.push(`📦 <b>${item.product_name}</b> (×${reserved.length}):\n${reserved.map((i: any) => `<code>${i.content}</code>`).join("\n")}`);
                const { count: remaining } = await supabase.from("shop_inventory").select("id", { count: "exact", head: true })
                  .eq("product_id", item.product_id).eq("status", "available");
                await supabase.from("shop_products").update({ stock: remaining || 0, updated_at: new Date().toISOString() }).eq("id", item.product_id);
                if (reserved.length < item.quantity) allDelivered = false;
              } else { allDelivered = false; }
            }
          }

          const finalStatus = allDelivered && deliveredContent.length > 0 ? "delivered" : "paid";
          if (finalStatus !== "paid") {
            await supabase.from("shop_orders").update({ status: finalStatus, updated_at: new Date().toISOString() }).eq("id", orderId);
          }

          // Referral credit (USD-based)
          try {
            const refAmount = Math.max(0, Number(order.total_amount || 0) - Number(order.discount_amount || 0));
            if (refAmount > 0) {
              await supabase.rpc("shop_credit_referral_for_order", {
                p_shop_id: resolvedShopId,
                p_order_id: orderId,
                p_referred_telegram_id: telegramId,
                p_order_amount: refAmount,
              });
            }
          } catch (e) { console.error("xrocket referral credit error:", e); }

          // TG notification
          if (tokens.botToken) {
            let message = `✅ <b>Оплата подтверждена!</b>\n\n📦 Заказ: <code>${order.order_number}</code>\n💰 Сумма: $${Number(order.total_amount).toFixed(2)} (через xRocket)\n`;
            if (balanceUsed > 0) message += `💳 С баланса: $${balanceUsed.toFixed(2)}\n`;
            if (deliveredContent.length > 0) {
              message += `\n🎁 <b>Ваши товары:</b>\n\n${deliveredContent.join("\n\n")}\n\n⚠️ Сохраните данные!`;
            } else { message += `\nВаш товар будет доставлен в ближайшее время.`; }
            message += `\n\nСпасибо за покупку!`;
            await fetch(`https://api.telegram.org/bot${tokens.botToken}/sendMessage`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: telegramId, text: message, parse_mode: "HTML" }),
            });
          }

          await supabase.from("processed_invoices").insert({
            invoice_id: `xr:${order.invoice_id}`, type: "payment", order_id: orderId,
            telegram_id: telegramId, amount: Number(order.total_amount) || 0,
          });

          return jsonRes({ status: finalStatus, paymentStatus: "paid" });
        }

        if (xrStatus === "expired") {
          await supabase.from("shop_orders").update({ status: "cancelled", payment_status: "expired", updated_at: new Date().toISOString() }).eq("id", orderId);
          return jsonRes({ status: "cancelled", paymentStatus: "expired" });
        }
        return jsonRes({ status: order.status, paymentStatus: order.payment_status, invoiceStatus: xrStatus });
      } catch (e) {
        console.error("xrocket check error:", e);
        return jsonRes({ status: order.status, paymentStatus: order.payment_status });
      }
    }
    // ── TON / Tonkeeper polling (shop orders only) ────────────
    if (isShop && order.payment_method === "ton") {
      try {
        const ek = Deno.env.get("TOKEN_ENCRYPTION_KEY");
        if (!ek) return jsonRes({ status: order.status, paymentStatus: order.payment_status });
        const { data: tonMethod } = await supabase
          .from("shop_payment_methods")
          .select("config_encrypted")
          .eq("shop_id", shopId)
          .eq("method", "ton")
          .maybeSingle();
        if (!tonMethod?.config_encrypted) {
          return jsonRes({ status: order.status, paymentStatus: order.payment_status });
        }
        const { data: walletAddress } = await supabase.rpc("decrypt_token", {
          p_encrypted: tonMethod.config_encrypted, p_key: ek,
        });
        if (!walletAddress) return jsonRes({ status: order.status, paymentStatus: order.payment_status });

        const memo = order.invoice_id; // memo is stored in invoice_id
        if (!memo) return jsonRes({ status: order.status, paymentStatus: order.payment_status });

        // Recompute required nanoTON from pay_url to avoid courier-rate drift.
        // pay_url format: ton://transfer/<addr>?amount=<nanoton>&text=<memo>
        let requiredNano = 0n;
        try {
          const m = String(order.pay_url || "").match(/[?&]amount=(\d+)/);
          if (m) requiredNano = BigInt(m[1]);
        } catch { /* ignore */ }
        // Fail-safe: if we couldn't recover the required amount, refuse to confirm
        // (otherwise any tiny TX with the right memo would mark the order paid).
        if (requiredNano <= 0n) {
          console.warn(`[check-payment][ton] missing requiredNano for order=${orderId}`);
          return jsonRes({ status: order.status, paymentStatus: order.payment_status });
        }
        // Cancel order if older than 30 min and unpaid (matches typical TX confirmation window)
        const orderAgeMs = Date.now() - new Date(order.created_at).getTime();
        const TON_ORDER_TTL_MS = 30 * 60 * 1000;

        // Poll TonAPI for recent transactions
        const tonRes = await fetch(
          `${TONAPI_URL}/v2/blockchain/accounts/${encodeURIComponent(walletAddress)}/transactions?limit=30`,
          { signal: AbortSignal.timeout(8000) },
        );
        if (!tonRes.ok) {
          console.warn(`[check-payment][ton] tonapi http ${tonRes.status}`);
          return jsonRes({ status: order.status, paymentStatus: order.payment_status });
        }
        const tonData = await tonRes.json().catch(() => ({}));
        const txs: any[] = Array.isArray(tonData?.transactions) ? tonData.transactions : [];

        // Look for an incoming message with matching memo (text comment)
        let foundTxHash: string | null = null;
        let receivedNano = 0n;
        for (const tx of txs) {
          const inMsg = tx?.in_msg;
          if (!inMsg) continue;
          // TonAPI v2 exposes the text comment in several possible locations
          // depending on the wallet/version. Try each in order.
          let comment = "";
          if (inMsg?.decoded_op_name === "text_comment" && inMsg?.decoded_body?.text) {
            comment = String(inMsg.decoded_body.text);
          } else if (typeof inMsg?.message === "string") {
            comment = inMsg.message;
          } else if (typeof inMsg?.comment === "string") {
            comment = inMsg.comment;
          } else if (inMsg?.decoded_body?.text) {
            comment = String(inMsg.decoded_body.text);
          }
          comment = comment.trim();
          if (!comment || comment !== memo) continue;
          const value = BigInt(inMsg?.value ?? 0);
          if (value < requiredNano) continue; // amount too low
          foundTxHash = String(tx?.hash || "");
          receivedNano = value;
          break;
        }

        if (foundTxHash && order.payment_status !== "paid") {
          const telegramId = order.buyer_telegram_id;
          const resolvedShopId = tokens.resolvedShopId || shopId;

          // Pre-flight check only — insert AFTER successful processing.
          const { data: alreadyProcessed } = await supabase.from("processed_invoices")
            .select("invoice_id").eq("invoice_id", `ton:${foundTxHash}`).maybeSingle();
          if (alreadyProcessed) return jsonRes({ status: "paid", paymentStatus: "paid" });

          const { data: updatedRows } = await supabase.from("shop_orders")
            .update({ status: "paid", payment_status: "paid", updated_at: new Date().toISOString() })
            .eq("id", orderId).neq("payment_status", "paid").select("id");
          if (!updatedRows?.length) return jsonRes({ status: "paid", paymentStatus: "paid" });

          if (order.promo_code) {
            await supabase.rpc("increment_shop_promo_usage", { p_shop_id: resolvedShopId, p_code: order.promo_code });
          }

          const balanceUsed = Number(order.balance_used || 0);
          if (balanceUsed > 0) {
            const { data: nb, error: be } = await supabase.rpc("shop_deduct_balance", {
              p_shop_id: resolvedShopId, p_telegram_id: telegramId, p_amount: balanceUsed,
            });
            if (!be) {
              const promoInfo = order.promo_code ? ` (промо ${order.promo_code}, скидка $${Number(order.discount_amount || 0).toFixed(2)})` : "";
              await supabase.from("shop_balance_history").insert({
                shop_id: resolvedShopId, telegram_id: telegramId, amount: -balanceUsed, balance_after: nb,
                type: "purchase", comment: `Заказ ${order.order_number}${promoInfo}`, admin_telegram_id: telegramId,
              });
            }
          }

          // Inventory reservation
          const { data: orderItems } = await supabase.from("shop_order_items")
            .select("product_id, quantity, product_name").eq("order_id", orderId);
          const deliveredContent: string[] = [];
          let allDelivered = true;
          if (orderItems) {
            for (const item of orderItems) {
              const { data: reserved } = await supabase.rpc("reserve_shop_inventory", {
                p_product_id: item.product_id, p_quantity: item.quantity, p_order_id: orderId,
              });
              if (reserved?.length) {
                deliveredContent.push(`📦 <b>${item.product_name}</b> (×${reserved.length}):\n${reserved.map((i: any) => `<code>${i.content}</code>`).join("\n")}`);
                const { count: remaining } = await supabase.from("shop_inventory").select("id", { count: "exact", head: true })
                  .eq("product_id", item.product_id).eq("status", "available");
                await supabase.from("shop_products").update({ stock: remaining || 0, updated_at: new Date().toISOString() }).eq("id", item.product_id);
                if (reserved.length < item.quantity) allDelivered = false;
              } else { allDelivered = false; }
            }
          }

          const finalStatus = allDelivered && deliveredContent.length > 0 ? "delivered" : "paid";
          if (finalStatus !== "paid") {
            await supabase.from("shop_orders").update({ status: finalStatus, updated_at: new Date().toISOString() }).eq("id", orderId);
          }

          // Referral credit
          try {
            const refAmount = Math.max(0, Number(order.total_amount || 0) - Number(order.discount_amount || 0));
            if (refAmount > 0) {
              await supabase.rpc("shop_credit_referral_for_order", {
                p_shop_id: resolvedShopId, p_order_id: orderId,
                p_referred_telegram_id: telegramId, p_order_amount: refAmount,
              });
            }
          } catch (e) { console.error("ton referral credit error:", e); }

          // TG notification
          if (tokens.botToken) {
            const tonReceived = Number(receivedNano) / 1e9;
            let message = `✅ <b>Оплата подтверждена!</b>\n\n📦 Заказ: <code>${order.order_number}</code>\n💰 Сумма: $${Number(order.total_amount).toFixed(2)} (${tonReceived.toFixed(3)} TON)\n`;
            if (balanceUsed > 0) message += `💳 С баланса: $${balanceUsed.toFixed(2)}\n`;
            if (deliveredContent.length > 0) {
              message += `\n🎁 <b>Ваши товары:</b>\n\n${deliveredContent.join("\n\n")}\n\n⚠️ Сохраните данные!`;
            } else { message += `\nВаш товар будет доставлен в ближайшее время.`; }
            message += `\n\nСпасибо за покупку!`;
            await fetch(`https://api.telegram.org/bot${tokens.botToken}/sendMessage`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: telegramId, text: message, parse_mode: "HTML" }),
            });
          }

          await supabase.from("processed_invoices").insert({
            invoice_id: `ton:${foundTxHash}`, type: "payment", order_id: orderId,
            telegram_id: telegramId, amount: Number(order.total_amount) || 0,
          });

          return jsonRes({ status: finalStatus, paymentStatus: "paid" });
        }

        // Expire stale unpaid orders
        if (orderAgeMs > TON_ORDER_TTL_MS && order.payment_status !== "paid") {
          await supabase.from("shop_orders").update({
            status: "cancelled", payment_status: "expired", updated_at: new Date().toISOString(),
          }).eq("id", orderId);
          return jsonRes({ status: "cancelled", paymentStatus: "expired" });
        }

        return jsonRes({ status: order.status, paymentStatus: order.payment_status, invoiceStatus: "awaiting" });
      } catch (e) {
        console.error("ton check error:", e);
        return jsonRes({ status: order.status, paymentStatus: order.payment_status });
      }
    }
    if (!tokens.cryptobotToken) return jsonRes({ status: order.status, paymentStatus: order.payment_status });

    // Poll CryptoBot
    const response = await fetch(`${CRYPTOBOT_API_URL}/getInvoices`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Crypto-Pay-API-Token": tokens.cryptobotToken },
      body: JSON.stringify({ invoice_ids: order.invoice_id }),
    });
    const data = await response.json();
    if (!data.ok || !data.result?.items?.length)
      return jsonRes({ status: order.status, paymentStatus: order.payment_status });

    const invoice = data.result.items[0];
    const telegramId = isShop ? order.buyer_telegram_id : order.telegram_id;
    const resolvedShopId = tokens.resolvedShopId || shopId;

    if (invoice.status === "paid" && order.payment_status !== "paid") {
      // Pre-flight check only (insert AFTER successful processing so a failed
      // run can be retried by the next poll instead of being silently swallowed).
      const { data: alreadyProcessed } = await supabase.from("processed_invoices")
        .select("invoice_id").eq("invoice_id", String(invoice.invoice_id)).maybeSingle();
      if (alreadyProcessed) return jsonRes({ status: "paid", paymentStatus: "paid" });

      // Auto-orders (telegram_premium / telegram_stars) follow a different
      // fulfillment flow: they have no inventory rows, the seller delivers
      // them manually from the admin panel. Mark them as `processing` /
      // `fulfillment_status: pending` so they show up in the auto-orders queue.
      const isAutoOrder = isShop && (order.product_type === "telegram_premium" || order.product_type === "telegram_stars");

      const updatePayload: Record<string, unknown> = {
        status: isAutoOrder ? "processing" : "paid",
        payment_status: "paid",
        updated_at: new Date().toISOString(),
      };
      if (isAutoOrder) updatePayload.fulfillment_status = "pending";

      const { data: updatedRows } = await supabase.from(orderTable)
        .update(updatePayload)
        .eq("id", orderId).neq("payment_status", "paid").select("id");
      if (!updatedRows?.length) return jsonRes({ status: "paid", paymentStatus: "paid" });

      // Promo increment
      if (order.promo_code) {
        if (isShop) {
          await supabase.rpc("increment_shop_promo_usage", { p_shop_id: resolvedShopId, p_code: order.promo_code });
        } else {
          await supabase.rpc("increment_promo_usage", { p_code: order.promo_code });
        }
      }

      // Balance deduction — tenant-scoped
      const balanceUsed = Number(order.balance_used || 0);
      if (balanceUsed > 0) {
        if (isShop) {
          const { data: nb, error: be } = await supabase.rpc("shop_deduct_balance", {
            p_shop_id: resolvedShopId, p_telegram_id: telegramId, p_amount: balanceUsed,
          });
          if (!be) {
            const promoInfo = order.promo_code ? ` (промо ${order.promo_code}, скидка $${Number(order.discount_amount || 0).toFixed(2)})` : "";
            await supabase.from("shop_balance_history").insert({
              shop_id: resolvedShopId, telegram_id: telegramId, amount: -balanceUsed, balance_after: nb,
              type: "purchase", comment: `Заказ ${order.order_number}${promoInfo}`, admin_telegram_id: telegramId,
            });
          }
        } else {
          const { data: nb, error: be } = await supabase.rpc("deduct_balance", {
            p_telegram_id: telegramId, p_amount: balanceUsed,
          });
          if (!be) {
            await supabase.from("balance_history").insert({
              telegram_id: telegramId, amount: -balanceUsed, balance_after: nb,
              type: "purchase", comment: `Заказ ${order.order_number}`, admin_telegram_id: telegramId,
            });
          }
        }
      }

      // Auto-order: skip inventory reservation, send buyer + owner notifications
      // and credit referral. Then return early.
      if (isAutoOrder) {
        try {
          const refAmount = Number(order.total_amount || 0);
          if (refAmount > 0) {
            await supabase.rpc("shop_credit_referral_for_order", {
              p_shop_id: resolvedShopId, p_order_id: orderId,
              p_referred_telegram_id: telegramId, p_order_amount: refAmount,
            });
          }
        } catch (e) { console.error("[auto-order polling] referral error:", e); }

        const isPremium = order.product_type === "telegram_premium";
        const durLabel = order.premium_duration === "3m" ? "3 месяца"
          : order.premium_duration === "6m" ? "6 месяцев"
          : order.premium_duration === "12m" ? "12 месяцев" : "";
        const productLine = isPremium
          ? `⭐ <b>Telegram Premium</b> (${durLabel})`
          : `⭐ <b>${order.stars_amount} Telegram Stars</b>`;

        if (tokens.botToken) {
          const buyerMsg =
            `✅ <b>Оплата подтверждена!</b>\n\n` +
            `📦 Заказ: <code>${order.order_number}</code>\n` +
            `${productLine}\n` +
            `👤 Получатель: <code>${order.target_user}</code>\n` +
            `💰 Сумма: $${Number(order.total_amount).toFixed(2)}\n\n` +
            `⏳ Заказ передан продавцу для исполнения.\n` +
            `Мы уведомим вас, как только товар будет выдан.`;
          await fetch(`https://api.telegram.org/bot${tokens.botToken}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: telegramId, text: buyerMsg, parse_mode: "HTML" }),
          }).catch((e) => console.error("[auto-order polling] notify buyer:", e));
        }

        // Notify shop owner via the SHOP bot
        try {
          const { data: shop } = await supabase.from("shops")
            .select("name, owner_id").eq("id", resolvedShopId).maybeSingle();
          if (shop?.owner_id && tokens.botToken) {
            const { data: owner } = await supabase.from("platform_users")
              .select("telegram_id").eq("id", shop.owner_id).maybeSingle();
            if (owner?.telegram_id) {
              const ownerMsg =
                `🆕 <b>Новый авто-заказ</b>\n\n` +
                `🏪 Магазин: <b>${shop.name || ""}</b>\n` +
                `📦 Заказ: <code>${order.order_number}</code>\n` +
                `${productLine}\n` +
                `👤 Получатель: <code>${order.target_user}</code>\n` +
                `💰 Сумма: $${Number(order.total_amount).toFixed(2)}\n\n` +
                `⚙️ Откройте раздел «Авто-заказы» в админке магазина, чтобы выдать товар.`;
              try {
                const r = await fetch(`https://api.telegram.org/bot${tokens.botToken}/sendMessage`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: owner.telegram_id, text: ownerMsg, parse_mode: "HTML" }),
                });
                if (!r.ok) {
                  const t = await r.text();
                  console.error("[auto-order polling] notify owner failed:", r.status, t);
                }
              } catch (e) { console.error("[auto-order polling] notify owner:", e); }
            }
          }
        } catch (e) { console.error("[auto-order polling] owner notify err:", e); }

        await supabase.from("processed_invoices").insert({
          invoice_id: String(invoice.invoice_id), type: "payment", order_id: orderId,
          telegram_id: telegramId, amount: Number(invoice.amount) || 0,
        });

        return jsonRes({ status: "processing", paymentStatus: "paid" });
      }

      // Inventory reservation
      const itemsTable = isShop ? "shop_order_items" : "order_items";
      const titleCol = isShop ? "product_name" : "product_title";
      const reserveRpc = isShop ? "reserve_shop_inventory" : "reserve_inventory";
      const inventoryTable = isShop ? "shop_inventory" : "inventory_items";
      const productsTable = isShop ? "shop_products" : "products";

      const { data: orderItems } = await supabase.from(itemsTable).select(`product_id, quantity, ${titleCol}`).eq("order_id", orderId);
      const deliveredContent: string[] = [];
      let allDelivered = true;

      if (orderItems) {
        for (const item of orderItems) {
          const itemTitle = (item as any)[titleCol];
          const { data: reserved } = await supabase.rpc(reserveRpc, {
            p_product_id: item.product_id, p_quantity: item.quantity, p_order_id: orderId,
          });
          if (reserved?.length) {
            deliveredContent.push(`📦 <b>${itemTitle}</b> (×${reserved.length}):\n${reserved.map((i: any) => `<code>${i.content}</code>`).join("\n")}`);
            const { count: remaining } = await supabase.from(inventoryTable).select("id", { count: "exact", head: true })
              .eq("product_id", item.product_id).eq("status", "available");
            await supabase.from(productsTable).update({ stock: remaining || 0, updated_at: new Date().toISOString() }).eq("id", item.product_id);
            if (reserved.length < item.quantity) allDelivered = false;
          } else { allDelivered = false; }
        }
      }

      const finalStatus = allDelivered && deliveredContent.length > 0 ? "delivered" : "paid";
      if (finalStatus !== "paid") {
        await supabase.from(orderTable).update({ status: finalStatus, updated_at: new Date().toISOString() }).eq("id", orderId);
      }

      // Referral credit (CryptoBot polling — same canonical base as webhook).
      // Idempotent via UNIQUE(order_id) inside shop_credit_referral_for_order.
      if (isShop) {
        try {
          const refAmount = Math.max(0, Number(order.total_amount || 0) - Number(order.discount_amount || 0));
          if (refAmount > 0) {
            await supabase.rpc("shop_credit_referral_for_order", {
              p_shop_id: resolvedShopId,
              p_order_id: orderId,
              p_referred_telegram_id: telegramId,
              p_order_amount: refAmount,
            });
          }
        } catch (e) { console.error("[cryptobot polling] referral credit error:", e); }
      }

      // TG notification
      if (tokens.botToken) {
        let message = `✅ <b>Оплата подтверждена!</b>\n\n📦 Заказ: <code>${order.order_number}</code>\n💰 Сумма: ${invoice.amount} USD\n`;
        if (balanceUsed > 0) message += `💳 С баланса: $${balanceUsed.toFixed(2)}\n`;
        if (deliveredContent.length > 0) {
          message += `\n🎁 <b>Ваши товары:</b>\n\n${deliveredContent.join("\n\n")}\n\n⚠️ Сохраните данные!`;
        } else { message += `\nВаш товар будет доставлен в ближайшее время.`; }
        message += `\n\nСпасибо за покупку!`;
        await fetch(`https://api.telegram.org/bot${tokens.botToken}/sendMessage`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: telegramId, text: message, parse_mode: "HTML" }),
        });
      }

      // Mark as processed only AFTER everything above succeeded.
      await supabase.from("processed_invoices").insert({
        invoice_id: String(invoice.invoice_id), type: "payment", order_id: orderId,
        telegram_id: telegramId, amount: Number(invoice.amount) || 0,
      });

      return jsonRes({ status: finalStatus, paymentStatus: "paid" });
    }

    if (invoice.status === "expired") {
      await supabase.from(orderTable).update({ status: "cancelled", payment_status: "expired", updated_at: new Date().toISOString() }).eq("id", orderId);
      return jsonRes({ status: "cancelled", paymentStatus: "expired" });
    }

    return jsonRes({ status: order.status, paymentStatus: order.payment_status, invoiceStatus: invoice.status });
  } catch (error) {
    console.error("Check payment error:", error);
    return jsonRes({ error: "Internal error" }, 500);
  }
});
