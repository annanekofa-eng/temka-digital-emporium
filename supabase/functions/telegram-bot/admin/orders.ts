// Orders admin: list with filters, view card, status change, one-click /rep.
import { tg, deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog, getSetting } from "../_shared/db.ts";

const PAGE_SIZE = 8;

const STATUS_LABELS: Record<string, string> = {
  pending: "Создан",
  awaiting_payment: "Ожидает оплаты",
  paid: "Оплачен",
  processing: "В обработке",
  delivered: "Выдан",
  completed: "Завершён",
  cancelled: "Отменён",
  error: "Ошибка",
};
const STATUS_ORDER = [
  "pending", "awaiting_payment", "paid", "processing", "delivered", "completed", "cancelled", "error",
];
const PAY_LABELS: Record<string, string> = {
  unpaid: "Не оплачен",
  awaiting: "Ожидает",
  paid: "Оплачен",
  failed: "Ошибка",
  refunded: "Возврат",
  expired: "Истёк",
};
const PAY_ORDER = ["unpaid", "awaiting", "paid", "failed", "refunded", "expired"];

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function backRow() {
  return [{ text: "← Меню", callback_data: "a:menu" }];
}

export async function showOrderList(
  chatId: number,
  msgId: number | undefined,
  filter: string = "all",
  page = 0,
) {
  let q = supabase.from("orders").select("id, order_number, status, payment_status, total_amount, telegram_id, project_id, created_at", { count: "exact" });
  if (filter === "new") q = q.in("status", ["pending", "awaiting_payment", "paid"]);
  else if (filter === "active") q = q.in("status", ["paid", "processing"]);
  else if (filter === "done") q = q.in("status", ["delivered", "completed"]);
  else if (filter === "issues") q = q.in("status", ["error", "cancelled"]);
  q = q.order("created_at", { ascending: false }).range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

  const { data, count } = await q;
  const total = count ?? 0;

  const rows = (data ?? []).map((o) => [
    {
      text: safeSlice(
        `#${o.order_number} · ${Number(o.total_amount).toFixed(2)}$ · ${STATUS_LABELS[o.status] ?? o.status}`,
        60,
      ),
      callback_data: `a:o:v:${o.id}`,
    },
  ]);

  const filters = [
    { k: "all", t: "Все" }, { k: "new", t: "Новые" },
    { k: "active", t: "Активные" }, { k: "done", t: "Готовые" }, { k: "issues", t: "Проблемы" },
  ];
  rows.push(filters.map((f) => ({
    text: (filter === f.k ? "• " : "") + f.t,
    callback_data: `a:o:f:${f.k}`,
  })));

  const nav: any[] = [];
  if (page > 0) nav.push({ text: "‹", callback_data: `a:o:p:${filter}:${page - 1}` });
  nav.push({ text: `${page + 1}/${Math.max(1, Math.ceil(total / PAGE_SIZE))}`, callback_data: "a:o" });
  if ((page + 1) * PAGE_SIZE < total) nav.push({ text: "›", callback_data: `a:o:p:${filter}:${page + 1}` });
  if (nav.length) rows.push(nav);

  rows.push(backRow());

  await deleteAndSend(chatId, msgId, {
    text: `🛒 <b>Заказы</b> · ${filters.find(f => f.k === filter)?.t ?? "Все"} · ${total}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showOrder(chatId: number, msgId: number | undefined, id: string) {
  const { data: o } = await supabase.from("orders").select("*").eq("id", id).maybeSingle();
  if (!o) return showOrderList(chatId, msgId);
  const { data: items } = await supabase
    .from("order_items")
    .select("product_title, product_price, quantity, params")
    .eq("order_id", id);
  const { data: user } = await supabase
    .from("user_profiles")
    .select("first_name, username, balance")
    .eq("telegram_id", o.telegram_id)
    .maybeSingle();

  const itemLines = (items ?? []).map((i) =>
    `• ${escapeHtml(i.product_title)} ×${i.quantity} = ${(Number(i.product_price) * i.quantity).toFixed(2)}$`
  ).join("\n");

  const text = [
    `🛒 <b>Заказ #${o.order_number}</b>`,
    `Создан: ${new Date(o.created_at).toLocaleString("ru-RU")}`,
    `Проект: <code>${o.project_id ?? "-"}</code>`,
    "",
    `<b>Статус:</b> ${STATUS_LABELS[o.status] ?? o.status}`,
    `<b>Оплата:</b> ${PAY_LABELS[o.payment_status] ?? o.payment_status}`,
    `<b>Сумма:</b> ${Number(o.total_amount).toFixed(2)}$`,
    o.balance_used > 0 ? `Использован баланс: ${Number(o.balance_used).toFixed(2)}$` : "",
    o.promo_code ? `Промокод: <code>${o.promo_code}</code> (-${Number(o.discount_amount).toFixed(2)}$)` : "",
    "",
    `<b>Покупатель:</b> ${escapeHtml(user?.first_name ?? "—")}${user?.username ? ` @${user.username}` : ""}`,
    `Telegram ID: <code>${o.telegram_id}</code>`,
    user ? `Баланс: ${Number(user.balance).toFixed(2)}$` : "",
    "",
    "<b>Позиции:</b>",
    itemLines || "—",
    o.notes ? `\n📝 ${escapeHtml(o.notes)}` : "",
  ].filter(Boolean).join("\n");

  const kb = [
    [{ text: `📤 Отправить /rep`, callback_data: `a:o:rep:${id}` }],
    [{ text: "🔄 Сменить статус", callback_data: `a:o:ss:${id}` }, { text: "💳 Оплата", callback_data: `a:o:sp:${id}` }],
    [{ text: "👤 Покупатель", callback_data: `a:o:user:${id}` }],
    [{ text: "← К списку", callback_data: "a:o" }, ...backRow()],
  ];

  await deleteAndSend(chatId, msgId, { text, parse_mode: "HTML", reply_markup: { inline_keyboard: kb } });
}

export async function showStatusPicker(
  chatId: number, msgId: number | undefined, id: string, kind: "status" | "pay",
) {
  const list = kind === "status" ? STATUS_ORDER : PAY_ORDER;
  const labels = kind === "status" ? STATUS_LABELS : PAY_LABELS;
  const code = kind === "status" ? "st" : "pt";
  const rows = list.map((s) => [{ text: labels[s], callback_data: `a:o:${code}:${id}:${s}` }]);
  rows.push([{ text: "← Назад", callback_data: `a:o:v:${id}` }]);
  await deleteAndSend(chatId, msgId, {
    text: kind === "status" ? "Выберите новый <b>статус</b>:" : "Выберите новый <b>статус оплаты</b>:",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function setOrderStatus(
  chatId: number, msgId: number | undefined, id: string, value: string, adminId: number,
) {
  await supabase.from("orders").update({ status: value, updated_at: new Date().toISOString() }).eq("id", id);
  await writeAuditLog(adminId, "order.status", id, { status: value });
  return showOrder(chatId, msgId, id);
}

export async function setOrderPayment(
  chatId: number, msgId: number | undefined, id: string, value: string, adminId: number,
) {
  await supabase.from("orders").update({ payment_status: value, updated_at: new Date().toISOString() }).eq("id", id);
  await writeAuditLog(adminId, "order.payment_status", id, { payment_status: value });
  return showOrder(chatId, msgId, id);
}

// One-click /rep: render template, send to buyer, log result.
export async function sendOrderRep(
  chatId: number, msgId: number | undefined, id: string, adminId: number,
) {
  const { data: o } = await supabase
    .from("orders")
    .select("order_number, telegram_id")
    .eq("id", id)
    .maybeSingle();
  if (!o) return showOrderList(chatId, msgId);

  const { data: tpl } = await supabase
    .from("message_templates").select("body").eq("key", "rep_default").maybeSingle();
  const support = await getSetting("support_username", "support");
  const body = (tpl?.body ?? "✅ Ваш заказ {{order_number}} успешно обработан.")
    .replaceAll("{{order_number}}", `#${o.order_number}`)
    .replaceAll("{{support}}", support);

  const send = await tg("sendMessage", { chat_id: o.telegram_id, text: body });
  await writeAuditLog(adminId, "rep", String(o.order_number), { ok: !!send?.ok, via: "admin_panel" });

  await deleteAndSend(chatId, msgId, {
    text: send?.ok
      ? `✅ Сообщение по заказу #${o.order_number} отправлено покупателю.`
      : `⚠️ Не удалось отправить: ${escapeHtml(send?.description ?? "ошибка")}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "← К заказу", callback_data: `a:o:v:${id}` }]] },
  });
}
