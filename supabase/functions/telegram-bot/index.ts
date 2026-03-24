import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (d: unknown, s = 200) =>
  new Response(JSON.stringify(d), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

// ─── Telegram API ──────────────────────────────
const TG = (token: string) => {
  const call = (method: string, body: Record<string, unknown>) =>
    fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  return {
    send: (chatId: number, text: string, markup?: unknown) =>
      call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) }),
    edit: (chatId: number, msgId: number, text: string, markup?: unknown) =>
      call("editMessageText", { chat_id: chatId, message_id: msgId, text, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) }),
    answer: (cbId: string, text?: string) =>
      call("answerCallbackQuery", { callback_query_id: cbId, ...(text ? { text, show_alert: false } : {}) }),
    sendPhoto: (chatId: number, photo: string, caption: string, markup?: unknown) =>
      call("sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) }),
    getFile: (fileId: string) =>
      fetch(`https://api.telegram.org/bot${token}/getFile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
      }).then(r => r.json()),
    fileUrl: (path: string) => `https://api.telegram.org/file/bot${token}/${path}`,
  };
};

// ─── Supabase ──────────────────────────────────
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

// ─── Helpers ───────────────────────────────────
type Btn = { text: string; callback_data: string };
const btn = (t: string, cb: string): Btn => ({ text: t, callback_data: cb });
const ikb = (rows: Btn[][]) => ({ inline_keyboard: rows });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function paginate<T>(items: T[], page: number, perPage = 6) {
  const total = Math.max(1, Math.ceil(items.length / perPage));
  const p = Math.min(Math.max(0, page), total - 1);
  return { items: items.slice(p * perPage, (p + 1) * perPage), total, page: p };
}
function pgRow(prefix: string, page: number, total: number): Btn[] {
  const r: Btn[] = [];
  if (page > 0) r.push(btn("◀️", `${prefix}:${page - 1}`));
  r.push(btn(`${page + 1}/${total}`, "a:noop"));
  if (page < total - 1) r.push(btn("▶️", `${prefix}:${page + 1}`));
  return r;
}

// ─── Admin check ───────────────────────────────
async function isAdmin(tgId: number): Promise<string | null> {
  const ids = (Deno.env.get("ADMIN_TELEGRAM_IDS") || "").split(",").map(s => s.trim()).filter(Boolean);
  if (ids.includes(String(tgId))) return "owner";
  const { data } = await db().from("admin_users").select("role").eq("telegram_id", tgId).maybeSingle();
  return data?.role || null;
}

// ─── Logging ───────────────────────────────────
async function logA(adminId: number, action: string, eType?: string, eId?: string, details?: unknown) {
  await db().from("admin_logs").insert({
    admin_telegram_id: adminId, action, entity_type: eType || null, entity_id: eId || null, details: details || {},
  });
}

// ─── FSM Sessions ──────────────────────────────
async function getSession(tgId: number) {
  const { data } = await db().from("admin_sessions").select("*").eq("telegram_id", tgId).maybeSingle();
  return data as { telegram_id: number; state: string; data: Record<string, unknown> } | null;
}
async function setSession(tgId: number, state: string, data: Record<string, unknown> = {}) {
  await db().from("admin_sessions").upsert(
    { telegram_id: tgId, state, data, updated_at: new Date().toISOString() },
    { onConflict: "telegram_id" }
  );
}
async function clearSession(tgId: number) {
  await db().from("admin_sessions").delete().eq("telegram_id", tgId);
}

// ═══════════════════════════════════════════════
// MENU
// ═══════════════════════════════════════════════
const menuText = () => "🔐 <b>Админ-панель</b>\n\nВыберите раздел:";
const menuKb = () => ikb([
  [btn("📦 Товары", "a:pl:0"), btn("📁 Категории", "a:cl:0")],
  [btn("🛒 Заказы", "a:ol:0"), btn("👥 Пользователи", "a:ul:0")],
  [btn("📊 Статистика", "a:st"), btn("🎟 Промокоды", "a:prl:0")],
  [btn("🗃 Склад", "a:sk:0"), btn("📋 Логи", "a:lg:0")],
  [btn("⚙️ Настройки", "a:se"), btn("📢 Рассылка", "a:bc")],
  [btn("⭐ Отзывы", "a:rvl:0")],
]);

