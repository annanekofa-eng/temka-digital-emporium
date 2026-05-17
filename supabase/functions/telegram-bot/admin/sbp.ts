// SBP payment moderation + requisites editing.
import { tg, deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession } from "../_shared/session.ts";

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function backMenu() { return [{ text: "← Меню", callback_data: "a:menu" }]; }

const PAGE = 6;
const FILTERS: Record<string, { label: string; status: string | null }> = {
  pending: { label: "⏳ На проверке", status: "pending_review" },
  approved: { label: "✅ Подтверждены", status: "approved" },
  rejected: { label: "❌ Отклонены", status: "rejected" },
  all: { label: "📋 Все", status: null },
};

export async function showSbpList(
  chatId: number, msgId: number | undefined, filter = "pending", page = 0,
) {
  const f = FILTERS[filter] ?? FILTERS.pending;
  let q = supabase
    .from("sbp_payments")
    .select("id, amount_rub, amount_usd, status, created_at, telegram_id, order_id", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (f.status) q = q.eq("status", f.status);
  const { data, count } = await q;

  const filterRow = Object.entries(FILTERS).map(([k, v]) => ({
    text: safeSlice((filter === k ? "• " : "") + v.label, 30),
    callback_data: `a:sbp:f:${k}`,
  }));
  const rows: any[] = [filterRow];
  for (const p of data ?? []) {
    const tag = p.status === "pending_review" ? "⏳"
      : p.status === "approved" ? "✅" : "❌";
    rows.push([{
      text: safeSlice(`${tag} ${p.amount_rub}₽ · $${Number(p.amount_usd).toFixed(2)} · id${p.telegram_id}`, 60),
      callback_data: `a:sbp:v:${p.id}`,
    }]);
  }

  const total = count ?? 0;
  const nav: any[] = [];
  if (page > 0) nav.push({ text: "‹", callback_data: `a:sbp:p:${filter}:${page - 1}` });
  nav.push({ text: `${page + 1}/${Math.max(1, Math.ceil(total / PAGE))}`, callback_data: `a:sbp:f:${filter}` });
  if ((page + 1) * PAGE < total) nav.push({ text: "›", callback_data: `a:sbp:p:${filter}:${page + 1}` });
  if (nav.length > 1) rows.push(nav);
  rows.push(backMenu());

  await deleteAndSend(chatId, msgId, {
    text: `📥 <b>Заявки СБП — ${escapeHtml(f.label)}</b>\nВсего: <b>${total}</b>`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showSbpPayment(chatId: number, msgId: number | undefined, id: string) {
  const { data: p } = await supabase.from("sbp_payments").select("*").eq("id", id).maybeSingle();
  if (!p) return showSbpList(chatId, msgId, "pending", 0);

  const { data: order } = await supabase.from("orders").select("order_number, total_amount, promo_code, discount_amount").eq("id", p.order_id).maybeSingle();
  const { data: items } = await supabase.from("order_items").select("product_title, quantity, product_price").eq("order_id", p.order_id);
  const { data: user } = await supabase.from("user_profiles").select("first_name, last_name, username").eq("telegram_id", p.telegram_id).maybeSingle();

  const itemsText = (items || []).map((i: any) =>
    `• ${i.product_title} ×${i.quantity} — $${(Number(i.product_price) * i.quantity).toFixed(2)}`).join("\n");

  const userLabel = user
    ? `${user.first_name || ""}${user.last_name ? " " + user.last_name : ""}${user.username ? " (@" + user.username + ")" : ""}`
    : `id${p.telegram_id}`;

  const tag = p.status === "pending_review" ? "⏳ На проверке"
    : p.status === "approved" ? "✅ Подтверждена"
    : p.status === "rejected" ? `❌ Отклонена${p.reject_reason ? `: ${p.reject_reason}` : ""}`
    : "⏳ Ждём чек";

  const caption = [
    `📥 <b>Заявка СБП</b>`,
    `Статус: ${escapeHtml(tag)}`,
    `Заказ: <code>${escapeHtml(order?.order_number || "")}</code>`,
    `Покупатель: ${escapeHtml(userLabel)} · <code>${p.telegram_id}</code>`,
    ``,
    itemsText,
    ``,
    `Сумма: $${Number(p.amount_usd).toFixed(2)} = <b>${p.amount_rub} ₽</b> (курс ${p.rate})`,
    `Создано: ${new Date(p.created_at).toLocaleString("ru-RU")}`,
  ].join("\n");

  const kb: any[] = [];
  if (p.status === "pending_review") {
    kb.push([{ text: "✅ Принять", callback_data: `a:sbp:ok:${id}` }]);
    kb.push([{ text: "❌ Отклонить", callback_data: `a:sbp:rj:${id}` }]);
  }
  kb.push([{ text: "← К списку", callback_data: "a:sbp" }]);

  // Try sending receipt as photo with caption
  if (p.receipt_url) {
    const { data: signed } = await supabase.storage.from("sbp-receipts")
      .createSignedUrl(p.receipt_url, 60 * 60 * 24 * 7);
    if (signed?.signedUrl) {
      const isPdf = p.receipt_url.toLowerCase().endsWith(".pdf");
      if (msgId) {
        try { await tg("deleteMessage", { chat_id: chatId, message_id: msgId }); } catch {}
      }
      if (isPdf) {
        await tg("sendDocument", {
          chat_id: chatId, document: signed.signedUrl,
          caption, parse_mode: "HTML",
          reply_markup: { inline_keyboard: kb },
        });
      } else {
        await tg("sendPhoto", {
          chat_id: chatId, photo: signed.signedUrl,
          caption, parse_mode: "HTML",
          reply_markup: { inline_keyboard: kb },
        });
      }
      return;
    }
  }

  await deleteAndSend(chatId, msgId, {
    text: caption, parse_mode: "HTML",
    reply_markup: { inline_keyboard: kb },
  });
}

export async function approveSbpPayment(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  const { data: p } = await supabase.from("sbp_payments").select("*").eq("id", id).maybeSingle();
  if (!p || p.status !== "pending_review") return showSbpPayment(chatId, msgId, id);

  const { data: order } = await supabase.from("orders").select("*").eq("id", p.order_id).maybeSingle();
  if (!order) return;

  // Mark order paid + payment approved
  await supabase.from("orders").update({
    status: "processing", payment_status: "paid", updated_at: new Date().toISOString(),
  }).eq("id", p.order_id);
  await supabase.from("sbp_payments").update({
    status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: adminId,
  }).eq("id", id);

  if (order.promo_code) {
    await supabase.rpc("increment_promo_usage", { p_code: order.promo_code });
  }

  // Reserve inventory + deliver
  const { data: items } = await supabase.from("order_items").select("*").eq("order_id", p.order_id);
  const deliveredContent: string[] = [];
  let allDelivered = true;
  for (const item of items || []) {
    const { data: reserved } = await supabase.rpc("reserve_inventory", {
      p_product_id: item.product_id, p_quantity: item.quantity, p_order_id: p.order_id,
    });
    if (!reserved || reserved.length < item.quantity) {
      allDelivered = false;
    } else {
      reserved.forEach((r: any) => deliveredContent.push(`${item.product_title}: ${r.content}`));
      const { count: remaining } = await supabase.from("inventory_items").select("id", { count: "exact", head: true })
        .eq("product_id", item.product_id).eq("status", "available");
      await supabase.from("products").update({ stock: remaining || 0, updated_at: new Date().toISOString() }).eq("id", item.product_id);
    }
  }

  await supabase.from("orders").update({
    status: allDelivered ? "completed" : "processing",
    updated_at: new Date().toISOString(),
  }).eq("id", p.order_id);

  // Notify buyer
  try {
    if (allDelivered && deliveredContent.length) {
      await tg("sendMessage", {
        chat_id: p.telegram_id, parse_mode: "HTML",
        text: `✅ <b>Оплата подтверждена!</b>\n\nЗаказ <code>${order.order_number}</code> оплачен и выполнен.\n\n<pre>${deliveredContent.join("\n")}</pre>`,
      });
    } else {
      await tg("sendMessage", {
        chat_id: p.telegram_id, parse_mode: "HTML",
        text: `✅ <b>Оплата подтверждена!</b>\n\nЗаказ <code>${order.order_number}</code> принят. Товар будет выдан вручную в ближайшее время.`,
      });
    }
  } catch (e) { console.error(e); }

  await writeAuditLog(adminId, "sbp.approve", id, { orderId: p.order_id });
  return showSbpList(chatId, undefined, "pending", 0);
}

export async function startRejectSbp(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  await setSession(adminId, `sbp:reject:${id}`, {});
  await deleteAndSend(chatId, msgId, {
    text: "❌ Укажите причину отклонения (отправьте сообщением):",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: `a:sbp:v:${id}` }]] },
  });
}

