import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHash, createHmac } from "node:crypto";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, crypto-pay-api-signature",
};

const TOPUP_COMMENT_PREFIX = "Пополнение через CryptoBot";

function topupComment(invoiceId: string) {
  return `${TOPUP_COMMENT_PREFIX} (invoice:${invoiceId})`;
}

function safeJsonParse<T = any>(raw: string, fallback: T): T {
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}

async function resolveShopIdByHint(supabase: any, hint: string | null): Promise<string | null> {
  if (!hint) return null;
  const normalized = String(hint).trim();
  if (!normalized) return null;
  const { data: byId } = await supabase.from("shops").select("id").eq("id", normalized).maybeSingle();
  if (byId?.id) return byId.id;
  const { data: bySlug } = await supabase.from("shops").select("id").eq("slug", normalized).maybeSingle();
  return bySlug?.id ?? null;
}

async function decryptShopToken(supabase: any, shopId: string, field: "cryptobot_token_encrypted" | "bot_token_encrypted") {
  const encryptionKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
  if (!encryptionKey) return null;
  const { data: shop } = await supabase.from("shops").select(field).eq("id", shopId).maybeSingle();
  const encrypted = shop?.[field];
  if (!encrypted) return null;
  const { data } = await supabase.rpc("decrypt_token", { p_encrypted: encrypted, p_key: encryptionKey });
  return data || null;
}

async function hasTopupLedgerRecord(supabase: any, table: string, invoiceId: string, telegramUserId: number, topupAmount: number, processedAt?: string | null, shopId?: string | null) {
  let query = supabase.from(table).select("id", { count: "exact", head: true })
    .eq("telegram_id", telegramUserId).eq("type", "credit").ilike("comment", `%invoice:${invoiceId}%`);
  if (shopId && table === "shop_balance_history") query = query.eq("shop_id", shopId);
  const { count: taggedCount } = await query;
  if ((taggedCount || 0) > 0) return true;

  if (!processedAt) return false;
  const center = new Date(processedAt).getTime();
  if (!Number.isFinite(center)) return false;
  const from = new Date(center - 15 * 60 * 1000).toISOString();
  const to = new Date(center + 15 * 60 * 1000).toISOString();

  let fbQuery = supabase.from(table).select("id", { count: "exact", head: true })
    .eq("telegram_id", telegramUserId).eq("type", "credit").eq("amount", topupAmount)
    .gte("created_at", from).lte("created_at", to);
  if (shopId && table === "shop_balance_history") fbQuery = fbQuery.eq("shop_id", shopId);
  const { count: fallbackCount } = await fbQuery;
  return (fallbackCount || 0) > 0;
}

async function markTopupProcessed(supabase: any, invoiceId: string, telegramUserId: number, topupAmount: number, hasExistingRow: boolean) {
  if (hasExistingRow) {
    await supabase.from("processed_invoices").update({
      type: "topup", telegram_id: telegramUserId, amount: topupAmount, order_id: null, processed_at: new Date().toISOString(),
    }).eq("invoice_id", invoiceId);
    return;
  }
  await supabase.from("processed_invoices").insert({
    invoice_id: invoiceId, type: "topup", order_id: null, telegram_id: telegramUserId, amount: topupAmount,
  });
}

// Atomic claim: try to INSERT a row into processed_invoices. If the PK
// conflict fires, another concurrent webhook delivery already won the race
// and is responsible for processing — we must skip silently.
// Returns true ONLY if THIS call became the owner of the invoice.
async function claimInvoice(
  supabase: any,
  invoiceId: string,
  type: string,
  telegramId: number | null,
  amount: number,
  orderId: string | null,
): Promise<boolean> {
  const { error } = await supabase.from("processed_invoices").insert({
    invoice_id: invoiceId,
    type,
    order_id: orderId,
    telegram_id: telegramId,
    amount,
  });
  if (!error) return true;
  // 23505 = unique_violation in Postgres → already claimed
  const code = (error as any)?.code;
  if (code === "23505") return false;
  // Anything else is a real error — surface it so we don't drop payments silently.
  throw new Error(`claimInvoice failed: ${error.message || code}`);
}

