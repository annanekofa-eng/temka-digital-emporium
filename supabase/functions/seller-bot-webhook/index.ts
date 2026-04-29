import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ─── Supabase (singleton per request) ─────
let _db: ReturnType<typeof createClient> | null = null;
const supabase = () => {
  if (!_db) _db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  return _db;
};

/** Strip bot tokens from error messages */
function maskToken(s: string): string {
  return s.replace(/bot\d+:[A-Za-z0-9_-]+/g, "bot***:***");
}

const TG = (token: string) => {
  const call = async (method: string, body: Record<string, unknown>) => {
    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return await res.json();
    } catch (e) {
      console.error(`TG API call failed (${method}):`, maskToken(String(e)));
      return { ok: false, description: `Network error: ${method}` };
    }
  };
  return {
    send: (chatId: number, text: string, markup?: unknown) =>
      call("sendMessage", {
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(markup ? { reply_markup: markup } : {}),
      }),
    edit: (chatId: number, msgId: number, text: string, markup?: unknown) =>
      call("editMessageText", {
        chat_id: chatId,
        message_id: msgId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true,
        ...(markup ? { reply_markup: markup } : {}),
      }).then((r) => {
        if (!r.ok) console.error("editMessageText failed:", JSON.stringify(r));
        return r;
      }),
    answer: (cbId: string, text?: string) =>
      call("answerCallbackQuery", { callback_query_id: cbId, ...(text ? { text, show_alert: true } : {}) }),
    sendPhoto: (chatId: number, photo: string, caption: string, markup?: unknown) =>
      call("sendPhoto", {
        chat_id: chatId,
        photo,
        caption,
        parse_mode: "HTML",
        ...(markup ? { reply_markup: markup } : {}),
      }),
    getFile: (fileId: string) =>
      fetch(`https://api.telegram.org/bot${token}/getFile`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ file_id: fileId }),
      }).then((r) => r.json()),
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

/** Cached username of the platform bot. Resolved via getMe on first use. */
let _platformBotUsername: string | null = null;
async function getPlatformBotUsername(): Promise<string> {
  if (_platformBotUsername !== null) return _platformBotUsername;
  const fromEnv = (Deno.env.get("PLATFORM_BOT_USERNAME") || "").replace(/^@/, "").trim();
  if (fromEnv) {
    _platformBotUsername = fromEnv;
    return _platformBotUsername;
  }
  const token = Deno.env.get("PLATFORM_BOT_TOKEN") || "";
  if (!token) {
    _platformBotUsername = "";
    return "";
  }
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`);
    const j = await r.json();
    _platformBotUsername = (j?.result?.username || "").replace(/^@/, "");
  } catch (_e) {
    _platformBotUsername = "";
  }
  return _platformBotUsername || "";
}
/** Button that opens the platform bot (for Premium upsell etc). Falls back to a t.me search link. */
async function premiumUpsellBtn(text = "💎 Перейти на Премиум"): Promise<Btn> {
  const username = await getPlatformBotUsername();
  if (username) {
    return { text, url: `https://t.me/${username}?start=premium` };
  }
  // Last-resort fallback: still a URL button so the click does something
  return { text, url: "https://t.me/" };
}
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
const SHOP_AVATAR_SYSTEM_PROMPT = `Ты — арт-директор Telegram-магазинов. Создай готовую аватарку магазина, а не общий арт.
Формат: квадрат 1:1, композиция должна оставаться читаемой внутри круглой аватарки 64×64.
Обязательно используй название магазина как главный брендовый элемент: добавь точную крупную надпись с названием, если оно короткое; если название длинное — сделай короткий читаемый бейдж или монограмму и сохрани полное название в стиле бренда, когда пользователь явно просит title/name.
Текст на изображении должен быть без ошибок, без лишних слов, без водяных знаков, без чужих логотипов и без мелкого нечитаемого текста.
Стиль: премиальный e-commerce, чистые формы, выразительный силуэт, аккуратный свет, контрастный фон.
Выбирай визуальную метафору строго по нише магазина. Если пользователь просит game/esports — делай игровую эмблему/маскота и крупный заголовок магазина.
Качество: crisp icon, polished, 4K.`;

function buildAvatarPrompt(shopName: string | null | undefined, prompt: string, isEdit: boolean): string {
  const name = (shopName || "").trim();
  const nameInstruction = name
    ? `Название магазина: "${name}". Напиши это название на аватарке точно так же, без перевода и без опечаток.`
    : "Название магазина не найдено — если пользователь указал название в описании, используй его как крупный заголовок.";
  const mode = isEdit ? "Внеси изменения в существующую картинку согласно описанию, сохрани бренд и читаемое название магазина." : "Создай новую аватарку магазина.";
  return `${SHOP_AVATAR_SYSTEM_PROMPT}\n\n${mode}\n${nameInstruction}\nОписание пользователя: ${prompt}`;
}

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