export async function applyRejectSbp(chatId: number, adminId: number, id: string, reason: string) {
  const { data: p } = await supabase.from("sbp_payments").select("*").eq("id", id).maybeSingle();
  if (!p) { await clearSession(adminId); return; }
  await supabase.from("sbp_payments").update({
    status: "rejected", reject_reason: reason.slice(0, 500),
    reviewed_at: new Date().toISOString(), reviewed_by: adminId,
  }).eq("id", id);
  await supabase.from("orders").update({
    status: "failed", payment_status: "failed", updated_at: new Date().toISOString(),
  }).eq("id", p.order_id);

  try {
    await tg("sendMessage", {
      chat_id: p.telegram_id, parse_mode: "HTML",
      text: `❌ <b>Оплата отклонена</b>\n\nПричина: ${reason}\n\nЕсли это ошибка — свяжитесь с поддержкой или загрузите корректный чек заново.`,
    });
  } catch (e) { console.error(e); }

  await writeAuditLog(adminId, "sbp.reject", id, { reason });
  await clearSession(adminId);
  await showSbpList(chatId, undefined, "pending", 0);
}

// --- Requisites editing ---

const FIELDS: Record<string, string> = {
  bank: "🏦 Банк",
  card: "💳 Номер карты",
  holder_name: "👤 ФИО получателя",
  phone: "📱 Телефон",
};