// Release a claim if the business logic failed, so CryptoBot's retry can
// be processed by a future delivery instead of being silently swallowed.
async function releaseInvoiceClaim(supabase: any, invoiceId: string) {
  try {
    await supabase.from("processed_invoices").delete().eq("invoice_id", invoiceId);
  } catch (e) {
    console.error(`[cryptobot-webhook] failed to release claim ${invoiceId}:`, e);
  }
}

async function sendTopupNotification(botToken: string | null, telegramUserId: number, topupAmount: number, newBalance: number, invoiceId: string) {
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: telegramUserId, parse_mode: "HTML",
        text: `✅ <b>Баланс пополнен!</b>\n\n💰 Сумма: $${topupAmount.toFixed(2)}\n💳 Новый баланс: $${Number(newBalance).toFixed(2)}`,
      }),
    });
  } catch (error) {
    console.error(`[cryptobot-webhook] notification exception invoice=${invoiceId}:`, error);
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.text();
    const signature = req.headers.get("crypto-pay-api-signature");
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const parsedBody = safeJsonParse<any>(body, null);
    if (!parsedBody) {
      return new Response(JSON.stringify({ error: "Invalid payload" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let orderData: any = {};
    if (parsedBody.update_type === "invoice_paid") {
      orderData = safeJsonParse(parsedBody?.payload?.payload || "{}", {});
    }

    const shopHint = orderData?.shopId || orderData?.shopSlug || null;
    const shopId = await resolveShopIdByHint(supabase, shopHint);

    let verified = false;
    const platformToken = Deno.env.get("CRYPTOBOT_API_TOKEN");

    if (platformToken && signature) {
      const secret = createHash("sha256").update(platformToken).digest();
      if (createHmac("sha256", secret).update(body).digest("hex") === signature) verified = true;
    }

    if (!verified && shopId && signature) {
      const shopToken = await decryptShopToken(supabase, shopId, "cryptobot_token_encrypted");
      if (shopToken) {
        const secret = createHash("sha256").update(shopToken).digest();
        if (createHmac("sha256", secret).update(body).digest("hex") === signature) verified = true;
      }
    }

    if (!verified) {
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (parsedBody.update_type === "invoice_paid") {
      const invoice = parsedBody.payload;
      const invoiceId = String(invoice.invoice_id);

      if (orderData.type === "topup" || orderData.type === "platform_topup") {
        await handleTopup(supabase, orderData, invoiceId, orderData.type === "platform_topup" ? null : shopId, orderData.type === "platform_topup");
      } else if (orderData.type === "subscription") {
        await handleSubscriptionPayment(supabase, orderData, invoiceId);
      } else {
        // ATOMIC claim-first idempotency: insert into processed_invoices BEFORE
        // touching balances/inventory. The PK on invoice_id guarantees that
        // exactly one concurrent webhook delivery wins. If business logic
        // throws, we release the claim so CryptoBot can retry safely.
        const claimed = await claimInvoice(
          supabase,
          invoiceId,
          "payment",
          orderData.telegramUserId || null,
          Number(invoice.amount) || 0,
          orderData.orderId || null,
        );
        if (!claimed) {
          return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }

        try {
          let processedOk = false;
          if (shopId && orderData.orderId) {
            if (orderData.autoOrder) {
              processedOk = await handleAutoOrderPayment(supabase, invoice, orderData, shopId);
            } else {
              processedOk = await handleShopOrderPayment(supabase, invoice, orderData, shopId);
            }
          } else if (orderData.orderId) {
            processedOk = await handleOrderPayment(supabase, invoice, orderData);
          } else {
            processedOk = true; // nothing to do, but claim is valid
          }

          if (!processedOk) {
            // Business handler decided this delivery is invalid (e.g. order
            // not found). Release claim so a later valid delivery can win.
            await releaseInvoiceClaim(supabase, invoiceId);
          }
        } catch (err) {
          await releaseInvoiceClaim(supabase, invoiceId);
          throw err;
        }
      }
    }

    return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error: any) {
    console.error("[cryptobot-webhook] webhook error:", error?.message || error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ─── Topup handler (tenant-aware + platform) ─────────────
async function handleTopup(supabase: any, orderData: any, invoiceId: string, topupShopId: string | null, isPlatformTopup = false) {
  const topupAmount = Number(orderData.amount);
  const telegramUserId = Number(orderData.telegramUserId);
  if (!telegramUserId || !topupAmount || topupAmount <= 0) throw new Error(`[topup] invalid payload invoice=${invoiceId}`);

  const isShopTopup = !!topupShopId;

  // ATOMIC claim — only the first concurrent delivery proceeds. The PK
  // on processed_invoices guarantees that parallel webhook deliveries
  // cannot both credit the balance.
  const claimed = await claimInvoice(
    supabase,
    invoiceId,
    "topup",
    telegramUserId,
    topupAmount,
    null,
  );
  if (!claimed) {
    // Already processed — safe no-op.
    return;
  }

  try {
  // Credit balance — tenant-scoped or platform
  let newBalance: number;
  if (isPlatformTopup) {
    const { data: nb, error: creditError } = await supabase.rpc("platform_credit_balance", {
      p_telegram_id: telegramUserId, p_amount: topupAmount,
    });
    if (creditError) throw new Error(`platform_credit_balance failed: ${creditError.message}`);
    newBalance = nb;
    await supabase.from("platform_balance_history").insert({
      telegram_id: telegramUserId, amount: topupAmount, balance_after: newBalance,
      type: "credit", comment: topupComment(invoiceId),
    });
  } else if (isShopTopup) {
    const { data: nb, error: creditError } = await supabase.rpc("shop_credit_balance", {
      p_shop_id: topupShopId, p_telegram_id: telegramUserId, p_amount: topupAmount,
    });
    if (creditError) throw new Error(`shop_credit_balance failed: ${creditError.message}`);
    newBalance = nb;
    await supabase.from("shop_balance_history").insert({
      shop_id: topupShopId, telegram_id: telegramUserId, amount: topupAmount, balance_after: newBalance,
      type: "credit", comment: topupComment(invoiceId), admin_telegram_id: telegramUserId,
    });
  } else {
    const { data: nb, error: creditError } = await supabase.rpc("credit_balance", {
      p_telegram_id: telegramUserId, p_amount: topupAmount,
    });
    if (creditError) throw new Error(`credit_balance failed: ${creditError.message}`);
    newBalance = nb;
    await supabase.from("balance_history").insert({
      telegram_id: telegramUserId, amount: topupAmount, balance_after: newBalance,
      type: "credit", comment: topupComment(invoiceId), admin_telegram_id: telegramUserId,
    });
  }

  let botToken: string | null = null;
  if (isPlatformTopup) {
    botToken = Deno.env.get("PLATFORM_BOT_TOKEN") || null;
  } else if (isShopTopup) {
    botToken = await decryptShopToken(supabase, topupShopId!, "bot_token_encrypted");
  }
  if (!botToken) botToken = Deno.env.get("TELEGRAM_BOT_TOKEN") || null;

  await sendTopupNotification(botToken, telegramUserId, topupAmount, Number(newBalance), invoiceId);
  } catch (err) {
    // Business logic failed — release the claim so CryptoBot's retry can
    // be processed by a subsequent delivery instead of being lost.
    await releaseInvoiceClaim(supabase, invoiceId);
    throw err;
  }
}

// ─── Subscription payment handler ─────────────
async function handleSubscriptionPayment(supabase: any, orderData: any, invoiceId: string) {
  const telegramUserId = Number(orderData.telegramUserId);
  const paymentId = orderData.paymentId;
  const balanceUsed = Number(orderData.balanceUsed || 0);
  const subscriptionPrice = Number(orderData.subscriptionPrice || 0);
  const tier = orderData.tier || "standard_5";
  const plan = ['start','basic','premium'].includes(orderData.plan) ? orderData.plan : 'start';
  const months = Number(orderData.months) || 1;
  const totalDays = months * 30;

  if (!telegramUserId || !paymentId) throw new Error(`[subscription] invalid payload invoice=${invoiceId}`);

  // F3: Validate that paymentId references a real, still-pending payment for
  // this user. Prevents replay attacks where a valid signed webhook for a
  // different invoice is reused with a swapped paymentId.
  const { data: paymentRow } = await supabase.from("subscription_payments")
    .select("id, status, telegram_id, amount").eq("id", paymentId).maybeSingle();
  if (!paymentRow) {
    console.error(`[subscription] payment ${paymentId} not found for invoice ${invoiceId}`);
    return;
  }
  if (paymentRow.telegram_id && Number(paymentRow.telegram_id) !== telegramUserId) {
    console.error(`[subscription] payment ${paymentId} telegram mismatch (expected ${paymentRow.telegram_id}, got ${telegramUserId})`);
    return;
  }
  if (paymentRow.status === "paid") {
    // Already settled — only ensure idempotency record exists.
    await claimInvoice(supabase, invoiceId, "subscription", telegramUserId, subscriptionPrice, null);
    return;
  }

  // ATOMIC claim — first concurrent delivery wins.
  const claimed = await claimInvoice(supabase, invoiceId, "subscription", telegramUserId, subscriptionPrice, null);
  if (!claimed) return;

  try {
  // Deduct balance if used
  if (balanceUsed > 0) {
    const { data: newBal, error: balErr } = await supabase.rpc("platform_deduct_balance", {
      p_telegram_id: telegramUserId, p_amount: balanceUsed,
    });
    if (!balErr) {
      const planLabelComment = plan === 'premium' ? 'Премиум' : plan === 'basic' ? 'Базовый' : 'Старт';
      await supabase.from("platform_balance_history").insert({
        telegram_id: telegramUserId, amount: -balanceUsed, balance_after: newBal,
        type: "subscription", comment: `Подписка ${planLabelComment} (invoice:${invoiceId})`,
      });
    }
  }

  // Activate subscription — preserve remaining days
  const { data: pUser } = await supabase.from("platform_users").select("first_paid_at, id, subscription_status, subscription_expires_at").eq("telegram_id", telegramUserId).maybeSingle();
  const currentExpiry = pUser?.subscription_expires_at ? new Date(pUser.subscription_expires_at).getTime() : 0;
  const baseDate = Math.max(currentExpiry, Date.now());
  const expiresAt = new Date(baseDate + totalDays * 24 * 60 * 60 * 1000).toISOString();
  const wasActive = pUser?.subscription_status === 'active';
  
  // Capture previous plan to detect upgrade
  const previousPlan = pUser?.subscription_plan || null;

  await supabase.from("platform_users").update({
    subscription_status: "active", subscription_expires_at: expiresAt,
    subscription_plan: plan,
    current_period_end: expiresAt,
    billing_price_usd: months === 1 ? subscriptionPrice : Math.round(subscriptionPrice / months * 100) / 100,
    pricing_tier: plan,
    first_paid_at: pUser?.first_paid_at || new Date().toISOString(),
    reminder_sent_at: null, expiry_notified_at: null, updated_at: new Date().toISOString(),
  }).eq("telegram_id", telegramUserId);

  // Increment promo usage for subscription promos
  const { data: subPayment } = await supabase.from("subscription_payments").select("promo_code, discount_amount, id").eq("id", paymentId).maybeSingle();
  if (subPayment?.promo_code) {
    const { data: promoRow } = await supabase.from("platform_subscription_promos").select("id").ilike("code", subPayment.promo_code).maybeSingle();
    if (promoRow) {
      await supabase.rpc("increment_platform_promo_usage", {
        p_promo_id: promoRow.id, p_telegram_id: telegramUserId, p_payment_id: paymentId, p_discount_amount: Number(subPayment.discount_amount || 0),
      });
    }
  }

  // Reactivate paused shops
  if (pUser?.id) {
    const { data: shops } = await supabase.from("shops").select("id").eq("owner_id", pUser.id).eq("status", "paused");
    for (const shop of shops || []) {
      await supabase.from("shops").update({ status: "active", updated_at: new Date().toISOString() }).eq("id", shop.id);
    }
  }

  // Mark payment as paid
  await supabase.from("subscription_payments").update({ status: "paid" }).eq("id", paymentId);

  // Platform referral reward (idempotent via UNIQUE subscription_payment_id)
  try {
    const refAmount = Math.max(0, subscriptionPrice);
    if (refAmount > 0) {
      await supabase.rpc("platform_credit_referral_for_subscription", {
        p_subscription_payment_id: paymentId,
        p_referred_telegram_id: telegramUserId,
        p_payment_amount: refAmount,
      });
    }
  } catch (e) {
    console.error("Platform referral credit error:", e);
  }

  // Notify
  const monthsLabel = months === 1 ? "1 мес" : `${months} мес`;
  const botToken = Deno.env.get("PLATFORM_BOT_TOKEN");
  if (botToken) {
    const planLabel = plan === 'premium' ? '💎 Премиум' : plan === 'basic' ? '⭐ Базовый' : '🚀 Старт';
    let msg = `✅ <b>Подписка ${wasActive ? 'продлена' : 'активирована'}!</b>\n\n${planLabel}\n📅 Действует до: ${new Date(expiresAt).toLocaleDateString("ru")}\n💰 Стоимость: $${subscriptionPrice.toFixed(2)} (${monthsLabel})`;
    if (balanceUsed > 0) msg += `\n💳 С баланса: -$${balanceUsed.toFixed(2)}`;
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: telegramUserId, text: msg, parse_mode: "HTML" }),
      });
    } catch {}
  }

  // Deliver paid_content based on plan (idempotent via UNIQUE in paid_content_logs)
  await deliverPaidContent(supabase, telegramUserId, plan, previousPlan, botToken);
  } catch (err) {
    await releaseInvoiceClaim(supabase, invoiceId);
    throw err;
  }
}

// ─── Deliver paid content (basic/premium) ────────
async function deliverPaidContent(
  supabase: any,
  telegramId: number,
  newPlan: string,
  previousPlan: string | null,
  botToken: string | null,
) {
  if (!botToken) return;
  // Determine which plans the user is now entitled to
  const eligiblePlans: string[] = [];
  if (newPlan === 'basic' || newPlan === 'premium') eligiblePlans.push('basic');
  if (newPlan === 'premium') eligiblePlans.push('premium');
  if (eligiblePlans.length === 0) return;

  // For upgrades (basic -> premium): only deliver premium content (basic was already sent)
  // For new subs to basic/premium: deliver everything they're entitled to
  // Idempotency via UNIQUE(telegram_id, content_id) in paid_content_logs prevents dupes anyway.
  const { data: items } = await supabase
    .from('paid_content')
    .select('id, plan, title, body')
    .in('plan', eligiblePlans)
    .eq('is_active', true)
    .order('sort_order', { ascending: true });

  for (const item of items || []) {
    // Pre-check log to avoid sending message for already-sent content
    const { data: existing } = await supabase
      .from('paid_content_logs')
      .select('id').eq('telegram_id', telegramId).eq('content_id', item.id).maybeSingle();
    if (existing) continue;

    const text = `🎁 <b>${item.title}</b>\n\n${item.body}`;
    let ok = false;
    let errMsg = '';
    try {
      const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: telegramId, text, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      const j = await r.json().catch(() => ({}));
      ok = !!j?.ok;
      if (!ok) errMsg = String(j?.description || r.status);
    } catch (e: any) {
      errMsg = e?.message || 'send error';
    }
    // Log result (UNIQUE prevents dupes on retry)
    await supabase.from('paid_content_logs').insert({
      telegram_id: telegramId, content_id: item.id,
      status: ok ? 'sent' : 'failed', error: ok ? null : errMsg,
    });
  }
}

// ─── Platform order payment ─────────────────────
async function handleOrderPayment(supabase: any, invoice: any, orderData: any): Promise<boolean> {
  const { data: order } = await supabase.from("orders")
    .select("id, status, payment_status, promo_code, balance_used, telegram_id, order_number")
    .eq("id", orderData.orderId).single();
  if (!order) return false;
  if (order.payment_status === "paid") return true; // already done — safe to mark processed

  const { data: updatedRows } = await supabase.from("orders")
    .update({ status: "paid", payment_status: "paid", updated_at: new Date().toISOString() })
    .eq("id", orderData.orderId).neq("payment_status", "paid").select("id");
  if (!updatedRows?.length) return true; // someone else won the race — also safe

  if (order.promo_code) await supabase.rpc("increment_promo_usage", { p_code: order.promo_code });

  const balanceUsed = Number(order.balance_used || 0);
  if (balanceUsed > 0) {
    const { data: nb, error: be } = await supabase.rpc("deduct_balance", { p_telegram_id: order.telegram_id, p_amount: balanceUsed });
    if (!be) await supabase.from("balance_history").insert({
      telegram_id: order.telegram_id, amount: -balanceUsed, balance_after: nb,
      type: "purchase", comment: `Заказ ${order.order_number}`, admin_telegram_id: order.telegram_id,
    });
  }

  await deliverInventory(supabase, orderData.orderId, "order_items", "product_title", "reserve_inventory", "inventory_items", "products", order.telegram_id, order.order_number, balanceUsed, invoice, Deno.env.get("TELEGRAM_BOT_TOKEN"), "orders");
  return true;
}

// ─── Shop order payment (tenant-scoped balance) ──
async function handleShopOrderPayment(supabase: any, invoice: any, orderData: any, shopId: string): Promise<boolean> {
  const { data: order } = await supabase.from("shop_orders")
    .select("id, status, payment_status, balance_used, buyer_telegram_id, order_number, shop_id, promo_code, discount_amount, total_amount")
    .eq("id", orderData.orderId).single();
  if (!order) return false;
  if (order.payment_status === "paid") return true;

  const { data: updatedRows } = await supabase.from("shop_orders")
    .update({ status: "paid", payment_status: "paid", updated_at: new Date().toISOString() })
    .eq("id", orderData.orderId).neq("payment_status", "paid").select("id");
  if (!updatedRows?.length) return true;

  // Shop promo increment
  if (order.promo_code) {
    await supabase.rpc("increment_shop_promo_usage", { p_shop_id: shopId, p_code: order.promo_code });
  }

  const balanceUsed = Number(order.balance_used || 0);
  if (balanceUsed > 0) {
    const { data: nb, error: be } = await supabase.rpc("shop_deduct_balance", {
      p_shop_id: shopId, p_telegram_id: order.buyer_telegram_id, p_amount: balanceUsed,
    });
    if (!be) {
      const promoInfo = order.promo_code ? ` (промо ${order.promo_code}, скидка $${Number(order.discount_amount || 0).toFixed(2)})` : "";
      await supabase.from("shop_balance_history").insert({
        shop_id: shopId, telegram_id: order.buyer_telegram_id, amount: -balanceUsed, balance_after: nb,
        type: "purchase", comment: `Заказ ${order.order_number}${promoInfo}`, admin_telegram_id: order.buyer_telegram_id,
      });
    }
  }

  const botToken = await decryptShopToken(supabase, shopId, "bot_token_encrypted");
  await deliverInventory(supabase, orderData.orderId, "shop_order_items", "product_name", "reserve_shop_inventory", "shop_inventory", "shop_products", order.buyer_telegram_id, order.order_number, balanceUsed, invoice, botToken, "shop_orders");

  // Referral reward (idempotent via UNIQUE order_id)
  try {
    // Use the canonical final amount (total - discount) so referrer
    // earns from what the buyer actually paid, regardless of split
    // between external invoice and internal balance.
    const finalAmount = Math.max(0, Number(order.total_amount || 0) - Number(order.discount_amount || 0));
    if (finalAmount > 0) {
      await supabase.rpc("shop_credit_referral_for_order", {
        p_shop_id: shopId,
        p_order_id: orderData.orderId,
        p_referred_telegram_id: order.buyer_telegram_id,
        p_order_amount: finalAmount,
      });
    }
  } catch (e) {
    console.error("Referral credit error:", e);
  }
  return true;
}

// ─── Shared delivery logic ──────────────────────
async function deliverInventory(
  supabase: any, orderId: string,
  itemsTable: string, titleCol: string, reserveRpc: string,
  inventoryTable: string, productsTable: string,
  telegramId: number, orderNumber: string, balanceUsed: number,
  invoice: any, botToken: string | null, orderTable: string,
) {
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

  if (botToken) {
    let message = `✅ <b>Оплата подтверждена!</b>\n\n📦 Заказ: <code>${orderNumber}</code>\n💰 Сумма: ${invoice.amount} USD\n`;
    if (balanceUsed > 0) message += `💳 С баланса: $${balanceUsed.toFixed(2)}\n`;
    if (deliveredContent.length > 0) {
      message += `\n🎁 <b>Ваши товары:</b>\n\n${deliveredContent.join("\n\n")}\n\n⚠️ Сохраните данные!`;
    } else { message += `\nВаш товар будет доставлен в ближайшее время.`; }
    message += `\n\nСпасибо за покупку!`;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, text: message, parse_mode: "HTML" }),
    });
  }
}