// ═══════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════
async function productsList(tg: ReturnType<typeof TG>, cid: number, mid: number, page: number) {
  const { data: products } = await db().from("products").select("id, title, price, stock, is_active, is_featured, is_popular").order("created_at", { ascending: false });
  if (!products?.length) {
    return tg.edit(cid, mid, "📦 <b>Товары</b>\n\nТоваров нет.", ikb([[btn("➕ Добавить", "a:pa")], [btn("◀️ Меню", "a:m")]]));
  }
  const pg = paginate(products, page, 8);
  let t = `📦 <b>Товары</b> (${products.length})\n\n`;
  pg.items.forEach(p => {
    const s = p.is_active ? "✅" : "❌";
    const badges = [p.is_featured ? "⭐" : "", p.is_popular ? "🔥" : ""].filter(Boolean).join("");
    t += `${s} <b>${esc(p.title)}</b> ${badges}\n💰 $${Number(p.price).toFixed(2)} | 📦 ${p.stock}\n\n`;
  });
  const rows: Btn[][] = pg.items.map(p => [btn(`${p.is_active ? "✅" : "❌"} ${p.title.slice(0, 28)}`, `a:pv:${p.id}`)]);
  if (pg.total > 1) rows.push(pgRow("a:pl", pg.page, pg.total));
  rows.push([btn("➕ Добавить", "a:pa"), btn("◀️ Меню", "a:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function productView(tg: ReturnType<typeof TG>, cid: number, mid: number, pid: string) {
  const { data: p } = await db().from("products").select("*").eq("id", pid).single();
  if (!p) return tg.edit(cid, mid, "❌ Товар не найден", ikb([[btn("◀️ Назад", "a:pl:0")]]));
  const { count: invCount } = await db().from("inventory_items").select("id", { count: "exact", head: true }).eq("product_id", pid).eq("status", "available");
  const badges = [p.is_featured ? "⭐" : "", p.is_popular ? "🔥" : "", p.is_new ? "🆕" : ""].filter(Boolean).join(" ");
  let t = `📦 <b>${esc(p.title)}</b> ${badges}\n\n`;
  t += `📝 ${esc(p.subtitle || "—")}\n`;
  t += `💰 <b>$${Number(p.price).toFixed(2)}</b>`;
  if (p.old_price) t += ` <s>$${Number(p.old_price).toFixed(2)}</s>`;
  t += `\n📦 Остаток: <b>${p.stock}</b> | Единиц: <b>${invCount || 0}</b>\n`;
  t += `📁 ${p.category_id || "—"} | 🚚 ${p.delivery_type} | 🌍 ${p.region}\n`;
  t += `${p.is_active ? "✅ Активен" : "❌ Скрыт"}\n`;
  if (p.tags?.length) t += `🏷 ${p.tags.join(", ")}\n`;
  if (p.image) t += `🖼 Фото: есть\n`;
  return tg.edit(cid, mid, t, ikb([
    [btn("✏️ Название", `a:pe:${pid}:t`), btn("✏️ Цена", `a:pe:${pid}:p`)],
    [btn("✏️ Остаток", `a:pe:${pid}:s`), btn("✏️ Описание", `a:pe:${pid}:d`)],
    [btn("✏️ Стар.цена", `a:pe:${pid}:o`), btn("✏️ Теги", `a:pe:${pid}:g`)],
    [btn("📁 Категория", `a:pc:${pid}`), btn("🖼 Фото", `a:pe:${pid}:img`)],
    [btn(p.is_active ? "❌ Скрыть" : "✅ Показать", `a:pt:${pid}`)],
    [btn(p.is_featured ? "⭐ Убрать" : "⭐ Featured", `a:pf:${pid}`), btn(p.is_popular ? "🔥 Убрать" : "🔥 Популярное", `a:px:${pid}`)],
    [btn(p.is_new ? "🆕 Убрать" : "🆕 Новинка", `a:pn:${pid}`)],
    [btn("🗃 Склад", `a:iv:${pid}:0`), btn("🗑 Удалить", `a:pd:${pid}`)],
    [btn("◀️ К товарам", "a:pl:0")],
  ]));
}

async function productToggle(tg: ReturnType<typeof TG>, cid: number, mid: number, pid: string, field: string, adminId: number) {
  const { data: p } = await db().from("products").select(field).eq("id", pid).single();
  if (!p) return;
  await db().from("products").update({ [field]: !p[field], updated_at: new Date().toISOString() }).eq("id", pid);
  await logA(adminId, `toggle_${field}`, "product", pid, { [field]: !p[field] });
  return productView(tg, cid, mid, pid);
}

async function productDeleteConfirm(tg: ReturnType<typeof TG>, cid: number, mid: number, pid: string, adminId: number) {
  const { data: p } = await db().from("products").select("title").eq("id", pid).single();
  await db().from("reviews").delete().eq("product_id", pid);
  const { error } = await db().from("products").delete().eq("id", pid);
  if (error) return tg.edit(cid, mid, `❌ Ошибка: ${error.message}\n\nВозможно, есть связанные заказы.`, ikb([[btn("◀️ Назад", `a:pv:${pid}`)]]));
  await logA(adminId, "delete_product", "product", pid, { title: p?.title });
  return tg.edit(cid, mid, `✅ Товар <b>${esc(p?.title || "")}</b> удалён.`, ikb([[btn("◀️ К товарам", "a:pl:0")]]));
}

// ═══════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════
async function categoriesList(tg: ReturnType<typeof TG>, cid: number, mid: number, _page: number) {
  const { data: cats } = await db().from("categories").select("*").order("sort_order");
  const { data: products } = await db().from("products").select("category_id").eq("is_active", true);
  const counts: Record<string, number> = {};
  products?.forEach(p => { if (p.category_id) counts[p.category_id] = (counts[p.category_id] || 0) + 1; });
  if (!cats?.length) return tg.edit(cid, mid, "📁 <b>Категории</b>\n\nНет.", ikb([[btn("➕ Добавить", "a:ca")], [btn("◀️ Меню", "a:m")]]));
  let t = `📁 <b>Категории</b> (${cats.length})\n\n`;
  cats.forEach(c => { t += `${c.icon} <b>${esc(c.name)}</b> — ${counts[c.id] || 0} товаров ${c.is_active ? "" : "❌"}\n`; });
  const rows: Btn[][] = cats.map(c => [btn(`${c.icon} ${c.name}`, `a:cv:${c.id}`)]);
  rows.push([btn("➕ Добавить", "a:ca"), btn("◀️ Меню", "a:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function categoryView(tg: ReturnType<typeof TG>, cid: number, mid: number, catId: string) {
  const { data: c } = await db().from("categories").select("*").eq("id", catId).single();
  if (!c) return tg.edit(cid, mid, "Не найдена", ikb([[btn("◀️ Назад", "a:cl:0")]]));
  const { count } = await db().from("products").select("id", { count: "exact", head: true }).eq("category_id", catId);
  let t = `📁 <b>${c.icon} ${esc(c.name)}</b>\n\n🆔 ${c.id}\n📊 Сортировка: ${c.sort_order}\n📦 Товаров: ${count || 0}\n${c.is_active ? "✅ Активна" : "❌ Скрыта"}\n`;
  return tg.edit(cid, mid, t, ikb([
    [btn("✏️ Название", `a:ce:${catId}:n`), btn("✏️ Иконка", `a:ce:${catId}:i`)],
    [btn("✏️ Описание", `a:ce:${catId}:d`), btn("✏️ Сортировка", `a:ce:${catId}:s`)],
    [btn(c.is_active ? "❌ Скрыть" : "✅ Показать", `a:ct:${catId}`)],
    [btn("🗑 Удалить", `a:cd:${catId}`)],
    [btn("◀️ К категориям", "a:cl:0")],
  ]));
}

// ═══════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════
async function ordersList(tg: ReturnType<typeof TG>, cid: number, mid: number, page: number) {
  const { data: orders } = await db().from("orders").select("*").order("created_at", { ascending: false }).limit(100);
  if (!orders?.length) return tg.edit(cid, mid, "🛒 <b>Заказы</b>\n\nНет.", ikb([[btn("◀️ Меню", "a:m")]]));
  const se: Record<string, string> = { pending: "⏳", awaiting_payment: "💳", paid: "✅", processing: "⚙️", delivered: "📬", completed: "✅", cancelled: "❌", error: "⚠️" };
  const pg = paginate(orders, page, 6);
  let t = `🛒 <b>Заказы</b> (${orders.length})\n\n`;
  pg.items.forEach(o => {
    t += `${se[o.status] || "❓"} <b>${esc(o.order_number)}</b> — $${Number(o.total_amount).toFixed(2)}\n👤 ${o.telegram_id} | 📅 ${new Date(o.created_at).toLocaleDateString("ru-RU")}\n\n`;
  });
  const rows: Btn[][] = pg.items.map(o => [btn(`${se[o.status] || "❓"} ${o.order_number}`, `a:ov:${o.id}`)]);
  if (pg.total > 1) rows.push(pgRow("a:ol", pg.page, pg.total));
  rows.push([btn("◀️ Меню", "a:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function orderView(tg: ReturnType<typeof TG>, cid: number, mid: number, oid: string) {
  const { data: o } = await db().from("orders").select("*").eq("id", oid).single();
  if (!o) return tg.edit(cid, mid, "Не найден", ikb([[btn("◀️ Назад", "a:ol:0")]]));
  const { data: items } = await db().from("order_items").select("*").eq("order_id", oid);
  const { data: user } = await db().from("user_profiles").select("*").eq("telegram_id", o.telegram_id).maybeSingle();
  let t = `🛒 <b>Заказ ${esc(o.order_number)}</b>\n\n`;
  t += `👤 ${user ? esc(user.first_name + (user.last_name ? " " + user.last_name : "")) : o.telegram_id}`;
  if (user?.username) t += ` @${esc(user.username)}`;
  t += `\n🆔 TG: ${o.telegram_id}\n\n📦 <b>Состав:</b>\n`;
  items?.forEach(i => { t += `  • ${esc(i.product_title)} ×${i.quantity} — $${Number(i.product_price * i.quantity).toFixed(2)}\n`; });
  t += `\n💰 <b>$${Number(o.total_amount).toFixed(2)}</b> ${o.currency}\n📋 Статус: <b>${o.status}</b>\n💳 Оплата: <b>${o.payment_status}</b>\n`;
  if (o.invoice_id) t += `🧾 Invoice: ${o.invoice_id}\n`;
  if (o.notes) t += `📝 ${esc(o.notes)}\n`;
  t += `📅 ${new Date(o.created_at).toLocaleString("ru-RU")}\n`;
  const statuses = ["paid", "processing", "delivered", "completed", "cancelled"].filter(s => s !== o.status);
  const sBtns: Btn[][] = [];
  for (let i = 0; i < statuses.length; i += 3) sBtns.push(statuses.slice(i, i + 3).map(s => btn(s, `a:os:${oid}:${s}`)));
  sBtns.push([btn("👤 Пользователь", `a:uvt:${o.telegram_id}`)]);
  return tg.edit(cid, mid, t, ikb([...sBtns, [btn("◀️ К заказам", "a:ol:0")]]));
}

async function orderSetStatus(tg: ReturnType<typeof TG>, cid: number, mid: number, oid: string, status: string, adminId: number) {
  const pm: Record<string, string> = { paid: "paid", processing: "paid", delivered: "paid", completed: "paid", cancelled: "failed" };
  await db().from("orders").update({ status, payment_status: pm[status] || "unpaid", updated_at: new Date().toISOString() }).eq("id", oid);
  await logA(adminId, `order_${status}`, "order", oid);
  return orderView(tg, cid, mid, oid);
}

// ═══════════════════════════════════════════════
// USERS
// ═══════════════════════════════════════════════
async function usersList(tg: ReturnType<typeof TG>, cid: number, mid: number, page: number, filter?: string) {
  let query = db().from("user_profiles").select("*").order("created_at", { ascending: false });
  if (filter === "vip") query = query.eq("role", "vip");
  else if (filter === "blocked") query = query.eq("is_blocked", true);
  const { data: users } = await query;
  if (!users?.length) return tg.edit(cid, mid, "👥 <b>Пользователи</b>\n\nНет.", ikb([[btn("◀️ Меню", "a:m")]]));
  const pg = paginate(users, page, 8);
  let t = `👥 <b>Пользователи</b> (${users.length})${filter ? ` [${filter}]` : ""}\n\n`;
  pg.items.forEach(u => {
    const flags = [u.is_premium ? "⭐" : "", u.role === "vip" ? "👑" : "", u.is_blocked ? "🚫" : ""].filter(Boolean).join("");
    t += `👤 <b>${esc(u.first_name)}${u.last_name ? " " + esc(u.last_name) : ""}</b> ${flags}`;
    if (u.username) t += ` @${esc(u.username)}`;
    t += ` | ${u.telegram_id}\n`;
  });
  const pfx = filter ? `a:ulf:${filter}` : "a:ul";
  const rows: Btn[][] = pg.items.map(u => [btn(`${u.is_blocked ? "🚫 " : ""}${u.first_name} ${u.last_name || ""}`.trim().slice(0, 28), `a:uv:${u.id}`)]);
  if (pg.total > 1) rows.push(pgRow(pfx, pg.page, pg.total));
  rows.push([btn("🔍 Поиск", "a:usq"), btn("📊 Фильтр", "a:usf")]);
  rows.push([btn("◀️ Меню", "a:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function userView(tg: ReturnType<typeof TG>, cid: number, mid: number, uid: string) {
  const { data: u } = await db().from("user_profiles").select("*").eq("id", uid).single();
  if (!u) return tg.edit(cid, mid, "Не найден", ikb([[btn("◀️ Назад", "a:ul:0")]]));
  const { data: orders } = await db().from("orders").select("id, total_amount, status").eq("telegram_id", u.telegram_id);
  const paid = orders?.filter(o => ["paid", "completed", "delivered", "processing"].includes(o.status)) || [];
  const spent = paid.reduce((s, o) => s + Number(o.total_amount), 0);
  let t = `👤 <b>${esc(u.first_name)}${u.last_name ? " " + esc(u.last_name) : ""}</b>\n\n`;
  if (u.username) t += `📱 @${esc(u.username)}\n`;
  t += `🆔 TG: ${u.telegram_id}\n`;
  t += `🏷 Роль: <b>${u.role || "user"}</b>\n`;
  t += `${u.is_blocked ? "🚫 Заблокирован\n" : ""}`;
  t += `${u.is_premium ? "⭐ Premium\n" : ""}`;
  t += `💰 Баланс: <b>$${Number(u.balance || 0).toFixed(2)}</b>\n`;
  t += `📅 ${new Date(u.created_at).toLocaleDateString("ru-RU")}\n\n`;
  t += `🛒 Заказов: ${orders?.length || 0}\n💵 Потрачено: $${spent.toFixed(2)}\n`;
  if (u.internal_note) t += `\n📝 <i>${esc(u.internal_note)}</i>\n`;
  return tg.edit(cid, mid, t, ikb([
    [btn("📢 Написать", `a:um:${u.telegram_id}`), btn("🛒 Заказы", `a:uo:${u.telegram_id}:0`)],
    [btn("💰 Баланс", `a:ub:${u.telegram_id}`), btn("🏷 Роль", `a:ur:${u.telegram_id}`)],
    [btn(u.is_blocked ? "✅ Разблокировать" : "🚫 Заблокировать", `a:ux:${u.telegram_id}`)],
    [btn("📝 Заметка", `a:un:${u.telegram_id}`), btn("📋 Логи", `a:ula:${u.telegram_id}:0`)],
    [btn("◀️ К пользователям", "a:ul:0")],
  ]));
}

async function userViewByTg(tg: ReturnType<typeof TG>, cid: number, mid: number, tgId: number) {
  const { data: u } = await db().from("user_profiles").select("id").eq("telegram_id", tgId).maybeSingle();
  if (!u) return tg.edit(cid, mid, "Пользователь не найден", ikb([[btn("◀️ Назад", "a:ul:0")]]));
  return userView(tg, cid, mid, u.id);
}

// User orders
async function userOrdersList(tg: ReturnType<typeof TG>, cid: number, mid: number, tgId: number, page: number) {
  const { data: orders } = await db().from("orders").select("*").eq("telegram_id", tgId).order("created_at", { ascending: false });
  if (!orders?.length) return tg.edit(cid, mid, `🛒 <b>Заказы пользователя ${tgId}</b>\n\nНет.`, ikb([[btn("◀️ Назад", `a:uvt:${tgId}`)]]));
  const se: Record<string, string> = { pending: "⏳", paid: "✅", processing: "⚙️", delivered: "📬", completed: "✅", cancelled: "❌" };
  const pg = paginate(orders, page, 6);
  let t = `🛒 <b>Заказы</b> (${orders.length}) — TG ${tgId}\n\n`;
  pg.items.forEach(o => { t += `${se[o.status] || "❓"} ${esc(o.order_number)} — $${Number(o.total_amount).toFixed(2)}\n`; });
  const rows: Btn[][] = pg.items.map(o => [btn(`${se[o.status] || "❓"} ${o.order_number}`, `a:ov:${o.id}`)]);
  if (pg.total > 1) rows.push(pgRow(`a:uo:${tgId}`, pg.page, pg.total));
  rows.push([btn("◀️ К пользователю", `a:uvt:${tgId}`)]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// Balance menu
async function balanceMenu(tg: ReturnType<typeof TG>, cid: number, mid: number, tgId: number) {
  const { data: u } = await db().from("user_profiles").select("balance").eq("telegram_id", tgId).maybeSingle();
  const { data: history } = await db().from("balance_history").select("*").eq("telegram_id", tgId).order("created_at", { ascending: false }).limit(5);
  let t = `💰 <b>Баланс</b> — TG ${tgId}\n\nТекущий: <b>$${Number(u?.balance || 0).toFixed(2)}</b>\n`;
  if (history?.length) {
    t += `\n📜 <b>Последние операции:</b>\n`;
    history.forEach(h => {
      const sign = Number(h.amount) >= 0 ? "+" : "";
      t += `${sign}$${Number(h.amount).toFixed(2)} → $${Number(h.balance_after).toFixed(2)} | ${h.type}\n`;
      if (h.comment) t += `  <i>${esc(h.comment)}</i>\n`;
    });
  }
  return tg.edit(cid, mid, t, ikb([
    [btn("➕ Начислить", `a:ubc:${tgId}`), btn("➖ Списать", `a:ubd:${tgId}`)],
    [btn("🎯 Установить", `a:ubs:${tgId}`)],
    [btn("◀️ К пользователю", `a:uvt:${tgId}`)],
  ]));
}

// User logs
async function userLogsList(tg: ReturnType<typeof TG>, cid: number, mid: number, tgId: number, page: number) {
  const { data: logs } = await db().from("admin_logs").select("*").eq("entity_id", String(tgId)).order("created_at", { ascending: false }).limit(30);
  if (!logs?.length) return tg.edit(cid, mid, `📋 <b>Логи</b> — TG ${tgId}\n\nПусто.`, ikb([[btn("◀️ Назад", `a:uvt:${tgId}`)]]));
  const pg = paginate(logs, page, 6);
  let t = `📋 <b>Логи</b> — TG ${tgId}\n\n`;
  pg.items.forEach(l => { t += `${new Date(l.created_at).toLocaleString("ru-RU")} | <b>${esc(l.action)}</b>\n`; });
  const rows: Btn[][] = [];
  if (pg.total > 1) rows.push(pgRow(`a:ula:${tgId}`, pg.page, pg.total));
  rows.push([btn("◀️ К пользователю", `a:uvt:${tgId}`)]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// ═══════════════════════════════════════════════
// PROMOCODES
// ═══════════════════════════════════════════════
async function promosList(tg: ReturnType<typeof TG>, cid: number, mid: number, page: number) {
  const { data: promos } = await db().from("promocodes").select("*").order("created_at", { ascending: false });
  if (!promos?.length) return tg.edit(cid, mid, "🎟 <b>Промокоды</b>\n\nНет.", ikb([[btn("➕ Создать", "a:pra")], [btn("◀️ Меню", "a:m")]]));
  const pg = paginate(promos, page, 6);
  let t = `🎟 <b>Промокоды</b> (${promos.length})\n\n`;
  pg.items.forEach(p => {
    const st = p.is_active ? "✅" : "❌";
    const disc = p.discount_type === "percent" ? `${p.discount_value}%` : `$${Number(p.discount_value).toFixed(2)}`;
    t += `${st} <code>${esc(p.code)}</code> — ${disc} | ${p.used_count}/${p.max_uses ?? "∞"}\n`;
  });
  const rows: Btn[][] = pg.items.map(p => [btn(`${p.is_active ? "✅" : "❌"} ${p.code}`, `a:prv:${p.id}`)]);
  if (pg.total > 1) rows.push(pgRow("a:prl", pg.page, pg.total));
  rows.push([btn("➕ Создать", "a:pra"), btn("◀️ Меню", "a:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function promoView(tg: ReturnType<typeof TG>, cid: number, mid: number, prId: string) {
  const { data: p } = await db().from("promocodes").select("*").eq("id", prId).single();
  if (!p) return tg.edit(cid, mid, "Не найден", ikb([[btn("◀️ Назад", "a:prl:0")]]));
  const disc = p.discount_type === "percent" ? `${p.discount_value}%` : `$${Number(p.discount_value).toFixed(2)}`;
  let t = `🎟 <b>${esc(p.code)}</b>\n\n`;
  t += `💰 Скидка: <b>${disc}</b> (${p.discount_type})\n`;
  t += `📊 Использовано: ${p.used_count}/${p.max_uses ?? "∞"}\n`;
  t += `${p.is_active ? "✅ Активен" : "❌ Неактивен"}\n`;
  if (p.valid_from) t += `📅 С: ${new Date(p.valid_from).toLocaleDateString("ru-RU")}\n`;
  if (p.valid_until) t += `📅 До: ${new Date(p.valid_until).toLocaleDateString("ru-RU")}\n`;
  return tg.edit(cid, mid, t, ikb([
    [btn(p.is_active ? "❌ Деактивировать" : "✅ Активировать", `a:prt:${prId}`)],
    [btn("🗑 Удалить", `a:prd:${prId}`)],
    [btn("◀️ К промокодам", "a:prl:0")],
  ]));
}

// ═══════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════
async function statsView(tg: ReturnType<typeof TG>, cid: number, mid: number) {
  const d = db();
  const [{ count: uc }, { count: pc }, { count: ap }, { data: orders }, { count: inv }] = await Promise.all([
    d.from("user_profiles").select("id", { count: "exact", head: true }),
    d.from("products").select("id", { count: "exact", head: true }),
    d.from("products").select("id", { count: "exact", head: true }).eq("is_active", true),
    d.from("orders").select("id, total_amount, status"),
    d.from("inventory_items").select("id", { count: "exact", head: true }).eq("status", "available"),
  ]);
  const paid = orders?.filter(o => ["paid", "completed", "delivered", "processing"].includes(o.status)) || [];
  const rev = paid.reduce((s, o) => s + Number(o.total_amount), 0);
  const avg = paid.length ? rev / paid.length : 0;
  const problems = orders?.filter(o => ["error", "cancelled"].includes(o.status)).length || 0;
  let t = `📊 <b>Статистика</b>\n\n👥 Пользователей: <b>${uc || 0}</b>\n📦 Товаров: <b>${ap || 0}</b>/${pc || 0}\n🗃 На складе: <b>${inv || 0}</b>\n\n`;
  t += `🛒 Заказов: <b>${orders?.length || 0}</b>\n✅ Оплаченных: <b>${paid.length}</b>\n⚠️ Проблемных: <b>${problems}</b>\n\n`;
  t += `💰 Выручка: <b>$${rev.toFixed(2)}</b>\n📈 Средний чек: <b>$${avg.toFixed(2)}</b>\n`;
  return tg.edit(cid, mid, t, ikb([[btn("🔄 Обновить", "a:st"), btn("◀️ Меню", "a:m")]]));
}

// ═══════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════
async function settingsList(tg: ReturnType<typeof TG>, cid: number, mid: number) {
  const { data: settings } = await db().from("shop_settings").select("*").order("key");
  let t = `⚙️ <b>Настройки</b>\n\n`;
  settings?.forEach(s => { t += `<b>${esc(s.key)}</b>: ${esc(s.value)}\n`; });
  const rows: Btn[][] = (settings || []).map(s => [btn(`✏️ ${s.key}`, `a:sv:${s.key}`)]);
  rows.push([btn("➕ Добавить", "a:sa"), btn("◀️ Меню", "a:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// ═══════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════
async function logsList(tg: ReturnType<typeof TG>, cid: number, mid: number, page: number) {
  const { data: logs } = await db().from("admin_logs").select("*").order("created_at", { ascending: false }).limit(50);
  if (!logs?.length) return tg.edit(cid, mid, "📋 <b>Логи</b>\n\nПусто.", ikb([[btn("◀️ Меню", "a:m")]]));
  const pg = paginate(logs, page, 8);
  let t = `📋 <b>Логи</b> (${logs.length})\n\n`;
  pg.items.forEach(l => {
    t += `${new Date(l.created_at).toLocaleString("ru-RU")}\n👤 ${l.admin_telegram_id} | <b>${esc(l.action)}</b>${l.entity_type ? ` | ${l.entity_type}` : ""}\n\n`;
  });
  const rows: Btn[][] = [];
  if (pg.total > 1) rows.push(pgRow("a:lg", pg.page, pg.total));
  rows.push([btn("◀️ Меню", "a:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// ═══════════════════════════════════════════════
// STOCK OVERVIEW
// ═══════════════════════════════════════════════
async function stockOverview(tg: ReturnType<typeof TG>, cid: number, mid: number, page: number) {
  const { data: products } = await db().from("products").select("id, title, stock, is_active").order("stock", { ascending: true });
  if (!products?.length) return tg.edit(cid, mid, "🗃 <b>Склад</b>\n\nНет товаров.", ikb([[btn("◀️ Меню", "a:m")]]));
  const oos = products.filter(p => p.stock <= 0).length;
  const low = products.filter(p => p.stock > 0 && p.stock <= 5).length;
  const pg = paginate(products, page, 8);
  let t = `🗃 <b>Склад</b>\n\n❌ Нет в наличии: <b>${oos}</b>\n⚠️ Мало: <b>${low}</b>\n\n`;
  pg.items.forEach(p => {
    const ic = p.stock <= 0 ? "❌" : p.stock <= 5 ? "⚠️" : "✅";
    t += `${ic} ${esc(p.title)} — <b>${p.stock}</b>\n`;
  });
  const rows: Btn[][] = pg.items.map(p => [btn(`${p.stock <= 0 ? "❌" : p.stock <= 5 ? "⚠️" : "✅"} ${p.title.slice(0, 25)}`, `a:iv:${p.id}:0`)]);
  if (pg.total > 1) rows.push(pgRow("a:sk", pg.page, pg.total));
  rows.push([btn("◀️ Меню", "a:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// ═══════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════
async function inventoryView(tg: ReturnType<typeof TG>, cid: number, mid: number, pid: string, page: number) {
  const { data: p } = await db().from("products").select("title, stock").eq("id", pid).single();
  const { data: items } = await db().from("inventory_items").select("*").eq("product_id", pid).order("created_at", { ascending: false });
  const avail = items?.filter(i => i.status === "available").length || 0;
  const sold = items?.filter(i => i.status === "sold").length || 0;
  let t = `🗃 <b>${esc(p?.title || "?")}</b>\n\n📦 Остаток: ${p?.stock || 0}\n✅ Доступно: ${avail}\n📤 Продано: ${sold}\n\n`;
  if (items?.length) {
    const pg = paginate(items, page, 5);
    pg.items.forEach(i => {
      const st = i.status === "available" ? "✅" : i.status === "sold" ? "📤" : "❓";
      t += `${st} <code>${esc(i.content.slice(0, 30))}${i.content.length > 30 ? "…" : ""}</code>\n`;
    });
    const rows: Btn[][] = [];
    if (pg.total > 1) rows.push(pgRow(`a:iv:${pid}`, pg.page, pg.total));
    rows.push([btn("➕ Добавить", `a:ia:${pid}`), btn("🔄 Синхр.", `a:is:${pid}`)]);
    rows.push([btn("◀️ К товару", `a:pv:${pid}`)]);
    return tg.edit(cid, mid, t, ikb(rows));
  }
  return tg.edit(cid, mid, t, ikb([[btn("➕ Добавить", `a:ia:${pid}`)], [btn("◀️ К товару", `a:pv:${pid}`)]]));
}

async function inventorySync(tg: ReturnType<typeof TG>, cid: number, mid: number, pid: string, adminId: number) {
  const { count } = await db().from("inventory_items").select("id", { count: "exact", head: true }).eq("product_id", pid).eq("status", "available");
  await db().from("products").update({ stock: count || 0, updated_at: new Date().toISOString() }).eq("id", pid);
  await logA(adminId, "sync_inventory", "product", pid, { stock: count });
  return inventoryView(tg, cid, mid, pid, 0);
}

// ═══════════════════════════════════════════════
// BROADCAST
// ═══════════════════════════════════════════════
async function broadcastMenu(tg: ReturnType<typeof TG>, cid: number, mid: number) {
  const { count } = await db().from("user_profiles").select("id", { count: "exact", head: true });
  return tg.edit(cid, mid, `📢 <b>Рассылка</b>\n\n👥 Получателей: <b>${count || 0}</b>\n\nОтправьте текст (HTML) или фото с подписью.\nПеред отправкой будет показан предпросмотр.`,
    ikb([[btn("✍️ Написать", "a:bs")], [btn("◀️ Меню", "a:m")]]));
}

// ═══════════════════════════════════════════════
// REVIEWS MODERATION
// ═══════════════════════════════════════════════
async function reviewsList(tg: ReturnType<typeof TG>, cid: number, mid: number, page: number, filter?: string) {
  let query = db().from("reviews").select("*").order("created_at", { ascending: false });
  if (filter === "approved") query = query.eq("moderation_status", "approved");
  else if (filter === "rejected") query = query.eq("moderation_status", "rejected");
  else if (!filter || filter === "pending") query = query.eq("moderation_status", "pending");
  else query = query; // "all"
  const { data: reviews } = await query;
  const statusLabel = filter === "approved" ? "одобренные" : filter === "rejected" ? "отклонённые" : filter === "all" ? "все" : "на модерации";
  if (!reviews?.length) return tg.edit(cid, mid, `⭐ <b>Отзывы (${statusLabel})</b>\n\nНет отзывов.`, ikb([
    [btn("⏳ Ожидающие", "a:rvl:0"), btn("✅ Одобренные", "a:rvf:approved:0")],
    [btn("❌ Отклонённые", "a:rvf:rejected:0"), btn("📋 Все", "a:rvf:all:0")],
    [btn("◀️ Меню", "a:m")],
  ]));
  const pg = paginate(reviews, page, 5);
  const se: Record<string, string> = { pending: "⏳", approved: "✅", rejected: "❌" };
  let t = `⭐ <b>Отзывы (${statusLabel})</b> — ${reviews.length}\n\n`;
  pg.items.forEach(r => {
    t += `${se[r.moderation_status] || "❓"} <b>${esc(r.author)}</b> | ${"⭐".repeat(r.rating)}\n${esc(r.text.slice(0, 80))}\n\n`;
  });
  const rows: Btn[][] = pg.items.map(r => [
    ...(r.moderation_status === "pending" ? [btn("✅", `a:rva:${r.id}`), btn("❌", `a:rvr:${r.id}`)] : []),
    btn(`${se[r.moderation_status] || ""} ${r.author.slice(0, 18)}`, `a:rvv:${r.id}`)
  ]);
  const pfx = filter && filter !== "pending" ? `a:rvf:${filter}` : "a:rvl";
  if (pg.total > 1) rows.push(pgRow(pfx, pg.page, pg.total));
  rows.push([btn("⏳ Ожидающие", "a:rvl:0"), btn("✅ Одобренные", "a:rvf:approved:0")]);
  rows.push([btn("❌ Отклонённые", "a:rvf:rejected:0"), btn("📋 Все", "a:rvf:all:0")]);
  rows.push([btn("◀️ Меню", "a:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// ═══════════════════════════════════════════════
// FSM HANDLER
// ═══════════════════════════════════════════════
async function handleFSM(tg: ReturnType<typeof TG>, cid: number, text: string, photo: any[] | null, session: { state: string; data: Record<string, unknown> }, adminId: number) {
  const { state, data: sData } = session;
  const d = db();

  // Edit product field
  if (state.startsWith("ep:")) {
    const parts = state.split(":");
    const field = parts[1];
    const pid = parts.slice(2).join(":");

    // Photo upload for product image
    if (field === "img") {
      if (!photo?.length) { await tg.send(cid, "❌ Отправьте фото."); return; }
      const fileId = photo[photo.length - 1].file_id;
      const fileData = await tg.getFile(fileId);
      if (!fileData.ok) { await tg.send(cid, "❌ Не удалось получить файл."); await clearSession(adminId); return; }
      const filePath = fileData.result.file_path;
      const fileUrl = tg.fileUrl(filePath);
      const fileResp = await fetch(fileUrl);
      const fileBlob = await fileResp.blob();
      const ext = filePath.split(".").pop() || "jpg";
      const storagePath = `${pid}.${ext}`;
      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const { error: uploadErr } = await d.storage.from("product-images").upload(storagePath, fileBlob, { upsert: true, contentType: `image/${ext}` });
      if (uploadErr) { await tg.send(cid, `❌ Ошибка загрузки: ${uploadErr.message}`); await clearSession(adminId); return; }
      const imageUrl = `${supabaseUrl}/storage/v1/object/public/product-images/${storagePath}`;
      await d.from("products").update({ image: imageUrl, updated_at: new Date().toISOString() }).eq("id", pid);
      await logA(adminId, "upload_image", "product", pid);
      await clearSession(adminId);
      return await tg.send(cid, `✅ Фото загружено!`, ikb([[btn("📦 Открыть товар", `a:pv:${pid}`)], [btn("◀️ Меню", "a:m")]]));
    }

    const fm: Record<string, string> = { t: "title", p: "price", s: "stock", d: "description", o: "old_price", g: "tags" };
    const dbF = fm[field];
    if (!dbF || !pid) { await clearSession(adminId); return; }
    let val: unknown = text;
    if (["price", "old_price"].includes(dbF)) { val = parseFloat(text); if (isNaN(val as number)) { await tg.send(cid, "❌ Введите число."); return; } }
    if (dbF === "stock") { val = parseInt(text); if (isNaN(val as number)) { await tg.send(cid, "❌ Введите целое число."); return; } }
    if (dbF === "tags") { val = text.split(",").map(s => s.trim()).filter(Boolean); }
    await d.from("products").update({ [dbF]: val, updated_at: new Date().toISOString() }).eq("id", pid);
    await logA(adminId, `edit_${dbF}`, "product", pid, { [dbF]: val });
    await clearSession(adminId);
    return await tg.send(cid, `✅ <b>${dbF}</b> обновлено!`, ikb([[btn("📦 Открыть товар", `a:pv:${pid}`)], [btn("◀️ Меню", "a:m")]]));
  }

  // Add product
  if (state === "ap:t") {
    await setSession(adminId, "ap:p", { title: text });
    return await tg.send(cid, `📦 <b>${esc(text)}</b>\n\nВведите цену (USD):`);
  }
  if (state === "ap:p") {
    const price = parseFloat(text);
    if (isNaN(price) || price <= 0) { await tg.send(cid, "❌ Введите корректную цену."); return; }
    const title = sData.title as string;
    const { data: product, error } = await d.from("products").insert({ title, price, stock: 0, is_active: false }).select().single();
    if (error) { await tg.send(cid, `❌ ${error.message}`); await clearSession(adminId); return; }
    await logA(adminId, "create_product", "product", product.id, { title, price });
    await clearSession(adminId);
    return await tg.send(cid, `✅ <b>${esc(title)}</b> создан ($${price.toFixed(2)}).\nТовар скрыт — активируйте через админку.`,
      ikb([[btn("📦 Открыть", `a:pv:${product.id}`)], [btn("◀️ Меню", "a:m")]]));
  }

  // Add category
  if (state === "ac:n") {
    await setSession(adminId, "ac:i", { name: text });
    return await tg.send(cid, `📁 <b>${esc(text)}</b>\n\nОтправьте иконку (emoji):`);
  }
  if (state === "ac:i") {
    const name = sData.name as string;
    const slug = name.toLowerCase().replace(/[^a-zа-яё0-9]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || `cat-${Date.now()}`;
    const { error } = await d.from("categories").insert({ id: slug, name, icon: text.trim(), sort_order: 0 });
    await clearSession(adminId);
    if (error) return await tg.send(cid, `❌ ${error.message}`);
    await logA(adminId, "create_category", "category", slug, { name });
    return await tg.send(cid, `✅ ${text.trim()} <b>${esc(name)}</b> создана!`, ikb([[btn("📁 К категориям", "a:cl:0")], [btn("◀️ Меню", "a:m")]]));
  }

  // Edit category
  if (state.startsWith("ec:")) {
    const [, field, ...rest] = state.split(":");
    const catId = rest.join(":");
    const fm: Record<string, string> = { n: "name", i: "icon", d: "description", s: "sort_order" };
    const dbF = fm[field];
    if (!dbF || !catId) { await clearSession(adminId); return; }
    let val: unknown = text;
    if (dbF === "sort_order") val = parseInt(text) || 0;
    await d.from("categories").update({ [dbF]: val }).eq("id", catId);
    await logA(adminId, `edit_cat_${dbF}`, "category", catId, { [dbF]: val });
    await clearSession(adminId);
    return await tg.send(cid, `✅ Обновлено!`, ikb([[btn("📁 Открыть", `a:cv:${catId}`)], [btn("◀️ Меню", "a:m")]]));
  }

  // Edit setting
  if (state.startsWith("es:")) {
    const key = state.slice(3);
    await d.from("shop_settings").update({ value: text, updated_at: new Date().toISOString() }).eq("key", key);
    await logA(adminId, "edit_setting", "setting", key, { value: text });
    await clearSession(adminId);
    return await tg.send(cid, `✅ <b>${esc(key)}</b> обновлено!`, ikb([[btn("⚙️ Настройки", "a:se")], [btn("◀️ Меню", "a:m")]]));
  }

  // Add setting
  if (state === "as:k") {
    await setSession(adminId, "as:v", { key: text.trim() });
    return await tg.send(cid, `Введите значение для <b>${esc(text.trim())}</b>:`);
  }
  if (state === "as:v") {
    const key = sData.key as string;
    await d.from("shop_settings").upsert({ key, value: text, updated_at: new Date().toISOString() }, { onConflict: "key" });
    await logA(adminId, "add_setting", "setting", key, { value: text });
    await clearSession(adminId);
    return await tg.send(cid, `✅ <b>${esc(key)}</b> добавлено!`, ikb([[btn("⚙️ Настройки", "a:se")], [btn("◀️ Меню", "a:m")]]));
  }

  // Add inventory
  if (state.startsWith("ai:")) {
    const pid = state.slice(3);
    const lines = text.split("\n").map(s => s.trim()).filter(Boolean);
    if (!lines.length) { await tg.send(cid, "❌ Отправьте хотя бы одну строку."); return; }
    const { error } = await d.from("inventory_items").insert(lines.map(content => ({ product_id: pid, content, status: "available" })));
    if (error) { await tg.send(cid, `❌ ${error.message}`); await clearSession(adminId); return; }
    const { count } = await d.from("inventory_items").select("id", { count: "exact", head: true }).eq("product_id", pid).eq("status", "available");
    await d.from("products").update({ stock: count || 0, updated_at: new Date().toISOString() }).eq("id", pid);
    await logA(adminId, "add_inventory", "product", pid, { added: lines.length });
    await clearSession(adminId);
    return await tg.send(cid, `✅ Добавлено <b>${lines.length}</b> единиц. Остаток: <b>${count}</b>.`,
      ikb([[btn("🗃 Склад товара", `a:iv:${pid}:0`)], [btn("◀️ Меню", "a:m")]]));
  }

  // Broadcast — save to session for preview
  if (state === "bc:t") {
    await setSession(adminId, "bc:preview", { text: text || "", photoId: photo?.length ? photo[photo.length - 1].file_id : null });
    const previewText = text || "(без текста)";
    if (photo?.length) {
      await tg.sendPhoto(cid, photo[photo.length - 1].file_id, `📢 <b>Предпросмотр:</b>\n\n${previewText}`,
        ikb([[btn("✅ Отправить", "a:bcsend"), btn("✏️ Редактировать", "a:bcedit"), btn("❌ Отмена", "a:bccancel")]]));
    } else {
      await tg.send(cid, `📢 <b>Предпросмотр:</b>\n\n${text}`,
        ikb([[btn("✅ Отправить", "a:bcsend"), btn("✏️ Редактировать", "a:bcedit"), btn("❌ Отмена", "a:bccancel")]]));
    }
    return;
  }

  // Message to user
  if (state.startsWith("um:")) {
    const uid = parseInt(state.slice(3));
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: uid, text, parse_mode: "HTML" }),
      });
      await tg.send(cid, "✅ Отправлено.");
    } catch { await tg.send(cid, "❌ Ошибка отправки."); }
    await clearSession(adminId);
    return;
  }

  // User search
  if (state === "us:q") {
    const isNum = /^\d+$/.test(text);
    let query = d.from("user_profiles").select("*");
    if (isNum) {
      query = query.eq("telegram_id", parseInt(text));
    } else {
      query = query.or(`username.ilike.%${text}%,first_name.ilike.%${text}%,last_name.ilike.%${text}%`);
    }
    const { data: users } = await query.limit(10);
    await clearSession(adminId);
    if (!users?.length) return await tg.send(cid, "❌ Ничего не найдено.", ikb([[btn("◀️ К пользователям", "a:ul:0")]]));
    let t = `🔍 <b>Результаты</b> (${users.length})\n\n`;
    users.forEach(u => { t += `👤 <b>${esc(u.first_name)}</b> ${u.username ? `@${esc(u.username)}` : ""} | ${u.telegram_id}\n`; });
    const rows: Btn[][] = users.map(u => [btn(`${u.first_name} ${u.last_name || ""}`.trim().slice(0, 28), `a:uv:${u.id}`)]);
    rows.push([btn("◀️ К пользователям", "a:ul:0")]);
    return await tg.send(cid, t, ikb(rows));
  }

  // User note
  if (state.startsWith("un:")) {
    const tgId = parseInt(state.slice(3));
    await d.from("user_profiles").update({ internal_note: text, updated_at: new Date().toISOString() }).eq("telegram_id", tgId);
    await logA(adminId, "set_note", "user", String(tgId), { note: text });
    await clearSession(adminId);
    return await tg.send(cid, "✅ Заметка сохранена.", ikb([[btn("◀️ К пользователю", `a:uvt:${tgId}`)]]));
  }

  // Balance operations
  if (state.startsWith("bal:")) {
    const parts = state.split(":");
    const op = parts[1]; // c=credit, d=debit, s=set
    const tgId = parseInt(parts[2]);

    if (!sData.amount) {
      const amount = parseFloat(text);
      if (isNaN(amount) || amount < 0) { await tg.send(cid, "❌ Введите положительное число."); return; }
      await setSession(adminId, state, { ...sData, amount });
      return await tg.send(cid, "📝 Введите комментарий:");
    }

    const amount = sData.amount as number;
    const comment = text;
    const { data: u } = await d.from("user_profiles").select("balance").eq("telegram_id", tgId).single();
    const current = Number(u?.balance || 0);
    let newBalance: number;
    let histAmount: number;
    let histType: string;

    if (op === "c") { newBalance = current + amount; histAmount = amount; histType = "credit"; }
    else if (op === "d") { newBalance = Math.max(0, current - amount); histAmount = -(Math.min(amount, current)); histType = "debit"; }
    else { newBalance = amount; histAmount = amount - current; histType = "set"; }

    await d.from("user_profiles").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("telegram_id", tgId);
    await d.from("balance_history").insert({ telegram_id: tgId, amount: histAmount, balance_after: newBalance, type: histType, comment, admin_telegram_id: adminId });
    await logA(adminId, `balance_${histType}`, "user", String(tgId), { amount: histAmount, balance_after: newBalance, comment });
    await clearSession(adminId);
    return await tg.send(cid, `✅ Баланс: <b>$${newBalance.toFixed(2)}</b>`, ikb([[btn("💰 Баланс", `a:ub:${tgId}`)], [btn("◀️ К пользователю", `a:uvt:${tgId}`)]]));
  }

  // Promo creation
  if (state === "pr:c") {
    await setSession(adminId, "pr:t", { code: text.trim().toUpperCase() });
    return await tg.send(cid, `Код: <b>${esc(text.trim().toUpperCase())}</b>\n\nВведите тип (<b>percent</b> или <b>fixed</b>):`);
  }
  if (state === "pr:t") {
    const type = text.trim().toLowerCase();
    if (!["percent", "fixed"].includes(type)) { await tg.send(cid, "❌ Введите <b>percent</b> или <b>fixed</b>."); return; }
    await setSession(adminId, "pr:v", { ...sData, discount_type: type });
    return await tg.send(cid, `Введите значение скидки${type === "percent" ? " (%)" : " ($)"}:`);
  }
  if (state === "pr:v") {
    const val = parseFloat(text);
    if (isNaN(val) || val <= 0) { await tg.send(cid, "❌ Введите число > 0."); return; }
    const { error } = await d.from("promocodes").insert({
      code: sData.code as string,
      discount_type: sData.discount_type as string,
      discount_value: val,
      is_active: true,
    });
    await clearSession(adminId);
    if (error) return await tg.send(cid, `❌ ${error.message}`);
    await logA(adminId, "create_promo", "promocode", sData.code as string, { discount_type: sData.discount_type, discount_value: val });
    return await tg.send(cid, `✅ Промокод <b>${esc(sData.code as string)}</b> создан!`, ikb([[btn("🎟 К промокодам", "a:prl:0")], [btn("◀️ Меню", "a:m")]]));
  }

  await clearSession(adminId);
}

// ═══════════════════════════════════════════════
// CALLBACK ROUTER
// ═══════════════════════════════════════════════
async function handleCallback(tg: ReturnType<typeof TG>, cb: any, adminId: number) {
  const cid = cb.message.chat.id;
  const mid = cb.message.message_id;
  const d = cb.data as string;
  // Don't clear session for broadcast actions that need it
  if (!["a:bcsend", "a:bcedit", "a:bccancel"].includes(d)) {
    await clearSession(adminId);
  }

  try {
    if (d === "a:m") { await tg.answer(cb.id); return await tg.edit(cid, mid, menuText(), menuKb()); }
    if (d === "a:noop") return await tg.answer(cb.id);

    // Products
    if (d.startsWith("a:pl:")) { await tg.answer(cb.id); return await productsList(tg, cid, mid, parseInt(d.slice(5))); }
    if (d.startsWith("a:pv:")) { await tg.answer(cb.id); return await productView(tg, cid, mid, d.slice(5)); }
    if (d.startsWith("a:pt:")) { await tg.answer(cb.id, "✅"); return await productToggle(tg, cid, mid, d.slice(5), "is_active", adminId); }
    if (d.startsWith("a:pf:")) { await tg.answer(cb.id, "⭐"); return await productToggle(tg, cid, mid, d.slice(5), "is_featured", adminId); }
    if (d.startsWith("a:px:")) { await tg.answer(cb.id, "🔥"); return await productToggle(tg, cid, mid, d.slice(5), "is_popular", adminId); }
    if (d.startsWith("a:pn:")) { await tg.answer(cb.id, "🆕"); return await productToggle(tg, cid, mid, d.slice(5), "is_new", adminId); }
    if (d.startsWith("a:pd:")) {
      const pid = d.slice(5);
      const { data: p } = await db().from("products").select("title").eq("id", pid).single();
      await tg.answer(cb.id);
      return await tg.edit(cid, mid, `⚠️ <b>Удалить?</b>\n\n${esc(p?.title || "?")}\n\nЭто необратимо!`,
        ikb([[btn("✅ Да, удалить", `a:py:${pid}`), btn("❌ Отмена", `a:pv:${pid}`)]]));
    }
    if (d.startsWith("a:py:")) { await tg.answer(cb.id, "🗑"); return await productDeleteConfirm(tg, cid, mid, d.slice(5), adminId); }
    if (d === "a:pa") { await setSession(adminId, "ap:t"); await tg.answer(cb.id); return await tg.send(cid, "📦 <b>Новый товар</b>\n\nВведите название:"); }
    if (d.startsWith("a:pe:")) {
      const parts = d.split(":"); const pid = parts[2]; const f = parts[3];
      if (f === "img") {
        await setSession(adminId, `ep:img:${pid}`);
        await tg.answer(cb.id);
        return await tg.send(cid, "🖼 Отправьте фото товара:\n\n/cancel — отмена");
      }
      const labels: Record<string, string> = { t: "название", p: "цену (USD)", s: "остаток (число)", d: "описание", o: "старую цену (USD)", g: "теги (через запятую)" };
      await setSession(adminId, `ep:${f}:${pid}`);
      await tg.answer(cb.id);
      const extra = f === "d" ? "\n\n💡 Для загрузки файлов используйте ссылку на Яндекс Диск / Google Drive / другое внешнее хранилище." : "";
      return await tg.send(cid, `✏️ Введите <b>${labels[f] || f}</b>:${extra}\n\n/cancel — отмена`);
    }

    // Product category selection
    if (d.startsWith("a:pc:")) {
      const pid = d.slice(5);
      const { data: cats } = await db().from("categories").select("id, name, icon").order("sort_order");
      await tg.answer(cb.id);
      const rows: Btn[][] = (cats || []).map(c => [btn(`${c.icon} ${c.name}`, `a:ps:${pid}:${c.id}`)]);
      rows.push([btn("❌ Без категории", `a:ps:${pid}:__none__`)]);
      rows.push([btn("◀️ Назад", `a:pv:${pid}`)]);
      return await tg.edit(cid, mid, "📁 Выберите категорию:", ikb(rows));
    }
    if (d.startsWith("a:ps:")) {
      const parts = d.split(":"); const pid = parts[2]; const catId = parts.slice(3).join(":");
      const val = catId === "__none__" ? null : catId;
      await db().from("products").update({ category_id: val, updated_at: new Date().toISOString() }).eq("id", pid);
      await logA(adminId, "set_category", "product", pid, { category_id: val });
      await tg.answer(cb.id, "✅");
      return await productView(tg, cid, mid, pid);
    }

    // Categories
    if (d.startsWith("a:cl:")) { await tg.answer(cb.id); return await categoriesList(tg, cid, mid, parseInt(d.slice(5))); }
    if (d.startsWith("a:cv:")) { await tg.answer(cb.id); return await categoryView(tg, cid, mid, d.slice(5)); }
    if (d.startsWith("a:ct:")) {
      const catId = d.slice(5);
      const { data: c } = await db().from("categories").select("is_active").eq("id", catId).single();
      if (c) { await db().from("categories").update({ is_active: !c.is_active }).eq("id", catId); await logA(adminId, "toggle_cat", "category", catId); }
      await tg.answer(cb.id, "✅"); return await categoryView(tg, cid, mid, catId);
    }
    if (d === "a:ca") { await setSession(adminId, "ac:n"); await tg.answer(cb.id); return await tg.send(cid, "📁 <b>Новая категория</b>\n\nВведите название:"); }
    if (d.startsWith("a:ce:")) {
      const parts = d.split(":"); const catId = parts[2]; const f = parts[3];
      const labels: Record<string, string> = { n: "название", i: "иконку (emoji)", d: "описание", s: "порядок сортировки" };
      await setSession(adminId, `ec:${f}:${catId}`);
      await tg.answer(cb.id);
      return await tg.send(cid, `✏️ Введите <b>${labels[f] || f}</b>:\n\n/cancel — отмена`);
    }
    if (d.startsWith("a:cd:")) {
      const catId = d.slice(5);
      const { data: c } = await db().from("categories").select("name").eq("id", catId).single();
      await tg.answer(cb.id);
      return await tg.edit(cid, mid, `⚠️ <b>Удалить категорию?</b>\n\n${esc(c?.name || "?")}\n\nТовары останутся без категории.`,
        ikb([[btn("✅ Удалить", `a:cdy:${catId}`), btn("❌ Отмена", `a:cv:${catId}`)]]));
    }
    if (d.startsWith("a:cdy:")) {
      const catId = d.slice(6);
      await db().from("products").update({ category_id: null }).eq("category_id", catId);
      await db().from("categories").delete().eq("id", catId);
      await logA(adminId, "delete_category", "category", catId);
      await tg.answer(cb.id, "🗑");
      return await tg.edit(cid, mid, "✅ Категория удалена.", ikb([[btn("◀️ К категориям", "a:cl:0")]]));
    }

    // Orders
    if (d.startsWith("a:ol:")) { await tg.answer(cb.id); return await ordersList(tg, cid, mid, parseInt(d.slice(5))); }
    if (d.startsWith("a:ov:")) { await tg.answer(cb.id); return await orderView(tg, cid, mid, d.slice(5)); }
    if (d.startsWith("a:os:")) {
      const parts = d.split(":"); const oid = parts[2]; const status = parts[3];
      await tg.answer(cb.id, `→ ${status}`);
      return await orderSetStatus(tg, cid, mid, oid, status, adminId);
    }

    // Users
    if (d.startsWith("a:ul:")) { await tg.answer(cb.id); return await usersList(tg, cid, mid, parseInt(d.slice(5))); }
    if (d.startsWith("a:ulf:")) {
      const parts = d.split(":"); const filter = parts[2]; const page = parseInt(parts[3] || "0");
      await tg.answer(cb.id); return await usersList(tg, cid, mid, page, filter);
    }
    if (d === "a:usf") {
      await tg.answer(cb.id);
      return await tg.edit(cid, mid, "📊 <b>Фильтр пользователей</b>", ikb([
        [btn("Все", "a:ul:0"), btn("👑 VIP", "a:ulf:vip:0"), btn("🚫 Заблокированные", "a:ulf:blocked:0")],
        [btn("◀️ Назад", "a:ul:0")],
      ]));
    }
    if (d === "a:usq") { await setSession(adminId, "us:q"); await tg.answer(cb.id); return await tg.send(cid, "🔍 Введите TG ID, username или имя:\n\n/cancel — отмена"); }
    if (d.startsWith("a:uv:")) { await tg.answer(cb.id); return await userView(tg, cid, mid, d.slice(5)); }
    if (d.startsWith("a:uvt:")) { await tg.answer(cb.id); return await userViewByTg(tg, cid, mid, parseInt(d.slice(6))); }
    if (d.startsWith("a:um:")) {
      const uid = d.slice(5);
      await setSession(adminId, `um:${uid}`);
      await tg.answer(cb.id);
      return await tg.send(cid, "✍️ Введите сообщение:\n\n/cancel — отмена");
    }

    // User orders
    if (d.startsWith("a:uo:")) {
      const parts = d.split(":"); const tgId = parseInt(parts[2]); const page = parseInt(parts[3] || "0");
      await tg.answer(cb.id); return await userOrdersList(tg, cid, mid, tgId, page);
    }

    // User balance
    if (d.startsWith("a:ub:")) {
      const tgId = parseInt(d.slice(5));
      await tg.answer(cb.id); return await balanceMenu(tg, cid, mid, tgId);
    }
    if (d.startsWith("a:ubc:")) { const tgId = d.slice(6); await setSession(adminId, `bal:c:${tgId}`); await tg.answer(cb.id); return await tg.send(cid, "➕ Введите сумму для начисления:\n\n/cancel — отмена"); }
    if (d.startsWith("a:ubd:")) { const tgId = d.slice(6); await setSession(adminId, `bal:d:${tgId}`); await tg.answer(cb.id); return await tg.send(cid, "➖ Введите сумму для списания:\n\n/cancel — отмена"); }
    if (d.startsWith("a:ubs:")) { const tgId = d.slice(6); await setSession(adminId, `bal:s:${tgId}`); await tg.answer(cb.id); return await tg.send(cid, "🎯 Введите новое значение баланса:\n\n/cancel — отмена"); }

    // User role
    if (d.startsWith("a:ur:")) {
      const tgId = parseInt(d.slice(5));
      await tg.answer(cb.id);
      return await tg.edit(cid, mid, `🏷 <b>Изменить роль</b> — TG ${tgId}`, ikb([
        [btn("👤 user", `a:urs:${tgId}:user`), btn("👑 vip", `a:urs:${tgId}:vip`), btn("🚫 blocked", `a:urs:${tgId}:blocked`)],
        [btn("◀️ Назад", `a:uvt:${tgId}`)],
      ]));
    }
    if (d.startsWith("a:urs:")) {
      const parts = d.split(":"); const tgId = parseInt(parts[2]); const role = parts[3];
      await db().from("user_profiles").update({ role, updated_at: new Date().toISOString() }).eq("telegram_id", tgId);
      await logA(adminId, "set_role", "user", String(tgId), { role });
      await tg.answer(cb.id, `✅ ${role}`);
      return await userViewByTg(tg, cid, mid, tgId);
    }

    // User block/unblock
    if (d.startsWith("a:ux:")) {
      const tgId = parseInt(d.slice(5));
      const { data: u } = await db().from("user_profiles").select("is_blocked").eq("telegram_id", tgId).single();
      if (u) {
        const newVal = !u.is_blocked;
        await db().from("user_profiles").update({ is_blocked: newVal, updated_at: new Date().toISOString() }).eq("telegram_id", tgId);
        await logA(adminId, newVal ? "block_user" : "unblock_user", "user", String(tgId));
        await tg.answer(cb.id, newVal ? "🚫" : "✅");
      }
      return await userViewByTg(tg, cid, mid, tgId);
    }

    // User note
    if (d.startsWith("a:un:")) {
      const tgId = d.slice(5);
      await setSession(adminId, `un:${tgId}`);
      await tg.answer(cb.id);
      return await tg.send(cid, "📝 Введите заметку:\n\n/cancel — отмена");
    }

    // User logs
    if (d.startsWith("a:ula:")) {
      const parts = d.split(":"); const tgId = parseInt(parts[2]); const page = parseInt(parts[3] || "0");
      await tg.answer(cb.id); return await userLogsList(tg, cid, mid, tgId, page);
    }

    // Promocodes
    if (d.startsWith("a:prl:")) { await tg.answer(cb.id); return await promosList(tg, cid, mid, parseInt(d.slice(6))); }
    if (d.startsWith("a:prv:")) { await tg.answer(cb.id); return await promoView(tg, cid, mid, d.slice(6)); }
    if (d === "a:pra") { await setSession(adminId, "pr:c"); await tg.answer(cb.id); return await tg.send(cid, "🎟 <b>Новый промокод</b>\n\nВведите код:"); }
    if (d.startsWith("a:prt:")) {
      const prId = d.slice(6);
      const { data: p } = await db().from("promocodes").select("is_active").eq("id", prId).single();
      if (p) { await db().from("promocodes").update({ is_active: !p.is_active }).eq("id", prId); await logA(adminId, "toggle_promo", "promocode", prId); }
      await tg.answer(cb.id, "✅"); return await promoView(tg, cid, mid, prId);
    }
    if (d.startsWith("a:prd:")) {
      const prId = d.slice(6);
      const { data: p } = await db().from("promocodes").select("code").eq("id", prId).single();
      await tg.answer(cb.id);
      return await tg.edit(cid, mid, `⚠️ <b>Удалить промокод?</b>\n\n<code>${esc(p?.code || "?")}</code>`,
        ikb([[btn("✅ Удалить", `a:prdy:${prId}`), btn("❌ Отмена", `a:prv:${prId}`)]]));
    }
    if (d.startsWith("a:prdy:")) {
      const prId = d.slice(7);
      await db().from("promocodes").delete().eq("id", prId);
      await logA(adminId, "delete_promo", "promocode", prId);
      await tg.answer(cb.id, "🗑");
      return await tg.edit(cid, mid, "✅ Промокод удалён.", ikb([[btn("◀️ К промокодам", "a:prl:0")]]));
    }

    // Stats, Settings, Logs, Stock
    if (d === "a:st") { await tg.answer(cb.id); return await statsView(tg, cid, mid); }
    if (d === "a:se") { await tg.answer(cb.id); return await settingsList(tg, cid, mid); }
    if (d === "a:sa") { await setSession(adminId, "as:k"); await tg.answer(cb.id); return await tg.send(cid, "⚙️ Введите ключ настройки:\n\n/cancel — отмена"); }
    if (d.startsWith("a:sv:")) {
      const key = d.slice(5);
      await setSession(adminId, `es:${key}`);
      await tg.answer(cb.id);
      return await tg.send(cid, `✏️ Новое значение для <b>${esc(key)}</b>:\n\n/cancel — отмена`);
    }
    if (d.startsWith("a:lg:")) { await tg.answer(cb.id); return await logsList(tg, cid, mid, parseInt(d.slice(5))); }
    if (d.startsWith("a:sk:")) { await tg.answer(cb.id); return await stockOverview(tg, cid, mid, parseInt(d.slice(5))); }

    // Inventory
    if (d.startsWith("a:iv:")) {
      const parts = d.split(":"); const pid = parts[2]; const page = parseInt(parts[3] || "0");
      await tg.answer(cb.id); return await inventoryView(tg, cid, mid, pid, page);
    }
    if (d.startsWith("a:ia:")) {
      const pid = d.slice(5);
      await setSession(adminId, `ai:${pid}`);
      await tg.answer(cb.id);
      return await tg.send(cid, "🗃 <b>Добавление единиц</b>\n\nОтправьте ключи/аккаунты, каждый с новой строки.\n\n💡 Для загрузки файлов используйте ссылку на Яндекс Диск / Google Drive / другое внешнее хранилище.\n\n/cancel — отмена");
    }
    if (d.startsWith("a:is:")) { await tg.answer(cb.id, "🔄"); return await inventorySync(tg, cid, mid, d.slice(5), adminId); }

    // Broadcast
    if (d === "a:bc") { await tg.answer(cb.id); return await broadcastMenu(tg, cid, mid); }
    if (d === "a:bs") { await setSession(adminId, "bc:t"); await tg.answer(cb.id); return await tg.send(cid, "📢 Введите текст рассылки (поддерживается HTML: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;a&gt;) или отправьте фото с подписью:\n\n/cancel — отмена"); }
    if (d === "a:bcsend") {
      const session = await getSession(adminId);
      console.log("Broadcast send - session:", JSON.stringify(session));
      if (!session || session.state !== "bc:preview") {
        console.error("Broadcast session lost! adminId:", adminId, "session:", JSON.stringify(session));
        await tg.answer(cb.id, "⚠️ Сессия устарела. Попробуйте создать рассылку заново.");
        return;
      }
      const sData = session.data;
      const { data: users } = await db().from("user_profiles").select("telegram_id").eq("is_blocked", false);
      if (!users?.length) { await tg.answer(cb.id, "❌ Нет пользователей"); await clearSession(adminId); return; }
      const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN")!;
      let ok = 0, fail = 0;
      for (const u of users) {
        try {
          let r;
          if (sData.photoId) {
            r = await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: u.telegram_id, photo: sData.photoId, caption: (sData.text as string) || "", parse_mode: "HTML" }),
            }).then(r => r.json());
          } else {
            r = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: u.telegram_id, text: sData.text as string, parse_mode: "HTML" }),
            }).then(r => r.json());
          }
          if (r.ok) ok++; else fail++;
        } catch { fail++; }
      }
      await logA(adminId, "broadcast", "broadcast", undefined, { ok, fail, total: users.length });
      await clearSession(adminId);
      await tg.answer(cb.id, "✅");
      return await tg.send(cid, `📢 <b>Рассылка завершена!</b>\n\n✅ ${ok}\n❌ ${fail}\n📊 ${users.length}`, ikb([[btn("◀️ Меню", "a:m")]]));
    }
    if (d === "a:bcedit") { await setSession(adminId, "bc:t"); await tg.answer(cb.id); return await tg.send(cid, "✏️ Введите новый текст рассылки:\n\n/cancel — отмена"); }
    if (d === "a:bccancel") { await clearSession(adminId); await tg.answer(cb.id); return await tg.send(cid, "❌ Рассылка отменена.", ikb([[btn("◀️ Меню", "a:m")]])); }

    // Reviews moderation
    if (d.startsWith("a:rvl:")) { await tg.answer(cb.id); return await reviewsList(tg, cid, mid, parseInt(d.slice(6))); }
    if (d.startsWith("a:rvf:")) {
      const parts = d.split(":"); const filter = parts[2]; const page = parseInt(parts[3] || "0");
      await tg.answer(cb.id); return await reviewsList(tg, cid, mid, page, filter);
    }
    if (d.startsWith("a:rva:")) {
      const rid = d.slice(6);
      await db().from("reviews").update({ verified: true, moderation_status: "approved" }).eq("id", rid);
      await logA(adminId, "approve_review", "review", rid);
      await tg.answer(cb.id, "✅"); return await reviewsList(tg, cid, mid, 0);
    }
    if (d.startsWith("a:rvr:")) {
      const rid = d.slice(6);
      await db().from("reviews").update({ moderation_status: "rejected" }).eq("id", rid);
      await logA(adminId, "reject_review", "review", rid);
      await tg.answer(cb.id, "❌"); return await reviewsList(tg, cid, mid, 0);
    }
    if (d.startsWith("a:rvv:")) {
      const rid = d.slice(6);
      const { data: r } = await db().from("reviews").select("*").eq("id", rid).single();
      if (!r) { await tg.answer(cb.id); return; }
      const t = `⭐ <b>Отзыв</b>\n\n👤 ${esc(r.author)}\n${"⭐".repeat(r.rating)}\n\n${esc(r.text)}\n\n📅 ${new Date(r.created_at).toLocaleDateString("ru-RU")}`;
      await tg.answer(cb.id);
      return await tg.edit(cid, mid, t, ikb([
        [btn("✅ Одобрить", `a:rva:${rid}`), btn("❌ Отклонить", `a:rvr:${rid}`)],
        [btn("🗑 Удалить", `a:rvd:${rid}`)],
        [btn("◀️ К отзывам", "a:rvl:0")],
      ]));
    }
    if (d.startsWith("a:rvd:")) {
      const rid = d.slice(6);
      await db().from("reviews").delete().eq("id", rid);
      await logA(adminId, "delete_review", "review", rid);
      await tg.answer(cb.id, "🗑"); return await reviewsList(tg, cid, mid, 0);
    }

    await tg.answer(cb.id, "❓");
  } catch (e) {
    console.error("Callback error:", e);
    await tg.answer(cb.id, "⚠️ Ошибка");
  }
}

// ═══════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const botToken = Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ error: "No token" }, 500);

    // ─── Webhook secret token verification ───────
    const secretToken = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    if (!secretToken) {
      return json({ error: "Webhook secret is not configured" }, 500);
    }
    const headerToken = req.headers.get("x-telegram-bot-api-secret-token");
    if (headerToken !== secretToken) {
      return json({ error: "Forbidden" }, 403);
    }

    // Setup endpoint removed for security — use CLI or manual API call to set webhook

    if (req.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }

    const rawBody = await req.text();
    let body: any;
    try {
      body = JSON.parse(rawBody);
    } catch (_e) {
      return json({ error: "Invalid JSON" }, 400);
    }
    const updateId = body?.update_id;
    if (!updateId || updateId === null) {
      return json({ ok: true });
    }
    const tg = TG(botToken);

    // Callback queries
    if (body.callback_query) {
      const cb = body.callback_query;
      const role = await isAdmin(cb.from.id);
      if (!role) { await tg.answer(cb.id, "⛔ Нет доступа"); return json({ ok: true }); }
      await handleCallback(tg, cb, cb.from.id);
      return json({ ok: true });
    }

    // Messages
    const message = body.message;
    if (!message) return json({ ok: true });

    const chatId = message.chat.id;
    const text = (message.text || message.caption || "").trim();
    const photo = message.photo || null;
    const tgId = message.from?.id;
    const firstName = message.from?.first_name || "друг";

    // FSM check — now handles both text and photo
    if (tgId && text !== "/admin" && text !== "/start" && text !== "/cancel") {
      const session = await getSession(tgId);
      if (session) {
        const role = await isAdmin(tgId);
        if (role) { await handleFSM(tg, chatId, text, photo, session, tgId); return json({ ok: true }); }
      }
    }
    // Also check FSM for photo-only messages (no text/caption)
    if (tgId && photo && !text) {
      const session = await getSession(tgId);
      if (session) {
        const role = await isAdmin(tgId);
        if (role) { await handleFSM(tg, chatId, "", photo, session, tgId); return json({ ok: true }); }
      }
    }

    // /cancel
    if (text === "/cancel" && tgId) {
      await clearSession(tgId);
      await tg.send(chatId, "❌ Отменено.", ikb([[btn("◀️ Меню", "a:m")]]));
      return json({ ok: true });
    }

    // /admin
    if (text === "/admin" && tgId) {
      const role = await isAdmin(tgId);
      if (!role) {
        await logA(tgId, "unauthorized_admin", "security");
        await tg.send(chatId, "⛔ Нет доступа.");
        return json({ ok: true });
      }
      await clearSession(tgId);
      await logA(tgId, "open_admin", "admin");
      await tg.send(chatId, menuText(), menuKb());
      return json({ ok: true });
    }

    // /start
    if (text === "/start") {
      let webAppUrl = Deno.env.get("WEBAPP_URL") || "https://temka-digital-vault.lovable.app";
      // Ensure URL has https:// prefix
      if (!webAppUrl.startsWith("http://") && !webAppUrl.startsWith("https://")) {
        webAppUrl = `https://${webAppUrl}`;
      }
      const { data: supportSetting } = await db().from("shop_settings").select("value").eq("key", "support_username").maybeSingle();
      const support = supportSetting?.value || "TeleStoreHelp";

      console.log("Sending /start message to", chatId, "webAppUrl:", webAppUrl);
      const sendResult = await tg.send(chatId,
        `👋 Привет, ${firstName}!\n\nДобро пожаловать в наш магазин цифровых товаров!\n\n🛍 Аккаунты, ключи ПО и подписки\n⚡ Мгновенная доставка\n₿ Оплата через CryptoBot\n🛡 Гарантия и поддержка\n\nНажмите кнопку ниже 👇`,
        { inline_keyboard: [
          [{ text: "🛒 Открыть магазин", web_app: { url: webAppUrl } }],
          [{ text: "📋 Каталог", web_app: { url: `${webAppUrl}/catalog` } }, { text: "👤 Профиль", web_app: { url: `${webAppUrl}/account` } }],
          [{ text: "💬 Поддержка", url: `https://t.me/${support}` }],
        ] }
      );
      const sendResultText = await sendResult.text();
      console.log("Send result:", sendResult.status, sendResultText.substring(0, 300));

      // Upsert profile + fetch avatar
      if (tgId) {
        let photoUrl: string | null = null;
        try {
          const photosRes = await fetch(`https://api.telegram.org/bot${botToken}/getUserProfilePhotos`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: tgId, limit: 1 }),
          }).then(r => r.json());
          if (photosRes.ok && photosRes.result?.total_count > 0) {
            const fileId = photosRes.result.photos[0][0].file_id;
            const fileData = await fetch(`https://api.telegram.org/bot${botToken}/getFile`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ file_id: fileId }),
            }).then(r => r.json());
            if (fileData.ok) {
              photoUrl = `https://api.telegram.org/file/bot${botToken}/${fileData.result.file_path}`;
            }
          }
        } catch (e) { console.error("Photo fetch error:", e); }

        await db().from("user_profiles").upsert({
          telegram_id: tgId, first_name: message.from.first_name || "",
          last_name: message.from.last_name || null, username: message.from.username || null,
          is_premium: message.from.is_premium || false, language_code: message.from.language_code || null,
          accepted_terms: true,
          ...(photoUrl ? { photo_url: photoUrl } : {}),
          updated_at: new Date().toISOString(),
        }, { onConflict: "telegram_id" });
      }
      return json({ ok: true });
    }

    return json({ ok: true });
  } catch (error) {
    console.error("Webhook error:", error);
    return json({ error: error.message }, 500);
  }
});
