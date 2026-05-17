// Auto-orders admin module: queue of Stars/Premium orders awaiting manual delivery.
import { tg, deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession } from "../_shared/session.ts";

const PAGE_SIZE = 8;

const STATUS_LABEL: Record<string, string> = {
  pending: "⏳ Ожидают",
  delivered: "✅ Выданы",
  error: "❌ Ошибки",
};

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function showAutoOrderList(
  chatId: number,
  msgId: number | undefined,
  filter: "pending" | "delivered" | "error" | "all" = "pending",
  page = 0,
) {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let q = supabase
    .from("orders")
    .select("id, order_number, telegram_id, total_amount, auto_status, created_at", { count: "exact" })
    .eq("is_auto", true)
    .order("created_at", { ascending: false });
  if (filter !== "all") q = q.eq("auto_status", filter);

  const { data, count } = await q.range(from, to);
  const total = count ?? 0;

  const tabs = [
    { text: filter === "pending" ? "• ⏳ •" : "⏳", callback_data: "a:ao:f:pending" },
    { text: filter === "delivered" ? "• ✅ •" : "✅", callback_data: "a:ao:f:delivered" },
    { text: filter === "error" ? "• ❌ •" : "❌", callback_data: "a:ao:f:error" },
    { text: filter === "all" ? "• 📋 •" : "📋", callback_data: "a:ao:f:all" },
  ];

  const rows: any[] = [tabs];

  if (!data?.length) {
    rows.push([{ text: "← Меню", callback_data: "a:menu" }]);
    return deleteAndSend(chatId, msgId, {
      text: `🤖 <b>Авто-заказы</b>\n\nПусто в разделе «${STATUS_LABEL[filter] ?? filter}».`,
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: rows },
    });
  }

  for (const o of data) {
    const icon =
      o.auto_status === "delivered" ? "✅" :
      o.auto_status === "error" ? "❌" : "⏳";
    rows.push([{
      text: safeSlice(
        `${icon} ${o.order_number} · $${Number(o.total_amount).toFixed(2)} · ${o.telegram_id}`,
        60,
      ),
      callback_data: `a:ao:v:${o.id}`,
    }]);
  }

  // Pagination
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (totalPages > 1) {
    const nav: any[] = [];
    if (page > 0) nav.push({ text: "←", callback_data: `a:ao:p:${filter}:${page - 1}` });
    nav.push({ text: `${page + 1}/${totalPages}`, callback_data: "a:ao" });
    if (page < totalPages - 1) nav.push({ text: "→", callback_data: `a:ao:p:${filter}:${page + 1}` });
    rows.push(nav);
  }
  rows.push([{ text: "← Меню", callback_data: "a:menu" }]);

  return deleteAndSend(chatId, msgId, {
    text: `🤖 <b>Авто-заказы</b> · ${STATUS_LABEL[filter] ?? "всё"} (${total})`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showAutoOrder(chatId: number, msgId: number | undefined, orderId: string) {
  const { data: order } = await supabase
    .from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order) {
    return deleteAndSend(chatId, msgId, {
      text: "❌ Заказ не найден.",
      reply_markup: { inline_keyboard: [[{ text: "← К списку", callback_data: "a:ao" }]] },
    });
  }
  const { data: items } = await supabase
    .from("order_items").select("*").eq("order_id", orderId);

  const itemsText = (items ?? [])
    .map((i: any) => `• <b>${escapeHtml(i.product_title)}</b>${i.recipient_username ? ` → @${escapeHtml(i.recipient_username)}` : ""}`)
    .join("\n");

  const statusIcon =
    order.auto_status === "delivered" ? "✅ Выдан" :
    order.auto_status === "error" ? "❌ Ошибка выдачи" :
    "⏳ Ожидает выдачи";

  const created = new Date(order.created_at).toLocaleString("ru-RU");
  const delivered = order.auto_delivered_at
    ? new Date(order.auto_delivered_at).toLocaleString("ru-RU") : null;

  let text = `🤖 <b>Авто-заказ ${escapeHtml(order.order_number)}</b>\n\n` +
    `${itemsText}\n\n` +
    `💰 Сумма: $${Number(order.total_amount).toFixed(2)}\n` +
    `👤 Покупатель: <code>${order.telegram_id}</code>\n` +
    `🕐 Создан: ${created}\n` +
    `📊 Статус: ${statusIcon}`;
  if (delivered) text += `\n✅ Выдан: ${delivered}`;
  if (order.auto_error_note) text += `\n💬 Причина: ${escapeHtml(order.auto_error_note)}`;

  const rows: any[] = [];
  if (order.auto_status === "pending") {
    rows.push([
      { text: "✅ Подтвердить выдачу", callback_data: `a:ao:ok:${orderId}` },
    ]);
    rows.push([
      { text: "❌ Ошибка / Возврат", callback_data: `a:ao:err:${orderId}` },
    ]);
  }
  rows.push([{ text: "👤 Профиль покупателя", callback_data: `a:u:v:${order.telegram_id}` }]);
  rows.push([{ text: "← К списку", callback_data: "a:ao" }]);

  return deleteAndSend(chatId, msgId, {
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

async function notifyBuyer(telegramId: number, text: string) {
  const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!botToken) return;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: telegramId, parse_mode: "HTML", text }),
    });
  } catch (e) { console.error("notifyBuyer:", e); }
}