async function fetchUsdtRubRate(cryptobotToken: string): Promise<number> {
  for (const base of ["https://pay.crypt.bot/api", "https://testnet-pay.crypt.bot/api"]) {
    try {
      const res = await fetch(`${base}/getExchangeRates`, {
        headers: { "Crypto-Pay-API-Token": cryptobotToken },
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) continue;
      const data = await res.json();
      const row = data?.result?.find((r: any) => r.source === "USDT" && r.target === "RUB" && r.is_valid);
      if (row?.rate) return Number(row.rate);
    } catch {
      // try next endpoint
    }
  }
  throw new Error("Не удалось получить курс USDT/RUB из CryptoBot");
}

function parsePriceInput(raw: string): { value: number; currency: "usd" | "rub" } | null {
  const v = raw.trim().replace(",", ".");
  const m = v.match(/^([0-9]+(?:\.[0-9]{1,2})?)\s*(USD|RUB)?$/i);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const cur = (m[2] || "USD").toLowerCase() as "usd" | "rub";
  return { value: n, currency: cur };
}

// ─── Admin log helper ──────────────────────
async function logAction(
  shopId: string,
  adminTgId: number,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: Record<string, unknown>,
) {
  await supabase()
    .from("shop_admin_logs")
    .insert({
      shop_id: shopId,
      admin_telegram_id: adminTgId,
      action,
      entity_type: entityType || null,
      entity_id: entityId || null,
      details: details || {},
    });
}

// ─── Session FSM (fully isolated via seller_sessions with composite PK) ───
async function getSession(tgId: number, shopId: string) {
  const { data } = await supabase()
    .from("seller_sessions")
    .select("*")
    .eq("telegram_id", tgId)
    .eq("shop_id", shopId)
    .maybeSingle();
  if (!data) return null;
  return data as { telegram_id: number; shop_id: string; state: string; data: Record<string, unknown> };
}
async function setSession(tgId: number, state: string, shopId: string, data: Record<string, unknown> = {}) {
  await supabase()
    .from("seller_sessions")
    .upsert(
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

// ─── Check if user is shop owner or admin ─────────────
async function isShopOwner(shopId: string, telegramId: number): Promise<boolean> {
  // Check if primary owner
  const { data: shop } = await supabase().from("shops").select("owner_id").eq("id", shopId).single();
  if (shop) {
    const { data: user } = await supabase()
      .from("platform_users")
      .select("id")
      .eq("telegram_id", telegramId)
      .maybeSingle();
    if (user && shop.owner_id === user.id) return true;
  }
  // Check if admin in shop_customers
  const { data: cust } = await supabase()
    .from("shop_customers")
    .select("role")
    .eq("shop_id", shopId)
    .eq("telegram_id", telegramId)
    .maybeSingle();
  return cust?.role === "admin";
}

// ─── Ensure shop customer exists (tenant-scoped) ──────────
async function ensureShopCustomer(
  shopId: string,
  tgUser: {
    id: number;
    first_name?: string;
    last_name?: string;
    username?: string;
    is_premium?: boolean;
    language_code?: string;
  },
) {
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

  const hasPremium = await shopOwnerHasPremium(shopId);
  const text =
    `🔧 <b>Админ-панель: ${esc(shop.name)}</b>\n\n` +
    `📊 Статус: ${shop.status === "active" ? "активен 🟢" : "остановлен 🔴"}\n` +
    `📦 Товаров: ${productCount || 0}\n` +
    `📂 Категорий: ${categoryCount || 0}\n` +
    `🛍 Заказов: ${orderCount || 0}\n\nВыберите раздел:`;

  const autoBtn = hasPremium
    ? btn("🤖 Авто-товары", "s:ap")
    : btn("🔒 Авто-товары (Премиум)", "s:ap");
  const aiBtn = hasPremium
    ? btn("🪄 AI-аватарка", "s:aiav")
    : btn("🔒 AI-аватарка (Премиум)", "s:upsell:premium");
  const kb = ikb([
    [aiBtn],
    [btn("📦 Товары", "s:pl:0"), btn("📁 Категории", "s:cl:0")],
    [btn("🛒 Заказы", "s:ol:0"), btn("👥 Пользователи", "s:ul:0")],
    [btn("🧾 Заявки", "s:rql:0")],
    [btn("📊 Статистика", "s:st"), btn("🎟 Промокоды", "s:prl:0")],
    [btn("🗃 Склад", "s:sk:0"), btn("📋 Логи", "s:lg:0")],
    [btn("⚙️ Настройки", "s:se"), btn("📢 Рассылка", "s:bc")],
    [btn("⭐ Отзывы", "s:rvl:0")],
    [autoBtn, btn("📲 Авто-заказы", "s:ao:0")],
  ]);

  if (msgId) return tg.edit(chatId, msgId, text, kb);
  return tg.send(chatId, text, kb);
}

// ═══════════════════════════════════════════════
// PRODUCTS
// ═══════════════════════════════════════════════
async function productsList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number) {
  const { data: products } = await supabase()
    .from("shop_products")
    .select("id, name, price, stock, is_active")
    .eq("shop_id", shopId)
    .order("sort_order")
    .order("created_at", { ascending: false });
  if (!products?.length) {
    return tg.edit(
      cid,
      mid,
      "📦 <b>Товары</b>\n\nТоваров нет.",
      ikb([[btn("➕ Добавить", "s:pa")], [btn("◀️ Меню", "s:m")]]),
    );
  }
  const pg = paginate(products, page, 8);
  let t = `📦 <b>Товары</b> (${products.length})\n\n`;
  pg.items.forEach((p) => {
    const s = p.is_active ? "✅" : "❌";
    t += `${s} <b>${esc(p.name)}</b>\n💰 $${Number(p.price).toFixed(2)} | 📦 ${p.stock}\n\n`;
  });
  const rows: Btn[][] = pg.items.map((p) => [
    btn(`${p.is_active ? "✅" : "❌"} ${safeSlice(p.name, 28)}`, `s:pv:${p.id}`),
  ]);
  if (pg.total > 1) rows.push(pgRow("s:pl", pg.page, pg.total));
  rows.push([btn("➕ Добавить", "s:pa"), btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function productView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, pid: string) {
  const { data: p } = await supabase().from("shop_products").select("*").eq("id", pid).single();
  if (!p) return tg.edit(cid, mid, "❌ Товар не найден", ikb([[btn("◀️ Назад", "s:pl:0")]]));
  const [{ count: invCount }, catData] = await Promise.all([
    supabase()
      .from("shop_inventory")
      .select("id", { count: "exact", head: true })
      .eq("product_id", pid)
      .eq("status", "available"),
    p.category_id
      ? supabase().from("shop_categories").select("name, icon").eq("id", p.category_id).single()
      : Promise.resolve({ data: null }),
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
  return tg.edit(
    cid,
    mid,
    t,
    ikb([
      [btn("✏️ Название", `s:pe:${pid}:n`), btn("✏️ Цена", `s:pe:${pid}:p`)],
      [btn("✏️ Остаток", `s:pe:${pid}:s`), btn("✏️ Описание", `s:pe:${pid}:d`)],
      [btn("✏️ Стар.цена", `s:pe:${pid}:o`), btn("✏️ Подзаголовок", `s:pe:${pid}:sub`)],
      [btn("🖼 Фото", `s:pe:${pid}:img`), btn("🏷 Особенности", `s:pe:${pid}:f`)],
      [btn("📁 Категория", `s:pc:${pid}`), btn(p.is_active ? "❌ Скрыть" : "✅ Показать", `s:pt:${pid}`)],
      [btn("🗃 Склад", `s:iv:${pid}:0`), btn("🗑 Удалить", `s:pd:${pid}`)],
      [btn("◀️ К товарам", "s:pl:0")],
    ]),
  );
}

// ═══════════════════════════════════════════════
// CATEGORIES
// ═══════════════════════════════════════════════
async function categoriesList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, _page: number) {
  const { data: cats } = await supabase().from("shop_categories").select("*").eq("shop_id", shopId).order("sort_order");
  if (!cats?.length)
    return tg.edit(
      cid,
      mid,
      "📁 <b>Категории</b>\n\nНет.",
      ikb([[btn("➕ Добавить", "s:ca")], [btn("◀️ Меню", "s:m")]]),
    );
  let t = `📁 <b>Категории</b> (${cats.length})\n\n`;
  cats.forEach((c) => {
    t += `${c.icon} <b>${esc(c.name)}</b> ${c.is_active ? "" : "❌"}\n`;
  });
  const rows: Btn[][] = cats.map((c) => [btn(`${c.icon} ${c.name}`, `s:cv:${c.id}`)]);
  rows.push([btn("➕ Добавить", "s:ca"), btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function categoryView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, catId: string) {
  const [{ data: c }, { count: prodCount }] = await Promise.all([
    supabase().from("shop_categories").select("*").eq("id", catId).single(),
    supabase()
      .from("shop_products")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("category_id", catId),
  ]);
  if (!c) return tg.edit(cid, mid, "Не найдена", ikb([[btn("◀️ Назад", "s:cl:0")]]));
  let t = `📁 <b>${c.icon} ${esc(c.name)}</b>\n\n📊 Сортировка: ${c.sort_order}\n📦 Товаров: ${prodCount || 0}\n${c.is_active ? "✅ Активна" : "❌ Скрыта"}\n`;
  return tg.edit(
    cid,
    mid,
    t,
    ikb([
      [btn("✏️ Название", `s:ce:${catId}:n`), btn("✏️ Иконка", `s:ce:${catId}:i`)],
      [btn("✏️ Сортировка", `s:ce:${catId}:s`)],
      [btn(c.is_active ? "❌ Скрыть" : "✅ Показать", `s:ct:${catId}`)],
      [btn("📦 Товары категории", `s:cprod:${catId}:0`)],
      [btn("🗑 Удалить", `s:cd:${catId}`)],
      [btn("◀️ К категориям", "s:cl:0")],
    ]),
  );
}

// ═══════════════════════════════════════════════
// ORDERS
// ═══════════════════════════════════════════════
async function ordersList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number) {
  const { data: orders } = await supabase()
    .from("shop_orders")
    .select("*")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (!orders?.length) return tg.edit(cid, mid, "🛒 <b>Заказы</b>\n\nНет.", ikb([[btn("◀️ Меню", "s:m")]]));
  const se: Record<string, string> = {
    pending: "⏳",
    awaiting_payment: "💳",
    paid: "✅",
    processing: "⚙️",
    delivered: "📬",
    completed: "✅",
    cancelled: "❌",
    error: "⚠️",
  };
  const pg = paginate(orders, page, 6);
  let t = `🛒 <b>Заказы</b> (${orders.length})\n\n`;
  pg.items.forEach((o) => {
    t += `${se[o.status] || "❓"} <b>${esc(o.order_number)}</b> — $${Number(o.total_amount).toFixed(2)}\n👤 ${o.buyer_telegram_id} | 📅 ${new Date(o.created_at).toLocaleDateString("ru-RU")}\n\n`;
  });
  const rows: Btn[][] = pg.items.map((o) => [btn(`${se[o.status] || "❓"} ${o.order_number}`, `s:ov:${o.id}`)]);
  if (pg.total > 1) rows.push(pgRow("s:ol", pg.page, pg.total));
  rows.push([btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function orderView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, oid: string) {
  const { data: o } = await supabase().from("shop_orders").select("*").eq("id", oid).single();
  if (!o) return tg.edit(cid, mid, "Не найден", ikb([[btn("◀️ Назад", "s:ol:0")]]));
  const { data: items } = await supabase().from("shop_order_items").select("*").eq("order_id", oid);
  // Use shop_customers instead of user_profiles
  const { data: customer } = await supabase()
    .from("shop_customers")
    .select("*")
    .eq("shop_id", shopId)
    .eq("telegram_id", o.buyer_telegram_id)
    .maybeSingle();
  let t = `🛒 <b>Заказ ${esc(o.order_number)}</b>\n\n`;
  t += `👤 ${customer ? esc(customer.first_name + (customer.last_name ? " " + customer.last_name : "")) : o.buyer_telegram_id}`;
  if (customer?.username) t += ` @${esc(customer.username)}`;
  t += `\n🆔 TG: ${o.buyer_telegram_id}\n\n📦 <b>Состав:</b>\n`;
  items?.forEach((i) => {
    t += `  • ${esc(i.product_name)} ×${i.quantity} — $${Number(i.product_price * i.quantity).toFixed(2)}\n`;
  });
  t += `\n💰 <b>$${Number(o.total_amount).toFixed(2)}</b> ${o.currency}\n📋 Статус: <b>${o.status}</b>\n💳 Оплата: <b>${o.payment_status}</b>\n`;
  if (o.invoice_id) t += `🧾 Invoice: ${o.invoice_id}\n`;
  if (Number(o.balance_used) > 0) t += `💎 Баланс: $${Number(o.balance_used).toFixed(2)}\n`;
  t += `📅 ${new Date(o.created_at).toLocaleString("ru-RU")}\n`;
  const statuses = ["paid", "processing", "delivered", "completed", "cancelled"].filter((s) => s !== o.status);
  const sBtns: Btn[][] = [];
  for (let i = 0; i < statuses.length; i += 3)
    sBtns.push(statuses.slice(i, i + 3).map((s) => btn(s, `s:os:${oid}:${s}`)));
  sBtns.push([btn("👤 Пользователь", `s:uvt:${o.buyer_telegram_id}`)]);
  return tg.edit(cid, mid, t, ikb([...sBtns, [btn("◀️ К заказам", "s:ol:0")]]));
}

async function orderSetStatus(
  tg: ReturnType<typeof TG>,
  cid: number,
  mid: number,
  shopId: string,
  oid: string,
  status: string,
  adminId: number,
) {
  const pm: Record<string, string> = {
    paid: "paid",
    processing: "paid",
    delivered: "paid",
    completed: "paid",
    cancelled: "failed",
  };
  await supabase()
    .from("shop_orders")
    .update({ status, payment_status: pm[status] || "unpaid", updated_at: new Date().toISOString() })
    .eq("id", oid);
  await logAction(shopId, adminId, `order_${status}`, "order", oid);
  return orderView(tg, cid, mid, shopId, oid);
}

// ═══════════════════════════════════════════════
// USERS — now using shop_customers
// ═══════════════════════════════════════════════
async function usersList(
  tg: ReturnType<typeof TG>,
  cid: number,
  mid: number,
  shopId: string,
  page: number,
  filter?: string,
) {
  // Get all shop customers for this shop
  let query = supabase()
    .from("shop_customers")
    .select("*")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });
  if (filter === "vip") query = query.eq("role", "vip");
  else if (filter === "blocked") query = query.eq("is_blocked", true);
  const { data: customers } = await query;

  if (!customers?.length)
    return tg.edit(
      cid,
      mid,
      `👥 <b>Пользователи</b>${filter ? ` [${filter}]` : ""}\n\nНет.`,
      ikb([[btn("◀️ Меню", "s:m")]]),
    );
  const pg = paginate(customers, page, 8);
  let t = `👥 <b>Пользователи</b> (${customers.length})${filter ? ` [${filter}]` : ""}\n\n`;
  pg.items.forEach((u) => {
    const flags = [u.is_premium ? "⭐" : "", u.role === "vip" ? "👑" : "", u.is_blocked ? "🚫" : ""]
      .filter(Boolean)
      .join("");
    t += `👤 <b>${esc(u.first_name)}${u.last_name ? " " + esc(u.last_name) : ""}</b> ${flags}`;
    if (u.username) t += ` @${esc(u.username)}`;
    t += ` | ${u.telegram_id}\n`;
  });
  const pfx = filter ? `s:ulf:${filter}` : "s:ul";
  const rows: Btn[][] = pg.items.map((u) => [
    btn(safeSlice(`${u.is_blocked ? "🚫 " : ""}${u.first_name} ${u.last_name || ""}`.trim(), 28), `s:uv:${u.id}`),
  ]);
  if (pg.total > 1) rows.push(pgRow(pfx, pg.page, pg.total));
  rows.push([btn("🔍 Поиск", "s:usq"), btn("📊 Фильтр", "s:usf")]);
  rows.push([btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function userView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, uid: string) {
  // Read from shop_customers
  const { data: u } = await supabase().from("shop_customers").select("*").eq("id", uid).single();
  if (!u) return tg.edit(cid, mid, "Не найден", ikb([[btn("◀️ Назад", "s:ul:0")]]));
  const { data: orders } = await supabase()
    .from("shop_orders")
    .select("id, total_amount, status, payment_status")
    .eq("shop_id", shopId)
    .eq("buyer_telegram_id", u.telegram_id);
  const paid = orders?.filter((o) => ["paid", "completed", "delivered", "processing"].includes(o.status)) || [];
  const spent = paid.reduce((s, o) => s + Number(o.total_amount), 0);

  // Referral info
  const sb = supabase();
  const [{ data: refRow }, { count: invitedCount }, { data: earnings }] = await Promise.all([
    sb
      .from("shop_referrals")
      .select("referrer_telegram_id, created_at")
      .eq("shop_id", shopId)
      .eq("referred_telegram_id", u.telegram_id)
      .maybeSingle(),
    sb
      .from("shop_referrals")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", shopId)
      .eq("referrer_telegram_id", u.telegram_id),
    sb
      .from("shop_referral_earnings")
      .select("reward_amount, status")
      .eq("shop_id", shopId)
      .eq("referrer_telegram_id", u.telegram_id),
  ]);
  const totalEarned = (earnings || []).reduce((s: number, e: any) => s + Number(e.reward_amount || 0), 0);
  const pendingPayout = (earnings || [])
    .filter((e: any) => e.status === "pending")
    .reduce((s: number, e: any) => s + Number(e.reward_amount || 0), 0);

  let inviterLabel = "—";
  if (refRow?.referrer_telegram_id) {
    const { data: inviter } = await sb
      .from("shop_customers")
      .select("first_name, last_name, username")
      .eq("shop_id", shopId)
      .eq("telegram_id", refRow.referrer_telegram_id)
      .maybeSingle();
    if (inviter) {
      inviterLabel =
        `${esc(inviter.first_name)}${inviter.last_name ? " " + esc(inviter.last_name) : ""}` +
        (inviter.username ? ` (@${esc(inviter.username)})` : ` (${refRow.referrer_telegram_id})`);
    } else {
      inviterLabel = String(refRow.referrer_telegram_id);
    }
  }

  let t = `👤 <b>${esc(u.first_name)}${u.last_name ? " " + esc(u.last_name) : ""}</b>\n\n`;
  if (u.username) t += `📱 @${esc(u.username)}\n`;
  t += `🆔 TG: ${u.telegram_id}\n`;
  t += `🏷 Роль: <b>${u.role || "user"}</b>\n`;
  t += `${u.is_blocked ? "🚫 Заблокирован\n" : ""}`;
  t += `${u.is_premium ? "⭐ Premium\n" : ""}`;
  t += `💰 Баланс: <b>$${Number(u.balance || 0).toFixed(2)}</b>\n`;
  t += `📅 ${new Date(u.created_at).toLocaleDateString("ru-RU")}\n\n`;
  t += `🛒 Заказов: ${orders?.length || 0}\n💵 Потрачено: $${spent.toFixed(2)}\n`;
  t += `\n🎁 <b>Рефералы</b>\n`;
  t += `👥 Пригласил: <b>${invitedCount || 0}</b>\n`;
  t += `💎 Заработал: <b>$${totalEarned.toFixed(2)}</b>\n`;
  t += `💸 К выплате: <b>$${pendingPayout.toFixed(2)}</b>\n`;
  t += `🔗 Пригласил его: ${inviterLabel}\n`;
  if (u.internal_note) t += `\n📝 <i>${esc(u.internal_note)}</i>\n`;
  return tg.edit(
    cid,
    mid,
    t,
    ikb([
      [btn("📢 Написать", `s:um:${u.telegram_id}`), btn("🛒 Заказы", `s:uo:${u.telegram_id}:0`)],
      [btn("💰 Баланс", `s:ub:${u.telegram_id}`), btn("🏷 Роль", `s:ur:${u.telegram_id}`)],
      [btn(u.is_blocked ? "✅ Разблокировать" : "🚫 Заблокировать", `s:ux:${u.telegram_id}`)],
      [btn("📝 Заметка", `s:un:${u.telegram_id}`), btn("📋 Логи", `s:ula:${u.telegram_id}:0`)],
      [btn("◀️ К пользователям", "s:ul:0")],
    ]),
  );
}

async function userViewByTg(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, tgId: number) {
  const { data: u } = await supabase()
    .from("shop_customers")
    .select("id")
    .eq("shop_id", shopId)
    .eq("telegram_id", tgId)
    .maybeSingle();
  if (!u) return tg.edit(cid, mid, "Пользователь не найден", ikb([[btn("◀️ Назад", "s:ul:0")]]));
  return userView(tg, cid, mid, shopId, u.id);
}

// User orders
async function userOrdersList(
  tg: ReturnType<typeof TG>,
  cid: number,
  mid: number,
  shopId: string,
  tgId: number,
  page: number,
) {
  const { data: orders } = await supabase()
    .from("shop_orders")
    .select("*")
    .eq("shop_id", shopId)
    .eq("buyer_telegram_id", tgId)
    .order("created_at", { ascending: false });
  if (!orders?.length)
    return tg.edit(
      cid,
      mid,
      `🛒 <b>Заказы пользователя ${tgId}</b>\n\nНет.`,
      ikb([[btn("◀️ Назад", `s:uvt:${tgId}`)]]),
    );
  const se: Record<string, string> = {
    pending: "⏳",
    paid: "✅",
    processing: "⚙️",
    delivered: "📬",
    completed: "✅",
    cancelled: "❌",
  };
  const pg = paginate(orders, page, 6);
  let t = `🛒 <b>Заказы</b> (${orders.length}) — TG ${tgId}\n\n`;
  pg.items.forEach((o) => {
    t += `${se[o.status] || "❓"} ${esc(o.order_number)} — $${Number(o.total_amount).toFixed(2)}\n`;
  });
  const rows: Btn[][] = pg.items.map((o) => [btn(`${se[o.status] || "❓"} ${o.order_number}`, `s:ov:${o.id}`)]);
  if (pg.total > 1) rows.push(pgRow(`s:uo:${tgId}`, pg.page, pg.total));
  rows.push([btn("◀️ К пользователю", `s:uvt:${tgId}`)]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// Balance menu — now using shop_customers + shop_balance_history
async function balanceMenu(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, tgId: number) {
  const { data: u } = await supabase()
    .from("shop_customers")
    .select("balance")
    .eq("shop_id", shopId)
    .eq("telegram_id", tgId)
    .maybeSingle();
  const { data: history } = await supabase()
    .from("shop_balance_history")
    .select("*")
    .eq("shop_id", shopId)
    .eq("telegram_id", tgId)
    .order("created_at", { ascending: false })
    .limit(5);
  let t = `💰 <b>Баланс</b> — TG ${tgId}\n\nТекущий: <b>$${Number(u?.balance || 0).toFixed(2)}</b>\n`;
  if (history?.length) {
    t += `\n📜 <b>Последние операции:</b>\n`;
    history.forEach((h) => {
      const sign = Number(h.amount) >= 0 ? "+" : "";
      t += `${sign}$${Number(h.amount).toFixed(2)} → $${Number(h.balance_after).toFixed(2)} | ${h.type}\n`;
      if (h.comment) t += `  <i>${esc(h.comment)}</i>\n`;
    });
  }
  return tg.edit(
    cid,
    mid,
    t,
    ikb([
      [btn("➕ Начислить", `s:ubc:${tgId}`), btn("➖ Списать", `s:ubd:${tgId}`)],
      [btn("🎯 Установить", `s:ubs:${tgId}`)],
      [btn("◀️ К пользователю", `s:uvt:${tgId}`)],
    ]),
  );
}

// User logs
async function userLogsList(
  tg: ReturnType<typeof TG>,
  cid: number,
  mid: number,
  shopId: string,
  tgId: number,
  page: number,
) {
  const { data: logs } = await supabase()
    .from("shop_admin_logs")
    .select("*")
    .eq("shop_id", shopId)
    .eq("entity_id", String(tgId))
    .order("created_at", { ascending: false })
    .limit(30);
  if (!logs?.length)
    return tg.edit(cid, mid, `📋 <b>Логи</b> — TG ${tgId}\n\nПусто.`, ikb([[btn("◀️ Назад", `s:uvt:${tgId}`)]]));
  const pg = paginate(logs, page, 6);
  let t = `📋 <b>Логи</b> — TG ${tgId}\n\n`;
  pg.items.forEach((l) => {
    t += `${new Date(l.created_at).toLocaleString("ru-RU")} | <b>${esc(l.action)}</b>\n`;
  });
  const rows: Btn[][] = [];
  if (pg.total > 1) rows.push(pgRow(`s:ula:${tgId}`, pg.page, pg.total));
  rows.push([btn("◀️ К пользователю", `s:uvt:${tgId}`)]);
  return tg.edit(cid, mid, t, ikb(rows));
}

// ═══════════════════════════════════════════════
// PROMOCODES
// ═══════════════════════════════════════════════
async function promosList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number) {
  const { data: promos } = await supabase()
    .from("shop_promocodes")
    .select("*")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });
  if (!promos?.length)
    return tg.edit(
      cid,
      mid,
      "🎟 <b>Промокоды</b>\n\nНет.",
      ikb([[btn("➕ Создать", "s:pra")], [btn("◀️ Меню", "s:m")]]),
    );
  const pg = paginate(promos, page, 6);
  let t = `🎟 <b>Промокоды</b> (${promos.length})\n\n`;
  pg.items.forEach((p) => {
    const st = p.is_active ? "✅" : "❌";
    const disc = p.discount_type === "percent" ? `${p.discount_value}%` : `$${Number(p.discount_value).toFixed(2)}`;
    t += `${st} <code>${esc(p.code)}</code> — ${disc} | ${p.used_count}/${p.max_uses ?? "∞"}\n`;
  });
  const rows: Btn[][] = pg.items.map((p) => [btn(`${p.is_active ? "✅" : "❌"} ${p.code}`, `s:prv:${p.id}`)]);
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
  return tg.edit(
    cid,
    mid,
    t,
    ikb([
      [btn(p.is_active ? "❌ Деактивировать" : "✅ Активировать", `s:prt:${prId}`)],
      [btn("🗑 Удалить", `s:prd:${prId}`)],
      [btn("◀️ К промокодам", "s:prl:0")],
    ]),
  );
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
  const prodIds = (await d.from("shop_products").select("id").eq("shop_id", shopId)).data?.map((p) => p.id) || [];
  let invCount = 0;
  if (prodIds.length) {
    const { count } = await d
      .from("shop_inventory")
      .select("id", { count: "exact", head: true })
      .eq("status", "available")
      .in("product_id", prodIds);
    invCount = count || 0;
  }
  const paid = orders?.filter((o) => ["paid", "completed", "delivered", "processing"].includes(o.status)) || [];
  const rev = paid.reduce((s, o) => s + Number(o.total_amount), 0);
  const avg = paid.length ? rev / paid.length : 0;
  const problems = orders?.filter((o) => ["error", "cancelled"].includes(o.status)).length || 0;
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
    `👋 Приветствие: ${shop.welcome_message ? esc(shop.welcome_message.slice(0, 50)) + "…" : "—"}${shop.welcome_photo_id ? " 🖼" : ""}\n` +
    `🔗 Поддержка: ${shop.support_link || "—"}\n` +
    `🤖 Бот: ${botStatus}\n` +
    `💳 Способы оплаты: ${shop.cryptobot_token_encrypted ? "CryptoBot ✅" : "CryptoBot ❌"}\n` +
    `📢 Подписка на канал: ${subStatus}`;

  return tg.edit(
    cid,
    mid,
    text,
    ikb([
      [btn("✏️ Название", "s:edit:name"), btn("🎨 Цвет", "s:edit:color")],
      [btn("📌 Заголовок витрины", "s:edit:hero_title")],
      [btn("📝 Описание витрины", "s:edit:hero_desc")],
      [btn("👋 Приветствие", "s:edit:welcome"), btn("🔗 Поддержка", "s:edit:support")],
      [btn("💳 Способы оплаты", "s:paym")],
      [btn(`📢 ОП ${shop.is_subscription_required ? "✅" : "❌"}`, "s:opsettings")],
      [btn("🎁 Реф. система", "s:ref")],
      [btn("◀️ Меню", "s:m")],
    ]),
  );
}

async function paymentMethodsView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string) {
  const { data: shop } = await supabase().from("shops").select("cryptobot_token_encrypted").eq("id", shopId).single();
  const { data: methods } = await supabase()
    .from("shop_payment_methods")
    .select("method, enabled, config_masked")
    .eq("shop_id", shopId);
  const byMethod = new Map((methods || []).map((m: any) => [m.method, m]));
  const cbEnabled = byMethod.get("cryptobot")?.enabled ?? Boolean(shop?.cryptobot_token_encrypted);
  const sbp = byMethod.get("sbp_card");
  const sbpEnabled = Boolean(sbp?.enabled);
  const sbpCfg = (sbp?.config_masked || {}) as Record<string, string>;
  const stars = byMethod.get("stars");
  const starsEnabled = Boolean(stars?.enabled);
  const starsCfg = (stars?.config_masked || {}) as Record<string, any>;
  const starsRate = Number(starsCfg.usd_per_star || 0);
  const xr = byMethod.get("xrocket");
  const xrEnabled = Boolean(xr?.enabled);
  const xrCfg = (xr?.config_masked || {}) as Record<string, any>;
  const xrTokenSet = Boolean((xr as any)?.config_encrypted) || Boolean(xrCfg.token_set);
  const ton = byMethod.get("ton");
  const tonEnabled = Boolean(ton?.enabled);
  const tonCfg = (ton?.config_masked || {}) as Record<string, any>;
  const tonWalletSet = Boolean((ton as any)?.config_encrypted) || Boolean(tonCfg.wallet_set);
  const tonWalletMasked = String(tonCfg.wallet_masked || "");

  let t = `💳 <b>Способы оплаты</b>\n\n`;
  t += `• CryptoBot: <b>${cbEnabled ? "✅ включён" : "❌ выключен"}</b>\n`;
  t += `• Карта/СБП: <b>${sbpEnabled ? "✅ включён" : "❌ выключен"}</b>\n`;
  t += `• Telegram Stars: <b>${starsEnabled ? "✅ включён" : "❌ выключен"}</b>`;
  if (starsRate > 0) t += ` · курс: <code>1⭐ = $${starsRate.toFixed(4)}</code>`;
  t += `\n`;
  t += `• xRocket Pay: <b>${xrEnabled ? "✅ включён" : "❌ выключен"}</b>`;
  t += `\n`;
  t += `• TON / Tonkeeper: <b>${tonEnabled ? "✅ включён" : "❌ выключен"}</b>`;
  if (tonWalletMasked) t += ` · <code>${esc(tonWalletMasked)}</code>`;
  t += `\n`;
  if (sbpCfg.cardNumber || sbpCfg.phone) {
    t += `\n<b>Реквизиты СБП:</b>\n`;
    t += `Банк: ${esc(sbpCfg.bankName || "—")}\n`;
    t += `Карта: ${esc(sbpCfg.cardNumber || "—")}\n`;
    t += `Получатель: ${esc(sbpCfg.recipientName || "—")}\n`;
    t += `Телефон: ${esc(sbpCfg.phone || "—")}\n`;
  }
  if (starsEnabled || starsRate > 0) {
    t += `\n<i>💡 Stars зачисляются на баланс вашего бота. Вывести их можно через @PremiumBot (Stars → TON).</i>\n`;
  }
  if (xrTokenSet || xrEnabled) {
    t += `\n<i>💡 xRocket Pay: средства поступают на счёт вашего приложения в @xRocket. Курс к USD считается автоматически на момент оплаты.</i>\n`;
  }
  if (tonWalletSet || tonEnabled) {
    t += `\n<i>💎 TON / Tonkeeper: переводы поступают напрямую на ваш кошелёк. Сумма в USD конвертируется в TON по актуальному курсу.</i>\n`;
  }

  return tg.edit(
    cid,
    mid,
    t,
    ikb([
      [btn(cbEnabled ? "🟢 CryptoBot ON" : "⚪️ CryptoBot OFF", "s:paytoggle:cryptobot")],
      [btn(sbpEnabled ? "🟢 СБП ON" : "⚪️ СБП OFF", "s:paytoggle:sbp_card")],
      [btn(starsEnabled ? "🟢 Stars ON" : "⚪️ Stars OFF", "s:paytoggle:stars")],
      [btn(xrEnabled ? "🟢 xRocket ON" : "⚪️ xRocket OFF", "s:paytoggle:xrocket")],
      [btn(tonEnabled ? "🟢 TON ON" : "⚪️ TON OFF", "s:paytoggle:ton")],
      [btn("✏️ Реквизиты СБП", "s:setsbp")],
      [btn(`⭐ Курс Stars${starsRate > 0 ? ` (1⭐=$${starsRate.toFixed(4)})` : ""}`, "s:setstars")],
      [btn("🔑 Токен CryptoBot", "s:setcb")],
      [btn(`🚀 Токен xRocket${xrTokenSet ? " ✅" : ""}`, "s:setxr")],
      [btn(`💎 TON-кошелёк${tonWalletSet ? " ✅" : ""}`, "s:setton")],
      [btn("◀️ К настройкам", "s:se")],
    ]),
  );
}

async function paymentRequestsList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number) {
  const { data: rows } = await supabase()
    .from("shop_payment_requests")
    .select("id, order_id, buyer_telegram_id, amount_usd, status, created_at")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (!rows?.length) return tg.edit(cid, mid, "🧾 <b>Заявки</b>\n\nПока нет заявок.", ikb([[btn("◀️ Меню", "s:m")]]));
  const pg = paginate(rows, page, 8);
  let t = `🧾 <b>Заявки на проверку</b> (${rows.length})\n\n`;
  pg.items.forEach((r: any) => {
    const ic = r.status === "pending" ? "🟡" : r.status === "approved" ? "✅" : r.status === "rejected" ? "❌" : "▫️";
    t += `${ic} <code>${r.id.slice(0, 8)}</code> | TG ${r.buyer_telegram_id}\n`;
    t += `💰 $${Number(r.amount_usd).toFixed(2)} | ${new Date(r.created_at).toLocaleString("ru-RU")}\n\n`;
  });
  const kb: Btn[][] = pg.items.map((r: any) => {
    const mark = r.status === "approved" ? "✅" : r.status === "rejected" ? "❌" : "🟡";
    return [btn(`${mark} ${r.id.slice(0, 8)} · $${Number(r.amount_usd).toFixed(2)}`, `s:rqv:${r.id}`)];
  });
  if (pg.total > 1) kb.push(pgRow("s:rql", pg.page, pg.total));
  kb.push([btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(kb));
}

async function paymentRequestView(
  tg: ReturnType<typeof TG>,
  cid: number,
  mid: number,
  shopId: string,
  requestId: string,
  botToken?: string,
) {
  const { data: req } = await supabase()
    .from("shop_payment_requests")
    .select("*")
    .eq("shop_id", shopId)
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return tg.edit(cid, mid, "❌ Заявка не найдена", ikb([[btn("◀️ К заявкам", "s:rql:0")]]));
  const { data: order } = await supabase().from("shop_orders").select("*").eq("id", req.order_id).maybeSingle();
  const { data: items } = await supabase()
    .from("shop_order_items")
    .select("product_name, quantity, product_price")
    .eq("order_id", req.order_id);
  let t = `🧾 <b>Заявка ${req.id}</b>\n\n`;
  t += `📌 Статус: <b>${req.status}</b>\n`;
  t += `👤 TG: <code>${req.buyer_telegram_id}</code>\n`;
  t += `🛒 Заказ: <code>${order?.order_number || req.order_id}</code>\n`;
  t += `💰 Сумма: <b>$${Number(req.amount_usd).toFixed(2)}</b>${req.amount_rub ? ` (~${Number(req.amount_rub).toFixed(0)} ₽)` : ""}\n`;
  t += `🕒 Создано: ${new Date(req.created_at).toLocaleString("ru-RU")}\n`;
  if (req.rejection_reason) t += `❌ Причина: ${esc(req.rejection_reason)}\n`;
  t += `\n<b>Состав заказа:</b>\n`;
  (items || []).forEach((i: any) => {
    t += `• ${esc(i.product_name)} ×${i.quantity} — $${(Number(i.product_price) * Number(i.quantity)).toFixed(2)}\n`;
  });
  const rows: Btn[][] = [];
  if (req.status === "pending") {
    rows.push([btn("✅ Принять", `s:rqa:${req.id}`), btn("❌ Отклонить", `s:rqr:${req.id}`)]);
  }
  rows.push([btn("◀️ К заявкам", "s:rql:0")]);
  await tg.edit(cid, mid, t, ikb(rows));

  // Send receipt as a separate photo message only for pending requests
  if (req.receipt_path && botToken && req.status === "pending") {
    try {
      await fetch(`https://api.telegram.org/bot${botToken}/sendPhoto`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chat_id: cid, photo: req.receipt_path, caption: "📎 Чек к заявке" }),
      });
    } catch (e) {
      console.error("Failed to send receipt photo", e);
    }
  }
}

async function approvePaymentRequest(
  tg: ReturnType<typeof TG>,
  cid: number,
  mid: number,
  shopId: string,
  requestId: string,
  adminId: number,
  botToken: string,
) {
  const { data: req } = await supabase()
    .from("shop_payment_requests")
    .select("*")
    .eq("shop_id", shopId)
    .eq("id", requestId)
    .maybeSingle();
  if (!req) return tg.edit(cid, mid, "❌ Заявка не найдена", ikb([[btn("◀️ К заявкам", "s:rql:0")]]));
  if (req.status !== "pending") return paymentRequestView(tg, cid, mid, shopId, requestId, botToken);

  const { data: order } = await supabase().from("shop_orders").select("*").eq("id", req.order_id).maybeSingle();
  if (!order) return tg.edit(cid, mid, "❌ Заказ не найден", ikb([[btn("◀️ К заявкам", "s:rql:0")]]));

  // Idempotent approve: only update if still pending
  const { data: updatedReqs } = await supabase()
    .from("shop_payment_requests")
    .update({
      status: "approved",
      reviewed_by_telegram_id: adminId,
      reviewed_at: new Date().toISOString(),
    })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id");

  // If no rows updated, another admin already processed it
  if (!updatedReqs?.length) {
    return paymentRequestView(tg, cid, mid, shopId, requestId, botToken);
  }

  if (order.promo_code) {
    await supabase().rpc("increment_shop_promo_usage", { p_shop_id: shopId, p_code: order.promo_code });
  }

  const balanceUsed = Number(order.balance_used || 0);
  if (balanceUsed > 0) {
    const { data: nb, error: be } = await supabase().rpc("shop_deduct_balance", {
      p_shop_id: shopId,
      p_telegram_id: order.buyer_telegram_id,
      p_amount: balanceUsed,
    });
    if (!be) {
      const promoInfo = order.promo_code
        ? ` (промо ${order.promo_code}, скидка $${Number(order.discount_amount || 0).toFixed(2)})`
        : "";
      await supabase()
        .from("shop_balance_history")
        .insert({
          shop_id: shopId,
          telegram_id: order.buyer_telegram_id,
          amount: -balanceUsed,
          balance_after: nb,
          type: "purchase",
          comment: `Заказ ${order.order_number}${promoInfo}`,
          admin_telegram_id: order.buyer_telegram_id,
        });
    }
  }

  const { data: orderItems } = await supabase()
    .from("shop_order_items")
    .select("product_id, quantity, product_name")
    .eq("order_id", order.id);
  const deliveredContent: string[] = [];
  const isAutoOrder = order.product_type === "telegram_premium" || order.product_type === "telegram_stars";
  let allDelivered = true;
  for (const item of (isAutoOrder ? [] : (orderItems || []))) {
    const { data: reserved } = await supabase().rpc("reserve_shop_inventory", {
      p_product_id: item.product_id,
      p_quantity: item.quantity,
      p_order_id: order.id,
    });
    if (reserved?.length) {
      deliveredContent.push(
        `📦 <b>${item.product_name}</b> (×${reserved.length}):\n${reserved.map((i: any) => `<code>${i.content}</code>`).join("\n")}`,
      );
      const { count: remaining } = await supabase()
        .from("shop_inventory")
        .select("id", { count: "exact", head: true })
        .eq("product_id", item.product_id)
        .eq("status", "available");
      await supabase()
        .from("shop_products")
        .update({ stock: remaining || 0, updated_at: new Date().toISOString() })
        .eq("id", item.product_id);
      if (reserved.length < item.quantity) allDelivered = false;
    } else {
      allDelivered = false;
    }
  }

  const finalStatus = isAutoOrder
    ? "processing"
    : (allDelivered && deliveredContent.length > 0 ? "delivered" : "paid");
  await supabase()
    .from("shop_orders")
    .update({
      payment_status: "paid",
      status: finalStatus,
      fulfillment_status: isAutoOrder ? "pending" : (order.fulfillment_status ?? null),
      updated_at: new Date().toISOString(),
    })
    .eq("id", order.id);

  // Referral reward credited at SBP approval for ALL order types (auto + regular).
  // Cryptobot path credits in its own webhook.
  // Канонично: финальная сумма = total_amount - discount_amount.
  // Идемпотентно через UNIQUE(order_id) в shop_credit_referral_for_order.
  try {
    const refAmount = Math.max(
      0,
      Number(order.total_amount || 0) - Number(order.discount_amount || 0),
    );
    if (refAmount > 0) {
      await supabase().rpc("shop_credit_referral_for_order", {
        p_shop_id: shopId,
        p_order_id: order.id,
        p_referred_telegram_id: order.buyer_telegram_id,
        p_order_amount: refAmount,
      });
    }
  } catch (e) {
    console.error("[approvePaymentRequest] referral error", e);
  }

  await logAction(shopId, adminId, "approve_payment_request", "payment_request", requestId, { order_id: order.id });

  let userMsg = `✅ <b>Оплата подтверждена!</b>\n\n📦 Заказ: <code>${order.order_number}</code>\n💰 Сумма: $${Number(req.amount_usd).toFixed(2)}\n`;
  if (isAutoOrder) {
    const isPrem = order.product_type === "telegram_premium";
    const dur = order.premium_duration === "3m" ? "3 месяца"
      : order.premium_duration === "6m" ? "6 месяцев"
      : order.premium_duration === "12m" ? "12 месяцев" : "";
    const productLine = isPrem
      ? `⭐ <b>Telegram Premium</b> (${dur})`
      : `⭐ <b>${order.stars_amount} Telegram Stars</b>`;
    userMsg += `\n${productLine}\n👤 Получатель: <code>${order.target_user || ""}</code>\n\n⏳ Заказ передан продавцу для исполнения. Мы уведомим вас, как только товар будет выдан.`;
  } else if (deliveredContent.length > 0) {
    userMsg += `\n🎁 <b>Ваши товары:</b>\n\n${deliveredContent.join("\n\n")}\n\n⚠️ Сохраните данные!`;
  } else {
    userMsg += `\nВаш товар будет доставлен в ближайшее время.`;
  }
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: order.buyer_telegram_id, text: userMsg, parse_mode: "HTML" }),
  });

  return paymentRequestView(tg, cid, mid, shopId, requestId, botToken);
}

