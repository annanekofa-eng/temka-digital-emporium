import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Supabase (singleton per request) ─────
let _db: ReturnType<typeof createClient> | null = null;
const supabase = () => {
  if (!_db) _db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return _db;
};

const TG = (token: string) => {
  const call = (method: string, body: Record<string, unknown>) =>
    fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(r => r.json());
  return {
    send: (chatId: number, text: string, markup?: unknown) =>
      call("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) }),
    edit: (chatId: number, msgId: number, text: string, markup?: unknown) =>
      call("editMessageText", { chat_id: chatId, message_id: msgId, text, parse_mode: "HTML", disable_web_page_preview: true, ...(markup ? { reply_markup: markup } : {}) }).then(r => {
        if (!r.ok) console.error("editMessageText failed:", JSON.stringify(r));
        return r;
      }),
    answer: (cbId: string, text?: string) =>
      call("answerCallbackQuery", { callback_query_id: cbId, ...(text ? { text, show_alert: true } : {}) }),
    sendPhoto: (chatId: number, photo: string, caption: string, markup?: unknown) =>
      call("sendPhoto", { chat_id: chatId, photo, caption, parse_mode: "HTML", ...(markup ? { reply_markup: markup } : {}) }),
    getFile: (fileId: string) =>
      fetch(`https://api.telegram.org/bot${token}/getFile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
      }).then(r => r.json()),
    fileUrl: (path: string) => `https://api.telegram.org/file/bot${token}/${path}`,
    deleteMessage: (chatId: number, msgId: number) =>
      call("deleteMessage", { chat_id: chatId, message_id: msgId }).catch(() => {}),
  };
};

type Btn = { text: string; callback_data?: string; url?: string; web_app?: { url: string } };

// shopId is NEVER included in callback_data — it comes from the webhook URL query param.
// This avoids exceeding Telegram's 64-byte callback_data limit and UUID confusion.
const btn = (t: string, cb: string): Btn => ({ text: t, callback_data: cb });
const ikb = (rows: Btn[][]) => ({ inline_keyboard: rows });
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Unicode-safe truncation: never breaks surrogate pairs / multi-byte chars */
const safeSlice = (s: string, max: number) => {
  const chars = [...s];
  return chars.length <= max ? s : chars.slice(0, max).join("");
};

/** Sanitize a welcome_message from shop owner: escape HTML to prevent injection, then replace {name} */
function escHtmlWelcome(raw: string, name: string): string {
  // Escape ALL HTML first, then replace the {name} placeholder with an escaped name
  const escaped = esc(raw);
  return escaped.replace(/\{name\}/gi, esc(name));
}
/** Render validated welcome message: HTML is already validated by Telegram, just replace {name} */
function renderWelcome(raw: string, name: string): string {
  return raw.replace(/\{name\}/gi, esc(name));
}
const WEBAPP_DOMAIN = Deno.env.get("WEBAPP_URL") || "https://telestore.lovable.app";

function paginate<T>(items: T[], page: number, perPage = 6) {
  const total = Math.max(1, Math.ceil(items.length / perPage));
  const p = Math.min(Math.max(0, page), total - 1);
  return { items: items.slice(p * perPage, (p + 1) * perPage), total, page: p };
}
function pgRow(prefix: string, page: number, total: number): Btn[] {
  const r: Btn[] = [];
  if (page > 0) r.push(btn("◀️", `${prefix}:${page - 1}`));
  r.push(btn(`${page + 1}/${total}`, "s:noop"));
  if (page < total - 1) r.push(btn("▶️", `${prefix}:${page + 1}`));
  return r;
}

// ─── Admin log helper ──────────────────────
async function logAction(shopId: string, adminTgId: number, action: string, entityType?: string, entityId?: string, details?: Record<string, unknown>) {
  await supabase().from("shop_admin_logs").insert({
    shop_id: shopId, admin_telegram_id: adminTgId, action,
    entity_type: entityType || null, entity_id: entityId || null, details: details || {},
  });
}

// ─── Session FSM (fully isolated via seller_sessions with composite PK) ───
async function getSession(tgId: number, shopId: string) {
  const { data } = await supabase().from("seller_sessions").select("*").eq("telegram_id", tgId).eq("shop_id", shopId).maybeSingle();
  if (!data) return null;
  return data as { telegram_id: number; shop_id: string; state: string; data: Record<string, unknown> };
}
async function setSession(tgId: number, state: string, shopId: string, data: Record<string, unknown> = {}) {
  await supabase().from("seller_sessions").upsert(
    { telegram_id: tgId, shop_id: shopId, state, data, updated_at: new Date().toISOString() },
    { onConflict: "telegram_id,shop_id" },
  );
}
async function clearSession(tgId: number, shopId?: string) {
  if (shopId) {
    await supabase().from("seller_sessions").delete().eq("telegram_id", tgId).eq("shop_id", shopId);
  } else {
    await supabase().from("seller_sessions").delete().eq("telegram_id", tgId);
  }
}

// ─── Check if user is shop owner ─────────────
async function isShopOwner(shopId: string, telegramId: number): Promise<boolean> {
  const { data: shop } = await supabase().from("shops").select("owner_id").eq("id", shopId).single();
  if (!shop) return false;
  const { data: user } = await supabase().from("platform_users").select("id").eq("telegram_id", telegramId).maybeSingle();
  if (!user) return false;
  return shop.owner_id === user.id;
}

// ─── Ensure shop customer exists (tenant-scoped) ──────────
async function ensureShopCustomer(shopId: string, tgUser: { id: number; first_name?: string; last_name?: string; username?: string; is_premium?: boolean; language_code?: string }) {
  await supabase().rpc("ensure_shop_customer", {
    p_shop_id: shopId,
    p_telegram_id: tgUser.id,
    p_first_name: tgUser.first_name || "",
    p_last_name: tgUser.last_name || null,
    p_username: tgUser.username || null,
    p_is_premium: tgUser.is_premium || false,
    p_language_code: tgUser.language_code || null,
  });
}

// ═══════════════════════════════════════════════
// ADMIN HOME
// ═══════════════════════════════════════════════
async function adminHome(tg: ReturnType<typeof TG>, chatId: number, shopId: string, msgId?: number) {
  const { data: shop } = await supabase().from("shops").select("*").eq("id", shopId).single();
  if (!shop) return;

  const [{ count: productCount }, { count: orderCount }, { count: categoryCount }] = await Promise.all([
    supabase().from("shop_products").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    supabase().from("shop_orders").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    supabase().from("shop_categories").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
  ]);

  const text =
    `🔧 <b>Админ-панель: ${esc(shop.name)}</b>\n\n` +
    `📊 Статус: ${shop.status === "active" ? "активен 🟢" : "остановлен 🔴"}\n` +
    `📦 Товаров: ${productCount || 0}\n` +
    `📂 Категорий: ${categoryCount || 0}\n` +
    `🛍 Заказов: ${orderCount || 0}\n\nВыберите раздел:`;

  const kb = ikb([
    [btn("📦 Товары", "s:pl:0"), btn("📁 Категории", "s:cl:0")],
    [btn("🛒 Заказы", "s:ol:0"), btn("👥 Пользователи", "s:ul:0")],
    [btn("📊 Статистика", "s:st"), btn("🎟 Промокоды", "s:prl:0")],
    [btn("🗃 Склад", "s:sk:0"), btn("📋 Логи", "s:lg:0")],
    [btn("⚙️ Настройки", "s:se"), btn("📢 Рассылка", "s:bc")],
    [btn("⭐ Отзывы", "s:rvl:0")],
  ]);

  if (msgId) return tg.edit(chatId, msgId, text, kb);
  return tg.send(chatId, text, kb);
}

// ═══════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════
async function productsList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number) {
  const { data: products } = await supabase().from("shop_products").select("id, name, price, stock, is_active").eq("shop_id", shopId).order("sort_order").order("created_at", { ascending: false });
  if (!products?.length) {
    return tg.edit(cid, mid, "📦 <b>Товары</b>\n\nТоваров нет.", ikb([[btn("➕ Добавить", "s:pa")], [btn("◀️ Меню", "s:m")]]));
  }
  const pg = paginate(products, page, 8);
  let t = `📦 <b>Товары</b> (${products.length})\n\n`;
  pg.items.forEach(p => {
    const s = p.is_active ? "✅" : "❌";
    t += `${s} <b>${esc(p.name)}</b>\n💰 $${Number(p.price).toFixed(2)} | 📦 ${p.stock}\n\n`;
  });
  const rows: Btn[][] = pg.items.map(p => [btn(`${p.is_active ? "✅" : "❌"} ${safeSlice(p.name, 28)}`, `s:pv:${p.id}`)]);
  if (pg.total > 1) rows.push(pgRow("s:pl", pg.page, pg.total));
  rows.push([btn("➕ Добавить", "s:pa"), btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function productView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, pid: string) {
  const { data: p } = await supabase().from("shop_products").select("*").eq("id", pid).single();
  if (!p) return tg.edit(cid, mid, "❌ Товар не найден", ikb([[btn("◀️ Назад", "s:pl:0")]]));
  const [{ count: invCount }, catData] = await Promise.all([
    supabase().from("shop_inventory").select("id", { count: "exact", head: true }).eq("product_id", pid).eq("status", "available"),
    p.category_id ? supabase().from("shop_categories").select("name, icon").eq("id", p.category_id).single() : Promise.resolve({ data: null }),
  ]);
  const cat = catData?.data;
  let t = `📦 <b>${esc(p.name)}</b>\n\n`;
  t += `📝 ${esc(p.subtitle || "—")}\n`;
  t += `💰 <b>$${Number(p.price).toFixed(2)}</b>`;
  if (p.old_price) t += ` <s>$${Number(p.old_price).toFixed(2)}</s>`;
  t += `\n📦 Остаток: <b>${p.stock}</b> | Единиц: <b>${invCount || 0}</b>\n`;
  t += `📁 Категория: <b>${cat ? `${cat.icon} ${esc(cat.name)}` : "— не задана"}</b>\n`;
  t += `📝 Описание: ${p.description ? esc(p.description.slice(0, 100)) : "—"}\n`;
  t += `🔧 Тип: ${p.type}\n`;
  t += `${p.is_active ? "✅ Активен" : "❌ Скрыт"}\n`;
  if (p.image) t += `🖼 Фото: есть\n`;
  if (p.features?.length) t += `🏷 Особенности: ${p.features.join(", ")}\n`;
  return tg.edit(cid, mid, t, ikb([
    [btn("✏️ Название", `s:pe:${pid}:n`), btn("✏️ Цена", `s:pe:${pid}:p`)],
    [btn("✏️ Остаток", `s:pe:${pid}:s`), btn("✏️ Описание", `s:pe:${pid}:d`)],
    [btn("✏️ Стар.цена", `s:pe:${pid}:o`), btn("✏️ Подзаголовок", `s:pe:${pid}:sub`)],
    [btn("🖼 Фото", `s:pe:${pid}:img`), btn("🏷 Особенности", `s:pe:${pid}:f`)],
    [btn("📁 Категория", `s:pc:${pid}`), btn(p.is_active ? "❌ Скрыть" : "✅ Показать", `s:pt:${pid}`)],
    [btn("🗃 Склад", `s:iv:${pid}:0`), btn("🗑 Удалить", `s:pd:${pid}`)],
    [btn("◀️ К товарам", "s:pl:0")],
  ]));
}

// ═══════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════
async function categoriesList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, _page: number) {
  const { data: cats } = await supabase().from("shop_categories").select("*").eq("shop_id", shopId).order("sort_order");
  if (!cats?.length) return tg.edit(cid, mid, "📁 <b>Категории</b>\n\nНет.", ikb([[btn("➕ Добавить", "s:ca")], [btn("◀️ Меню", "s:m")]]));
  let t = `📁 <b>Категории</b> (${cats.length})\n\n`;
  cats.forEach(c => { t += `${c.icon} <b>${esc(c.name)}</b> ${c.is_active ? "" : "❌"}\n`; });
  const rows: Btn[][] = cats.map(c => [btn(`${c.icon} ${c.name}`, `s:cv:${c.id}`)]);
  rows.push([btn("➕ Добавить", "s:ca"), btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function categoryView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, catId: string) {
  const [{ data: c }, { count: prodCount }] = await Promise.all([
    supabase().from("shop_categories").select("*").eq("id", catId).single(),
    supabase().from("shop_products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("category_id", catId),
  ]);
  if (!c) return tg.edit(cid, mid, "Не найдена", ikb([[btn("◀️ Назад", "s:cl:0")]]));
  let t = `📁 <b>${c.icon} ${esc(c.name)}</b>\n\n📊 Сортировка: ${c.sort_order}\n📦 Товаров: ${prodCount || 0}\n${c.is_active ? "✅ Активна" : "❌ Скрыта"}\n`;
  return tg.edit(cid, mid, t, ikb([
    [btn("✏️ Название", `s:ce:${catId}:n`), btn("✏️ Иконка", `s:ce:${catId}:i`)],
    [btn("✏️ Сортировка", `s:ce:${catId}:s`)],
    [btn(c.is_active ? "❌ Скрыть" : "✅ Показать", `s:ct:${catId}`)],
    [btn("📦 Товары категории", `s:cprod:${catId}:0`)],
    [btn("🗑 Удалить", `s:cd:${catId}`)],
    [btn("◀️ К категориям", "s:cl:0")],
  ]));
}

// ═══════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════
async function ordersList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number) {
  const { data: orders } = await supabase().from("shop_orders").select("*").eq("shop_id", shopId).order("created_at", { ascending: false }).limit(100);
  if (!orders?.length) return tg.edit(cid, mid, "🛒 <b>Заказы</b>\n\nНет.", ikb([[btn("◀️ Меню", "s:m")]]));
  const se: Record<string, string> = { pending: "⏳", awaiting_payment: "💳", paid: "✅", processing: "⚙️", delivered: "📬", completed: "✅", cancelled: "❌", error: "⚠️" };
  const pg = paginate(orders, page, 6);
  let t = `🛒 <b>Заказы</b> (${orders.length})\n\n`;
  pg.items.forEach(o => {
    t += `${se[o.status] || "❓"} <b>${esc(o.order_number)}</b> — $${Number(o.total_amount).toFixed(2)}\n👤 ${o.buyer_telegram_id} | 📅 ${new Date(o.created_at).toLocaleDateString("ru-RU")}\n\n`;
  });
  const rows: Btn[][] = pg.items.map(o => [btn(`${se[o.status] || "❓"} ${o.order_number}`, `s:ov:${o.id}`)]);
  if (pg.total > 1) rows.push(pgRow("s:ol", pg.page, pg.total));
  rows.push([btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function orderView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, oid: string) {
  const { data: o } = await supabase().from("shop_orders").select("*").eq("id", oid).single();
  if (!o) return tg.edit(cid, mid, "Не найден", ikb([[btn("◀️ Назад", "s:ol:0")]]));
  const { data: items } = await supabase().from("shop_order_items").select("*").eq("order_id", oid);
  // Use shop_customers instead of user_profiles
  const { data: customer } = await supabase().from("shop_customers").select("*").eq("shop_id", shopId).eq("telegram_id", o.buyer_telegram_id).maybeSingle();
  let t = `🛒 <b>Заказ ${esc(o.order_number)}</b>\n\n`;
  t += `👤 ${customer ? esc(customer.first_name + (customer.last_name ? " " + customer.last_name : "")) : o.buyer_telegram_id}`;
  if (customer?.username) t += ` @${esc(customer.username)}`;
  t += `\n🆔 TG: ${o.buyer_telegram_id}\n\n📦 <b>Состав:</b>\n`;
  items?.forEach(i => { t += `  • ${esc(i.product_name)} ×${i.quantity} — $${Number(i.product_price * i.quantity).toFixed(2)}\n`; });
  t += `\n💰 <b>$${Number(o.total_amount).toFixed(2)}</b> ${o.currency}\n📋 Статус: <b>${o.status}</b>\n💳 Оплата: <b>${o.payment_status}</b>\n`;
  if (o.invoice_id) t += `🧾 Invoice: ${o.invoice_id}\n`;
  if (Number(o.balance_used) > 0) t += `💎 Баланс: $${Number(o.balance_used).toFixed(2)}\n`;
  t += `📅 ${new Date(o.created_at).toLocaleString("ru-RU")}\n`;
  const statuses = ["paid", "processing", "delivered", "completed", "cancelled"].filter(s => s !== o.status);
  const sBtns: Btn[][] = [];
  for (let i = 0; i < statuses.length; i += 3) sBtns.push(statuses.slice(i, i + 3).map(s => btn(s, `s:os:${oid}:${s}`)));
  sBtns.push([btn("👤 Пользователь", `s:uvt:${o.buyer_telegram_id}`)]);
  return tg.edit(cid, mid, t, ikb([...sBtns, [btn("◀️ К заказам", "s:ol:0")]]));
}

async function orderSetStatus(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, oid: string, status: string, adminId: number) {
  const pm: Record<string, string> = { paid: "paid", processing: "paid", delivered: "paid", completed: "paid", cancelled: "failed" };
  await supabase().from("shop_orders").update({ status, payment_status: pm[status] || "unpaid", updated_at: new Date().toISOString() }).eq("id", oid);
  await logAction(shopId, adminId, `order_${status}`, "order", oid);
  return orderView(tg, cid, mid, shopId, oid);
}

// ═══════════════════════════════════════════════
// USERS — now using shop_customers
// ═══════════════════════════════════════════════
async function usersList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number, filter?: string) {
  // Get all shop customers for this shop
  let query = supabase().from("shop_customers").select("*").eq("shop_id", shopId).order("created_at", { ascending: false });
  if (filter === "vip") query = query.eq("role", "vip");
  else if (filter === "blocked") query = query.eq("is_blocked", true);
  const { data: customers } = await query;

  if (!customers?.length) return tg.edit(cid, mid, `👥 <b>Пользователи</b>${filter ? ` [${filter}]` : ""}\n\nНет.`, ikb([[btn("◀️ Меню", "s:m")]]));
  const pg = paginate(customers, page, 8);
  let t = `👥 <b>Пользователи</b> (${customers.length})${filter ? ` [${filter}]` : ""}\n\n`;
  pg.items.forEach(u => {
    const flags = [u.is_premium ? "⭐" : "", u.role === "vip" ? "👑" : "", u.is_blocked ? "🚫" : ""].filter(Boolean).join("");
    t += `👤 <b>${esc(u.first_name)}${u.last_name ? " " + esc(u.last_name) : ""}</b> ${flags}`;
    if (u.username) t += ` @${esc(u.username)}`;
    t += ` | ${u.telegram_id}\n`;
  });
  const pfx = filter ? `s:ulf:${filter}` : "s:ul";
  const rows: Btn[][] = pg.items.map(u => [btn(safeSlice(`${u.is_blocked ? "🚫 " : ""}${u.first_name} ${u.last_name || ""}`.trim(), 28), `s:uv:${u.id}`)]);
  if (pg.total > 1) rows.push(pgRow(pfx, pg.page, pg.total));
  rows.push([btn("🔍 Поиск", "s:usq"), btn("📊 Фильтр", "s:usf")]);
  rows.push([btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function userView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, uid: string) {
  // Read from shop_customers
  const { data: u } = await supabase().from("shop_customers").select("*").eq("id", uid).single();
  if (!u) return tg.edit(cid, mid, "Не найден", ikb([[btn("◀️ Назад", "s:ul:0")]]));
  const { data: orders } = await supabase().from("shop_orders").select("id, total_amount, status, payment_status").eq("shop_id", shopId).eq("buyer_telegram_id", u.telegram_id);
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
    [btn("📢 Написать", `s:um:${u.telegram_id}`), btn("🛒 Заказы", `s:uo:${u.telegram_id}:0`)],
    [btn("💰 Баланс", `s:ub:${u.telegram_id}`), btn("🏷 Роль", `s:ur:${u.telegram_id}`)],
    [btn(u.is_blocked ? "✅ Разблокировать" : "🚫 Заблокировать", `s:ux:${u.telegram_id}`)],
    [btn("📝 Заметка", `s:un:${u.telegram_id}`), btn("📋 Логи", `s:ula:${u.telegram_id}:0`)],
    [btn("◀️ К пользователям", "s:ul:0")],
  ]));
}

async function userViewByTg(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, tgId: number) {
  const { data: u } = await supabase().from("shop_customers").select("id").eq("shop_id", shopId).eq("telegram_id", tgId).maybeSingle();
  if (!u) return tg.edit(cid, mid, "Пользователь не найден", ikb([[btn("◀️ Назад", "s:ul:0")]]));
  return userView(tg, cid, mid, shopId, u.id);
}

// User orders
async function userOrdersList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, tgId: number, page: number) {
  const { data: orders } = await supabase().from("shop_orders").select("*").eq("shop_id", shopId).eq("buyer_telegram_id", tgId).order("created_at", { ascending: false });
  if (!orders?.length) return tg.edit(cid, mid, `🛒 <b>Заказы пользователя ${tgId}</b>\n\nНет.`, ikb([[btn("◀️ Назад", `s:uvt:${tgId}`)]]));
  const se: Record<string, string> = { pending: "⏳", paid: "✅", processing: "⚙️", delivered: "📬", completed: "✅", cancelled: "❌" };
  const pg = paginate(orders, page, 6);
  let t = `🛒 <b>Заказы</b> (${orders.length}) — TG ${tgId}\n\n`;
  pg.items.forEach(o => { t += `${se[o.status] || "❓"} ${esc(o.order_number)} — $${Number(o.total_amount).toFixed(2)}\n`; });
  const rows: Btn[][] = pg.items.map(o => [btn(`${se[o.status] || "❓"} ${o.order_number}`, `s:ov:${o.id}`)]);
  if (pg.total > 1) rows.push(pgRow(`s:uo:${tgId}`, pg.page, pg.total));
  rows.push([btn("◀️ К пользователю", `s:uvt:${tgId}`)]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// Balance menu — now using shop_customers + shop_balance_history
async function balanceMenu(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, tgId: number) {
  const { data: u } = await supabase().from("shop_customers").select("balance").eq("shop_id", shopId).eq("telegram_id", tgId).maybeSingle();
  const { data: history } = await supabase().from("shop_balance_history").select("*").eq("shop_id", shopId).eq("telegram_id", tgId).order("created_at", { ascending: false }).limit(5);
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
    [btn("➕ Начислить", `s:ubc:${tgId}`), btn("➖ Списать", `s:ubd:${tgId}`)],
    [btn("🎯 Установить", `s:ubs:${tgId}`)],
    [btn("◀️ К пользователю", `s:uvt:${tgId}`)],
  ]));
}

// User logs
async function userLogsList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, tgId: number, page: number) {
  const { data: logs } = await supabase().from("shop_admin_logs").select("*").eq("shop_id", shopId).eq("entity_id", String(tgId)).order("created_at", { ascending: false }).limit(30);
  if (!logs?.length) return tg.edit(cid, mid, `📋 <b>Логи</b> — TG ${tgId}\n\nПусто.`, ikb([[btn("◀️ Назад", `s:uvt:${tgId}`)]]));
  const pg = paginate(logs, page, 6);
  let t = `📋 <b>Логи</b> — TG ${tgId}\n\n`;
  pg.items.forEach(l => { t += `${new Date(l.created_at).toLocaleString("ru-RU")} | <b>${esc(l.action)}</b>\n`; });
  const rows: Btn[][] = [];
  if (pg.total > 1) rows.push(pgRow(`s:ula:${tgId}`, pg.page, pg.total));
  rows.push([btn("◀️ К пользователю", `s:uvt:${tgId}`)]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// ═══════════════════════════════════════════════
// PROMOCODES
// ═══════════════════════════════════════════════
async function promosList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number) {
  const { data: promos } = await supabase().from("shop_promocodes").select("*").eq("shop_id", shopId).order("created_at", { ascending: false });
  if (!promos?.length) return tg.edit(cid, mid, "🎟 <b>Промокоды</b>\n\nНет.", ikb([[btn("➕ Создать", "s:pra")], [btn("◀️ Меню", "s:m")]]));
  const pg = paginate(promos, page, 6);
  let t = `🎟 <b>Промокоды</b> (${promos.length})\n\n`;
  pg.items.forEach(p => {
    const st = p.is_active ? "✅" : "❌";
    const disc = p.discount_type === "percent" ? `${p.discount_value}%` : `$${Number(p.discount_value).toFixed(2)}`;
    t += `${st} <code>${esc(p.code)}</code> — ${disc} | ${p.used_count}/${p.max_uses ?? "∞"}\n`;
  });
  const rows: Btn[][] = pg.items.map(p => [btn(`${p.is_active ? "✅" : "❌"} ${p.code}`, `s:prv:${p.id}`)]);
  if (pg.total > 1) rows.push(pgRow("s:prl", pg.page, pg.total));
  rows.push([btn("➕ Создать", "s:pra"), btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function promoView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, prId: string) {
  const { data: p } = await supabase().from("shop_promocodes").select("*").eq("id", prId).single();
  if (!p) return tg.edit(cid, mid, "Не найден", ikb([[btn("◀️ Назад", "s:prl:0")]]));
  const disc = p.discount_type === "percent" ? `${p.discount_value}%` : `$${Number(p.discount_value).toFixed(2)}`;
  let t = `🎟 <b>${esc(p.code)}</b>\n\n`;
  t += `💰 Скидка: <b>${disc}</b> (${p.discount_type})\n`;
  t += `📊 Использовано: ${p.used_count}/${p.max_uses ?? "∞"}\n`;
  t += `👤 Макс на юзера: ${p.max_uses_per_user || "безлимит"}\n`;
  t += `${p.is_active ? "✅ Активен" : "❌ Неактивен"}\n`;
  if (p.valid_from) t += `📅 С: ${new Date(p.valid_from).toLocaleDateString("ru-RU")}\n`;
  if (p.valid_until) t += `📅 До: ${new Date(p.valid_until).toLocaleDateString("ru-RU")}\n`;
  return tg.edit(cid, mid, t, ikb([
    [btn(p.is_active ? "❌ Деактивировать" : "✅ Активировать", `s:prt:${prId}`)],
    [btn("🗑 Удалить", `s:prd:${prId}`)],
    [btn("◀️ К промокодам", "s:prl:0")],
  ]));
}

// ═══════════════════════════════════════════════
// STATS
// ═══════════════════════════════════════════════
async function statsView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string) {
  const { data: shop } = await supabase().from("shops").select("name").eq("id", shopId).single();
  const d = supabase();
  const [{ count: pc }, { count: ap }, { data: orders }, { count: customerCount }] = await Promise.all([
    d.from("shop_products").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
    d.from("shop_products").select("id", { count: "exact", head: true }).eq("shop_id", shopId).eq("is_active", true),
    d.from("shop_orders").select("id, total_amount, status, buyer_telegram_id, payment_status").eq("shop_id", shopId),
    d.from("shop_customers").select("id", { count: "exact", head: true }).eq("shop_id", shopId),
  ]);
  const prodIds = (await d.from("shop_products").select("id").eq("shop_id", shopId)).data?.map(p => p.id) || [];
  let invCount = 0;
  if (prodIds.length) {
    const { count } = await d.from("shop_inventory").select("id", { count: "exact", head: true }).eq("status", "available").in("product_id", prodIds);
    invCount = count || 0;
  }
  const paid = orders?.filter(o => ["paid", "completed", "delivered", "processing"].includes(o.status)) || [];
  const rev = paid.reduce((s, o) => s + Number(o.total_amount), 0);
  const avg = paid.length ? rev / paid.length : 0;
  const problems = orders?.filter(o => ["error", "cancelled"].includes(o.status)).length || 0;
  let t = `📊 <b>Статистика: ${esc(shop?.name || "")}</b>\n\n👥 Покупателей: <b>${customerCount || 0}</b>\n📦 Товаров: <b>${ap || 0}</b>/${pc || 0}\n🗃 На складе: <b>${invCount}</b>\n\n`;
  t += `🛒 Заказов: <b>${orders?.length || 0}</b>\n✅ Оплаченных: <b>${paid.length}</b>\n⚠️ Проблемных: <b>${problems}</b>\n\n`;
  t += `💰 Выручка: <b>$${rev.toFixed(2)}</b>\n📈 Средний чек: <b>$${avg.toFixed(2)}</b>\n`;
  return tg.edit(cid, mid, t, ikb([[btn("🔄 Обновить", "s:st"), btn("◀️ Меню", "s:m")]]));
}

// ═══════════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════════
async function settingsView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string) {
  const { data: shop } = await supabase().from("shops").select("*").eq("id", shopId).single();
  if (!shop) return tg.edit(cid, mid, "❌ Не найден", ikb([[btn("◀️ Меню", "s:m")]]));

  let botStatus = "❌ не подключён";
  if (shop.bot_token_encrypted) {
    if (shop.bot_username && shop.webhook_status === "active") {
      botStatus = `✅ @${shop.bot_username} (webhook активен)`;
    } else if (shop.bot_username) {
      botStatus = `⚠️ @${shop.bot_username} (webhook: ${shop.webhook_status})`;
    } else {
      botStatus = "⚠️ токен сохранён";
    }
  }

  let subStatus = "❌ выключена";
  if (shop.is_subscription_required) {
    subStatus = shop.required_channel_id
      ? `✅ включена (${shop.required_channel_link || shop.required_channel_id})`
      : "⚠️ включена, но канал не настроен";
  }

  const text =
    `⚙️ <b>Настройки: ${esc(shop.name)}</b>\n\n` +
    `📛 Название: ${esc(shop.name)}\n` +
    `🎨 Цвет: ${shop.color}\n` +
    `📌 Заголовок: ${shop.hero_title || "—"}\n` +
    `📝 Описание: ${shop.hero_description ? esc(shop.hero_description.slice(0, 60)) + "…" : "—"}\n` +
    `👋 Приветствие: ${shop.welcome_message ? esc(shop.welcome_message.slice(0, 50)) + "…" : "—"}\n` +
    `🔗 Поддержка: ${shop.support_link || "—"}\n` +
    `🤖 Бот: ${botStatus}\n` +
    `💰 CryptoBot: ${shop.cryptobot_token_encrypted ? "✅ подключён" : "❌ не подключён"}\n` +
    `📢 Подписка на канал: ${subStatus}`;

  return tg.edit(cid, mid, text, ikb([
    [btn("✏️ Название", "s:edit:name"), btn("🎨 Цвет", "s:edit:color")],
    [btn("📌 Заголовок витрины", "s:edit:hero_title")],
    [btn("📝 Описание витрины", "s:edit:hero_desc")],
    [btn("👋 Приветствие", "s:edit:welcome"), btn("🔗 Поддержка", "s:edit:support")],
    [btn("💰 CryptoBot", "s:setcb")],
    [btn(`📢 ОП ${shop.is_subscription_required ? "✅" : "❌"}`, "s:opsettings")],
    [btn("◀️ Меню", "s:m")],
  ]));
}

// ═══════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════
async function logsList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number) {
  const { data: logs } = await supabase().from("shop_admin_logs").select("*").eq("shop_id", shopId).order("created_at", { ascending: false }).limit(50);
  if (!logs?.length) return tg.edit(cid, mid, "📋 <b>Логи</b>\n\nПусто.", ikb([[btn("◀️ Меню", "s:m")]]));
  const pg = paginate(logs, page, 8);
  let t = `📋 <b>Логи</b> (${logs.length})\n\n`;
  pg.items.forEach(l => {
    t += `${new Date(l.created_at).toLocaleString("ru-RU")}\n👤 ${l.admin_telegram_id} | <b>${esc(l.action)}</b>${l.entity_type ? ` | ${l.entity_type}` : ""}\n\n`;
  });
  const rows: Btn[][] = [];
  if (pg.total > 1) rows.push(pgRow("s:lg", pg.page, pg.total));
  rows.push([btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// ═══════════════════════════════════════════════
// STOCK OVERVIEW
// ═══════════════════════════════════════════════
async function stockOverview(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number) {
  const { data: products } = await supabase().from("shop_products").select("id, name, stock, is_active").eq("shop_id", shopId).order("stock", { ascending: true });
  if (!products?.length) return tg.edit(cid, mid, "🗃 <b>Склад</b>\n\nНет товаров.", ikb([[btn("◀️ Меню", "s:m")]]));
  const oos = products.filter(p => p.stock <= 0).length;
  const low = products.filter(p => p.stock > 0 && p.stock <= 5).length;
  const pg = paginate(products, page, 8);
  let t = `🗃 <b>Склад</b>\n\n❌ Нет в наличии: <b>${oos}</b>\n⚠️ Мало: <b>${low}</b>\n\n`;
  pg.items.forEach(p => {
    const ic = p.stock <= 0 ? "❌" : p.stock <= 5 ? "⚠️" : "✅";
    t += `${ic} ${esc(p.name)} — <b>${p.stock}</b>\n`;
  });
  const rows: Btn[][] = [];
  if (pg.total > 1) rows.push(pgRow("s:sk", pg.page, pg.total));
  rows.push([btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// ═══════════════════════════════════════════════
// INVENTORY
// ═══════════════════════════════════════════════
async function inventoryView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, pid: string, page: number) {
  const { data: p } = await supabase().from("shop_products").select("name").eq("id", pid).single();
  const { data: inv } = await supabase().from("shop_inventory").select("id, status, content, created_at").eq("product_id", pid).order("created_at", { ascending: false });
  const available = inv?.filter(i => i.status === "available") || [];
  const sold = inv?.filter(i => i.status === "sold") || [];
  const pg = paginate(available, page, 8);
  let t = `🗃 <b>Склад: ${esc(p?.name || "?")}</b>\n\n✅ В наличии: <b>${available.length}</b>\n🛒 Продано: <b>${sold.length}</b>\n\n`;
  pg.items.forEach(i => { t += `📦 <code>${esc(i.content.slice(0, 40))}</code>\n`; });
  const rows: Btn[][] = [];
  if (pg.total > 1) rows.push(pgRow(`s:iv:${pid}`, pg.page, pg.total));
  rows.push([btn("➕ Добавить", `s:ia:${pid}`), btn("🔄 Синхр.", `s:is:${pid}`)]);
  rows.push([btn("◀️ К товару", `s:pv:${pid}`)]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function inventorySync(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, pid: string, adminId: number) {
  const { count } = await supabase().from("shop_inventory").select("id", { count: "exact", head: true }).eq("product_id", pid).eq("status", "available");
  await supabase().from("shop_products").update({ stock: count || 0, updated_at: new Date().toISOString() }).eq("id", pid);
  await logAction(shopId, adminId, "sync_inventory", "product", pid, { stock: count || 0 });
  return inventoryView(tg, cid, mid, shopId, pid, 0);
}

// ═══════════════════════════════════════════════
// REVIEWS
// ═══════════════════════════════════════════════
async function reviewsList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number, filter?: string) {
  let query = supabase().from("shop_reviews").select("*").eq("shop_id", shopId).order("created_at", { ascending: false });
  if (filter === "pending") query = query.eq("moderation_status", "pending");
  else if (filter === "approved") query = query.eq("moderation_status", "approved");
  const { data: reviews } = await query.limit(50);
  if (!reviews?.length) return tg.edit(cid, mid, `⭐ <b>Отзывы</b>${filter ? ` [${filter}]` : ""}\n\nНет.`, ikb([[btn("◀️ Меню", "s:m")]]));
  const pg = paginate(reviews, page, 6);
  let t = `⭐ <b>Отзывы</b> (${reviews.length})${filter ? ` [${filter}]` : ""}\n\n`;
  pg.items.forEach(r => {
    const st = r.moderation_status === "approved" ? "✅" : r.moderation_status === "rejected" ? "❌" : "⏳";
    t += `${st} ${"⭐".repeat(r.rating)} — ${esc(r.author)}\n${esc(r.text.slice(0, 40))}\n\n`;
  });
  const rows: Btn[][] = pg.items.map(r => [btn(`${r.moderation_status === "approved" ? "✅" : "⏳"} ${safeSlice(r.author, 20)}`, `s:rvv:${r.id}`)]);
  if (pg.total > 1) rows.push(pgRow(filter ? `s:rvf:${filter}` : "s:rvl", pg.page, pg.total));
  rows.push([btn("⏳ Ожидающие", "s:rvf:pending:0"), btn("✅ Одобренные", "s:rvf:approved:0")]);
  rows.push([btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// ═══════════════════════════════════════════════
// BROADCAST
// ═══════════════════════════════════════════════
async function broadcastMenu(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string) {
  // Count all shop customers (not just buyers)
  const { count } = await supabase().from("shop_customers").select("id", { count: "exact", head: true }).eq("shop_id", shopId);
  return tg.edit(cid, mid,
    `📢 <b>Рассылка</b>\n\n👥 Получателей: <b>${count || 0}</b>\n\nОтправьте текст (поддерживается HTML) или фото с подписью.`,
    ikb([[btn("✍️ Написать", "s:bs")], [btn("◀️ Меню", "s:m")]]));
}

// ═══════════════════════════════════════════════
// FSM TEXT HANDLER
// ═══════════════════════════════════════════════
async function handleFSM(tg: ReturnType<typeof TG>, cid: number, val: string, photo: any, shopId: string, adminId: number): Promise<boolean> {
  const session = await getSession(cid, shopId);
  if (!session) return false;
  const state = session.state;
  const sData = (session.data || {}) as Record<string, unknown>;

  // ─── /cancel ──────────────────────────────
  if (val === "/cancel") {
    await clearSession(cid);
    await tg.send(cid, "❌ Отменено.", ikb([[btn("◀️ Меню", "s:m")]]));
    return true;
  }

  // ─── Add product ──────────────────────────
  if (state === "ap:t") {
    await setSession(cid, "ap:p", shopId, { ...sData, title: val });
    await tg.send(cid, `Название: <b>${esc(val)}</b>\n\nВведите цену (USD):`);
    return true;
  }
  if (state === "ap:p") {
    const price = parseFloat(val);
    if (isNaN(price) || price <= 0) { await tg.send(cid, "❌ Введите число > 0."); return true; }
    await setSession(cid, "ap:d", shopId, { ...sData, price });
    await tg.send(cid, "Введите описание (или <b>/skip</b>):");
    return true;
  }
  if (state === "ap:d") {
    const desc = val === "/skip" ? "" : val;
    const { data: product, error } = await supabase().from("shop_products").insert({
      name: sData.title as string, price: sData.price as number, description: desc,
      shop_id: shopId, is_active: true,
    }).select().single();
    await clearSession(cid);
    if (error) { await tg.send(cid, `❌ ${error.message}`); return true; }
    await logAction(shopId, adminId, "create_product", "product", product.id, { name: sData.title });
    await tg.send(cid, `✅ Товар <b>${esc(sData.title as string)}</b> создан!`, ikb([[btn("📦 К товару", `s:pv:${product.id}`)], [btn("◀️ Меню", "s:m")]]));
    return true;
  }

  // ─── Edit product ─────────────────────────
  if (state.startsWith("ep:")) {
    const parts = state.split(":");
    const field = parts[1]; const pid = parts[2];

    if (field === "img") {
      if (!photo?.length) { await tg.send(cid, "❌ Отправьте фото."); return true; }
      const fileId = photo[photo.length - 1].file_id;
      const fileInfo = await tg.getFile(fileId);
      if (!fileInfo.ok) { await tg.send(cid, "❌ Ошибка получения файла."); await clearSession(cid); return true; }
      const fileUrl = tg.fileUrl(fileInfo.result.file_path);

      // Download and upload to Supabase Storage
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      try {
        const imgRes = await fetch(fileUrl);
        const blob = await imgRes.blob();
        const ext = fileInfo.result.file_path.split(".").pop() || "jpg";
        const storagePath = `shops/${shopId}/${pid}.${ext}`;
        const { error: uploadError } = await supabase().storage.from("product-images").upload(storagePath, blob, { upsert: true, contentType: `image/${ext}` });
        if (uploadError) { await tg.send(cid, `❌ Ошибка загрузки: ${uploadError.message}`); await clearSession(cid); return true; }
        const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/${storagePath}`;
        await supabase().from("shop_products").update({ image: publicUrl, updated_at: new Date().toISOString() }).eq("id", pid);
        await logAction(shopId, adminId, "update_photo", "product", pid);
        await clearSession(cid);
        await tg.send(cid, "✅ Фото обновлено!", ikb([[btn("📦 К товару", `s:pv:${pid}`)]]));
      } catch (e) {
        await tg.send(cid, `❌ Ошибка: ${(e as Error).message}`);
        await clearSession(cid);
      }
      return true;
    }

    const fieldMap: Record<string, string> = { n: "name", p: "price", s: "stock", d: "description", o: "old_price", sub: "subtitle", f: "features" };
    const dbField = fieldMap[field];
    if (!dbField) { await clearSession(cid); return true; }
    let updateVal: unknown = val;
    if (field === "p" || field === "o") { const n = parseFloat(val); if (isNaN(n)) { await tg.send(cid, "❌ Введите число."); return true; } updateVal = n; }
    if (field === "s") { const n = parseInt(val); if (isNaN(n)) { await tg.send(cid, "❌ Введите число."); return true; } updateVal = n; }
    if (field === "f") updateVal = val.split(",").map(s => s.trim()).filter(Boolean);
    await supabase().from("shop_products").update({ [dbField]: updateVal, updated_at: new Date().toISOString() }).eq("id", pid);
    await logAction(shopId, adminId, "edit_product", "product", pid, { field: dbField });
    await clearSession(cid);
    const resp = await tg.send(cid, "✅ Обновлено!");
    const mid = resp?.result?.message_id;
    if (mid) return productView(tg, cid, mid, shopId, pid), true;
    return true;
  }

  // ─── Add category ─────────────────────────
  if (state === "ac:n") {
    await setSession(cid, "ac:i", shopId, { ...sData, name: val });
    await tg.send(cid, `Название: <b>${esc(val)}</b>\n\nВведите иконку (emoji):`);
    return true;
  }
  if (state === "ac:i") {
    const { error } = await supabase().from("shop_categories").insert({ name: sData.name as string, icon: val, shop_id: shopId });
    await clearSession(cid);
    if (error) { await tg.send(cid, `❌ ${error.message}`); return true; }
    await logAction(shopId, adminId, "create_category", "category", undefined, { name: sData.name });
    await tg.send(cid, `✅ Категория <b>${val} ${esc(sData.name as string)}</b> создана!`, ikb([[btn("📁 К категориям", "s:cl:0")], [btn("◀️ Меню", "s:m")]]));
    return true;
  }

  // ─── Edit category ────────────────────────
  if (state.startsWith("ec:")) {
    const parts = state.split(":");
    const field = parts[1]; const catId = parts[2];
    const fieldMap: Record<string, string> = { n: "name", i: "icon", s: "sort_order" };
    const dbField = fieldMap[field];
    if (!dbField) { await clearSession(cid); return true; }
    let updateVal: unknown = val;
    if (field === "s") { const n = parseInt(val); if (isNaN(n)) { await tg.send(cid, "❌ Введите число."); return true; } updateVal = n; }
    await supabase().from("shop_categories").update({ [dbField]: updateVal }).eq("id", catId);
    await logAction(shopId, adminId, "edit_category", "category", catId, { field: dbField });
    await clearSession(cid);
    const resp = await tg.send(cid, "✅ Обновлено!");
    const mid = resp?.result?.message_id;
    if (mid) return categoryView(tg, cid, mid, shopId, catId), true;
    return true;
  }

  // ─── Edit shop field ──────────────────────
  if (state === "s_edit_field") {
    const field = sData.field as string;
    const fieldMap: Record<string, string> = {
      name: "name", color: "color", hero_title: "hero_title",
      hero_desc: "hero_description", welcome: "welcome_message", support: "support_link",
    };
    const dbField = fieldMap[field];
    if (!dbField) { await clearSession(cid); return true; }
    if (field === "color" && !/^#?[0-9A-Fa-f]{6}$/.test(val)) {
      await tg.send(cid, "❌ Введи HEX цвет, например: #FF5500");
      return true;
    }
    // For welcome message, store raw text as-is (full replacement, HTML supported)
    const updateVal = field === "color" ? (val.startsWith("#") ? val : `#${val}`) : val;
    await supabase().from("shops").update({ [dbField]: updateVal, updated_at: new Date().toISOString() }).eq("id", shopId);
    await clearSession(cid);
    const resp = await tg.send(cid, "✅ Обновлено!");
    const mid = resp?.result?.message_id;
    if (mid) return settingsView(tg, cid, mid, shopId), true;
    return true;
  }

  // ─── Set OP channel link ──────────────────
  if (state === "s_set_op_channel") {
    const input = val.trim();
    // Accept @username, t.me/username, or numeric chat_id
    let channelLink = input;
    let channelId = input;
    if (/^-?\d+$/.test(input)) {
      channelId = input;
      channelLink = input;
    } else {
      // Extract username from t.me link or @username
      let username = input;
      if (username.includes("t.me/")) {
        username = username.split("t.me/").pop()?.split("/")[0]?.split("?")[0] || "";
      }
      username = username.replace(/^@/, "");
      if (!username) { await tg.send(cid, "❌ Неверный формат. Отправьте @username канала, ссылку t.me/... или числовой chat_id."); return true; }
      channelId = `@${username}`;
      channelLink = `https://t.me/${username}`;
    }
    await supabase().from("shops").update({
      required_channel_id: channelId,
      required_channel_link: channelLink,
      updated_at: new Date().toISOString(),
    }).eq("id", shopId);
    await clearSession(cid);
    await tg.send(cid, `✅ Канал установлен: <b>${esc(channelId)}</b>\n\n⚠️ Убедитесь, что бот добавлен в канал как администратор.`, ikb([[btn("◀️ К настройкам", "s:se")]]));
    return true;
  }

  // ─── Set CryptoBot token ──────────────────
  if (state === "s_set_cryptobot") {
    if (val.length < 10) { await tg.send(cid, "❌ Неверный формат."); return true; }
    const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!encKey) { await tg.send(cid, "❌ Ошибка конфигурации."); return true; }
    const { data: enc } = await supabase().rpc("encrypt_token", { p_token: val, p_key: encKey });
    await supabase().from("shops").update({ cryptobot_token_encrypted: enc, updated_at: new Date().toISOString() }).eq("id", shopId);
    await clearSession(cid);
    await tg.send(cid, "✅ CryptoBot-токен сохранён!", ikb([[btn("◀️ К настройкам", "s:se")]]));
    return true;
  }

  // ─── Add inventory ────────────────────────
  if (state.startsWith("ai:")) {
    const pid = state.slice(3);
    const lines = val.split("\n").map(s => s.trim()).filter(Boolean);
    if (!lines.length) { await tg.send(cid, "❌ Отправьте хотя бы одну строку."); return true; }
    const { error } = await supabase().from("shop_inventory").insert(lines.map(content => ({ product_id: pid, content, status: "available" })));
    if (error) { await tg.send(cid, `❌ ${error.message}`); await clearSession(cid); return true; }
    const { count } = await supabase().from("shop_inventory").select("id", { count: "exact", head: true }).eq("product_id", pid).eq("status", "available");
    await supabase().from("shop_products").update({ stock: count || 0, updated_at: new Date().toISOString() }).eq("id", pid);
    await logAction(shopId, adminId, "add_inventory", "product", pid, { added: lines.length });
    await clearSession(cid);
    await tg.send(cid, `✅ Добавлено <b>${lines.length}</b> единиц. Остаток: <b>${count}</b>.`,
      ikb([[btn("🗃 Склад товара", `s:iv:${pid}:0`)], [btn("◀️ Меню", "s:m")]]));
    return true;
  }

  // ─── Broadcast text ───────────────────────
  if (state === "bc:t") {
    await setSession(cid, "bc:preview", shopId, { text: val || "", photoId: photo?.length ? photo[photo.length - 1].file_id : null });
    const previewText = val || "(без текста)";
    if (photo?.length) {
      await tg.sendPhoto(cid, photo[photo.length - 1].file_id, `📢 <b>Предпросмотр:</b>\n\n${previewText}`,
        ikb([[btn("✅ Отправить", "s:bcsend"), btn("✏️ Редактировать", "s:bcedit"), btn("❌ Отмена", "s:bccancel")]]));
    } else {
      await tg.send(cid, `📢 <b>Предпросмотр:</b>\n\n${val}`,
        ikb([[btn("✅ Отправить", "s:bcsend"), btn("✏️ Редактировать", "s:bcedit"), btn("❌ Отмена", "s:bccancel")]]));
    }
    return true;
  }

  // ─── Message to user ──────────────────────
  if (state.startsWith("um:")) {
    const uid = parseInt(state.slice(3));
    try {
      await tg.send(uid, val);
      await tg.send(cid, "✅ Отправлено.");
    } catch { await tg.send(cid, "❌ Ошибка отправки."); }
    await clearSession(cid);
    return true;
  }

  // ─── User search (now using shop_customers) ──────────────
  if (state === "us:q") {
    const isNum = /^\d+$/.test(val);
    let query = supabase().from("shop_customers").select("*").eq("shop_id", shopId);
    if (isNum) {
      query = query.eq("telegram_id", parseInt(val));
    } else {
      query = query.or(`username.ilike.%${val}%,first_name.ilike.%${val}%,last_name.ilike.%${val}%`);
    }
    const { data: customers } = await query.limit(10);
    await clearSession(cid);
    if (!customers?.length) { await tg.send(cid, "❌ Ничего не найдено.", ikb([[btn("◀️ К пользователям", "s:ul:0")]])); return true; }
    let t = `🔍 <b>Результаты</b> (${customers.length})\n\n`;
    customers.forEach(u => { t += `👤 <b>${esc(u.first_name)}</b> ${u.username ? `@${esc(u.username)}` : ""} | ${u.telegram_id}\n`; });
    const rows: Btn[][] = customers.map(u => [btn(safeSlice(`${u.first_name} ${u.last_name || ""}`.trim(), 28), `s:uv:${u.id}`)]);
    rows.push([btn("◀️ К пользователям", "s:ul:0")]);
    await tg.send(cid, t, ikb(rows));
    return true;
  }

  // ─── User note (now using shop_customers) ─────────
  if (state.startsWith("un:")) {
    const tgId = parseInt(state.slice(3));
    await supabase().from("shop_customers").update({ internal_note: val, updated_at: new Date().toISOString() }).eq("shop_id", shopId).eq("telegram_id", tgId);
    await logAction(shopId, adminId, "set_note", "user", String(tgId), { note: val });
    await clearSession(cid);
    await tg.send(cid, "✅ Заметка сохранена.", ikb([[btn("◀️ К пользователю", `s:uvt:${tgId}`)]]));
    return true;
  }

  // ─── Balance operations (now using shop_customers + shop_balance_history) ───
  if (state.startsWith("bal:")) {
    const parts = state.split(":");
    const op = parts[1];
    const tgId = parseInt(parts[2]);

    if (!sData.amount) {
      const amount = parseFloat(val);
      if (isNaN(amount) || amount < 0) { await tg.send(cid, "❌ Введите положительное число."); return true; }
      await setSession(cid, state, shopId, { ...sData, amount });
      await tg.send(cid, "📝 Введите комментарий:");
      return true;
    }

    const amount = sData.amount as number;
    const comment = val;
    const { data: u } = await supabase().from("shop_customers").select("balance").eq("shop_id", shopId).eq("telegram_id", tgId).maybeSingle();
    const current = Number(u?.balance || 0);
    let newBalance: number;
    let histAmount: number;
    let histType: string;

    if (op === "c") { newBalance = current + amount; histAmount = amount; histType = "credit"; }
    else if (op === "d") { newBalance = Math.max(0, current - amount); histAmount = -(Math.min(amount, current)); histType = "debit"; }
    else { newBalance = amount; histAmount = amount - current; histType = "set"; }

    // Ensure shop customer exists before updating balance
    await supabase().rpc("ensure_shop_customer", { p_shop_id: shopId, p_telegram_id: tgId });
    await supabase().from("shop_customers").update({ balance: newBalance, updated_at: new Date().toISOString() }).eq("shop_id", shopId).eq("telegram_id", tgId);
    await supabase().from("shop_balance_history").insert({ shop_id: shopId, telegram_id: tgId, amount: histAmount, balance_after: newBalance, type: histType, comment, admin_telegram_id: adminId });
    await logAction(shopId, adminId, `balance_${histType}`, "user", String(tgId), { amount: histAmount, balance_after: newBalance, comment });
    await clearSession(cid);
    await tg.send(cid, `✅ Баланс: <b>$${newBalance.toFixed(2)}</b>`, ikb([[btn("💰 Баланс", `s:ub:${tgId}`)], [btn("◀️ К пользователю", `s:uvt:${tgId}`)]]));
    return true;
  }

  // ─── Promo creation ───────────────────────
  if (state === "pr:c") {
    await setSession(cid, "pr:t", shopId, { ...sData, code: val.trim().toUpperCase() });
    await tg.send(cid, `Код: <b>${esc(val.trim().toUpperCase())}</b>\n\nВведите тип (<b>percent</b> или <b>fixed</b>):`);
    return true;
  }
  if (state === "pr:t") {
    const type = val.toLowerCase();
    if (!["percent", "fixed"].includes(type)) { await tg.send(cid, "❌ Введите <b>percent</b> или <b>fixed</b>."); return true; }
    await setSession(cid, "pr:v", shopId, { ...sData, discount_type: type });
    await tg.send(cid, `Введите значение скидки${type === "percent" ? " (%)" : " ($)"}:`);
    return true;
  }
  if (state === "pr:v") {
    const v = parseFloat(val);
    if (isNaN(v) || v <= 0) { await tg.send(cid, "❌ Введите число > 0."); return true; }
    const { error } = await supabase().from("shop_promocodes").insert({
      code: sData.code as string, discount_type: sData.discount_type as string,
      discount_value: v, is_active: true, shop_id: shopId,
    });
    await clearSession(cid);
    if (error) { await tg.send(cid, `❌ ${error.message}`); return true; }
    await logAction(shopId, adminId, "create_promo", "promocode", sData.code as string, { discount_type: sData.discount_type, discount_value: v });
    await tg.send(cid, `✅ Промокод <b>${esc(sData.code as string)}</b> создан!`, ikb([[btn("🎟 К промокодам", "s:prl:0")], [btn("◀️ Меню", "s:m")]]));
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════
// CALLBACK HANDLER
// ═══════════════════════════════════════════════
async function handleCallback(tg: ReturnType<typeof TG>, cid: number, mid: number, data: string, cbId: string, shopId: string, adminId: number, botToken?: string) {
  // Format: s:<cmd>:<arg1>:<arg2>:... — NO shopId in callback_data
  const parts = data.split(":");
  const cmd = parts[1];

  // Don't clear session for flows that need persisted callback context
  if (!["bcsend", "bcedit", "bccancel", "pcs", "pcr"].includes(cmd)) {
    await clearSession(cid);
  }

  try {
    await tg.answer(cbId);

    if (cmd === "noop") return;
    if (cmd === "m") return adminHome(tg, cid, shopId, mid);

    // Products
    if (cmd === "pl") return productsList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "pv") return productView(tg, cid, mid, shopId, parts[2]);
    if (cmd === "pt") {
      const pid = parts[2];
      const { data: p } = await supabase().from("shop_products").select("is_active, name").eq("id", pid).single();
      if (p) {
        await supabase().from("shop_products").update({ is_active: !p.is_active, updated_at: new Date().toISOString() }).eq("id", pid);
        await logAction(shopId, adminId, "toggle_active", "product", pid, { is_active: !p.is_active });
      }
      return productView(tg, cid, mid, shopId, pid);
    }
    if (cmd === "pd") {
      const pid = parts[2];
      const { data: p } = await supabase().from("shop_products").select("name").eq("id", pid).single();
      return tg.edit(cid, mid, `⚠️ <b>Удалить?</b>\n\n${esc(p?.name || "?")}\n\nЭто необратимо!`,
        ikb([[btn("✅ Да, удалить", `s:py:${pid}`), btn("❌ Отмена", `s:pv:${pid}`)]]));
    }
    if (cmd === "py") {
      const pid = parts[2];
      const { data: p } = await supabase().from("shop_products").select("name").eq("id", pid).single();
      await supabase().from("shop_inventory").delete().eq("product_id", pid);
      await supabase().from("shop_products").delete().eq("id", pid);
      await logAction(shopId, adminId, "delete_product", "product", pid, { name: p?.name });
      return tg.edit(cid, mid, `✅ Товар <b>${esc(p?.name || "")}</b> удалён.`, ikb([[btn("◀️ К товарам", "s:pl:0")]]));
    }
    if (cmd === "pa") {
      await setSession(cid, "ap:t", shopId);
      return tg.send(cid, "📦 <b>Новый товар</b>\n\nВведите название:");
    }
    if (cmd === "pe") {
      const pid = parts[2]; const f = parts[3];
      if (f === "img") {
        await setSession(cid, `ep:img:${pid}`, shopId);
        return tg.send(cid, "🖼 Отправьте фото товара:\n\n/cancel — отмена");
      }
      const labels: Record<string, string> = { n: "название", p: "цену (USD)", s: "остаток (число)", d: "описание", o: "старую цену (USD)", sub: "подзаголовок", f: "особенности (через запятую)" };
      await setSession(cid, `ep:${f}:${pid}`, shopId);
      return tg.send(cid, `✏️ Введите <b>${labels[f] || f}</b>:\n\n/cancel — отмена`);
    }

    // Categories
    if (cmd === "cl") return categoriesList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "cv") return categoryView(tg, cid, mid, shopId, parts[2]);
    if (cmd === "ct") {
      const catId = parts[2];
      const { data: c } = await supabase().from("shop_categories").select("is_active").eq("id", catId).single();
      if (c) { await supabase().from("shop_categories").update({ is_active: !c.is_active }).eq("id", catId); await logAction(shopId, adminId, "toggle_cat", "category", catId); }
      return categoryView(tg, cid, mid, shopId, catId);
    }
    if (cmd === "ca") { await setSession(cid, "ac:n", shopId); return tg.send(cid, "📁 <b>Новая категория</b>\n\nВведите название:"); }
    if (cmd === "ce") {
      const catId = parts[2]; const f = parts[3];
      const labels: Record<string, string> = { n: "название", i: "иконку (emoji)", s: "порядок сортировки" };
      await setSession(cid, `ec:${f}:${catId}`, shopId);
      return tg.send(cid, `✏️ Введите <b>${labels[f] || f}</b>:\n\n/cancel — отмена`);
    }
    if (cmd === "cd") {
      const catId = parts[2];
      const { data: c } = await supabase().from("shop_categories").select("name").eq("id", catId).single();
      return tg.edit(cid, mid, `⚠️ <b>Удалить категорию?</b>\n\n${esc(c?.name || "?")}`,
        ikb([[btn("✅ Удалить", `s:cdy:${catId}`), btn("❌ Отмена", `s:cv:${catId}`)]]));
    }
    if (cmd === "cdy") {
      const catId = parts[2];
      await supabase().from("shop_categories").delete().eq("id", catId);
      await logAction(shopId, adminId, "delete_category", "category", catId);
      return tg.edit(cid, mid, "✅ Категория удалена.", ikb([[btn("◀️ К категориям", "s:cl:0")]]));
    }

    // Category picker for product
    if (cmd === "pc") {
      const pid = parts[2];
      // Store product id in session so category buttons don't need two UUIDs
      await supabase().from("seller_sessions").upsert({ telegram_id: adminId, shop_id: shopId, state: `pc_pick:${pid}` }, { onConflict: "telegram_id,shop_id" });
      const { data: cats } = await supabase().from("shop_categories").select("id, name, icon").eq("shop_id", shopId).eq("is_active", true).order("sort_order");
      if (!cats?.length) return tg.edit(cid, mid, "📁 Нет категорий. Сначала создайте категорию.", ikb([[btn("📁 Создать категорию", "s:ca")], [btn("◀️ К товару", `s:pv:${pid}`)]]));
      const rows: Btn[][] = cats.map(c => [btn(`${c.icon} ${c.name}`, `s:pcs:${c.id}`)]);
      rows.push([btn("🚫 Без категории", `s:pcr`)]);
      rows.push([btn("◀️ К товару", `s:pv:${pid}`)]);
      return tg.edit(cid, mid, "📁 <b>Выберите категорию:</b>", ikb(rows));
    }
    if (cmd === "pcs") {
      const catId = parts[2];
      const { data: sess } = await supabase().from("seller_sessions").select("state").eq("telegram_id", adminId).eq("shop_id", shopId).single();
      const pid = sess?.state?.split(":")?.[1];
      if (!pid) return;
      await supabase().from("shop_products").update({ category_id: catId, updated_at: new Date().toISOString() }).eq("id", pid);
      await logAction(shopId, adminId, "set_category", "product", pid, { category_id: catId });
      return productView(tg, cid, mid, shopId, pid);
    }
    if (cmd === "pcr") {
      const { data: sess } = await supabase().from("seller_sessions").select("state").eq("telegram_id", adminId).eq("shop_id", shopId).single();
      const pid = sess?.state?.split(":")?.[1];
      if (!pid) return;
      await supabase().from("shop_products").update({ category_id: null, updated_at: new Date().toISOString() }).eq("id", pid);
      await logAction(shopId, adminId, "remove_category", "product", pid);
      return productView(tg, cid, mid, shopId, pid);
    }

    // Products in category
    if (cmd === "cprod") {
      const catId = parts[2]; const page = parseInt(parts[3]) || 0;
      const { data: cat } = await supabase().from("shop_categories").select("name, icon").eq("id", catId).single();
      const { data: products } = await supabase().from("shop_products").select("id, name, price, stock, is_active").eq("shop_id", shopId).eq("category_id", catId).order("sort_order");
      if (!products?.length) return tg.edit(cid, mid, `📁 <b>${cat ? `${cat.icon} ${esc(cat.name)}` : "Категория"}</b>\n\nТоваров нет.`, ikb([[btn("◀️ К категории", `s:cv:${catId}`)]]));
      const pg = paginate(products, page, 8);
      let t = `📁 <b>${cat ? `${cat.icon} ${esc(cat.name)}` : "Категория"}</b> — товары (${products.length})\n\n`;
      pg.items.forEach(p => { t += `${p.is_active ? "✅" : "❌"} <b>${esc(p.name)}</b> — $${Number(p.price).toFixed(2)}\n`; });
      const rows: Btn[][] = pg.items.map(p => [btn(`${p.is_active ? "✅" : "❌"} ${safeSlice(p.name, 28)}`, `s:pv:${p.id}`)]);
      if (pg.total > 1) rows.push(pgRow(`s:cprod:${catId}`, pg.page, pg.total));
      rows.push([btn("◀️ К категории", `s:cv:${catId}`)]);
      return tg.edit(cid, mid, t, ikb(rows));
    }


    if (cmd === "ol") return ordersList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "ov") return orderView(tg, cid, mid, shopId, parts[2]);
    if (cmd === "os") return orderSetStatus(tg, cid, mid, shopId, parts[2], parts[3], adminId);

    // Users
    if (cmd === "ul") return usersList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "ulf") {
      const filter = parts[2];
      const page = parseInt(parts[3]) || 0;
      return usersList(tg, cid, mid, shopId, page, filter);
    }
    if (cmd === "usf") {
      return tg.edit(cid, mid, "📊 <b>Фильтр пользователей</b>", ikb([
        [btn("Все", "s:ul:0"), btn("👑 VIP", "s:ulf:vip:0"), btn("🚫 Заблокированные", "s:ulf:blocked:0")],
        [btn("◀️ Назад", "s:ul:0")],
      ]));
    }
    if (cmd === "usq") { await setSession(cid, "us:q", shopId); return tg.send(cid, "🔍 Введите TG ID, username или имя:\n\n/cancel — отмена"); }
    if (cmd === "uv") return userView(tg, cid, mid, shopId, parts[2]);
    if (cmd === "uvt") return userViewByTg(tg, cid, mid, shopId, parseInt(parts[2]));
    if (cmd === "um") {
      const uid = parts[2];
      await setSession(cid, `um:${uid}`, shopId);
      return tg.send(cid, "✍️ Введите сообщение:\n\n/cancel — отмена");
    }

    // User orders
    if (cmd === "uo") {
      const tgId = parseInt(parts[2]); const page = parseInt(parts[3] || "0");
      return userOrdersList(tg, cid, mid, shopId, tgId, page);
    }

    // User balance
    if (cmd === "ub") return balanceMenu(tg, cid, mid, shopId, parseInt(parts[2]));
    if (cmd === "ubc") { const tgId = parts[2]; await setSession(cid, `bal:c:${tgId}`, shopId); return tg.send(cid, "➕ Введите сумму для начисления:\n\n/cancel — отмена"); }
    if (cmd === "ubd") { const tgId = parts[2]; await setSession(cid, `bal:d:${tgId}`, shopId); return tg.send(cid, "➖ Введите сумму для списания:\n\n/cancel — отмена"); }
    if (cmd === "ubs") { const tgId = parts[2]; await setSession(cid, `bal:s:${tgId}`, shopId); return tg.send(cid, "🎯 Введите новое значение баланса:\n\n/cancel — отмена"); }

    // User role (now using shop_customers)
    if (cmd === "ur") {
      const tgId = parseInt(parts[2]);
      return tg.edit(cid, mid, `🏷 <b>Изменить роль</b> — TG ${tgId}`, ikb([
        [btn("👤 user", `s:urs:${tgId}:user`), btn("👑 vip", `s:urs:${tgId}:vip`), btn("🚫 blocked", `s:urs:${tgId}:blocked`)],
        [btn("◀️ Назад", `s:uvt:${tgId}`)],
      ]));
    }
    if (cmd === "urs") {
      const tgId = parseInt(parts[2]); const role = parts[3];
      await supabase().from("shop_customers").update({ role, updated_at: new Date().toISOString() }).eq("shop_id", shopId).eq("telegram_id", tgId);
      await logAction(shopId, adminId, "set_role", "user", String(tgId), { role });
      return userViewByTg(tg, cid, mid, shopId, tgId);
    }

    // User block/unblock (now using shop_customers)
    if (cmd === "ux") {
      const tgId = parseInt(parts[2]);
      const { data: u } = await supabase().from("shop_customers").select("is_blocked").eq("shop_id", shopId).eq("telegram_id", tgId).maybeSingle();
      if (u) {
        const newVal = !u.is_blocked;
        await supabase().from("shop_customers").update({ is_blocked: newVal, updated_at: new Date().toISOString() }).eq("shop_id", shopId).eq("telegram_id", tgId);
        await logAction(shopId, adminId, newVal ? "block_user" : "unblock_user", "user", String(tgId));
      }
      return userViewByTg(tg, cid, mid, shopId, tgId);
    }

    // User note
    if (cmd === "un") {
      const tgId = parts[2];
      await setSession(cid, `un:${tgId}`, shopId);
      return tg.send(cid, "📝 Введите заметку:\n\n/cancel — отмена");
    }

    // User logs
    if (cmd === "ula") {
      const tgId = parseInt(parts[2]); const page = parseInt(parts[3] || "0");
      return userLogsList(tg, cid, mid, shopId, tgId, page);
    }

    // Promocodes
    if (cmd === "prl") return promosList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "prv") return promoView(tg, cid, mid, shopId, parts[2]);
    if (cmd === "pra") { await setSession(cid, "pr:c", shopId); return tg.send(cid, "🎟 <b>Новый промокод</b>\n\nВведите код:"); }
    if (cmd === "prt") {
      const prId = parts[2];
      const { data: p } = await supabase().from("shop_promocodes").select("is_active").eq("id", prId).single();
      if (p) { await supabase().from("shop_promocodes").update({ is_active: !p.is_active }).eq("id", prId); await logAction(shopId, adminId, "toggle_promo", "promocode", prId); }
      return promoView(tg, cid, mid, shopId, prId);
    }
    if (cmd === "prd") {
      const prId = parts[2];
      const { data: p } = await supabase().from("shop_promocodes").select("code").eq("id", prId).single();
      return tg.edit(cid, mid, `⚠️ <b>Удалить промокод?</b>\n\n<code>${esc(p?.code || "?")}</code>`,
        ikb([[btn("✅ Удалить", `s:prdy:${prId}`), btn("❌ Отмена", `s:prv:${prId}`)]]));
    }
    if (cmd === "prdy") {
      const prId = parts[2];
      await supabase().from("shop_promocodes").delete().eq("id", prId);
      await logAction(shopId, adminId, "delete_promo", "promocode", prId);
      return tg.edit(cid, mid, "✅ Промокод удалён.", ikb([[btn("◀️ К промокодам", "s:prl:0")]]));
    }

    // Stats, Settings, Logs, Stock, OP
    if (cmd === "st") return statsView(tg, cid, mid, shopId);
    if (cmd === "se") return settingsView(tg, cid, mid, shopId);

    // OP subscription settings
    if (cmd === "opsettings") {
      const { data: s } = await supabase().from("shops").select("is_subscription_required, required_channel_link, required_channel_id").eq("id", shopId).single();
      const enabled = s?.is_subscription_required || false;
      const ch = s?.required_channel_id || "не указан";
      const lnk = s?.required_channel_link || "—";
      let t = `📢 <b>Обязательная подписка (ОП)</b>\n\n`;
      t += `Статус: <b>${enabled ? "✅ включена" : "❌ выключена"}</b>\n`;
      t += `Канал: <b>${esc(ch)}</b>\n`;
      t += `Ссылка: ${esc(lnk)}\n\n`;
      t += `Когда включено, пользователь должен подписаться на канал перед использованием магазина.\n\n`;
      t += `⚠️ Бот магазина должен быть добавлен в канал как администратор.`;
      return tg.edit(cid, mid, t, ikb([
        [btn(enabled ? "❌ Выключить" : "✅ Включить", "s:optoggle")],
        [btn("📢 Указать канал", "s:opsetc")],
        [btn("🔍 Проверить бота", "s:optest")],
        [btn("◀️ К настройкам", "s:se")],
      ]));
    }
    if (cmd === "optoggle") {
      const { data: s } = await supabase().from("shops").select("is_subscription_required").eq("id", shopId).single();
      const newVal = !(s?.is_subscription_required);
      await supabase().from("shops").update({ is_subscription_required: newVal, updated_at: new Date().toISOString() }).eq("id", shopId);
      await logAction(shopId, adminId, newVal ? "enable_op" : "disable_op", "shop", shopId);
      // Re-render OP settings
      const { data: s2 } = await supabase().from("shops").select("is_subscription_required, required_channel_link, required_channel_id").eq("id", shopId).single();
      const enabled = s2?.is_subscription_required || false;
      const ch = s2?.required_channel_id || "не указан";
      const lnk = s2?.required_channel_link || "—";
      let t = `📢 <b>Обязательная подписка (ОП)</b>\n\n`;
      t += `Статус: <b>${enabled ? "✅ включена" : "❌ выключена"}</b>\n`;
      t += `Канал: <b>${esc(ch)}</b>\n`;
      t += `Ссылка: ${esc(lnk)}\n\n`;
      t += `⚠️ Бот магазина должен быть добавлен в канал как администратор.`;
      return tg.edit(cid, mid, t, ikb([
        [btn(enabled ? "❌ Выключить" : "✅ Включить", "s:optoggle")],
        [btn("📢 Указать канал", "s:opsetc")],
        [btn("🔍 Проверить бота", "s:optest")],
        [btn("◀️ К настройкам", "s:se")],
      ]));
    }
    if (cmd === "opsetc") {
      await setSession(cid, "s_set_op_channel", shopId, {});
      return tg.edit(cid, mid, "📢 <b>Укажите канал</b>\n\nОтправьте @username канала, ссылку (t.me/...) или числовой chat_id:\n\nПример: <code>@mychannel</code>", ikb([[btn("❌ Отмена", "s:se")]]));
    }
    if (cmd === "optest") {
      // Test if bot can access getChatMember on the configured channel
      const { data: s } = await supabase().from("shops").select("required_channel_id").eq("id", shopId).single();
      if (!s?.required_channel_id) {
        return tg.edit(cid, mid, "❌ Канал не указан. Сначала укажите канал.", ikb([[btn("📢 Указать канал", "s:opsetc")], [btn("◀️ Назад", "s:opsettings")]]));
      }
      try {
        const testRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: s.required_channel_id, user_id: adminId }),
        }).then(r => r.json());
        if (testRes.ok) {
          return tg.edit(cid, mid, `✅ Бот имеет доступ к каналу <b>${esc(s.required_channel_id)}</b>\n\nСтатус вашего членства: <b>${testRes.result.status}</b>`,
            ikb([[btn("◀️ Назад", "s:opsettings")]]));
        } else {
          return tg.edit(cid, mid, `❌ <b>Ошибка:</b> ${esc(testRes.description || "Бот не имеет доступа к каналу")}\n\n⚠️ Убедитесь что бот добавлен в канал как администратор.`,
            ikb([[btn("🔄 Повторить", "s:optest"), btn("◀️ Назад", "s:opsettings")]]));
        }
      } catch (e) {
        return tg.edit(cid, mid, `❌ Ошибка проверки: ${(e as Error).message}`, ikb([[btn("◀️ Назад", "s:opsettings")]]));
      }
    }
    // OP check callback from user subscription gate
    if (cmd === "opcheck") {
      // This is for non-admin users, handled below in the main flow
      // But since callbacks go through admin check first, we need special handling
    }
    if (cmd === "se") return settingsView(tg, cid, mid, shopId);
    if (cmd === "lg") return logsList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "sk") return stockOverview(tg, cid, mid, shopId, parseInt(parts[2]) || 0);

    // Edit shop field
    if (cmd === "edit") {
      const field = parts[2];
      const labels: Record<string, string> = {
        name: "📛 название магазина", color: "🎨 HEX цвет (например #FF5500)",
        hero_title: "📌 заголовок витрины", hero_desc: "📝 описание витрины",
        welcome: "👋 приветственное сообщение (HTML: &lt;b&gt;, &lt;i&gt;, &lt;a&gt;, {name} для имени)", support: "🔗 ссылку на поддержку",
      };
      await setSession(cid, "s_edit_field", shopId, { field });
      const extra = field === "welcome" ? "\n\n💡 Сообщение заменяет стартовый текст полностью.\nПоддерживается HTML: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;a href=\"\"&gt;\nИспользуйте <code>{name}</code> для имени пользователя." : "";
      return tg.edit(cid, mid, `✏️ Введи новое ${labels[field] || field}:${extra}`, ikb([[btn("❌ Отмена", "s:se")]]));
    }

    if (cmd === "setcb") {
      await setSession(cid, "s_set_cryptobot", shopId, {});
      await tg.deleteMessage(cid, mid).catch(() => null);
      return tg.send(
        cid,
        "💰 <b>Подключение CryptoBot</b>\n\nОтправь API-токен от @CryptoBot:\n\n⏱ <b>Настройка займёт всего 3 минуты.</b>\n\n⚠️ Токен будет зашифрован.",
        ikb([
          [{ text: "📖 Инструкция — 3 минуты", url: "https://telegra.ph/Nastrojka-oplaty--3-minuty-03-16" }],
          [btn("❌ Отмена", "s:se")],
        ]),
      );
    }

    // Inventory
    if (cmd === "iv") {
      const pid = parts[2]; const page = parseInt(parts[3] || "0");
      return inventoryView(tg, cid, mid, shopId, pid, page);
    }
    if (cmd === "ia") {
      const pid = parts[2];
      await setSession(cid, `ai:${pid}`, shopId);
      return tg.send(cid, "🗃 <b>Добавление единиц</b>\n\nОтправьте ключи/аккаунты, каждый с новой строки.\n\n💡 Для загрузки файлов используйте ссылку на Яндекс Диск / Google Drive / другое внешнее хранилище.\n\n/cancel — отмена");
    }
    if (cmd === "is") return inventorySync(tg, cid, mid, shopId, parts[2], adminId);

    // Broadcast
    if (cmd === "bc") return broadcastMenu(tg, cid, mid, shopId);
    if (cmd === "bs") { await setSession(cid, "bc:t", shopId); return tg.send(cid, "📢 Введите текст рассылки (поддерживается HTML: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;a&gt;) или отправьте фото с подписью:\n\n/cancel — отмена"); }
    if (cmd === "bcsend") {
      const session = await getSession(cid, shopId);
      if (!session || session.state !== "bc:preview") return;
      const sd = session.data;
      // Use shop_customers for broadcast recipients
      const { data: customers } = await supabase().from("shop_customers").select("telegram_id").eq("shop_id", shopId);
      const uniqueIds = [...new Set(customers?.map(c => c.telegram_id) || [])];
      if (!uniqueIds.length) { await clearSession(cid); return tg.send(cid, "❌ Нет покупателей."); }
      let ok = 0, fail = 0;
      for (const uid of uniqueIds) {
        try {
          let r;
          if (sd.photoId) {
            r = await tg.sendPhoto(uid as number, sd.photoId as string, (sd.text as string) || "");
          } else {
            r = await tg.send(uid as number, sd.text as string);
          }
          if (r.ok) ok++; else fail++;
        } catch { fail++; }
      }
      await logAction(shopId, adminId, "broadcast", "broadcast", undefined, { ok, fail, total: uniqueIds.length });
      await clearSession(cid);
      return tg.send(cid, `📢 <b>Рассылка завершена!</b>\n\n✅ ${ok}\n❌ ${fail}\n📊 ${uniqueIds.length}`, ikb([[btn("◀️ Меню", "s:m")]]));
    }
    if (cmd === "bcedit") { await setSession(cid, "bc:t", shopId); return tg.send(cid, "✏️ Введите новый текст рассылки:\n\n/cancel — отмена"); }
    if (cmd === "bccancel") { await clearSession(cid); return tg.send(cid, "❌ Рассылка отменена.", ikb([[btn("◀️ Меню", "s:m")]])); }

    // Reviews
    if (cmd === "rvl") return reviewsList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "rvf") {
      const filter = parts[2];
      const page = parseInt(parts[3]) || 0;
      return reviewsList(tg, cid, mid, shopId, page, filter);
    }
    if (cmd === "rva") {
      const rid = parts[2];
      await supabase().from("shop_reviews").update({ verified: true, moderation_status: "approved" }).eq("id", rid);
      await logAction(shopId, adminId, "approve_review", "review", rid);
      return reviewsList(tg, cid, mid, shopId, 0);
    }
    if (cmd === "rvr") {
      const rid = parts[2];
      await supabase().from("shop_reviews").update({ moderation_status: "rejected" }).eq("id", rid);
      await logAction(shopId, adminId, "reject_review", "review", rid);
      return reviewsList(tg, cid, mid, shopId, 0);
    }
    if (cmd === "rvv") {
      const rid = parts[2];
      const { data: r } = await supabase().from("shop_reviews").select("*").eq("id", rid).single();
      if (!r) return;
      const t = `⭐ <b>Отзыв</b>\n\n👤 ${esc(r.author)}\n${"⭐".repeat(r.rating)}\n\n${esc(r.text)}\n\n📅 ${new Date(r.created_at).toLocaleDateString("ru-RU")}`;
      return tg.edit(cid, mid, t, ikb([
        [btn("✅ Одобрить", `s:rva:${rid}`), btn("❌ Отклонить", `s:rvr:${rid}`)],
        [btn("🗑 Удалить", `s:rvd:${rid}`)],
        [btn("◀️ К отзывам", "s:rvl:0")],
      ]));
    }
    if (cmd === "rvd") {
      const rid = parts[2];
      await supabase().from("shop_reviews").delete().eq("id", rid);
      await logAction(shopId, adminId, "delete_review", "review", rid);
      return reviewsList(tg, cid, mid, shopId, 0);
    }

  } catch (e) {
    console.error("Callback error:", e);
  }
}

// ═══════════════════════════════════════════════
// MAIN SERVE
// ═══════════════════════════════════════════════
serve(async (req) => {
  // Reset singleton per request
  _db = null;

  if (req.method === "OPTIONS") {
    return new Response(null, { headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" } });
  }

  try {
    const url = new URL(req.url);
    const shopId = url.searchParams.get("shop_id");
    

    if (!shopId) {
      console.error("seller-bot-webhook: no shop_id");
      return new Response("Missing shop_id", { status: 400 });
    }

    // Verify webhook secret
    const secret = Deno.env.get("TELEGRAM_WEBHOOK_SECRET");
    if (!secret) {
      return new Response("Webhook secret is not configured", { status: 500 });
    }
    const headerSecret = req.headers.get("x-telegram-bot-api-secret-token");
    if (headerSecret !== secret) {
      console.error("seller-bot-webhook: invalid secret");
      return new Response("Forbidden", { status: 403 });
    }

    // Parse body once upfront
    const body = await req.json();
    const updateId = body?.update_id;
    if (updateId !== undefined && updateId !== null) {
      const dedupIdentifier = `seller_webhook:${shopId}:${String(updateId)}`;
      const { count } = await supabase()
        .from("rate_limits")
        .select("id", { count: "exact", head: true })
        .eq("identifier", dedupIdentifier)
        .eq("action", "webhook_update")
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());
      if ((count || 0) > 0) return new Response("ok");
      await supabase().from("rate_limits").insert({ identifier: dedupIdentifier, action: "webhook_update" });
    }

    // Load shop and decrypt bot token
    const { data: shop, error: shopErr } = await supabase().from("shops").select("id, name, slug, bot_token_encrypted, welcome_message, support_link, status, owner_id, is_subscription_required, required_channel_id, required_channel_link").eq("id", shopId).single();
    console.log("seller-bot-webhook: shop loaded, status:", shop?.status, "error:", !!shopErr);
    if (!shop) {
      console.error("seller-bot-webhook: shop not found", shopId);
      return new Response("ok");
    }
    // If shop is inactive, notify the user instead of silently ignoring
    if (shop.status !== "active") {
      console.log("seller-bot-webhook: shop inactive, status:", shop.status);
      if (shop.bot_token_encrypted) {
        const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
        if (encKey) {
          try {
            const { data: rawToken } = await supabase().rpc("decrypt_token", { p_encrypted: shop.bot_token_encrypted, p_key: encKey });
            if (rawToken) {
              const chatId = body.message?.chat?.id || body.callback_query?.message?.chat?.id || body.callback_query?.from?.id;
              if (chatId) {
                await fetch(`https://api.telegram.org/bot${rawToken}/sendMessage`, {
                  method: "POST", headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ chat_id: chatId, text: "⚠️ Магазин временно недоступен. Обратитесь в поддержку.", parse_mode: "HTML" }),
                });
              }
            }
          } catch (e) { console.error("seller-bot-webhook: failed to send inactive message", e); }
        }
      }
      return new Response("ok");
    }

    if (!shop.bot_token_encrypted) {
      console.error("seller-bot-webhook: no bot token for shop", shopId);
      return new Response("ok");
    }

    const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!encKey) {
      console.error("seller-bot-webhook: TOKEN_ENCRYPTION_KEY not set");
      return new Response("ok");
    }

    const { data: botToken } = await supabase().rpc("decrypt_token", { p_encrypted: shop.bot_token_encrypted, p_key: encKey });
    if (!botToken) {
      console.error("seller-bot-webhook: failed to decrypt bot token");
      return new Response("ok");
    }

    const tg = TG(botToken);
    const msg = body.message;
    const cb = body.callback_query;

    // ─── Callback query ─────────────────────
    if (cb) {
      const chatId = cb.message?.chat?.id || cb.from?.id;
      const msgId = cb.message?.message_id;
      const data = cb.data;

      // Handle OP check callback for ANY user (not just admin)
      if (chatId && msgId && data === "s:opcheck") {
        await tg.answer(cb.id);
        if (shop.is_subscription_required && shop.required_channel_id) {
          try {
            const memberRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: shop.required_channel_id, user_id: chatId }),
            }).then(r => r.json());
            if (memberRes.ok && ["member", "administrator", "creator"].includes(memberRes.result.status)) {
              // Subscribed — show normal start
              const shopUrl = `${WEBAPP_DOMAIN}/shop/${shop.id}`;
              const welcomeText = shop.welcome_message
                ? escHtmlWelcome(shop.welcome_message, cb.from?.first_name || "друг")
                : `👋 Привет, <b>${esc(cb.from?.first_name || "друг")}</b>!\n\nДобро пожаловать в ${esc(shop.name)}!`;
              const supportUrl = shop.support_link ? (shop.support_link.startsWith("http") ? shop.support_link : `https://${shop.support_link}`) : null;
              await tg.edit(chatId, msgId, welcomeText, {
                inline_keyboard: [
                  [{ text: "🛍 Открыть магазин", web_app: { url: shopUrl } }],
                  ...(supportUrl ? [[{ text: "🆘 Поддержка", url: supportUrl }]] : []),
                ],
              });
            } else {
              await tg.answer(cb.id, "❌ Вы ещё не подписаны на канал!");
            }
          } catch {
            await tg.answer(cb.id, "❌ Ошибка проверки подписки");
          }
        }
        return new Response("ok");
      }

      if (chatId && msgId && data && data.startsWith("s:")) {
        const owner = await isShopOwner(shopId, chatId);
        if (!owner) {
          await tg.answer(cb.id, "⛔ Нет доступа");
          return new Response("ok");
        }
        try {
          await handleCallback(tg, chatId, msgId, data, cb.id, shopId, chatId, botToken);
        } catch (cbErr) {
          console.error("seller-bot-webhook: callback error:", cbErr, "data:", data);
          try { await tg.answer(cb.id, "❌ Ошибка обработки"); } catch {}
        }
      }
      return new Response("ok");
    }

    if (!msg) return new Response("ok");

    const chatId = msg.chat.id;
    const text = (msg.text || msg.caption || "").trim();
    const photo = msg.photo || null;
    const firstName = msg.from?.first_name || "друг";

    // ─── /admin command ─────────────────────
    if (text === "/admin") {
      const owner = await isShopOwner(shopId, chatId);
      if (!owner) {
        await tg.send(chatId, "⛔ У вас нет доступа к админ-панели этого магазина.");
        return new Response("ok");
      }
      await clearSession(chatId, shopId);
      await adminHome(tg, chatId, shopId);
      return new Response("ok");
    }

    // ─── /start command — MUST be before FSM so commands always take priority ───
    if (text === "/start" || text.startsWith("/start ")) {
      // Create shop customer profile (tenant-scoped)
      if (msg.from) {
        await ensureShopCustomer(shopId, {
          id: msg.from.id,
          first_name: msg.from.first_name,
          last_name: msg.from.last_name,
          username: msg.from.username,
          is_premium: msg.from.is_premium || false,
          language_code: msg.from.language_code,
        });
      }

      // Clear any active admin FSM session so /start is a clean entry point
      await clearSession(chatId, shopId);

      // ─── Subscription gate (OP check) ─────
      if (shop.is_subscription_required && shop.required_channel_id) {
        // Skip OP check for shop owner
        const isOwner = await isShopOwner(shopId, chatId);
        if (!isOwner) {
          try {
            const memberRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: shop.required_channel_id, user_id: chatId }),
            }).then(r => r.json());
            const isSubscribed = memberRes.ok && ["member", "administrator", "creator"].includes(memberRes.result?.status);
            if (!isSubscribed) {
              const subLink = shop.required_channel_link || `https://t.me/${String(shop.required_channel_id).replace("@", "")}`;
              await tg.send(chatId,
                `📢 <b>Для доступа к магазину подпишитесь на канал</b>\n\nПосле подписки нажмите «✅ Проверить».`,
                { inline_keyboard: [
                  [{ text: "📢 Подписаться", url: subLink }],
                  [{ text: "✅ Проверить", callback_data: "s:opcheck" }],
                ]});
              return new Response("ok");
            }
          } catch (opErr) {
            console.error("OP check error:", opErr);
            // If OP check fails (bot not in channel), let user through with warning
          }
        }
      }

      const shopUrl = `${WEBAPP_DOMAIN}/shop/${shop.id}`;

      // Sanitize welcome message — strip raw HTML to prevent injection
      let greeting: string;
      if (shop.welcome_message) {
        greeting = escHtmlWelcome(shop.welcome_message, firstName);
      } else {
        greeting = `👋 Привет, <b>${esc(firstName)}</b>!\n\nДобро пожаловать в <b>${esc(shop.name)}</b>! 🛍`;
      }

      const supportUrl = shop.support_link
        ? (shop.support_link.startsWith("http") ? shop.support_link : `https://${shop.support_link}`)
        : null;

      // Shop-specific custom buttons
      const customRows: Btn[][] = [];
      if (shopId === "d83f8cdb-850c-4b70-af24-0a205620089b") {
        customRows.push([{ text: "❗Важно", url: "https://telegra.ph/VIETO-STORE--FAQ-03-30" }]);
      }

      await tg.send(chatId, greeting, {
        inline_keyboard: [
          [{ text: "🛍 Открыть магазин", web_app: { url: shopUrl } }],
          ...customRows,
          ...(supportUrl ? [[{ text: "🆘 Поддержка", url: supportUrl }]] : []),
        ],
      });
      return new Response("ok");
    }

    // ─── /help — before FSM ─────────────────
    if (text === "/help") {
      const shopUrl = `${WEBAPP_DOMAIN}/shop/${shop.id}`;
      const supportUrl = shop.support_link
        ? (shop.support_link.startsWith("http") ? shop.support_link : `https://${shop.support_link}`)
        : null;

      await tg.send(chatId,
        `ℹ️ <b>${esc(shop.name)}</b>\n\nЭто бот магазина ${esc(shop.name)}.\nНажмите кнопку ниже чтобы открыть витрину.`,
        {
          inline_keyboard: [
            [{ text: "🛍 Открыть магазин", web_app: { url: shopUrl } }],
            ...(supportUrl ? [[{ text: "🆘 Поддержка", url: supportUrl }]] : []),
          ],
        },
      );
      return new Response("ok");
    }

    // ─── /cancel — before FSM ───────────────
    if (text === "/cancel") {
      const owner = await isShopOwner(shopId, chatId);
      await clearSession(chatId, shopId);
      if (owner) {
        await tg.send(chatId, "❌ Отменено.", ikb([[btn("◀️ Меню", "s:m")]]));
      }
      return new Response("ok");
    }

    // ─── FSM text handler (admin) — AFTER command checks ───
    const owner = await isShopOwner(shopId, chatId);
    if (owner) {
      const handled = await handleFSM(tg, chatId, text, photo, shopId, chatId);
      if (handled) return new Response("ok");
    }

    // ─── Default ────────────────────────────
    const shopUrl = `${WEBAPP_DOMAIN}/shop/${shop.id}`;
    await tg.send(chatId, `Используйте кнопку ниже для перехода в магазин 👇`, {
      inline_keyboard: [[{ text: "🛍 Открыть магазин", web_app: { url: shopUrl } }]],
    });

    return new Response("ok");
  } catch (e) {
    console.error("seller-bot-webhook error:", e);
    return new Response("error", { status: 500 });
  }
});