export async function confirmAutoOrder(
  chatId: number, msgId: number | undefined, orderId: string, adminId: number,
) {
  const { data: order } = await supabase
    .from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order || !order.is_auto) return;
  if (order.auto_status === "delivered") {
    return showAutoOrder(chatId, msgId, orderId);
  }

  await supabase.from("orders").update({
    auto_status: "delivered",
    auto_delivered_at: new Date().toISOString(),
    auto_delivered_by: adminId,
    status: "completed",
    updated_at: new Date().toISOString(),
  }).eq("id", orderId);

  const { data: items } = await supabase
    .from("order_items").select("product_title, recipient_username").eq("order_id", orderId);
  const itemsText = (items ?? [])
    .map((i: any) => `✨ ${i.product_title}${i.recipient_username ? ` → @${i.recipient_username}` : ""}`)
    .join("\n");

  await notifyBuyer(
    order.telegram_id,
    `✅ <b>Ваш заказ выдан!</b>\n\n` +
      `Номер: <code>${order.order_number}</code>\n${itemsText}\n\n` +
      `Проверьте получение в Telegram. Спасибо за покупку!`,
  );

  await writeAuditLog(adminId, "auto_deliver", order.order_number, { orderId });
  return showAutoOrder(chatId, msgId, orderId);
}

export async function startAutoOrderError(
  chatId: number, msgId: number | undefined, orderId: string, adminId: number,
) {
  await setSession(adminId, `ao:err:${orderId}`, {});
  return deleteAndSend(chatId, msgId, {
    text: "💬 Укажите причину ошибки выдачи (одним сообщением).\nСумма заказа будет возвращена покупателю на баланс.",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: `a:ao:v:${orderId}` }]] },
  });
}

export async function applyAutoOrderError(
  chatId: number, adminId: number, orderId: string, reason: string,
) {
  await clearSession(adminId);
  const { data: order } = await supabase
    .from("orders").select("*").eq("id", orderId).maybeSingle();
  if (!order || !order.is_auto) return;
  if (order.auto_status !== "pending") {
    await tg("sendMessage", { chat_id: chatId, text: "Заказ уже обработан." });
    return showAutoOrder(chatId, undefined, orderId);
  }

  const refundAmount = Number(order.total_amount) || 0;
  let refunded = 0;
  if (refundAmount > 0) {
    const { data: nb } = await supabase.rpc("credit_balance", {
      p_telegram_id: order.telegram_id, p_amount: refundAmount,
    });
    refunded = refundAmount;
    await supabase.from("balance_history").insert({
      telegram_id: order.telegram_id,
      amount: refundAmount,
      type: "refund_auto",
      balance_after: Number(nb ?? 0),
      comment: `Возврат по авто-заказу ${order.order_number}: ${reason.slice(0, 200)}`,
      admin_telegram_id: adminId,
    });
  }

  await supabase.from("orders").update({
    auto_status: "error",
    auto_error_note: reason.slice(0, 500),
    auto_delivered_by: adminId,
    status: "cancelled",
    updated_at: new Date().toISOString(),
  }).eq("id", orderId);

  await notifyBuyer(
    order.telegram_id,
    `❌ <b>Не удалось выдать заказ</b>\n\n` +
      `Номер: <code>${order.order_number}</code>\n` +
      `Причина: ${reason.slice(0, 300)}\n\n` +
      (refunded > 0
        ? `💰 Сумма $${refunded.toFixed(2)} возвращена на ваш баланс.`
        : `Свяжитесь с поддержкой.`),
  );

  await writeAuditLog(adminId, "auto_error", order.order_number, { orderId, reason, refunded });
  await tg("sendMessage", {
    chat_id: chatId,
    text: `❌ Заказ ${order.order_number} помечен как ошибка. Возврат $${refunded.toFixed(2)} выполнен.`,
  });
  return showAutoOrder(chatId, undefined, orderId);
}
