// Statistics dashboard: orders / revenue / users / inventory snapshots.
import { deleteAndSend } from "../_shared/tg.ts";
import { supabase } from "../_shared/db.ts";

function backMenu() { return [{ text: "← Меню", callback_data: "a:menu" }]; }
function fmt(n: number) { return n.toLocaleString("ru-RU"); }
function money(n: number) { return `$${(n || 0).toFixed(2)}`; }

const RANGES: Record<string, { label: string; days: number | null }> = {
  d:  { label: "24 часа", days: 1 },
  w:  { label: "7 дней",  days: 7 },
  m:  { label: "30 дней", days: 30 },
  all:{ label: "Всё время", days: null },
};

export async function showStats(chatId: number, msgId: number | undefined, range = "w") {
  const r = RANGES[range] ?? RANGES.w;
  const since = r.days ? new Date(Date.now() - r.days * 86400_000).toISOString() : null;

  // --- orders ---
  let oq = supabase.from("orders").select("total_amount, payment_status, status, created_at", { count: "exact" });
  if (since) oq = oq.gte("created_at", since);
  const { data: orders, count: ordersCount } = await oq;

  const paid = (orders ?? []).filter((o) => o.payment_status === "paid");
  const revenue = paid.reduce((s, o) => s + Number(o.total_amount || 0), 0);
  const aov = paid.length ? revenue / paid.length : 0;

  const byStatus = new Map<string, number>();
  for (const o of orders ?? []) {
    byStatus.set(o.status, (byStatus.get(o.status) ?? 0) + 1);
  }
  const statusLine = Array.from(byStatus.entries())
    .map(([s, n]) => `<code>${s}</code>: ${n}`)
    .join(" · ") || "—";

  // --- users ---
  let uq = supabase.from("user_profiles").select("telegram_id, balance, is_blocked, created_at", { count: "exact" });
  const { data: users, count: usersTotal } = await uq;
  const newUsers = since ? (users ?? []).filter((u) => u.created_at >= since).length : (usersTotal ?? 0);
  const blocked = (users ?? []).filter((u) => u.is_blocked).length;
  const totalBalance = (users ?? []).reduce((s, u) => s + Number(u.balance || 0), 0);

  // --- inventory ---
  const { count: invAvail } = await supabase
    .from("inventory_items").select("id", { count: "exact", head: true }).eq("status", "available");
  const { count: invSold } = await supabase
    .from("inventory_items").select("id", { count: "exact", head: true }).eq("status", "sold");

  // --- products ---
  const { count: productsTotal } = await supabase
    .from("products").select("id", { count: "exact", head: true });
  const { count: productsActive } = await supabase
    .from("products").select("id", { count: "exact", head: true }).eq("is_active", true);

  // --- reviews pending ---
  const { count: reviewsPending } = await supabase
    .from("reviews").select("id", { count: "exact", head: true }).eq("moderation_status", "pending");

  const txt = [
    `📊 <b>Статистика — ${r.label}</b>`,
    ``,
    `🛒 <b>Заказы</b>`,
    `Всего: <b>${fmt(ordersCount ?? 0)}</b> · Оплачено: <b>${fmt(paid.length)}</b>`,
    `Выручка: <b>${money(revenue)}</b> · Средний чек: <b>${money(aov)}</b>`,
    `Статусы: ${statusLine}`,
    ``,
    `👥 <b>Пользователи</b>`,
    `Всего: <b>${fmt(usersTotal ?? 0)}</b> · Новых за период: <b>${fmt(newUsers)}</b>`,
    `Заблокировано: <b>${fmt(blocked)}</b> · Баланс на счетах: <b>${money(totalBalance)}</b>`,
    ``,
    `📦 <b>Каталог</b>`,
    `Товаров: <b>${fmt(productsTotal ?? 0)}</b> (активных: <b>${fmt(productsActive ?? 0)}</b>)`,
    `Склад: доступно <b>${fmt(invAvail ?? 0)}</b> · продано <b>${fmt(invSold ?? 0)}</b>`,
    ``,
    `⭐ Отзывов на модерации: <b>${fmt(reviewsPending ?? 0)}</b>`,
  ].join("\n");

  const filterRow = Object.entries(RANGES).map(([k, v]) => ({
    text: (range === k ? "• " : "") + v.label,
    callback_data: `a:st:r:${k}`,
  }));

  await deleteAndSend(chatId, msgId, {
    text: txt,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [filterRow, [{ text: "🔄 Обновить", callback_data: `a:st:r:${range}` }], backMenu()] },
  });
}