export async function showSbpRequisites(chatId: number, msgId?: number) {
  const { data: r } = await supabase.from("sbp_requisites").select("*").eq("key", "current").maybeSingle();
  const lines = Object.entries(FIELDS).map(([k, label]) => {
    const v = (r as any)?.[k] || "<i>не задано</i>";
    return `<b>${label}</b>\n<code>${escapeHtml(v)}</code>`;
  }).join("\n\n");
  const kb = Object.entries(FIELDS).map(([k, label]) => [{
    text: label, callback_data: `a:sbp:re:${k}`,
  }]);
  kb.push([{ text: "← К настройкам", callback_data: "a:se" }]);
  await deleteAndSend(chatId, msgId, {
    text: `🏦 <b>Реквизиты СБП</b>\n\n${lines}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: kb },
  });
}

export async function startEditSbpField(chatId: number, msgId: number | undefined, field: string, adminId: number) {
  if (!FIELDS[field]) return showSbpRequisites(chatId, msgId);
  await setSession(adminId, `sbp:rfield:${field}`, {});
  await deleteAndSend(chatId, msgId, {
    text: `✏️ Введите новое значение для <b>${FIELDS[field]}</b> (или <code>-</code> чтобы очистить):`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "a:sbp:req" }]] },
  });
}

export async function applyEditSbpField(chatId: number, adminId: number, field: string, raw: string) {
  if (!FIELDS[field]) { await clearSession(adminId); return; }
  const value = raw === "-" ? "" : raw.trim();
  await supabase.from("sbp_requisites").update({
    [field]: value, updated_at: new Date().toISOString(),
  }).eq("key", "current");
  await writeAuditLog(adminId, "sbp.requisites.update", field, { value });
  await clearSession(adminId);
  await showSbpRequisites(chatId, undefined);
}

// FSM dispatcher
export async function handleSbpText(
  chatId: number, adminId: number, sessState: string, text: string,
): Promise<boolean> {
  if (sessState.startsWith("sbp:reject:")) {
    const id = sessState.split(":")[2];
    await applyRejectSbp(chatId, adminId, id, text);
    return true;
  }
  if (sessState.startsWith("sbp:rfield:")) {
    const field = sessState.split(":")[2];
    await applyEditSbpField(chatId, adminId, field, text);
    return true;
  }
  return false;
}