// ═══════════════════════════════════════════════
// LOGS
// ═══════════════════════════════════════════════
async function logsList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number) {
  const { data: logs } = await supabase()
    .from("shop_admin_logs")
    .select("*")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (!logs?.length) return tg.edit(cid, mid, "📋 <b>Логи</b>\n\nПусто.", ikb([[btn("◀️ Меню", "s:m")]]));
  const pg = paginate(logs, page, 8);
  let t = `📋 <b>Логи</b> (${logs.length})\n\n`;
  pg.items.forEach((l) => {
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
  const { data: products } = await supabase()
    .from("shop_products")
    .select("id, name, stock, is_active")
    .eq("shop_id", shopId)
    .order("stock", { ascending: true });
  if (!products?.length) return tg.edit(cid, mid, "🗃 <b>Склад</b>\n\nНет товаров.", ikb([[btn("◀️ Меню", "s:m")]]));
  const oos = products.filter((p) => p.stock <= 0).length;
  const low = products.filter((p) => p.stock > 0 && p.stock <= 5).length;
  const pg = paginate(products, page, 8);
  let t = `🗃 <b>Склад</b>\n\n❌ Нет в наличии: <b>${oos}</b>\n⚠️ Мало: <b>${low}</b>\n\n`;
  pg.items.forEach((p) => {
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
async function inventoryView(
  tg: ReturnType<typeof TG>,
  cid: number,
  mid: number,
  shopId: string,
  pid: string,
  page: number,
) {
  const { data: p } = await supabase().from("shop_products").select("name").eq("id", pid).single();
  const { data: inv } = await supabase()
    .from("shop_inventory")
    .select("id, status, content, created_at")
    .eq("product_id", pid)
    .order("created_at", { ascending: false });
  const available = inv?.filter((i) => i.status === "available") || [];
  const sold = inv?.filter((i) => i.status === "sold") || [];
  const pg = paginate(available, page, 8);
  let t = `🗃 <b>Склад: ${esc(p?.name || "?")}</b>\n\n✅ В наличии: <b>${available.length}</b>\n🛒 Продано: <b>${sold.length}</b>\n\n`;
  pg.items.forEach((i) => {
    t += `📦 <code>${esc(i.content.slice(0, 40))}</code>\n`;
  });
  const rows: Btn[][] = [];
  if (pg.total > 1) rows.push(pgRow(`s:iv:${pid}`, pg.page, pg.total));
  rows.push([btn("➕ Добавить", `s:ia:${pid}`), btn("🔄 Синхр.", `s:is:${pid}`)]);
  rows.push([btn("◀️ К товару", `s:pv:${pid}`)]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function inventorySync(
  tg: ReturnType<typeof TG>,
  cid: number,
  mid: number,
  shopId: string,
  pid: string,
  adminId: number,
) {
  const { count } = await supabase()
    .from("shop_inventory")
    .select("id", { count: "exact", head: true })
    .eq("product_id", pid)
    .eq("status", "available");
  await supabase()
    .from("shop_products")
    .update({ stock: count || 0, updated_at: new Date().toISOString() })
    .eq("id", pid);
  await logAction(shopId, adminId, "sync_inventory", "product", pid, { stock: count || 0 });
  return inventoryView(tg, cid, mid, shopId, pid, 0);
}

// ═══════════════════════════════════════════════
// REVIEWS
// ═══════════════════════════════════════════════
async function reviewsList(
  tg: ReturnType<typeof TG>,
  cid: number,
  mid: number,
  shopId: string,
  page: number,
  filter?: string,
) {
  let query = supabase()
    .from("shop_reviews")
    .select("*")
    .eq("shop_id", shopId)
    .order("created_at", { ascending: false });
  if (filter === "pending") query = query.eq("moderation_status", "pending");
  else if (filter === "approved") query = query.eq("moderation_status", "approved");
  const { data: reviews } = await query.limit(50);
  if (!reviews?.length)
    return tg.edit(cid, mid, `⭐ <b>Отзывы</b>${filter ? ` [${filter}]` : ""}\n\nНет.`, ikb([[btn("◀️ Меню", "s:m")]]));
  const pg = paginate(reviews, page, 6);
  let t = `⭐ <b>Отзывы</b> (${reviews.length})${filter ? ` [${filter}]` : ""}\n\n`;
  pg.items.forEach((r) => {
    const st = r.moderation_status === "approved" ? "✅" : r.moderation_status === "rejected" ? "❌" : "⏳";
    t += `${st} ${"⭐".repeat(r.rating)} — ${esc(r.author)}\n${esc(r.text.slice(0, 40))}\n\n`;
  });
  const rows: Btn[][] = pg.items.map((r) => [
    btn(`${r.moderation_status === "approved" ? "✅" : "⏳"} ${safeSlice(r.author, 20)}`, `s:rvv:${r.id}`),
  ]);
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
  const { count } = await supabase()
    .from("shop_customers")
    .select("id", { count: "exact", head: true })
    .eq("shop_id", shopId);
  return tg.edit(
    cid,
    mid,
    `📢 <b>Рассылка</b>\n\n👥 Получателей: <b>${count || 0}</b>\n\nОтправьте текст (поддерживается HTML) или фото с подписью.`,
    ikb([[btn("✍️ Написать", "s:bs")], [btn("◀️ Меню", "s:m")]]),
  );
}

// ═══════════════════════════════════════════════
// FSM TEXT HANDLER
// ═══════════════════════════════════════════════
async function handleFSM(
  tg: ReturnType<typeof TG>,
  cid: number,
  val: string,
  photo: any,
  shopId: string,
  adminId: number,
): Promise<boolean> {
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

  // ─── AI shop avatar prompt ────────────────
  if (state === "aiav" || state.startsWith("aiav_edit:")) {
    const parentId = state.startsWith("aiav_edit:") ? state.slice("aiav_edit:".length) : null;
    await clearSession(cid, shopId);
    await generateShopAvatarFromPrompt(tg, cid, shopId, adminId, val, parentId);
    return true;
  }

  // ─── Add product ──────────────────────────
  if (state === "ap:t") {
    await setSession(cid, "ap:p", shopId, { ...sData, title: val });
    await tg.send(
      cid,
      `Название: <b>${esc(val)}</b>\n\nВведите цену в формате:\n<code>10 USD</code> или <code>990 RUB</code>\n(валюту можно не указывать — по умолчанию USD).`,
    );
    return true;
  }
  if (state === "ap:p") {
    const parsed = parsePriceInput(val);
    if (!parsed) {
      await tg.send(cid, "❌ Неверный формат цены. Пример: 10 USD или 990 RUB.");
      return true;
    }
    let usdPrice = parsed.value;
    let rate: number | null = null;
    if (parsed.currency === "rub") {
      const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
      const { data: shop } = await supabase()
        .from("shops")
        .select("cryptobot_token_encrypted")
        .eq("id", shopId)
        .maybeSingle();
      if (!encKey || !shop?.cryptobot_token_encrypted) {
        await tg.send(cid, "❌ Для конвертации RUB нужен подключённый CryptoBot.");
        return true;
      }
      const { data: token } = await supabase().rpc("decrypt_token", {
        p_encrypted: shop.cryptobot_token_encrypted,
        p_key: encKey,
      });
      rate = await fetchUsdtRubRate(String(token));
      usdPrice = Number((parsed.value / rate).toFixed(2));
    }
    await setSession(cid, "ap:d", shopId, {
      ...sData,
      price: usdPrice,
      price_input_currency: parsed.currency,
      price_input_value: parsed.value,
      price_input_rate: rate,
      price_converted_at: new Date().toISOString(),
    });
    await tg.send(cid, `Итоговая цена: <b>$${usdPrice.toFixed(2)}</b>\n\nВведите описание (или <b>/skip</b>):`);
    return true;
  }
  if (state === "ap:d") {
    const desc = val === "/skip" ? "" : val;
    const { data: product, error } = await supabase()
      .from("shop_products")
      .insert({
        name: sData.title as string,
        price: sData.price as number,
        price_input_currency: (sData.price_input_currency as string) || "usd",
        price_input_value: (sData.price_input_value as number) || (sData.price as number),
        price_input_rate: (sData.price_input_rate as number) || null,
        price_converted_at: (sData.price_converted_at as string) || new Date().toISOString(),
        description: desc,
        shop_id: shopId,
        is_active: true,
      })
      .select()
      .single();
    await clearSession(cid);
    if (error) {
      await tg.send(cid, `❌ ${error.message}`);
      return true;
    }
    await logAction(shopId, adminId, "create_product", "product", product.id, { name: sData.title });
    await tg.send(
      cid,
      `✅ Товар <b>${esc(sData.title as string)}</b> создан!`,
      ikb([[btn("📦 К товару", `s:pv:${product.id}`)], [btn("◀️ Меню", "s:m")]]),
    );
    return true;
  }

  // ─── Edit product ─────────────────────────
  if (state.startsWith("ep:")) {
    const parts = state.split(":");
    const field = parts[1];
    const pid = parts[2];

    if (field === "img") {
      if (!photo?.length) {
        await tg.send(cid, "❌ Отправьте фото.");
        return true;
      }
      const fileId = photo[photo.length - 1].file_id;
      const fileInfo = await tg.getFile(fileId);
      if (!fileInfo.ok) {
        await tg.send(cid, "❌ Ошибка получения файла.");
        await clearSession(cid);
        return true;
      }
      const fileUrl = tg.fileUrl(fileInfo.result.file_path);

      // Download and upload to Supabase Storage
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
      try {
        const imgRes = await fetch(fileUrl);
        const blob = await imgRes.blob();
        const ext = fileInfo.result.file_path.split(".").pop() || "jpg";
        const storagePath = `shops/${shopId}/${pid}.${ext}`;
        const { error: uploadError } = await supabase()
          .storage.from("product-images")
          .upload(storagePath, blob, { upsert: true, contentType: `image/${ext}` });
        if (uploadError) {
          await tg.send(cid, `❌ Ошибка загрузки: ${uploadError.message}`);
          await clearSession(cid);
          return true;
        }
        const publicUrl = `${SUPABASE_URL}/storage/v1/object/public/product-images/${storagePath}`;
        await supabase()
          .from("shop_products")
          .update({ image: publicUrl, updated_at: new Date().toISOString() })
          .eq("id", pid);
        await logAction(shopId, adminId, "update_photo", "product", pid);
        await clearSession(cid);
        await tg.send(cid, "✅ Фото обновлено!", ikb([[btn("📦 К товару", `s:pv:${pid}`)]]));
      } catch (e) {
        await tg.send(cid, `❌ Ошибка: ${maskToken((e as Error).message)}`);
        await clearSession(cid);
      }
      return true;
    }

    const fieldMap: Record<string, string> = {
      n: "name",
      p: "price",
      s: "stock",
      d: "description",
      o: "old_price",
      sub: "subtitle",
      f: "features",
    };
    const dbField = fieldMap[field];
    if (!dbField) {
      await clearSession(cid);
      return true;
    }
    let updateVal: unknown = val;
    if (field === "p" || field === "o") {
      const parsed = parsePriceInput(val);
      if (!parsed) {
        await tg.send(cid, "❌ Формат: 10 USD или 990 RUB");
        return true;
      }
      let usdPrice = parsed.value;
      let rate: number | null = null;
      if (parsed.currency === "rub") {
        const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
        const { data: shop } = await supabase()
          .from("shops")
          .select("cryptobot_token_encrypted")
          .eq("id", shopId)
          .maybeSingle();
        if (!encKey || !shop?.cryptobot_token_encrypted) {
          await tg.send(cid, "❌ Для RUB нужен подключённый CryptoBot.");
          return true;
        }
        const { data: token } = await supabase().rpc("decrypt_token", {
          p_encrypted: shop.cryptobot_token_encrypted,
          p_key: encKey,
        });
        rate = await fetchUsdtRubRate(String(token));
        usdPrice = Number((parsed.value / rate).toFixed(2));
      }
      updateVal = usdPrice;
      const extra: Record<string, unknown> =
        field === "p"
          ? {
              price_input_currency: parsed.currency,
              price_input_value: parsed.value,
              price_input_rate: rate,
              price_converted_at: new Date().toISOString(),
            }
          : {
              old_price_input_currency: parsed.currency,
              old_price_input_value: parsed.value,
              old_price_input_rate: rate,
              old_price_converted_at: new Date().toISOString(),
            };
      await supabase()
        .from("shop_products")
        .update({ [dbField]: updateVal, ...extra, updated_at: new Date().toISOString() })
        .eq("id", pid);
      await logAction(shopId, adminId, "edit_product", "product", pid, { field: dbField, currency: parsed.currency });
      await clearSession(cid);
      const resp = await tg.send(cid, `✅ Обновлено: <b>$${Number(usdPrice).toFixed(2)}</b>`);
      const mid = resp?.result?.message_id;
      if (mid) return (productView(tg, cid, mid, shopId, pid), true);
      return true;
    }
    if (field === "s") {
      const n = parseInt(val);
      if (isNaN(n)) {
        await tg.send(cid, "❌ Введите число.");
        return true;
      }
      updateVal = n;
    }
    if (field === "f")
      updateVal = val
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    await supabase()
      .from("shop_products")
      .update({ [dbField]: updateVal, updated_at: new Date().toISOString() })
      .eq("id", pid);
    await logAction(shopId, adminId, "edit_product", "product", pid, { field: dbField });
    await clearSession(cid);
    const resp = await tg.send(cid, "✅ Обновлено!");
    const mid = resp?.result?.message_id;
    if (mid) return (productView(tg, cid, mid, shopId, pid), true);
    return true;
  }

  // ─── Add category ─────────────────────────
  if (state === "ac:n") {
    await setSession(cid, "ac:i", shopId, { ...sData, name: val });
    await tg.send(cid, `Название: <b>${esc(val)}</b>\n\nВведите иконку (emoji):`);
    return true;
  }
  if (state === "ac:i") {
    const { error } = await supabase()
      .from("shop_categories")
      .insert({ name: sData.name as string, icon: val, shop_id: shopId });
    await clearSession(cid);
    if (error) {
      await tg.send(cid, `❌ ${error.message}`);
      return true;
    }
    await logAction(shopId, adminId, "create_category", "category", undefined, { name: sData.name });
    await tg.send(
      cid,
      `✅ Категория <b>${val} ${esc(sData.name as string)}</b> создана!`,
      ikb([[btn("📁 К категориям", "s:cl:0")], [btn("◀️ Меню", "s:m")]]),
    );
    return true;
  }

  // ─── Edit category ────────────────────────
  if (state.startsWith("ec:")) {
    const parts = state.split(":");
    const field = parts[1];
    const catId = parts[2];
    const fieldMap: Record<string, string> = { n: "name", i: "icon", s: "sort_order" };
    const dbField = fieldMap[field];
    if (!dbField) {
      await clearSession(cid);
      return true;
    }
    let updateVal: unknown = val;
    if (field === "s") {
      const n = parseInt(val);
      if (isNaN(n)) {
        await tg.send(cid, "❌ Введите число.");
        return true;
      }
      updateVal = n;
    }
    await supabase()
      .from("shop_categories")
      .update({ [dbField]: updateVal })
      .eq("id", catId);
    await logAction(shopId, adminId, "edit_category", "category", catId, { field: dbField });
    await clearSession(cid);
    const resp = await tg.send(cid, "✅ Обновлено!");
    const mid = resp?.result?.message_id;
    if (mid) return (categoryView(tg, cid, mid, shopId, catId), true);
    return true;
  }

  // ─── Edit shop field ──────────────────────
  if (state === "s_edit_field") {
    const field = sData.field as string;

    // Special handling for welcome message: support photo + text, validate HTML
    if (field === "welcome") {
      const newText = val || "";
      const photoId = photo?.length ? photo[photo.length - 1].file_id : null;

      // If no text and no photo, reject
      if (!newText && !photoId) {
        await tg.send(cid, "❌ Отправьте текст или текст + фото.");
        return true;
      }

      // Validate HTML via test sendMessage (then delete)
      if (newText) {
        const testText = renderWelcome(newText, "Тест");
        const testRes = await tg.send(cid, testText);
        if (!testRes.ok) {
          await tg.send(
            cid,
            `❌ <b>Ошибка HTML-разметки:</b>\n\n${esc(testRes.description || "Неверный формат HTML")}\n\nИсправьте и отправьте снова.`,
          );
          return true;
        }
        // Delete test message
        if (testRes.result?.message_id) {
          await tg.deleteMessage(cid, testRes.result.message_id).catch(() => {});
        }
      }

      // Update shop: text + photo (clear photo if not provided)
      const updateData: Record<string, unknown> = {
        welcome_message: newText,
        welcome_photo_id: photoId, // null clears the photo
        updated_at: new Date().toISOString(),
      };
      await supabase().from("shops").update(updateData).eq("id", shopId);
      await logAction(shopId, adminId, photoId ? "update_welcome_with_photo" : "update_welcome_text", "shop", shopId, {
        has_photo: !!photoId,
        text_length: newText.length,
      });
      await clearSession(cid);
      const confirmText = photoId
        ? "✅ Приветствие обновлено (текст + фото)!"
        : "✅ Приветствие обновлено (фото очищено).";
      const resp = await tg.send(cid, confirmText);
      const mid = resp?.result?.message_id;
      if (mid) return (settingsView(tg, cid, mid, shopId), true);
      return true;
    }

    const fieldMap: Record<string, string> = {
      name: "name",
      color: "color",
      hero_title: "hero_title",
      hero_desc: "hero_description",
      support: "support_link",
    };
    const dbField = fieldMap[field];
    if (!dbField) {
      await clearSession(cid);
      return true;
    }
    if (field === "color" && !/^#?[0-9A-Fa-f]{6}$/.test(val)) {
      await tg.send(cid, "❌ Введи HEX цвет, например: #FF5500");
      return true;
    }
    const updateVal = field === "color" ? (val.startsWith("#") ? val : `#${val}`) : val;
    await supabase()
      .from("shops")
      .update({ [dbField]: updateVal, updated_at: new Date().toISOString() })
      .eq("id", shopId);
    await clearSession(cid);
    const resp = await tg.send(cid, "✅ Обновлено!");
    const mid = resp?.result?.message_id;
    if (mid) return (settingsView(tg, cid, mid, shopId), true);
    return true;
  }

  // ─── Set OP channel link ──────────────────
  if (state === "s_set_op_channel") {
    // handled below
  }

  // ─── Set referral percent ─────────────────
  if (state === "s_set_ref_percent") {
    const num = Number(String(val).replace(",", ".").trim());
    if (!Number.isFinite(num) || num < 0 || num > 100) {
      await tg.send(cid, "❌ Введите число от 0 до 100. Пример: <code>15</code>");
      return true;
    }
    await supabase().from("shop_referral_settings").upsert(
      {
        shop_id: shopId,
        is_enabled: true,
        reward_percent: num,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id" },
    );
    await logAction(shopId, adminId, "set_referral_percent", "shop", shopId, { percent: num });
    await clearSession(cid);
    const resp = await tg.send(cid, `✅ Процент обновлён: <b>${num}%</b>`);
    const respMid = resp?.result?.message_id;
    if (respMid) {
      // Re-render referral admin
      return handleCallback(tg, cid, respMid, "s:ref", "noop", shopId, adminId)
        .then(() => true)
        .catch(() => true);
    }
    return true;
  }

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
      if (!username) {
        await tg.send(cid, "❌ Неверный формат. Отправьте @username канала, ссылку t.me/... или числовой chat_id.");
        return true;
      }
      channelId = `@${username}`;
      channelLink = `https://t.me/${username}`;
    }
    await supabase()
      .from("shops")
      .update({
        required_channel_id: channelId,
        required_channel_link: channelLink,
        updated_at: new Date().toISOString(),
      })
      .eq("id", shopId);
    await clearSession(cid);
    await tg.send(
      cid,
      `✅ Канал установлен: <b>${esc(channelId)}</b>\n\n⚠️ Убедитесь, что бот добавлен в канал как администратор.`,
      ikb([[btn("◀️ К настройкам", "s:se")]]),
    );
    return true;
  }

  // ─── Set CryptoBot token ──────────────────
  if (state === "s_set_cryptobot") {
    if (val.length < 10) {
      await tg.send(cid, "❌ Неверный формат.");
      return true;
    }
    const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!encKey) {
      await tg.send(cid, "❌ Ошибка конфигурации.");
      return true;
    }
    const { data: enc } = await supabase().rpc("encrypt_token", { p_token: val, p_key: encKey });
    await supabase()
      .from("shops")
      .update({ cryptobot_token_encrypted: enc, updated_at: new Date().toISOString() })
      .eq("id", shopId);
    await clearSession(cid);
    await tg.send(cid, "✅ CryptoBot-токен сохранён!", ikb([[btn("◀️ К настройкам", "s:se")]]));
    return true;
  }

  // ─── Set Stars exchange rate (USD per 1 star) ──────────────────
  if (state === "s_set_stars_rate") {
    const raw = val.replace(",", ".").trim();
    const rate = Number(raw);
    if (!isFinite(rate) || rate <= 0 || rate > 10) {
      await tg.send(cid, "❌ Введите положительное число (USD за 1 ⭐). Пример: <code>0.013</code>");
      return true;
    }
    const { data: existing } = await supabase()
      .from("shop_payment_methods")
      .select("config_masked, enabled")
      .eq("shop_id", shopId)
      .eq("method", "stars")
      .maybeSingle();
    const cfg = { ...((existing?.config_masked as any) || {}), usd_per_star: rate };
    await supabase()
      .from("shop_payment_methods")
      .upsert(
        {
          shop_id: shopId,
          method: "stars",
          enabled: existing?.enabled ?? true,
          config_masked: cfg,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shop_id,method" },
      );
    await logAction(shopId, cid, "set_stars_rate", "shop", shopId);
    await clearSession(cid);
    await tg.send(
      cid,
      `✅ Курс сохранён: <b>1 ⭐ = $${rate.toFixed(4)}</b>\n\n💡 <i>Stars начисляются вашему боту. Вывод — через @PremiumBot (Stars → TON).</i>`,
      ikb([[btn("◀️ К оплатам", "s:paym")]]),
    );
    return true;
  }

  // ─── Set xRocket Pay API token ──────────────────
  if (state === "s_set_xrocket_token") {
    const token = val.trim();
    if (token.length < 16 || /\s/.test(token)) {
      await tg.send(cid, "❌ Похоже, это не API-ключ. Попробуйте снова или /cancel.");
      return true;
    }
    const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!encKey) { await tg.send(cid, "❌ Ошибка конфигурации."); return true; }
    const { data: enc } = await supabase().rpc("encrypt_token", { p_token: token, p_key: encKey });
    const { data: existing } = await supabase()
      .from("shop_payment_methods")
      .select("config_masked, enabled")
      .eq("shop_id", shopId)
      .eq("method", "xrocket")
      .maybeSingle();
    const cfg = {
      ...((existing?.config_masked as any) || {}),
      token_set: true,
      currencies: (existing?.config_masked as any)?.currencies || ["USDT", "TONCOIN", "BTC"],
    };
    await supabase().from("shop_payment_methods").upsert(
      {
        shop_id: shopId, method: "xrocket",
        enabled: existing?.enabled ?? true,
        config_encrypted: enc, config_masked: cfg,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,method" },
    );
    await logAction(shopId, cid, "set_xrocket_token", "shop", shopId);
    await clearSession(cid);
    await tg.send(
      cid,
      `✅ Токен xRocket сохранён!\n\nВалюты по умолчанию: <code>${(cfg.currencies as string[]).join(", ")}</code>\nИзменить — кнопка «🪙 Валюты xRocket».`,
      ikb([[btn("◀️ К оплатам", "s:paym")]]),
    );
    return true;
  }

  // ─── Set xRocket Pay accepted currencies ──────────────────
  if (state === "s_set_xrocket_currencies") {
    const allowed = ["USDT","TONCOIN","BTC","ETH","BNB","TRX","SOL","NOT","HMSTR","DOGS","CATI","MAJOR","PX"];
    const list = val.toUpperCase().split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    const filtered = Array.from(new Set(list.filter((c) => allowed.includes(c))));
    if (filtered.length === 0) {
      await tg.send(cid, `❌ Не распознано ни одной валюты. Допустимы: ${allowed.join(", ")}.`);
      return true;
    }
    const { data: existing } = await supabase()
      .from("shop_payment_methods")
      .select("config_masked, enabled, config_encrypted")
      .eq("shop_id", shopId)
      .eq("method", "xrocket")
      .maybeSingle();
    const cfg = { ...((existing?.config_masked as any) || {}), currencies: filtered };
    await supabase().from("shop_payment_methods").upsert(
      {
        shop_id: shopId, method: "xrocket",
        enabled: existing?.enabled ?? false,
        config_masked: cfg,
        ...(existing?.config_encrypted ? {} : {}),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,method" },
    );
    await logAction(shopId, cid, "set_xrocket_currencies", "shop", shopId);
    await clearSession(cid);
    await tg.send(
      cid,
      `✅ Валюты xRocket обновлены: <code>${filtered.join(", ")}</code>`,
      ikb([[btn("◀️ К оплатам", "s:paym")]]),
    );
    return true;
  }

  // ─── Set TON wallet address ──────────────────
  if (state === "s_set_ton_wallet") {
    const wallet = val.trim();
    // Tonkeeper / TON wallet — base64url 48 chars (UQ/EQ/0Q/kQ...) OR raw 0:hex
    const isFriendly = /^[A-Za-z0-9_-]{48}$/.test(wallet);
    const isRaw = /^-?[01]:[0-9a-fA-F]{64}$/.test(wallet);
    if (!isFriendly && !isRaw) {
      await tg.send(
        cid,
        "❌ Не похоже на TON-адрес. Пример: <code>UQABcDeFgHiJkLmNoPqRsTuVwXyZ0123456789AbCdEfGhIj</code>\nИли используйте raw-формат: <code>0:abcdef...</code>",
      );
      return true;
    }
    const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!encKey) { await tg.send(cid, "❌ Ошибка конфигурации."); return true; }
    const { data: enc } = await supabase().rpc("encrypt_token", { p_token: wallet, p_key: encKey });
    const masked = wallet.length > 12 ? `${wallet.slice(0, 6)}…${wallet.slice(-6)}` : wallet;
    const { data: existing } = await supabase()
      .from("shop_payment_methods")
      .select("enabled")
      .eq("shop_id", shopId)
      .eq("method", "ton")
      .maybeSingle();
    await supabase().from("shop_payment_methods").upsert(
      {
        shop_id: shopId, method: "ton",
        enabled: existing?.enabled ?? true,
        config_encrypted: enc,
        config_masked: { wallet_set: true, wallet_masked: masked },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,method" },
    );
    await logAction(shopId, cid, "set_ton_wallet", "shop", shopId);
    await clearSession(cid);
    await tg.send(
      cid,
      `✅ TON-кошелёк сохранён: <code>${esc(masked)}</code>\n\n💎 Покупатели смогут оплачивать заказы переводом TON напрямую на ваш кошелёк через Tonkeeper.`,
      ikb([[btn("◀️ К оплатам", "s:paym")]]),
    );
    return true;
  }

  if (state === "s_set_sbp_bank") {
    await setSession(cid, "s_set_sbp_card", shopId, { ...sData, bankName: val.trim() });
    await tg.send(cid, "💳 Введите номер карты:");
    return true;
  }
  if (state === "s_set_sbp_card") {
    const card = val.replace(/\s+/g, "");
    if (!/^\d{16,19}$/.test(card)) {
      await tg.send(cid, "❌ Неверный номер карты.");
      return true;
    }
    await setSession(cid, "s_set_sbp_name", shopId, {
      ...sData,
      cardNumber: card.replace(/(\d{4})(?=\d)/g, "$1 ").trim(),
    });
    await tg.send(cid, "👤 Введите ФИО получателя:");
    return true;
  }
  if (state === "s_set_sbp_name") {
    await setSession(cid, "s_set_sbp_phone", shopId, { ...sData, recipientName: val.trim() });
    await tg.send(cid, "📱 Введите номер телефона получателя:");
    return true;
  }
  if (state === "s_set_sbp_phone") {
    const phone = val.trim();
    if (!/^\+?[0-9\-\s()]{8,20}$/.test(phone)) {
      await tg.send(cid, "❌ Неверный формат телефона.");
      return true;
    }
    await setSession(cid, "s_set_sbp_comment", shopId, { ...sData, phone });
    await tg.send(cid, "📝 Введите комментарий (или /skip):");
    return true;
  }
  if (state === "s_set_sbp_comment") {
    const payload = {
      bankName: String(sData.bankName || ""),
      cardNumber: String(sData.cardNumber || ""),
      recipientName: String(sData.recipientName || ""),
      phone: String(sData.phone || ""),
      comment: val === "/skip" ? "" : val.trim(),
    };
    const masked = {
      bankName: payload.bankName,
      cardNumber: payload.cardNumber,
      recipientName: payload.recipientName,
      phone: payload.phone,
      comment: payload.comment,
    };
    const encKey = Deno.env.get("TOKEN_ENCRYPTION_KEY");
    if (!encKey) {
      await tg.send(cid, "❌ Ошибка конфигурации.");
      return true;
    }
    const { data: enc } = await supabase().rpc("encrypt_token", { p_token: JSON.stringify(payload), p_key: encKey });
    await supabase().from("shop_payment_methods").upsert(
      {
        shop_id: shopId,
        method: "sbp_card",
        enabled: true,
        config_encrypted: enc,
        config_masked: masked,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "shop_id,method" },
    );
    await clearSession(cid);
    await tg.send(cid, "✅ Реквизиты СБП сохранены.", ikb([[btn("◀️ К оплатам", "s:paym")]]));
    return true;
  }

  if (state.startsWith("s_reject_req:")) {
    const reqId = state.slice("s_reject_req:".length);
    const reason = val.trim();
    if (!reason) {
      await tg.send(cid, "❌ Укажите причину отклонения.");
      return true;
    }
    const { data: req } = await supabase()
      .from("shop_payment_requests")
      .select("*")
      .eq("shop_id", shopId)
      .eq("id", reqId)
      .maybeSingle();
    if (!req) {
      await clearSession(cid);
      await tg.send(cid, "❌ Заявка не найдена.");
      return true;
    }
    const { data: updatedReqs } = await supabase()
      .from("shop_payment_requests")
      .update({
        status: "rejected",
        rejection_reason: reason,
        reviewed_by_telegram_id: adminId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", reqId)
      .eq("status", "pending")
      .select("id");
    if (!updatedReqs?.length) {
      await clearSession(cid);
      await tg.send(cid, "⚠️ Заявка уже обработана.");
      return true;
    }
    await supabase()
      .from("shop_orders")
      .update({
        status: "cancelled",
        payment_status: "failed",
        updated_at: new Date().toISOString(),
      })
      .eq("id", req.order_id);
    await logAction(shopId, adminId, "reject_payment_request", "payment_request", reqId, { reason });
    await tg
      .send(Number(req.buyer_telegram_id), `❌ Заявка на оплату отклонена.\nПричина: ${esc(reason)}`)
      .catch(() => {});
    await clearSession(cid);
    await tg.send(cid, "✅ Заявка отклонена.", ikb([[btn("◀️ К заявкам", "s:rql:0")]]));
    return true;
  }

  // ─── Add inventory ────────────────────────
  if (state.startsWith("ai:")) {
    const pid = state.slice(3);
    const lines = val
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!lines.length) {
      await tg.send(cid, "❌ Отправьте хотя бы одну строку.");
      return true;
    }
    const { error } = await supabase()
      .from("shop_inventory")
      .insert(lines.map((content) => ({ product_id: pid, content, status: "available" })));
    if (error) {
      await tg.send(cid, `❌ ${error.message}`);
      await clearSession(cid);
      return true;
    }
    const { count } = await supabase()
      .from("shop_inventory")
      .select("id", { count: "exact", head: true })
      .eq("product_id", pid)
      .eq("status", "available");
    await supabase()
      .from("shop_products")
      .update({ stock: count || 0, updated_at: new Date().toISOString() })
      .eq("id", pid);
    await logAction(shopId, adminId, "add_inventory", "product", pid, { added: lines.length });
    await clearSession(cid);
    await tg.send(
      cid,
      `✅ Добавлено <b>${lines.length}</b> единиц. Остаток: <b>${count}</b>.`,
      ikb([[btn("🗃 Склад товара", `s:iv:${pid}:0`)], [btn("◀️ Меню", "s:m")]]),
    );
    return true;
  }

  // ─── Broadcast text ───────────────────────
  if (state === "bc:t") {
    await setSession(cid, "bc:preview", shopId, {
      text: val || "",
      photoId: photo?.length ? photo[photo.length - 1].file_id : null,
    });
    const previewText = val || "(без текста)";
    if (photo?.length) {
      await tg.sendPhoto(
        cid,
        photo[photo.length - 1].file_id,
        `📢 <b>Предпросмотр:</b>\n\n${previewText}`,
        ikb([[btn("✅ Отправить", "s:bcsend"), btn("✏️ Редактировать", "s:bcedit"), btn("❌ Отмена", "s:bccancel")]]),
      );
    } else {
      await tg.send(
        cid,
        `📢 <b>Предпросмотр:</b>\n\n${val}`,
        ikb([[btn("✅ Отправить", "s:bcsend"), btn("✏️ Редактировать", "s:bcedit"), btn("❌ Отмена", "s:bccancel")]]),
      );
    }
    return true;
  }

  // ─── Message to user ──────────────────────
  if (state.startsWith("um:")) {
    const uid = parseInt(state.slice(3));
    try {
      await tg.send(uid, val);
      await tg.send(cid, "✅ Отправлено.");
    } catch {
      await tg.send(cid, "❌ Ошибка отправки.");
    }
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
    if (!customers?.length) {
      await tg.send(cid, "❌ Ничего не найдено.", ikb([[btn("◀️ К пользователям", "s:ul:0")]]));
      return true;
    }
    let t = `🔍 <b>Результаты</b> (${customers.length})\n\n`;
    customers.forEach((u) => {
      t += `👤 <b>${esc(u.first_name)}</b> ${u.username ? `@${esc(u.username)}` : ""} | ${u.telegram_id}\n`;
    });
    const rows: Btn[][] = customers.map((u) => [
      btn(safeSlice(`${u.first_name} ${u.last_name || ""}`.trim(), 28), `s:uv:${u.id}`),
    ]);
    rows.push([btn("◀️ К пользователям", "s:ul:0")]);
    await tg.send(cid, t, ikb(rows));
    return true;
  }

  // ─── User note (now using shop_customers) ─────────
  if (state.startsWith("un:")) {
    const tgId = parseInt(state.slice(3));
    await supabase()
      .from("shop_customers")
      .update({ internal_note: val, updated_at: new Date().toISOString() })
      .eq("shop_id", shopId)
      .eq("telegram_id", tgId);
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
      if (isNaN(amount) || amount < 0) {
        await tg.send(cid, "❌ Введите положительное число.");
        return true;
      }
      await setSession(cid, state, shopId, { ...sData, amount });
      await tg.send(cid, "📝 Введите комментарий:");
      return true;
    }

    const amount = sData.amount as number;
    const comment = val;
    const { data: u } = await supabase()
      .from("shop_customers")
      .select("balance")
      .eq("shop_id", shopId)
      .eq("telegram_id", tgId)
      .maybeSingle();
    const current = Number(u?.balance || 0);
    let newBalance: number;
    let histAmount: number;
    let histType: string;

    if (op === "c") {
      newBalance = current + amount;
      histAmount = amount;
      histType = "credit";
    } else if (op === "d") {
      newBalance = Math.max(0, current - amount);
      histAmount = -Math.min(amount, current);
      histType = "debit";
    } else {
      newBalance = amount;
      histAmount = amount - current;
      histType = "set";
    }

    // Ensure shop customer exists before updating balance
    await supabase().rpc("ensure_shop_customer", { p_shop_id: shopId, p_telegram_id: tgId });
    await supabase()
      .from("shop_customers")
      .update({ balance: newBalance, updated_at: new Date().toISOString() })
      .eq("shop_id", shopId)
      .eq("telegram_id", tgId);
    await supabase().from("shop_balance_history").insert({
      shop_id: shopId,
      telegram_id: tgId,
      amount: histAmount,
      balance_after: newBalance,
      type: histType,
      comment,
      admin_telegram_id: adminId,
    });
    await logAction(shopId, adminId, `balance_${histType}`, "user", String(tgId), {
      amount: histAmount,
      balance_after: newBalance,
      comment,
    });
    await clearSession(cid);
    await tg.send(
      cid,
      `✅ Баланс: <b>$${newBalance.toFixed(2)}</b>`,
      ikb([[btn("💰 Баланс", `s:ub:${tgId}`)], [btn("◀️ К пользователю", `s:uvt:${tgId}`)]]),
    );
    return true;
  }

  // ─── Promo creation ───────────────────────
  if (state === "pr:c") {
    await setSession(cid, "pr:t", shopId, { ...sData, code: val.trim().toUpperCase() });
    await tg.send(
      cid,
      `Код: <b>${esc(val.trim().toUpperCase())}</b>\n\nВведите тип (<b>percent</b> или <b>fixed</b>):`,
    );
    return true;
  }
  if (state === "pr:t") {
    const type = val.toLowerCase();
    if (!["percent", "fixed"].includes(type)) {
      await tg.send(cid, "❌ Введите <b>percent</b> или <b>fixed</b>.");
      return true;
    }
    await setSession(cid, "pr:v", shopId, { ...sData, discount_type: type });
    await tg.send(cid, `Введите значение скидки${type === "percent" ? " (%)" : " ($)"}:`);
    return true;
  }
  if (state === "pr:v") {
    const v = parseFloat(val);
    if (isNaN(v) || v <= 0) {
      await tg.send(cid, "❌ Введите число > 0.");
      return true;
    }
    const { error } = await supabase()
      .from("shop_promocodes")
      .insert({
        code: sData.code as string,
        discount_type: sData.discount_type as string,
        discount_value: v,
        is_active: true,
        shop_id: shopId,
      });
    await clearSession(cid);
    if (error) {
      await tg.send(cid, `❌ ${error.message}`);
      return true;
    }
    await logAction(shopId, adminId, "create_promo", "promocode", sData.code as string, {
      discount_type: sData.discount_type,
      discount_value: v,
    });
    await tg.send(
      cid,
      `✅ Промокод <b>${esc(sData.code as string)}</b> создан!`,
      ikb([[btn("🎟 К промокодам", "s:prl:0")], [btn("◀️ Меню", "s:m")]]),
    );
    return true;
  }

  // ─── Auto-product price/limit input ─────────
  if (state.startsWith("aap:")) {
    const [, type, field] = state.split(":");
    if (!["telegram_premium", "telegram_stars"].includes(type)) {
      await clearSession(cid);
      return true;
    }
    const raw = (val || "").trim().replace(",", ".");
    const num = Number(raw);
    if (!Number.isFinite(num) || num < 0) {
      await tg.send(cid, "❌ Введите неотрицательное число.");
      return true;
    }
    const update: Record<string, any> = { updated_at: new Date().toISOString() };
    if (field === "3m") update.price_3m = num > 0 ? num : null;
    else if (field === "6m") update.price_6m = num > 0 ? num : null;
    else if (field === "12m") update.price_12m = num > 0 ? num : null;
    else if (field === "per") update.price_per_star = num > 0 ? num : null;
    else if (field === "min") update.min_stars = Math.max(1, Math.floor(num));
    else if (field === "max") update.max_stars = Math.max(1, Math.floor(num));
    else {
      await clearSession(cid);
      return true;
    }
    await supabase().from("shop_auto_products")
      .update(update).eq("shop_id", shopId).eq("product_type", type);
    await logAction(shopId, adminId, "update_auto_product", "auto_product", type, { field, value: num });
    await clearSession(cid);
    await tg.send(
      cid,
      `✅ Сохранено.`,
      ikb([[btn(`◀️ К ${autoTypeLabel(type)}`, `s:apv:${type}`)], [btn("◀️ Меню", "s:m")]]),
    );
    return true;
  }

  return false;
}

// ═══════════════════════════════════════════════
// AUTO PRODUCTS (Telegram Premium / Stars)
// ═══════════════════════════════════════════════
const AUTO_TYPES = ["telegram_premium", "telegram_stars"] as const;
type AutoType = typeof AUTO_TYPES[number];
const autoTypeLabel = (t: string) => (t === "telegram_premium" ? "⭐ Telegram Premium" : t === "telegram_stars" ? "✨ Telegram Stars" : t);

// Check if shop owner has Premium plan (required to sell Stars/Premium to customers)
async function shopOwnerHasPremium(shopId: string): Promise<boolean> {
  try {
    const { data, error } = await supabase().rpc("shop_has_premium_features" as any, { p_shop_id: shopId });
    if (error) return false;
    return Boolean(data);
  } catch (_e) {
    return false;
  }
}

async function generateShopAvatarFromPrompt(
  tg: ReturnType<typeof TG>,
  cid: number,
  shopId: string,
  adminId: number,
  prompt: string,
  parentId?: string | null,
) {
  const text = (prompt || "").trim();
  if (text.length < 3 || text.length > 500) {
    await tg.send(cid, "❌ Опишите аватарку текстом от 3 до 500 символов.");
    return;
  }
  if (!(await shopOwnerHasPremium(shopId))) {
    await tg.send(cid, premiumUpsellBanner(), ikb([[await premiumUpsellBtn()], [btn("◀️ Меню", "s:m")]]));
    return;
  }

  const quotaRes = await supabase().rpc("get_shop_ai_avatar_quota" as any, { p_shop_id: shopId });
  const quota = (quotaRes.data as any) || { limit: 3, used: 0, remaining: 3, cycle_start: null };
  if (Number(quota.remaining || 0) <= 0) {
    await tg.send(cid, `❌ Лимит генераций исчерпан: ${quota.used}/${quota.limit}. Лимит обновится при продлении подписки.`, ikb([[btn("◀️ Меню", "s:m")]]));
    return;
  }

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  if (!lovableKey) {
    await tg.send(cid, "❌ AI временно не настроен. Сообщите в поддержку.");
    return;
  }

  await tg.send(cid, "🪄 Генерирую аватарку, это может занять до минуты…");

  const { data: shop } = await supabase().from("shops").select("name").eq("id", shopId).maybeSingle();

  let parentImageUrl: string | null = null;
  if (parentId) {
    const { data: parent } = await supabase()
      .from("shop_ai_avatar_generations")
      .select("image_url")
      .eq("id", parentId)
      .eq("shop_id", shopId)
      .maybeSingle();
    parentImageUrl = (parent as any)?.image_url || null;
  }

  const content: any[] = [
    { type: "text", text: buildAvatarPrompt((shop as any)?.name, text, Boolean(parentImageUrl)) },
  ];
  if (parentImageUrl) content.push({ type: "image_url", image_url: { url: parentImageUrl } });

  const models = [
    "google/gemini-3-pro-image-preview",
    "google/gemini-3.1-flash-image-preview",
    "google/gemini-2.5-flash-image",
  ];
  let aiRes: Response | null = null;
  let dataUrl: string | null = null;
  let lastStatus = 0;
  for (const model of models) {
    aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${lovableKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content }],
        modalities: ["image", "text"],
      }),
    });
    lastStatus = aiRes.status;
    if (!aiRes.ok) {
      const errText = await aiRes.text().catch(() => "");
      console.error("[seller-bot-webhook] avatar AI error:", model, aiRes.status, errText.slice(0, 200));
      if (aiRes.status !== 429 && aiRes.status !== 503) break;
      continue;
    }
    const aiJson = await aiRes.json().catch(() => null);
    const url = aiJson?.choices?.[0]?.message?.images?.[0]?.image_url?.url;
    if (typeof url === "string" && url.startsWith("data:image/")) {
      dataUrl = url;
      break;
    }
    const finishReason = aiJson?.choices?.[0]?.finish_reason;
    const textResp = aiJson?.choices?.[0]?.message?.content;
    console.error("[seller-bot-webhook] avatar no image from", model, "finish:", finishReason, "text:", typeof textResp === "string" ? textResp.slice(0, 200) : textResp);
  }
  if (!dataUrl) {
    await tg.send(cid, lastStatus === 429 ? "❌ AI перегружен. Попробуйте через минуту." : "❌ AI не вернул изображение. Попробуйте другой prompt (например: 'логотип кофейни с чашкой').");
    return;
  }
  const m = dataUrl.match(/^data:(image\/[a-z]+);base64,(.+)$/);
  if (!m) {
    await tg.send(cid, "❌ Неверный формат изображения от AI.");
    return;
  }

  const mime = m[1];
  const ext = mime.split("/")[1] || "png";
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  const path = `ai/${shopId}-${Date.now()}.${ext}`;
  const { error: uploadError } = await supabase().storage.from("bot-avatars").upload(path, bytes, { contentType: mime, upsert: false });
  if (uploadError) {
    console.error("[seller-bot-webhook] avatar upload error:", uploadError.message);
    await tg.send(cid, "❌ Не удалось сохранить аватарку.");
    return;
  }

  const { data: pub } = supabase().storage.from("bot-avatars").getPublicUrl(path);
  const publicUrl = pub.publicUrl;
  const { data: gen, error: genError } = await supabase()
    .from("shop_ai_avatar_generations")
    .insert({
      shop_id: shopId,
      owner_telegram_id: adminId,
      prompt: text,
      parent_id: parentId || null,
      image_url: publicUrl,
      subscription_cycle_start: quota.cycle_start || new Date().toISOString(),
    })
    .select("id")
    .single();
  if (genError) {
    console.error("[seller-bot-webhook] avatar generation log error:", genError.message);
    await supabase().storage.from("bot-avatars").remove([path]).catch(() => null);
    await tg.send(cid, "❌ Не удалось учесть генерацию. Попробуйте ещё раз позже.");
    return;
  }

  await supabase().from("shops").update({
    bot_avatar_url: publicUrl,
    ai_avatar_generated_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", shopId);
  await logAction(shopId, adminId, "generate_ai_avatar", "shop", shopId, { generation_id: (gen as any)?.id || null });

  const newQuotaRes = await supabase().rpc("get_shop_ai_avatar_quota" as any, { p_shop_id: shopId });
  const newQuota = (newQuotaRes.data as any) || quota;
  const caption = `✅ <b>AI-аватарка готова и установлена</b>\n\nОсталось генераций: <b>${newQuota.remaining}/${newQuota.limit}</b>`;
  const rows: Btn[][] = [];
  if ((gen as any)?.id) rows.push([btn("✨ Внести правки", `s:aiav_edit:${(gen as any).id}`)]);
  rows.push([btn("🪄 Новая генерация", "s:aiav"), btn("◀️ Меню", "s:m")]);
  const sent = await tg.sendPhoto(cid, publicUrl, caption, ikb(rows));
  if (!sent?.ok) await tg.send(cid, `${caption}\n\n${publicUrl}`, ikb(rows));
}

function premiumUpsellBanner(): string {
  return (
    `🔒 <b>Доступно на тарифе Премиум</b>\n\n` +
    `Продажа Telegram Premium и Stars вашим покупателям — Premium-функция платформы.\n\n` +
    `Откройте платформенного бота → подписка → выберите 💎 Премиум, и эти разделы автоматически активируются для покупателей в вашем магазине.\n`
  );
}

async function ensureAutoProduct(shopId: string, type: AutoType) {
  const { data: existing } = await supabase()
    .from("shop_auto_products")
    .select("id")
    .eq("shop_id", shopId)
    .eq("product_type", type)
    .maybeSingle();
  if (existing) return;
  await supabase().from("shop_auto_products").insert({
    shop_id: shopId,
    product_type: type,
    is_enabled: false,
    ...(type === "telegram_stars" ? { min_stars: 50, max_stars: 100000 } : {}),
  });
}

async function autoProductsHome(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string) {
  const hasPremium = await shopOwnerHasPremium(shopId);
  if (!hasPremium) {
    const text =
      premiumUpsellBanner() +
      `\n<i>Сейчас покупатели не видят эти разделы в вашем магазине.</i>`;
    return tg.edit(cid, mid, text, ikb([
      [await premiumUpsellBtn()],
      [btn("◀️ Меню", "s:m")],
    ]));
  }
  for (const t of AUTO_TYPES) await ensureAutoProduct(shopId, t);
  const { data: rows } = await supabase()
    .from("shop_auto_products")
    .select("product_type, is_enabled, price_3m, price_6m, price_12m, price_per_star")
    .eq("shop_id", shopId);
  const map = new Map<string, any>();
  (rows || []).forEach((r: any) => map.set(r.product_type, r));

  let t = `🤖 <b>Авто-товары</b>\n\nГотовые товары с автоматизированной обработкой. Включите, задайте цены — клиенты смогут оформлять заказы. Выдача — вручную через раздел «Авто-заказы».\n\n`;
  const rowsKb: Btn[][] = [];
  for (const type of AUTO_TYPES) {
    const r = map.get(type);
    const enabled = r?.is_enabled ? "✅" : "❌";
    let priceLine = "не настроено";
    if (type === "telegram_premium") {
      const parts: string[] = [];
      if (r?.price_3m) parts.push(`3м $${Number(r.price_3m).toFixed(2)}`);
      if (r?.price_6m) parts.push(`6м $${Number(r.price_6m).toFixed(2)}`);
      if (r?.price_12m) parts.push(`12м $${Number(r.price_12m).toFixed(2)}`);
      if (parts.length) priceLine = parts.join(" • ");
    } else if (type === "telegram_stars" && r?.price_per_star) {
      priceLine = `$${Number(r.price_per_star).toFixed(4)} / ⭐`;
    }
    t += `${enabled} <b>${autoTypeLabel(type)}</b>\n💰 ${priceLine}\n\n`;
    rowsKb.push([btn(`${enabled} ${autoTypeLabel(type)}`, `s:apv:${type}`)]);
  }
  rowsKb.push([btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rowsKb));
}

async function autoProductView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, type: string) {
  if (!AUTO_TYPES.includes(type as AutoType)) {
    return tg.edit(cid, mid, "❌ Неизвестный тип", ikb([[btn("◀️ Назад", "s:ap")]]));
  }
  if (!(await shopOwnerHasPremium(shopId))) {
    return tg.edit(cid, mid, premiumUpsellBanner(), ikb([
      [await premiumUpsellBtn()],
      [btn("◀️ Меню", "s:m")],
    ]));
  }
  await ensureAutoProduct(shopId, type as AutoType);
  const { data: r } = await supabase()
    .from("shop_auto_products").select("*")
    .eq("shop_id", shopId).eq("product_type", type).maybeSingle();
  if (!r) return tg.edit(cid, mid, "❌ Не найдено", ikb([[btn("◀️ Назад", "s:ap")]]));

  const enabled = r.is_enabled ? "✅ Включён" : "❌ Выключен";
  let info = `${autoTypeLabel(type)}\n\n📊 Статус: <b>${enabled}</b>\n\n`;
  const kb: Btn[][] = [];

  if (type === "telegram_premium") {
    info +=
      `💰 <b>Цены:</b>\n` +
      `• 3 месяца: ${r.price_3m ? `$${Number(r.price_3m).toFixed(2)}` : "—"}\n` +
      `• 6 месяцев: ${r.price_6m ? `$${Number(r.price_6m).toFixed(2)}` : "—"}\n` +
      `• 12 месяцев: ${r.price_12m ? `$${Number(r.price_12m).toFixed(2)}` : "—"}\n`;
    kb.push([btn("✏️ Цена 3 мес", `s:ape:${type}:3m`)]);
    kb.push([btn("✏️ Цена 6 мес", `s:ape:${type}:6m`)]);
    kb.push([btn("✏️ Цена 12 мес", `s:ape:${type}:12m`)]);
  } else {
    info +=
      `💰 Цена за 1 звезду: ${r.price_per_star ? `$${Number(r.price_per_star).toFixed(4)}` : "—"}\n` +
      `📉 Минимум: ${r.min_stars || 50} ⭐\n` +
      `📈 Максимум: ${r.max_stars || 100000} ⭐\n`;
    kb.push([btn("✏️ Цена за 1 ⭐", `s:ape:${type}:per`)]);
    kb.push([btn("✏️ Min", `s:ape:${type}:min`), btn("✏️ Max", `s:ape:${type}:max`)]);
  }

  kb.push([btn(r.is_enabled ? "❌ Выключить" : "✅ Включить", `s:apt:${type}`)]);
  kb.push([btn("◀️ К авто-товарам", "s:ap"), btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, info, ikb(kb));
}

// ═══════════════════════════════════════════════
// AUTO ORDERS (manual fulfillment)
// ═══════════════════════════════════════════════
async function autoOrdersList(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, page: number) {
  const { data: orders } = await supabase()
    .from("shop_orders")
    .select("id, order_number, product_type, target_user, premium_duration, stars_amount, total_amount, fulfillment_status, status, created_at")
    .eq("shop_id", shopId)
    .in("product_type", ["telegram_premium", "telegram_stars"])
    .in("payment_status", ["paid"])
    .order("created_at", { ascending: false })
    .limit(200);

  if (!orders?.length) {
    return tg.edit(cid, mid, "📲 <b>Авто-заказы</b>\n\nПока нет оплаченных авто-заказов.", ikb([[btn("◀️ Меню", "s:m")]]));
  }
  const pg = paginate(orders, page, 8);
  let t = `📲 <b>Авто-заказы</b> (${orders.length})\n\n⏳ — ожидает выдачи\n✅ — выдан\n⚠️ — ошибка выдачи\n\n`;
  const rows: Btn[][] = pg.items.map((o: any) => {
    const icon = o.fulfillment_status === "completed" ? "✅" : o.fulfillment_status === "failed" ? "⚠️" : "⏳";
    const kind = o.product_type === "telegram_premium"
      ? `Premium ${o.premium_duration || ""}`
      : `${o.stars_amount || 0}⭐`;
    return [btn(safeSlice(`${icon} ${o.order_number} • ${kind}`, 56), `s:aov:${o.id}`)];
  });
  if (pg.total > 1) rows.push(pgRow("s:ao", pg.page, pg.total));
  rows.push([btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(rows));
}

async function autoOrderView(tg: ReturnType<typeof TG>, cid: number, mid: number, shopId: string, oid: string) {
  const { data: o } = await supabase()
    .from("shop_orders").select("*").eq("id", oid).eq("shop_id", shopId).maybeSingle();
  if (!o) return tg.edit(cid, mid, "❌ Заказ не найден", ikb([[btn("◀️ Назад", "s:ao:0")]]));

  const isPremium = o.product_type === "telegram_premium";
  const dur = o.premium_duration === "3m" ? "3 месяца" : o.premium_duration === "6m" ? "6 месяцев" : o.premium_duration === "12m" ? "12 месяцев" : "—";
  const fStatus = o.fulfillment_status === "completed" ? "✅ Выдан" : o.fulfillment_status === "failed" ? "⚠️ Ошибка" : o.fulfillment_status === "processing" ? "⏳ В работе" : "⏳ Ожидает";
  const fComment = o.fulfillment_comment ? `\n💬 ${esc(o.fulfillment_comment)}` : "";
  const fulfilledAt = o.fulfilled_at ? `\n🕒 Выдано: ${new Date(o.fulfilled_at).toLocaleString("ru-RU")}` : "";

  const t =
    `📲 <b>Авто-заказ ${esc(o.order_number)}</b>\n\n` +
    `${isPremium ? `⭐ <b>Telegram Premium</b> (${dur})` : `✨ <b>${o.stars_amount} Telegram Stars</b>`}\n` +
    `👤 Получатель: <code>${esc(o.target_user || "")}</code>\n` +
    `💰 Сумма: $${Number(o.total_amount).toFixed(2)}\n` +
    `🆔 Покупатель: <code>${o.buyer_telegram_id}</code>\n` +
    `📅 Создан: ${new Date(o.created_at).toLocaleString("ru-RU")}\n\n` +
    `📊 Статус выдачи: <b>${fStatus}</b>${fulfilledAt}${fComment}`;

  const kb: Btn[][] = [];
  if (o.fulfillment_status !== "completed") {
    kb.push([btn("✅ Отметить выданным", `s:aoc:${o.id}`)]);
  }
  if (o.fulfillment_status !== "failed" && o.fulfillment_status !== "completed") {
    kb.push([btn("⚠️ Отметить ошибкой", `s:aof:${o.id}`)]);
  }
  kb.push([btn("◀️ К авто-заказам", "s:ao:0"), btn("◀️ Меню", "s:m")]);
  return tg.edit(cid, mid, t, ikb(kb));
}

async function notifyBuyerAutoFulfilled(shopId: string, botToken: string | null, order: any, success: boolean, comment: string | null) {
  if (!botToken) return;
  const isPremium = order.product_type === "telegram_premium";
  const product = isPremium
    ? `⭐ Telegram Premium (${order.premium_duration || ""})`
    : `✨ ${order.stars_amount} Telegram Stars`;
  const txt = success
    ? `✅ <b>Ваш заказ выдан!</b>\n\n📦 ${esc(order.order_number)}\n${product}\n👤 Получатель: <code>${esc(order.target_user || "")}</code>\n\nПроверьте получение в Telegram. Спасибо за покупку!`
    : `⚠️ <b>Возникла проблема с выдачей</b>\n\n📦 ${esc(order.order_number)}\n${product}\n${comment ? `\n💬 ${esc(comment)}\n` : ""}\nСвяжитесь с поддержкой магазина для возврата средств или повторной попытки.`;
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: order.buyer_telegram_id, text: txt, parse_mode: "HTML" }),
  }).catch((e) => console.error("[auto-order] buyer notify err:", e));
}

// ═══════════════════════════════════════════════
// CALLBACK HANDLER
// ═══════════════════════════════════════════════
async function handleCallback(
  tg: ReturnType<typeof TG>,
  cid: number,
  mid: number,
  data: string,
  cbId: string,
  shopId: string,
  adminId: number,
  botToken?: string,
) {
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
    if (cmd === "aiav") {
      if (!(await shopOwnerHasPremium(shopId))) {
        return tg.edit(cid, mid, premiumUpsellBanner(), ikb([[await premiumUpsellBtn()], [btn("◀️ Меню", "s:m")]]));
      }
      const quotaRes = await supabase().rpc("get_shop_ai_avatar_quota" as any, { p_shop_id: shopId });
      const quota = (quotaRes.data as any) || { limit: 3, used: 0, remaining: 3 };
      await setSession(cid, "aiav", shopId);
      return tg.send(
        cid,
        `🪄 <b>AI-аватарка магазина</b>\n\nОсталось генераций: <b>${quota.remaining}/${quota.limit}</b>\n\nОпишите аватарку: ниша магазина, стиль, цвета, настроение. До 500 символов.\n\n/cancel — отмена`,
      );
    }
    if (cmd === "aiav_edit") {
      const genId = parts[2];
      await setSession(cid, `aiav_edit:${genId}`, shopId);
      return tg.send(cid, "✨ Что изменить в аватарке?\n\nНапример: сделать фон темнее, добавить больше неона, упростить иконку.\n\n/cancel — отмена");
    }

    // Products
    if (cmd === "pl") return productsList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "pv") return productView(tg, cid, mid, shopId, parts[2]);
    if (cmd === "pt") {
      const pid = parts[2];
      const { data: p } = await supabase().from("shop_products").select("is_active, name").eq("id", pid).single();
      if (p) {
        await supabase()
          .from("shop_products")
          .update({ is_active: !p.is_active, updated_at: new Date().toISOString() })
          .eq("id", pid);
        await logAction(shopId, adminId, "toggle_active", "product", pid, { is_active: !p.is_active });
      }
      return productView(tg, cid, mid, shopId, pid);
    }
    if (cmd === "pd") {
      const pid = parts[2];
      const { data: p } = await supabase().from("shop_products").select("name").eq("id", pid).single();
      return tg.edit(
        cid,
        mid,
        `⚠️ <b>Удалить?</b>\n\n${esc(p?.name || "?")}\n\nЭто необратимо!`,
        ikb([[btn("✅ Да, удалить", `s:py:${pid}`), btn("❌ Отмена", `s:pv:${pid}`)]]),
      );
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
      const pid = parts[2];
      const f = parts[3];
      if (f === "img") {
        await setSession(cid, `ep:img:${pid}`, shopId);
        return tg.send(cid, "🖼 Отправьте фото товара:\n\n/cancel — отмена");
      }
      const labels: Record<string, string> = {
        n: "название",
        p: "цену (USD)",
        s: "остаток (число)",
        d: "описание",
        o: "старую цену (USD)",
        sub: "подзаголовок",
        f: "особенности (через запятую)",
      };
      await setSession(cid, `ep:${f}:${pid}`, shopId);
      return tg.send(cid, `✏️ Введите <b>${labels[f] || f}</b>:\n\n/cancel — отмена`);
    }

    // Categories
    if (cmd === "cl") return categoriesList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "cv") return categoryView(tg, cid, mid, shopId, parts[2]);
    if (cmd === "ct") {
      const catId = parts[2];
      const { data: c } = await supabase().from("shop_categories").select("is_active").eq("id", catId).single();
      if (c) {
        await supabase().from("shop_categories").update({ is_active: !c.is_active }).eq("id", catId);
        await logAction(shopId, adminId, "toggle_cat", "category", catId);
      }
      return categoryView(tg, cid, mid, shopId, catId);
    }
    if (cmd === "ca") {
      await setSession(cid, "ac:n", shopId);
      return tg.send(cid, "📁 <b>Новая категория</b>\n\nВведите название:");
    }
    if (cmd === "ce") {
      const catId = parts[2];
      const f = parts[3];
      const labels: Record<string, string> = { n: "название", i: "иконку (emoji)", s: "порядок сортировки" };
      await setSession(cid, `ec:${f}:${catId}`, shopId);
      return tg.send(cid, `✏️ Введите <b>${labels[f] || f}</b>:\n\n/cancel — отмена`);
    }
    if (cmd === "cd") {
      const catId = parts[2];
      const { data: c } = await supabase().from("shop_categories").select("name").eq("id", catId).single();
      return tg.edit(
        cid,
        mid,
        `⚠️ <b>Удалить категорию?</b>\n\n${esc(c?.name || "?")}`,
        ikb([[btn("✅ Удалить", `s:cdy:${catId}`), btn("❌ Отмена", `s:cv:${catId}`)]]),
      );
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
      await supabase()
        .from("seller_sessions")
        .upsert(
          { telegram_id: adminId, shop_id: shopId, state: `pc_pick:${pid}` },
          { onConflict: "telegram_id,shop_id" },
        );
      const { data: cats } = await supabase()
        .from("shop_categories")
        .select("id, name, icon")
        .eq("shop_id", shopId)
        .eq("is_active", true)
        .order("sort_order");
      if (!cats?.length)
        return tg.edit(
          cid,
          mid,
          "📁 Нет категорий. Сначала создайте категорию.",
          ikb([[btn("📁 Создать категорию", "s:ca")], [btn("◀️ К товару", `s:pv:${pid}`)]]),
        );
      const rows: Btn[][] = cats.map((c) => [btn(`${c.icon} ${c.name}`, `s:pcs:${c.id}`)]);
      rows.push([btn("🚫 Без категории", `s:pcr`)]);
      rows.push([btn("◀️ К товару", `s:pv:${pid}`)]);
      return tg.edit(cid, mid, "📁 <b>Выберите категорию:</b>", ikb(rows));
    }
    if (cmd === "pcs") {
      const catId = parts[2];
      const { data: sess } = await supabase()
        .from("seller_sessions")
        .select("state")
        .eq("telegram_id", adminId)
        .eq("shop_id", shopId)
        .single();
      const pid = sess?.state?.split(":")?.[1];
      if (!pid) return;
      await supabase()
        .from("shop_products")
        .update({ category_id: catId, updated_at: new Date().toISOString() })
        .eq("id", pid);
      await logAction(shopId, adminId, "set_category", "product", pid, { category_id: catId });
      return productView(tg, cid, mid, shopId, pid);
    }
    if (cmd === "pcr") {
      const { data: sess } = await supabase()
        .from("seller_sessions")
        .select("state")
        .eq("telegram_id", adminId)
        .eq("shop_id", shopId)
        .single();
      const pid = sess?.state?.split(":")?.[1];
      if (!pid) return;
      await supabase()
        .from("shop_products")
        .update({ category_id: null, updated_at: new Date().toISOString() })
        .eq("id", pid);
      await logAction(shopId, adminId, "remove_category", "product", pid);
      return productView(tg, cid, mid, shopId, pid);
    }

    // Products in category
    if (cmd === "cprod") {
      const catId = parts[2];
      const page = parseInt(parts[3]) || 0;
      const { data: cat } = await supabase().from("shop_categories").select("name, icon").eq("id", catId).single();
      const { data: products } = await supabase()
        .from("shop_products")
        .select("id, name, price, stock, is_active")
        .eq("shop_id", shopId)
        .eq("category_id", catId)
        .order("sort_order");
      if (!products?.length)
        return tg.edit(
          cid,
          mid,
          `📁 <b>${cat ? `${cat.icon} ${esc(cat.name)}` : "Категория"}</b>\n\nТоваров нет.`,
          ikb([[btn("◀️ К категории", `s:cv:${catId}`)]]),
        );
      const pg = paginate(products, page, 8);
      let t = `📁 <b>${cat ? `${cat.icon} ${esc(cat.name)}` : "Категория"}</b> — товары (${products.length})\n\n`;
      pg.items.forEach((p) => {
        t += `${p.is_active ? "✅" : "❌"} <b>${esc(p.name)}</b> — $${Number(p.price).toFixed(2)}\n`;
      });
      const rows: Btn[][] = pg.items.map((p) => [
        btn(`${p.is_active ? "✅" : "❌"} ${safeSlice(p.name, 28)}`, `s:pv:${p.id}`),
      ]);
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
      return tg.edit(
        cid,
        mid,
        "📊 <b>Фильтр пользователей</b>",
        ikb([
          [btn("Все", "s:ul:0"), btn("👑 VIP", "s:ulf:vip:0"), btn("🚫 Заблокированные", "s:ulf:blocked:0")],
          [btn("◀️ Назад", "s:ul:0")],
        ]),
      );
    }
    if (cmd === "usq") {
      await setSession(cid, "us:q", shopId);
      return tg.send(cid, "🔍 Введите TG ID, username или имя:\n\n/cancel — отмена");
    }
    if (cmd === "uv") return userView(tg, cid, mid, shopId, parts[2]);
    if (cmd === "uvt") return userViewByTg(tg, cid, mid, shopId, parseInt(parts[2]));
    if (cmd === "um") {
      const uid = parts[2];
      await setSession(cid, `um:${uid}`, shopId);
      return tg.send(cid, "✍️ Введите сообщение:\n\n/cancel — отмена");
    }

    // User orders
    if (cmd === "uo") {
      const tgId = parseInt(parts[2]);
      const page = parseInt(parts[3] || "0");
      return userOrdersList(tg, cid, mid, shopId, tgId, page);
    }

    // User balance
    if (cmd === "ub") return balanceMenu(tg, cid, mid, shopId, parseInt(parts[2]));
    if (cmd === "ubc") {
      const tgId = parts[2];
      await setSession(cid, `bal:c:${tgId}`, shopId);
      return tg.send(cid, "➕ Введите сумму для начисления:\n\n/cancel — отмена");
    }
    if (cmd === "ubd") {
      const tgId = parts[2];
      await setSession(cid, `bal:d:${tgId}`, shopId);
      return tg.send(cid, "➖ Введите сумму для списания:\n\n/cancel — отмена");
    }
    if (cmd === "ubs") {
      const tgId = parts[2];
      await setSession(cid, `bal:s:${tgId}`, shopId);
      return tg.send(cid, "🎯 Введите новое значение баланса:\n\n/cancel — отмена");
    }

    // User role (now using shop_customers)
    if (cmd === "ur") {
      const tgId = parseInt(parts[2]);
      return tg.edit(
        cid,
        mid,
        `🏷 <b>Изменить роль</b> — TG ${tgId}`,
        ikb([
          [
            btn("👤 user", `s:urs:${tgId}:user`),
            btn("👑 vip", `s:urs:${tgId}:vip`),
            btn("🚫 blocked", `s:urs:${tgId}:blocked`),
          ],
          [btn("◀️ Назад", `s:uvt:${tgId}`)],
        ]),
      );
    }
    if (cmd === "urs") {
      const tgId = parseInt(parts[2]);
      const role = parts[3];
      await supabase()
        .from("shop_customers")
        .update({ role, updated_at: new Date().toISOString() })
        .eq("shop_id", shopId)
        .eq("telegram_id", tgId);
      await logAction(shopId, adminId, "set_role", "user", String(tgId), { role });
      return userViewByTg(tg, cid, mid, shopId, tgId);
    }

    // User block/unblock (now using shop_customers)
    if (cmd === "ux") {
      const tgId = parseInt(parts[2]);
      const { data: u } = await supabase()
        .from("shop_customers")
        .select("is_blocked")
        .eq("shop_id", shopId)
        .eq("telegram_id", tgId)
        .maybeSingle();
      if (u) {
        const newVal = !u.is_blocked;
        await supabase()
          .from("shop_customers")
          .update({ is_blocked: newVal, updated_at: new Date().toISOString() })
          .eq("shop_id", shopId)
          .eq("telegram_id", tgId);
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
      const tgId = parseInt(parts[2]);
      const page = parseInt(parts[3] || "0");
      return userLogsList(tg, cid, mid, shopId, tgId, page);
    }

    // Promocodes
    if (cmd === "prl") return promosList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "prv") return promoView(tg, cid, mid, shopId, parts[2]);
    if (cmd === "pra") {
      await setSession(cid, "pr:c", shopId);
      return tg.send(cid, "🎟 <b>Новый промокод</b>\n\nВведите код:");
    }
    if (cmd === "prt") {
      const prId = parts[2];
      const { data: p } = await supabase().from("shop_promocodes").select("is_active").eq("id", prId).single();
      if (p) {
        await supabase().from("shop_promocodes").update({ is_active: !p.is_active }).eq("id", prId);
        await logAction(shopId, adminId, "toggle_promo", "promocode", prId);
      }
      return promoView(tg, cid, mid, shopId, prId);
    }
    if (cmd === "prd") {
      const prId = parts[2];
      const { data: p } = await supabase().from("shop_promocodes").select("code").eq("id", prId).single();
      return tg.edit(
        cid,
        mid,
        `⚠️ <b>Удалить промокод?</b>\n\n<code>${esc(p?.code || "?")}</code>`,
        ikb([[btn("✅ Удалить", `s:prdy:${prId}`), btn("❌ Отмена", `s:prv:${prId}`)]]),
      );
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
    if (cmd === "paym") return paymentMethodsView(tg, cid, mid, shopId);
    if (cmd === "paytoggle") {
      const method = parts[2];
      const { data: row } = await supabase()
        .from("shop_payment_methods")
        .select("enabled, config_masked")
        .eq("shop_id", shopId)
        .eq("method", method)
        .maybeSingle();
      const enabled = !row?.enabled;
      // Guard: Stars require usd_per_star rate before enabling
      if (method === "stars" && enabled) {
        const rate = Number((row?.config_masked as any)?.usd_per_star || 0);
        if (!(rate > 0)) {
          await tg.answer(cbId, "Сначала задайте курс Stars").catch(() => null);
          await setSession(cid, "s_set_stars_rate", shopId, {});
          await tg.send(
            cid,
            "⭐ <b>Установка курса Stars</b>\n\nСколько <b>USD стоит 1 звезда</b>?\nПример: <code>0.013</code>\n\nЦена товара в $ будет конвертирована автоматически.\n\n/cancel — отмена.",
          );
          return;
        }
      }
      // Guard: xRocket requires API token before enabling
      if (method === "xrocket" && enabled) {
        const { data: full } = await supabase()
          .from("shop_payment_methods")
          .select("config_encrypted")
          .eq("shop_id", shopId)
          .eq("method", "xrocket")
          .maybeSingle();
        if (!full?.config_encrypted) {
          await tg.answer(cbId, "Сначала укажите токен xRocket Pay").catch(() => null);
          await setSession(cid, "s_set_xrocket_token", shopId, {});
          await tg.send(
            cid,
            "🚀 <b>Подключение xRocket Pay</b>\n\nОтправьте API-ключ от вашего <b>xRocket Pay</b>-приложения.\n\n<b>Где взять:</b>\n1. Откройте <a href=\"https://t.me/xrocket\">@xRocket</a> → Pay → Создать\n2. Создайте приложение → API токен\n3. Скопируйте ключ и пришлите сюда.\n\n💡 Курс к USD рассчитывается автоматически на момент оплаты.\n\n/cancel — отмена.",
            ikb([[btn("❌ Отмена", "s:paym")]]),
          );
          return;
        }
      }
      // Guard: TON requires wallet address before enabling
      if (method === "ton" && enabled) {
        const { data: full } = await supabase()
          .from("shop_payment_methods")
          .select("config_encrypted")
          .eq("shop_id", shopId)
          .eq("method", "ton")
          .maybeSingle();
        if (!full?.config_encrypted) {
          await tg.answer(cbId, "Сначала укажите TON-кошелёк").catch(() => null);
          await setSession(cid, "s_set_ton_wallet", shopId, {});
          await tg.send(
            cid,
            "💎 <b>Подключение TON / Tonkeeper</b>\n\nОтправьте адрес вашего TON-кошелька.\n\n<b>Где взять:</b>\n1. Откройте <a href=\"https://tonkeeper.com\">Tonkeeper</a> → ваш кошелёк → Получить\n2. Скопируйте адрес (начинается с <code>UQ</code> или <code>EQ</code>)\n3. Пришлите сюда.\n\n💡 Платежи поступают напрямую на ваш кошелёк. Курс USD→TON считается автоматически.\n\n/cancel — отмена.",
            ikb([[btn("❌ Отмена", "s:paym")]]),
          );
          return;
        }
      }
      await supabase().from("shop_payment_methods").upsert(
        {
          shop_id: shopId,
          method,
          enabled,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "shop_id,method" },
      );
      await logAction(shopId, adminId, enabled ? `enable_${method}` : `disable_${method}`, "shop", shopId);
      return paymentMethodsView(tg, cid, mid, shopId);
    }
    if (cmd === "setsbp") {
      await setSession(cid, "s_set_sbp_bank", shopId, {});
      return tg.send(cid, "🏦 Введите название банка для СБП:");
    }
    if (cmd === "setstars") {
      await setSession(cid, "s_set_stars_rate", shopId, {});
      await tg.deleteMessage(cid, mid).catch(() => null);
      return tg.send(
        cid,
        "⭐ <b>Курс Telegram Stars</b>\n\nСколько <b>USD стоит 1 звезда</b>?\nПример: <code>0.013</code>\n\nЦена товара в $ будет конвертирована автоматически.\n\n💡 <i>Stars начисляются вашему боту. <a href=\"https://vc.ru/telegram/2729012-vydvod-telegram-stars\">Инструкция по выводу Stars</a>.</i>\n\n/cancel — отмена.",
        ikb([[btn("❌ Отмена", "s:paym")]]),
      );
    }
    if (cmd === "setxr") {
      await setSession(cid, "s_set_xrocket_token", shopId, {});
      await tg.deleteMessage(cid, mid).catch(() => null);
      return tg.send(
        cid,
        "🚀 <b>Токен xRocket Pay</b>\n\nОтправьте API-ключ от вашего xRocket Pay-приложения.\n\n<b>Где взять:</b>\n1. Откройте <a href=\"https://t.me/xrocket\">@xRocket</a> → Pay → Создать\n2. Создайте приложение → API токен\n3. Скопируйте ключ и пришлите сюда.\n\n💡 Курс к USD рассчитывается автоматически на момент оплаты.\n\n/cancel — отмена.",
        ikb([[btn("❌ Отмена", "s:paym")]]),
      );
    }
    if (cmd === "setxrcur") {
      await setSession(cid, "s_set_xrocket_currencies", shopId, {});
      await tg.deleteMessage(cid, mid).catch(() => null);
      return tg.send(
        cid,
        "🪙 <b>Валюты xRocket</b>\n\nПеречислите тикеры через запятую — какие валюты предлагать покупателю.\n\nПример: <code>USDT, TONCOIN, BTC, ETH, BNB, TRX, SOL, NOT</code>\n\nДоступны: USDT, TONCOIN, BTC, ETH, BNB, TRX, SOL, NOT, HMSTR, DOGS, CATI, MAJOR, PX.\n\n/cancel — отмена.",
        ikb([[btn("❌ Отмена", "s:paym")]]),
      );
    }
    if (cmd === "setton") {
      await setSession(cid, "s_set_ton_wallet", shopId, {});
      await tg.deleteMessage(cid, mid).catch(() => null);
      return tg.send(
        cid,
        "💎 <b>TON-кошелёк</b>\n\nОтправьте адрес вашего TON-кошелька.\n\n<b>Где взять:</b>\n1. Откройте <a href=\"https://tonkeeper.com\">Tonkeeper</a> → ваш кошелёк → Получить\n2. Скопируйте адрес (начинается с <code>UQ</code> или <code>EQ</code>)\n3. Пришлите сюда.\n\n💡 Платежи поступают напрямую на ваш кошелёк, без посредников. Курс USD→TON считается автоматически на момент оплаты.\n\n/cancel — отмена.",
        ikb([[btn("❌ Отмена", "s:paym")]]),
      );
    }
    if (cmd === "rql") return paymentRequestsList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "rqv") return paymentRequestView(tg, cid, mid, shopId, parts[2], botToken);
    if (cmd === "rqa") return approvePaymentRequest(tg, cid, mid, shopId, parts[2], adminId, botToken);
    if (cmd === "rqr") {
      await setSession(cid, `s_reject_req:${parts[2]}`, shopId, {});
      return tg.send(cid, "❌ Укажите причину отклонения заявки:");
    }

    // OP subscription settings
    if (cmd === "opsettings") {
      const { data: s } = await supabase()
        .from("shops")
        .select("is_subscription_required, required_channel_link, required_channel_id")
        .eq("id", shopId)
        .single();
      const enabled = s?.is_subscription_required || false;
      const ch = s?.required_channel_id || "не указан";
      const lnk = s?.required_channel_link || "—";
      let t = `📢 <b>Обязательная подписка (ОП)</b>\n\n`;
      t += `Статус: <b>${enabled ? "✅ включена" : "❌ выключена"}</b>\n`;
      t += `Канал: <b>${esc(ch)}</b>\n`;
      t += `Ссылка: ${esc(lnk)}\n\n`;
      t += `Когда включено, пользователь должен подписаться на канал перед использованием магазина.\n\n`;
      t += `⚠️ Бот магазина должен быть добавлен в канал как администратор.`;
      return tg.edit(
        cid,
        mid,
        t,
        ikb([
          [btn(enabled ? "❌ Выключить" : "✅ Включить", "s:optoggle")],
          [btn("📢 Указать канал", "s:opsetc")],
          [btn("🔍 Проверить бота", "s:optest")],
          [btn("◀️ К настройкам", "s:se")],
        ]),
      );
    }
    if (cmd === "optoggle") {
      const { data: s } = await supabase().from("shops").select("is_subscription_required").eq("id", shopId).single();
      const newVal = !s?.is_subscription_required;
      await supabase()
        .from("shops")
        .update({ is_subscription_required: newVal, updated_at: new Date().toISOString() })
        .eq("id", shopId);
      await logAction(shopId, adminId, newVal ? "enable_op" : "disable_op", "shop", shopId);
      // Re-render OP settings
      const { data: s2 } = await supabase()
        .from("shops")
        .select("is_subscription_required, required_channel_link, required_channel_id")
        .eq("id", shopId)
        .single();
      const enabled = s2?.is_subscription_required || false;
      const ch = s2?.required_channel_id || "не указан";
      const lnk = s2?.required_channel_link || "—";
      let t = `📢 <b>Обязательная подписка (ОП)</b>\n\n`;
      t += `Статус: <b>${enabled ? "✅ включена" : "❌ выключена"}</b>\n`;
      t += `Канал: <b>${esc(ch)}</b>\n`;
      t += `Ссылка: ${esc(lnk)}\n\n`;
      t += `⚠️ Бот магазина должен быть добавлен в канал как администратор.`;
      return tg.edit(
        cid,
        mid,
        t,
        ikb([
          [btn(enabled ? "❌ Выключить" : "✅ Включить", "s:optoggle")],
          [btn("📢 Указать канал", "s:opsetc")],
          [btn("🔍 Проверить бота", "s:optest")],
          [btn("◀️ К настройкам", "s:se")],
        ]),
      );
    }
    if (cmd === "opsetc") {
      await setSession(cid, "s_set_op_channel", shopId, {});
      return tg.edit(
        cid,
        mid,
        "📢 <b>Укажите канал</b>\n\nОтправьте @username канала, ссылку (t.me/...) или числовой chat_id:\n\nПример: <code>@mychannel</code>",
        ikb([[btn("❌ Отмена", "s:se")]]),
      );
    }
    if (cmd === "optest") {
      // Test if bot can access getChatMember on the configured channel
      const { data: s } = await supabase().from("shops").select("required_channel_id").eq("id", shopId).single();
      if (!s?.required_channel_id) {
        return tg.edit(
          cid,
          mid,
          "❌ Канал не указан. Сначала укажите канал.",
          ikb([[btn("📢 Указать канал", "s:opsetc")], [btn("◀️ Назад", "s:opsettings")]]),
        );
      }
      try {
        const testRes = await fetch(`https://api.telegram.org/bot${botToken}/getChatMember`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: s.required_channel_id, user_id: adminId }),
        }).then((r) => r.json());
        if (testRes.ok) {
          return tg.edit(
            cid,
            mid,
            `✅ Бот имеет доступ к каналу <b>${esc(s.required_channel_id)}</b>\n\nСтатус вашего членства: <b>${testRes.result.status}</b>`,
            ikb([[btn("◀️ Назад", "s:opsettings")]]),
          );
        } else {
          return tg.edit(
            cid,
            mid,
            `❌ <b>Ошибка:</b> ${esc(testRes.description || "Бот не имеет доступа к каналу")}\n\n⚠️ Убедитесь что бот добавлен в канал как администратор.`,
            ikb([[btn("🔄 Повторить", "s:optest"), btn("◀️ Назад", "s:opsettings")]]),
          );
        }
      } catch (e) {
        return tg.edit(
          cid,
          mid,
          `❌ Ошибка проверки: ${maskToken((e as Error).message)}`,
          ikb([[btn("◀️ Назад", "s:opsettings")]]),
        );
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

    // Referral system admin
    if (cmd === "ref") {
      const { data: rs } = await supabase()
        .from("shop_referral_settings")
        .select("is_enabled, reward_percent")
        .eq("shop_id", shopId)
        .maybeSingle();
      const enabled = rs?.is_enabled ?? true;
      const pct = Number(rs?.reward_percent ?? 10);
      const { count: refCount } = await supabase()
        .from("shop_referrals")
        .select("id", { count: "exact", head: true })
        .eq("shop_id", shopId);
      const { data: earnings } = await supabase()
        .from("shop_referral_earnings")
        .select("reward_amount, status")
        .eq("shop_id", shopId);
      const totalAccrued = (earnings || []).reduce((s: number, e: any) => s + Number(e.reward_amount), 0);
      const totalPending = (earnings || [])
        .filter((e: any) => e.status === "pending")
        .reduce((s: number, e: any) => s + Number(e.reward_amount), 0);
      const t =
        `🎁 <b>Реферальная система</b>\n\n` +
        `Статус: <b>${enabled ? "✅ включена" : "❌ выключена"}</b>\n` +
        `Процент вознаграждения: <b>${pct}%</b>\n\n` +
        `👥 Связей: <b>${refCount || 0}</b>\n` +
        `💰 Всего начислено: <b>$${totalAccrued.toFixed(2)}</b>\n` +
        `⏳ К выплате: <b>$${totalPending.toFixed(2)}</b>\n\n` +
        `<i>Начисление идёт автоматически после оплаты заказа приглашённого. Считается от суммы заказа после промокода.</i>`;
      return tg.edit(
        cid,
        mid,
        t,
        ikb([
          [btn(enabled ? "❌ Выключить" : "✅ Включить", "s:reftog")],
          [btn("✏️ Изменить %", "s:refset")],
          [btn("◀️ К настройкам", "s:se")],
        ]),
      );
    }
    if (cmd === "reftog") {
      const { data: rs } = await supabase()
        .from("shop_referral_settings")
        .select("is_enabled, reward_percent")
        .eq("shop_id", shopId)
        .maybeSingle();
      const newVal = !(rs?.is_enabled ?? true);
      await supabase()
        .from("shop_referral_settings")
        .upsert(
          {
            shop_id: shopId,
            is_enabled: newVal,
            reward_percent: rs?.reward_percent ?? 10,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "shop_id" },
        );
      await logAction(shopId, adminId, newVal ? "enable_referral" : "disable_referral", "shop", shopId);
      return handleCallback(tg, cid, mid, "s:ref", cbId, shopId, adminId, botToken);
    }
    if (cmd === "refset") {
      await setSession(cid, "s_set_ref_percent", shopId, {});
      return tg.send(
        cid,
        "✏️ Введите новый процент вознаграждения (число от 0 до 100):\n\nПример: <code>15</code>\n\n/cancel — отмена",
      );
    }

    // Edit shop field
    if (cmd === "edit") {
      const field = parts[2];
      const labels: Record<string, string> = {
        name: "📛 название магазина",
        color: "🎨 HEX цвет (например #FF5500)",
        hero_title: "📌 заголовок витрины",
        hero_desc: "📝 описание витрины",
        welcome: "👋 приветственное сообщение",
        support: "🔗 ссылку на поддержку",
      };
      await setSession(cid, "s_edit_field", shopId, { field });
      let extra = "";
      if (field === "welcome") {
        extra =
          "\n\n💡 <b>Подсказка по форматированию:</b>\n" +
          "• <code>&lt;b&gt;жирный&lt;/b&gt;</code> → <b>жирный</b>\n" +
          "• <code>&lt;i&gt;курсив&lt;/i&gt;</code> → <i>курсив</i>\n" +
          "• <code>&lt;u&gt;подчёркнутый&lt;/u&gt;</code> → <u>подчёркнутый</u>\n" +
          "• <code>&lt;code&gt;код&lt;/code&gt;</code> → <code>код</code>\n" +
          '• <code>&lt;a href="URL"&gt;текст&lt;/a&gt;</code> → ссылка\n' +
          "• <code>{name}</code> → имя пользователя\n\n" +
          "📸 <b>Можно приложить фото</b> — оно будет показано при /start.\n" +
          "Отправка текста без фото очистит текущее фото.\n\n" +
          "Сообщение заменяет стартовый текст полностью.";
      }
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
      const pid = parts[2];
      const page = parseInt(parts[3] || "0");
      return inventoryView(tg, cid, mid, shopId, pid, page);
    }
    if (cmd === "ia") {
      const pid = parts[2];
      await setSession(cid, `ai:${pid}`, shopId);
      return tg.send(
        cid,
        "🗃 <b>Добавление единиц</b>\n\nОтправьте ключи/аккаунты, каждый с новой строки.\n\n💡 Для загрузки файлов используйте ссылку на Яндекс Диск / Google Drive / другое внешнее хранилище.\n\n/cancel — отмена",
      );
    }
    if (cmd === "is") return inventorySync(tg, cid, mid, shopId, parts[2], adminId);

    // Broadcast
    if (cmd === "bc") return broadcastMenu(tg, cid, mid, shopId);
    if (cmd === "bs") {
      await setSession(cid, "bc:t", shopId);
      return tg.send(
        cid,
        "📢 Введите текст рассылки (поддерживается HTML: &lt;b&gt;, &lt;i&gt;, &lt;u&gt;, &lt;a&gt;) или отправьте фото с подписью:\n\n/cancel — отмена",
      );
    }
    if (cmd === "bcsend") {
      const session = await getSession(cid, shopId);
      if (!session || session.state !== "bc:preview") return;
      const sd = session.data;
      // Use shop_customers for broadcast recipients
      const { data: customers } = await supabase().from("shop_customers").select("telegram_id").eq("shop_id", shopId);
      const uniqueIds = [...new Set(customers?.map((c) => c.telegram_id) || [])];
      if (!uniqueIds.length) {
        await clearSession(cid);
        return tg.send(cid, "❌ Нет покупателей.");
      }
      let ok = 0,
        fail = 0;
      for (const uid of uniqueIds) {
        try {
          let r;
          if (sd.photoId) {
            r = await tg.sendPhoto(uid as number, sd.photoId as string, (sd.text as string) || "");
          } else {
            r = await tg.send(uid as number, sd.text as string);
          }
          if (r.ok) ok++;
          else fail++;
        } catch {
          fail++;
        }
      }
      await logAction(shopId, adminId, "broadcast", "broadcast", undefined, { ok, fail, total: uniqueIds.length });
      await clearSession(cid);
      return tg.send(
        cid,
        `📢 <b>Рассылка завершена!</b>\n\n✅ ${ok}\n❌ ${fail}\n📊 ${uniqueIds.length}`,
        ikb([[btn("◀️ Меню", "s:m")]]),
      );
    }
    if (cmd === "bcedit") {
      await setSession(cid, "bc:t", shopId);
      return tg.send(cid, "✏️ Введите новый текст рассылки:\n\n/cancel — отмена");
    }
    if (cmd === "bccancel") {
      await clearSession(cid);
      return tg.send(cid, "❌ Рассылка отменена.", ikb([[btn("◀️ Меню", "s:m")]]));
    }

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
      return tg.edit(
        cid,
        mid,
        t,
        ikb([
          [btn("✅ Одобрить", `s:rva:${rid}`), btn("❌ Отклонить", `s:rvr:${rid}`)],
          [btn("🗑 Удалить", `s:rvd:${rid}`)],
          [btn("◀️ К отзывам", "s:rvl:0")],
        ]),
      );
    }
    if (cmd === "rvd") {
      const rid = parts[2];
      await supabase().from("shop_reviews").delete().eq("id", rid);
      await logAction(shopId, adminId, "delete_review", "review", rid);
      return reviewsList(tg, cid, mid, shopId, 0);
    }

    // ─── Auto-products ──────────────────────
    if (cmd === "ap") return autoProductsHome(tg, cid, mid, shopId);
    if (cmd === "apv") return autoProductView(tg, cid, mid, shopId, parts[2]);
    if (cmd === "upsell") {
      const upsellRows: Btn[][] = [
        [premiumUpsellBtn("💎 Перейти на Премиум")],
        [btn("◀️ Назад", "s:ap")],
      ];
      return tg.edit(cid, mid,
        `💎 <b>Тариф Премиум</b>\n\n` +
        `Открывает в вашем магазине разделы Telegram Stars и Telegram Premium для покупателей.\n\n` +
        `Также включает: AI-аватарку магазина, кастомизацию, премиум-контент, кураторство и закрытый чат владельцев.\n\n` +
        `Подписка оформляется в платформенном Mini App.`,
        ikb(upsellRows),
      );
    }
    if (cmd === "apt") {
      const type = parts[2];
      if (!AUTO_TYPES.includes(type as AutoType)) return;
      await ensureAutoProduct(shopId, type as AutoType);
      const { data: r } = await supabase().from("shop_auto_products")
        .select("is_enabled, price_3m, price_6m, price_12m, price_per_star")
        .eq("shop_id", shopId).eq("product_type", type).maybeSingle();
      if (!r) return;
      // Validate: cannot enable without prices
      if (!r.is_enabled) {
        const ok = type === "telegram_premium"
          ? Number(r.price_3m) > 0 || Number(r.price_6m) > 0 || Number(r.price_12m) > 0
          : Number(r.price_per_star) > 0;
        if (!ok) {
          await tg.answer(cbId, "❌ Сначала задайте цену").catch(() => {});
          return autoProductView(tg, cid, mid, shopId, type);
        }
      }
      await supabase().from("shop_auto_products")
        .update({ is_enabled: !r.is_enabled, updated_at: new Date().toISOString() })
        .eq("shop_id", shopId).eq("product_type", type);
      await logAction(shopId, adminId, "toggle_auto_product", "auto_product", type, { is_enabled: !r.is_enabled });
      return autoProductView(tg, cid, mid, shopId, type);
    }
    if (cmd === "ape") {
      const type = parts[2];
      const field = parts[3];
      if (!AUTO_TYPES.includes(type as AutoType)) return;
      const labels: Record<string, string> = {
        "3m": "цену за 3 месяца (USD)",
        "6m": "цену за 6 месяцев (USD)",
        "12m": "цену за 12 месяцев (USD)",
        per: "цену за 1 звезду (USD, до 4 знаков)",
        min: "минимальное количество звёзд (целое)",
        max: "максимальное количество звёзд (целое)",
      };
      if (!labels[field]) return;
      await setSession(cid, `aap:${type}:${field}`, shopId);
      return tg.send(cid, `✏️ Введите <b>${labels[field]}</b>:\n\n0 — снять значение\n/cancel — отмена`);
    }

    // ─── Auto-orders ────────────────────────
    if (cmd === "ao") return autoOrdersList(tg, cid, mid, shopId, parseInt(parts[2]) || 0);
    if (cmd === "aov") return autoOrderView(tg, cid, mid, shopId, parts[2]);
    if (cmd === "aoc") {
      const oid = parts[2];
      const { data: o } = await supabase().from("shop_orders").select("*").eq("id", oid).eq("shop_id", shopId).maybeSingle();
      if (!o) return;
      await supabase().from("shop_orders").update({
        fulfillment_status: "completed",
        status: "completed",
        fulfilled_at: new Date().toISOString(),
        fulfilled_by_telegram_id: adminId,
        updated_at: new Date().toISOString(),
      }).eq("id", oid);
      await logAction(shopId, adminId, "fulfill_auto_order", "shop_order", oid, { result: "completed" });
      await notifyBuyerAutoFulfilled(shopId, botToken || null, o, true, null);
      return autoOrderView(tg, cid, mid, shopId, oid);
    }
    if (cmd === "aof") {
      const oid = parts[2];
      const { data: o } = await supabase().from("shop_orders").select("*").eq("id", oid).eq("shop_id", shopId).maybeSingle();
      if (!o) return;
      await supabase().from("shop_orders").update({
        fulfillment_status: "failed",
        fulfillment_comment: "Помечено продавцом как ошибка",
        fulfilled_by_telegram_id: adminId,
        updated_at: new Date().toISOString(),
      }).eq("id", oid);
      await logAction(shopId, adminId, "fulfill_auto_order", "shop_order", oid, { result: "failed" });
      await notifyBuyerAutoFulfilled(shopId, botToken || null, o, false, "Свяжитесь с продавцом");
      return autoOrderView(tg, cid, mid, shopId, oid);
    }
  } catch (e) {
    console.error("Callback error:", e);
  }
}