// ─── Auto-product order payment (Telegram Premium / Stars) ──────
async function handleAutoOrderPayment(supabase: any, invoice: any, orderData: any, shopId: string): Promise<boolean> {
  const { data: order } = await supabase.from("shop_orders")
    .select("id, status, payment_status, balance_used, buyer_telegram_id, order_number, shop_id, product_type, target_user, premium_duration, stars_amount, total_amount, discount_amount")
    .eq("id", orderData.orderId).single();
  if (!order) return false;
  if (order.payment_status === "paid") return true;

  const { data: updatedRows } = await supabase.from("shop_orders")
    .update({
      status: "processing",
      payment_status: "paid",
      fulfillment_status: "pending",
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderData.orderId).neq("payment_status", "paid").select("id");
  if (!updatedRows?.length) return true;

  // Referral reward (idempotent)
  try {
    const finalAmount = Math.max(0, Number(order.total_amount || 0) - Number(order.discount_amount || 0));
    if (finalAmount > 0) {
      await supabase.rpc("shop_credit_referral_for_order", {
        p_shop_id: shopId,
        p_order_id: orderData.orderId,
        p_referred_telegram_id: order.buyer_telegram_id,
        p_order_amount: finalAmount,
      });
    }
  } catch (e) {
    console.error("[auto-order] referral credit error:", e);
  }

  const botToken = await decryptShopToken(supabase, shopId, "bot_token_encrypted");

  // Compose product description
  const isPremium = order.product_type === "telegram_premium";
  const durLabel = order.premium_duration === "3m" ? "3 месяца"
    : order.premium_duration === "6m" ? "6 месяцев"
    : order.premium_duration === "12m" ? "12 месяцев" : "";
  const productLine = isPremium
    ? `⭐ <b>Telegram Premium</b> (${durLabel})`
    : `⭐ <b>${order.stars_amount} Telegram Stars</b>`;

  // Notify buyer
  if (botToken) {
    const buyerMsg =
      `✅ <b>Оплата подтверждена!</b>\n\n` +
      `📦 Заказ: <code>${order.order_number}</code>\n` +
      `${productLine}\n` +
      `👤 Получатель: <code>${order.target_user}</code>\n` +
      `💰 Сумма: $${Number(order.total_amount).toFixed(2)}\n\n` +
      `⏳ Заказ передан продавцу для исполнения. Обычно занимает несколько минут.\n` +
      `Мы уведомим вас, как только товар будет выдан.`;
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: order.buyer_telegram_id, text: buyerMsg, parse_mode: "HTML" }),
    }).catch((e) => console.error("[auto-order] notify buyer error:", e));
  }

  // Notify shop owner via the SHOP bot (so owner sees alerts in their store bot, not the platform bot)
  try {
    const { data: shop } = await supabase.from("shops")
      .select("name, owner_id").eq("id", shopId).maybeSingle();
    if (shop?.owner_id) {
      const { data: owner } = await supabase.from("platform_users")
        .select("telegram_id").eq("id", shop.owner_id).maybeSingle();
      if (owner?.telegram_id && botToken) {
        const ownerMsg =
          `🆕 <b>Новый авто-заказ</b>\n\n` +
          `🏪 Магазин: <b>${shop.name || ""}</b>\n` +
          `📦 Заказ: <code>${order.order_number}</code>\n` +
          `${productLine}\n` +
          `👤 Получатель: <code>${order.target_user}</code>\n` +
          `💰 Сумма: $${Number(order.total_amount).toFixed(2)}\n\n` +
          `⚙️ Откройте раздел «Авто-заказы» в админке магазина, чтобы выдать товар.`;
        try {
          const r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ chat_id: owner.telegram_id, text: ownerMsg, parse_mode: "HTML" }),
          });
          if (!r.ok) {
            const t = await r.text();
            console.error("[auto-order] notify owner failed:", r.status, t);
          }
        } catch (e) { console.error("[auto-order] notify owner error:", e); }
      }
    }
  } catch (e) {
    console.error("[auto-order] owner notification error:", e);
  }

  return true;
}