// ═══════════════════════════════════════════════
// MAIN SERVE
// ═══════════════════════════════════════════════
// ─── Telegram Stars: process successful_payment ─────────────
// Called when Telegram delivers a `successful_payment` message in the
// shop bot's chat with the buyer. Atomically marks the order paid,
// reserves digital inventory, debits used balance, increments promo,
// credits referral reward, and sends the delivery message.
async function handleStarsSuccessfulPayment(shopId: string, botToken: string, msg: any) {
  const sp = msg.successful_payment;
  if (!sp) return;
  const buyerTelegramId = Number(msg.from?.id || msg.chat?.id);
  const payload = String(sp.invoice_payload || "");
  const orderId = payload.startsWith("s_o:") ? payload.slice(4) : null;
  const chargeId = String(sp.telegram_payment_charge_id || sp.provider_payment_charge_id || "");
  if (!orderId || !buyerTelegramId) {
    console.error("stars-payment: missing orderId or buyerTelegramId", { payload, buyerTelegramId });
    return;
  }

  // Idempotency: insert into processed_invoices first; if already there, skip.
  const dedupKey = `stars:${chargeId || orderId}`;
  const { error: dedupErr } = await supabase()
    .from("processed_invoices")
    .insert({
      invoice_id: dedupKey,
      type: "payment",
      order_id: orderId,
      telegram_id: buyerTelegramId,
      amount: Number(sp.total_amount || 0),
    });
  if (dedupErr) {
    // Already processed
    return;
  }

  // Load + atomically transition order to paid (only if not already paid)
  const { data: order } = await supabase()
    .from("shop_orders")
    .select(
      "id, status, payment_status, balance_used, buyer_telegram_id, order_number, shop_id, promo_code, discount_amount, total_amount",
    )
    .eq("id", orderId)
    .maybeSingle();
  if (!order || order.shop_id !== shopId) return;

  const { data: updatedRows } = await supabase()
    .from("shop_orders")
    .update({ status: "paid", payment_status: "paid", updated_at: new Date().toISOString() })
    .eq("id", orderId)
    .neq("payment_status", "paid")
    .select("id");
  if (!updatedRows?.length) return;

  // Promo usage increment
  if (order.promo_code) {
    await supabase().rpc("increment_shop_promo_usage", { p_shop_id: shopId, p_code: order.promo_code });
  }

  // Debit balance if it was used to partially pay this order
  const balanceUsed = Number(order.balance_used || 0);
  if (balanceUsed > 0) {
    const { data: nb, error: be } = await supabase().rpc("shop_deduct_balance", {
      p_shop_id: shopId,
      p_telegram_id: order.buyer_telegram_id,
      p_amount: balanceUsed,
    });
    if (!be) {
      const promoInfo = order.promo_code
        ? ` (промо ${order.promo_code}, скидка $${Number(order.discount_amount || 0).toFixed(2)})`
        : "";
      await supabase()
        .from("shop_balance_history")
        .insert({
          shop_id: shopId,
          telegram_id: order.buyer_telegram_id,
          amount: -balanceUsed,
          balance_after: nb,
          type: "purchase",
          comment: `Заказ ${order.order_number}${promoInfo}`,
          admin_telegram_id: order.buyer_telegram_id,
        });
    }
  }

  // Reserve and deliver inventory
  const { data: orderItems } = await supabase()
    .from("shop_order_items")
    .select("product_id, quantity, product_name")
    .eq("order_id", orderId);
  const deliveredContent: string[] = [];
  let allDelivered = true;

  if (orderItems) {
    for (const item of orderItems) {
      const { data: reserved } = await supabase().rpc("reserve_shop_inventory", {
        p_product_id: item.product_id,
        p_quantity: item.quantity,
        p_order_id: orderId,
      });
      if (reserved?.length) {
        deliveredContent.push(
          `📦 <b>${esc(item.product_name)}</b> (×${reserved.length}):\n` +
            reserved.map((i: any) => `<code>${esc(i.content)}</code>`).join("\n"),
        );
        const { count: remaining } = await supabase()
          .from("shop_inventory")
          .select("id", { count: "exact", head: true })
          .eq("product_id", item.product_id)
          .eq("status", "available");
        await supabase()
          .from("shop_products")
          .update({
            stock: remaining || 0,
            updated_at: new Date().toISOString(),
          })
          .eq("id", item.product_id);
        if (reserved.length < item.quantity) allDelivered = false;
      } else {
        allDelivered = false;
      }
    }
  }

  const finalStatus = allDelivered && deliveredContent.length > 0 ? "delivered" : "paid";
  if (finalStatus !== "paid") {
    await supabase()
      .from("shop_orders")
      .update({
        status: finalStatus,
        updated_at: new Date().toISOString(),
      })
      .eq("id", orderId);
  }

  // Notify buyer in the bot chat
  const totalUsd = Number(order.total_amount || 0);
  const finalUsd = Math.max(0, totalUsd - Number(order.discount_amount || 0) - balanceUsed);
  let message =
    `✅ <b>Оплата подтверждена!</b>\n\n📦 Заказ: <code>${esc(order.order_number)}</code>\n` +
    `⭐ Stars: ${sp.total_amount}\n` +
    `💵 Сумма: $${finalUsd.toFixed(2)}\n`;
  if (balanceUsed > 0) message += `💳 С баланса: $${balanceUsed.toFixed(2)}\n`;
  if (deliveredContent.length > 0) {
    message += `\n🎁 <b>Ваши товары:</b>\n\n${deliveredContent.join("\n\n")}\n\n⚠️ Сохраните данные!`;
  } else {
    message += `\nВаш товар будет доставлен в ближайшее время.`;
  }
  message += `\n\nСпасибо за покупку!`;
  try {
    await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: buyerTelegramId, text: message, parse_mode: "HTML" }),
    });
  } catch (e) {
    console.error("stars-payment: notify buyer failed", e);
  }

  // Referral reward (idempotent on UNIQUE order_id)
  try {
    const finalAmount = Math.max(0, totalUsd - Number(order.discount_amount || 0));
    if (finalAmount > 0) {
      await supabase().rpc("shop_credit_referral_for_order", {
        p_shop_id: shopId,
        p_order_id: orderId,
        p_referred_telegram_id: order.buyer_telegram_id,
        p_order_amount: finalAmount,
      });
    }
  } catch (e) {
    console.error("stars-payment: referral credit error", e);
  }
}

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
    const { data: shop, error: shopErr } = await supabase()
      .from("shops")
      .select(
        "id, name, slug, bot_token_encrypted, welcome_message, welcome_photo_id, support_link, status, owner_id, is_subscription_required, required_channel_id, required_channel_link",
      )
      .eq("id", shopId)
      .single();
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
            const { data: rawToken } = await supabase().rpc("decrypt_token", {
              p_encrypted: shop.bot_token_encrypted,
              p_key: encKey,
            });
            if (rawToken) {
              const chatId =
                body.message?.chat?.id || body.callback_query?.message?.chat?.id || body.callback_query?.from?.id;
              if (chatId) {
                await fetch(`https://api.telegram.org/bot${rawToken}/sendMessage`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    chat_id: chatId,
                    text: "⚠️ Магазин временно недоступен. Обратитесь в поддержку.",
                    parse_mode: "HTML",
                  }),
                });
              }
            }
          } catch (e) {
            console.error("seller-bot-webhook: failed to send inactive message", e);
          }
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

    const { data: botToken } = await supabase().rpc("decrypt_token", {
      p_encrypted: shop.bot_token_encrypted,
      p_key: encKey,
    });
    if (!botToken) {
      console.error("seller-bot-webhook: failed to decrypt bot token");
      return new Response("ok");
    }

    const tg = TG(botToken);
    const msg = body.message;
    const cb = body.callback_query;
    const preCheckout = body.pre_checkout_query;

    // ─── Pre-checkout query (Telegram Stars) ──────────────────
    // MUST respond within 10 seconds, otherwise Telegram cancels the payment
    if (preCheckout) {
      try {
        const pcId = preCheckout.id;
        const payload = String(preCheckout.invoice_payload || "");
        const orderId = payload.startsWith("s_o:") ? payload.slice(4) : null;
        let approve = false;
        let errorMsg = "Заказ не найден или уже обработан.";
        if (orderId) {
          const { data: order } = await supabase()
            .from("shop_orders")
            .select("id, shop_id, payment_status, status")
            .eq("id", orderId)
            .maybeSingle();
          if (order && order.shop_id === shopId && order.payment_status !== "paid") {
            approve = true;
          } else if (order?.payment_status === "paid") {
            errorMsg = "Этот заказ уже оплачен.";
          }
        }
        await fetch(`https://api.telegram.org/bot${botToken}/answerPreCheckoutQuery`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            approve
              ? { pre_checkout_query_id: pcId, ok: true }
              : { pre_checkout_query_id: pcId, ok: false, error_message: errorMsg },
          ),
        });
      } catch (e) {
        console.error("pre_checkout_query error:", e);
      }
      return new Response("ok");
    }

    // ─── Successful payment (Telegram Stars) ──────────────────
    if (msg?.successful_payment) {
      try {
        await handleStarsSuccessfulPayment(shopId, botToken, msg);
      } catch (e) {
        console.error("successful_payment handler error:", e);
      }
      return new Response("ok");
    }

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
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: shop.required_channel_id, user_id: chatId }),
            }).then((r) => r.json());
            if (memberRes.ok && ["member", "administrator", "creator"].includes(memberRes.result.status)) {
              // Subscribed — show normal start
              const shopUrl = `${WEBAPP_DOMAIN}/shop/${shop.id}`;
              const welcomeText = shop.welcome_message
                ? renderWelcome(shop.welcome_message, cb.from?.first_name || "друг")
                : `👋 Привет, <b>${esc(cb.from?.first_name || "друг")}</b>!\n\nДобро пожаловать в ${esc(shop.name)}!`;
              const supportUrl = shop.support_link
                ? shop.support_link.startsWith("http")
                  ? shop.support_link
                  : `https://${shop.support_link}`
                : null;
              const opKb = {
                inline_keyboard: [
                  [{ text: "🛍 Открыть магазин", web_app: { url: shopUrl } }],
                  ...(supportUrl ? [[{ text: "🆘 Поддержка", url: supportUrl }]] : []),
                ],
              };
              // Delete the OP gate message and send fresh (photo can't be edited into text message)
              await tg.deleteMessage(chatId, msgId).catch(() => {});
              if (shop.welcome_photo_id) {
                await tg.sendPhoto(chatId, shop.welcome_photo_id, welcomeText, opKb);
              } else {
                await tg.send(chatId, welcomeText, opKb);
              }
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
          try {
            await tg.answer(cb.id, "❌ Ошибка обработки");
          } catch {}
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

      // ─── Capture referral (start payload "ref_<telegram_id>") ─────
      const startPayload = text.startsWith("/start ") ? text.slice(7).trim() : "";
      if (startPayload.startsWith("ref_") && msg.from) {
        const refIdRaw = startPayload.slice(4);
        const refId = Number(refIdRaw);
        if (Number.isFinite(refId) && refId > 0 && refId !== msg.from.id) {
          try {
            // Only create link if user is not already linked in this shop and the referrer is a known customer of this shop
            const { data: refExists } = await supabase()
              .from("shop_customers")
              .select("telegram_id")
              .eq("shop_id", shopId)
              .eq("telegram_id", refId)
              .maybeSingle();
            if (refExists) {
              await supabase().from("shop_referrals").insert({
                shop_id: shopId,
                referrer_telegram_id: refId,
                referred_telegram_id: msg.from.id,
              });
            }
          } catch (e) {
            // Ignore unique-violation (already linked) and any other errors silently
          }
        }
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
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ chat_id: shop.required_channel_id, user_id: chatId }),
            }).then((r) => r.json());
            const isSubscribed =
              memberRes.ok && ["member", "administrator", "creator"].includes(memberRes.result?.status);
            if (!isSubscribed) {
              const subLink =
                shop.required_channel_link || `https://t.me/${String(shop.required_channel_id).replace("@", "")}`;
              await tg.send(
                chatId,
                `📢 <b>Для доступа к магазину подпишитесь на канал</b>\n\nПосле подписки нажмите «✅ Проверить».`,
                {
                  inline_keyboard: [
                    [{ text: "📢 Подписаться", url: subLink }],
                    [{ text: "✅ Проверить", callback_data: "s:opcheck" }],
                  ],
                },
              );
              return new Response("ok");
            }
          } catch (opErr) {
            console.error("OP check error:", opErr);
            // If OP check fails (bot not in channel), let user through with warning
          }
        }
      }

      const shopUrl = `${WEBAPP_DOMAIN}/shop/${shop.id}`;

      // Render welcome message — HTML is validated at save time, use as-is
      let greeting: string;
      if (shop.welcome_message) {
        greeting = renderWelcome(shop.welcome_message, firstName);
      } else {
        greeting = `👋 Привет, <b>${esc(firstName)}</b>!\n\nДобро пожаловать в <b>${esc(shop.name)}</b>! 🛍`;
      }

      const supportUrl = shop.support_link
        ? shop.support_link.startsWith("http")
          ? shop.support_link
          : `https://${shop.support_link}`
        : null;

      // Shop-specific custom buttons
      const customRows: Btn[][] = [];
      if (shopId === "d83f8cdb-850c-4b70-af24-0a205620089b") {
        customRows.push([{ text: "❗Важно", url: "https://telegra.ph/VIETO-STORE--FAQ-03-30" }]);
      }

      const startKb = {
        inline_keyboard: [
          [{ text: "🛍 Открыть магазин", web_app: { url: shopUrl } }],
          ...customRows,
          ...(supportUrl ? [[{ text: "🆘 Поддержка", url: supportUrl }]] : []),
        ],
      };

      // Send photo + caption or plain text
      if (shop.welcome_photo_id) {
        await tg.sendPhoto(chatId, shop.welcome_photo_id, greeting, startKb);
      } else {
        await tg.send(chatId, greeting, startKb);
      }
      return new Response("ok");
    }

    // ─── /help — before FSM ─────────────────
    if (text === "/help") {
      const shopUrl = `${WEBAPP_DOMAIN}/shop/${shop.id}`;
      const supportUrl = shop.support_link
        ? shop.support_link.startsWith("http")
          ? shop.support_link
          : `https://${shop.support_link}`
        : null;

      await tg.send(
        chatId,
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
