// Products admin: list + view + edit + create wizard.
// Storage of long IDs: UUID (36 chars) fits in Telegram callback_data
// when we prefix only "a:p:<op>:<uuid>" (max ~46 bytes < 64).
import { deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession, getSession } from "../_shared/session.ts";
import { uploadTelegramPhoto } from "../_shared/upload.ts";

const PAGE_SIZE = 8;

type FieldType = "text" | "num" | "json" | "bool" | "lines" | "kv";
const FIELDS: Record<string, { label: string; type: FieldType; hint?: string }> = {
  title: { label: "Название", type: "text" },
  subtitle: { label: "Подзаголовок", type: "text" },
  description: { label: "Описание", type: "text" },
  price: { label: "Цена USDT", type: "num" },
  old_price: { label: "Старая цена USDT", type: "num", hint: "число или -" },
  stock: { label: "Остаток", type: "num" },
  project_id: { label: "Проект", type: "text", hint: "flux/vieto/cursor" },
  category_id: { label: "Категория", type: "text", hint: "id категории или -" },
  product_type: { label: "Тип", type: "text", hint: "simple / premium_terms / stars_qty" },
  image: {
    label: "Главное фото",
    type: "text",
    hint: "Отправьте фото в чат ИЛИ ссылку. Чтобы очистить — <code>-</code>",
  },
  external_link: { label: "Внешняя ссылка", type: "text" },
  min_qty: { label: "Мин. кол-во", type: "num" },
  max_qty: { label: "Макс. кол-во", type: "num" },
  slug: { label: "Slug", type: "text" },
  subcategory: { label: "Подкатегория", type: "text" },
  platform: { label: "Платформа", type: "text", hint: "iOS / Android / PC / Web …" },
  region: { label: "Регион", type: "text", hint: "по умолчанию: Глобальный" },
  delivery_type: { label: "Тип доставки", type: "text", hint: "instant / manual / on_demand" },
  tags: { label: "Теги", type: "lines", hint: "по одному на строку" },
  features: { label: "Преимущества", type: "lines", hint: "по одному на строку" },
  specifications: {
    label: "Характеристики",
    type: "kv",
    hint: "Ключ: значение — по одной паре на строку",
  },
  term_options: {
    label: "Сроки (term_options)",
    type: "json",
    hint: 'JSON массив: [{"months":3,"price":15.9},{"months":6,"price":29.9}]',
  },
  gallery: {
    label: "Галерея",
    type: "json",
    hint: 'Отправьте фото — добавлю в галерею. Или JSON: [{"url":"...","href":"..."}]. <code>-</code> очистит.',
  },
};

function backRow() {
  return [{ text: "← Меню", callback_data: "a:menu" }];
}

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function showProductList(chatId: number, msgId: number | undefined, page = 0) {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;
  const { data, count } = await supabase
    .from("products")
    .select("id, title, price, is_active, project_id", { count: "exact" })
    .not("product_type", "in", "(premium_term,stars)")
    .order("updated_at", { ascending: false })
    .range(from, to);

  const total = count ?? 0;
  const rows = (data ?? []).map((p) => [
    {
      text: safeSlice(
        `${p.is_active ? "" : "🚫 "}${p.title} · ${Number(p.price).toFixed(2)}$ · ${p.project_id ?? "-"}`,
        60,
      ),
      callback_data: `a:p:v:${p.id}`,
    },
  ]);

  const nav: any[] = [];
  if (page > 0) nav.push({ text: "‹", callback_data: `a:p:l:${page - 1}` });
  nav.push({ text: `${page + 1}/${Math.max(1, Math.ceil(total / PAGE_SIZE))}`, callback_data: "a:p" });
  if ((page + 1) * PAGE_SIZE < total) nav.push({ text: "›", callback_data: `a:p:l:${page + 1}` });
  if (nav.length) rows.push(nav);

  rows.push([{ text: "➕ Создать", callback_data: "a:p:n" }]);
  rows.push(backRow());

  await deleteAndSend(chatId, msgId, {
    text: `📦 <b>Товары</b> · всего ${total}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showProduct(chatId: number, msgId: number | undefined, id: string) {
  const { data: p } = await supabase.from("products").select("*").eq("id", id).maybeSingle();
  if (!p) return showProductList(chatId, msgId);

  const terms = Array.isArray(p.term_options) ? p.term_options.length : 0;
  const gal = Array.isArray(p.gallery) ? p.gallery.length : 0;
  const text = [
    `${p.is_active ? "🟢" : "🔴"} <b>${escapeHtml(p.title)}</b>`,
    p.subtitle ? `<i>${escapeHtml(p.subtitle)}</i>` : "",
    "",
    `Цена: <b>${Number(p.price).toFixed(2)}$</b>${p.old_price ? ` (старая ${Number(p.old_price).toFixed(2)}$)` : ""}`,
    `Проект: <code>${p.project_id ?? "-"}</code>  ·  Категория: <code>${p.category_id ?? "-"}</code>`,
    `Тип: <code>${p.product_type}</code>  ·  Склад: ${p.stock}`,
    `Кол-во: ${p.min_qty}…${p.max_qty}`,
    `Term options: ${terms}  ·  Галерея: ${gal}`,
    p.external_link ? `🔗 ${escapeHtml(p.external_link)}` : "",
    p.image ? `🖼 ${escapeHtml(p.image)}` : "",
    "",
    p.description ? escapeHtml(String(p.description).slice(0, 400)) : "",
  ].filter(Boolean).join("\n");

  const kb = [
    [
      { text: "📝 Название", callback_data: `a:p:e:${id}:title` },
      { text: "💵 Цена", callback_data: `a:p:e:${id}:price` },
    ],
    [
      { text: "💰 Старая цена", callback_data: `a:p:e:${id}:old_price` },
    ],
    [
      { text: "📁 Проект", callback_data: `a:p:e:${id}:project_id` },
      { text: "📂 Категория", callback_data: `a:p:e:${id}:category_id` },
    ],
    [
      { text: "🏷 Тип", callback_data: `a:p:e:${id}:product_type` },
      { text: "🔗 Slug", callback_data: `a:p:e:${id}:slug` },
    ],
    [
      { text: "🖼 Фото", callback_data: `a:p:e:${id}:image` },
      { text: "🌐 Внешн. ссылка", callback_data: `a:p:e:${id}:external_link` },
    ],
    [
      { text: "📝 Подзаголовок", callback_data: `a:p:e:${id}:subtitle` },
      { text: "📝 Описание", callback_data: `a:p:e:${id}:description` },
    ],
    [
      { text: "↓ min", callback_data: `a:p:e:${id}:min_qty` },
      { text: "↑ max", callback_data: `a:p:e:${id}:max_qty` },
    ],
    [
      { text: "🏷 Подкатегория", callback_data: `a:p:e:${id}:subcategory` },
      { text: "🌍 Регион", callback_data: `a:p:e:${id}:region` },
    ],
    [
      { text: "💻 Платформа", callback_data: `a:p:e:${id}:platform` },
      { text: "🚚 Доставка", callback_data: `a:p:e:${id}:delivery_type` },
    ],
    [
      { text: "🏷 Теги", callback_data: `a:p:e:${id}:tags` },
      { text: "✨ Преимущества", callback_data: `a:p:e:${id}:features` },
    ],
    [
      { text: "📋 Характеристики", callback_data: `a:p:e:${id}:specifications` },
    ],
    [
      { text: "⏱ Term options", callback_data: `a:p:e:${id}:term_options` },
      { text: "🖼 Галерея", callback_data: `a:p:e:${id}:gallery` },
    ],
    [{ text: "🏗 Склад", callback_data: `a:inv:v:${id}` }],
    [{ text: p.is_active ? "🔴 Выключить" : "🟢 Включить", callback_data: `a:p:t:${id}` }],
    [{ text: "🗑 Удалить", callback_data: `a:p:d:${id}` }],
    [{ text: "← К списку", callback_data: "a:p" }, ...backRow()],
  ];

  await deleteAndSend(chatId, msgId, { text, parse_mode: "HTML", reply_markup: { inline_keyboard: kb } });
}

export async function toggleProduct(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  const { data: p } = await supabase.from("products").select("is_active").eq("id", id).maybeSingle();
  if (!p) return showProductList(chatId, msgId);
  await supabase.from("products").update({ is_active: !p.is_active, updated_at: new Date().toISOString() }).eq("id", id);
  await writeAuditLog(adminId, "product.toggle", id, { is_active: !p.is_active });
  return showProduct(chatId, msgId, id);
}

export async function askDeleteProduct(chatId: number, msgId: number | undefined, id: string) {
  await deleteAndSend(chatId, msgId, {
    text: `⚠️ Удалить товар <code>${id}</code>?`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Да, удалить", callback_data: `a:p:dc:${id}` }],
        [{ text: "Отмена", callback_data: `a:p:v:${id}` }],
      ],
    },
  });
}

export async function confirmDeleteProduct(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  await supabase.from("products").delete().eq("id", id);
  await writeAuditLog(adminId, "product.delete", id, {});
  return showProductList(chatId, msgId);
}

export async function startEditProduct(
  chatId: number,
  msgId: number | undefined,
  id: string,
  field: string,
  adminId: number,
) {
  const f = FIELDS[field];
  if (!f) return showProduct(chatId, msgId, id);
  await setSession(adminId, `p:edit:${id}:${field}`, {});
  const hint = f.hint ? `\n\n<i>${f.hint}</i>` : "";
  await deleteAndSend(chatId, msgId, {
    text: `✏️ Введите новое значение для «<b>${f.label}</b>».${hint}\n\nОтправьте <code>-</code> чтобы очистить.`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: `a:p:v:${id}` }]] },
  });
}

function parseFieldValue(field: string, raw: string): { ok: true; value: unknown } | { ok: false; err: string } {
  const f = FIELDS[field];
  if (!f) return { ok: false, err: "Неизвестное поле" };
  if (raw === "-") {
    if (f.type === "num") return { ok: true, value: 0 };
    if (f.type === "json" || f.type === "lines") return { ok: true, value: [] };
    if (f.type === "kv") return { ok: true, value: {} };
    return { ok: true, value: null };
  }
  if (f.type === "num") {
    const n = Number(raw.replace(",", "."));
    if (!isFinite(n)) return { ok: false, err: "Нужно число" };
    return { ok: true, value: n };
  }
  if (f.type === "json") {
    try {
      const v = JSON.parse(raw);
      if (!Array.isArray(v)) return { ok: false, err: "Нужен JSON-массив" };
      return { ok: true, value: v };
    } catch {
      return { ok: false, err: "Невалидный JSON" };
    }
  }
  if (f.type === "lines") {
    const arr = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    return { ok: true, value: arr };
  }
  if (f.type === "kv") {
    const obj: Record<string, string> = {};
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const idx = t.indexOf(":");
      if (idx <= 0) return { ok: false, err: `Строка без двоеточия: "${t}"` };
      obj[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
    }
    return { ok: true, value: obj };
  }
  return { ok: true, value: raw };
}

export async function applyEditProduct(
  chatId: number,
  adminId: number,
  id: string,
  field: string,
  raw: string,
) {
  const r = parseFieldValue(field, raw);
  if (!r.ok) {
    await deleteAndSend(chatId, undefined, { text: `❌ ${r.err}. Попробуйте ещё раз.` });
    return;
  }
  await supabase
    .from("products")
    .update({ [field]: r.value, updated_at: new Date().toISOString() })
    .eq("id", id);
  await writeAuditLog(adminId, "product.update", id, { field, value: r.value });
  await clearSession(adminId);
  await showProduct(chatId, undefined, id);
}

// --- create wizard: title → price → save (defaults project=vieto) ---

export async function startCreateProduct(chatId: number, msgId: number | undefined, adminId: number) {
  await setSession(adminId, "p:new:title", {});
  await deleteAndSend(chatId, msgId, {
    text: "➕ <b>Новый товар</b>\n\nШаг 1/2: введите <b>название</b>:",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "a:p" }]] },
  });
}

export async function handleCreateProductStep(chatId: number, adminId: number, raw: string) {
  const sess = await getSession(adminId);
  if (!sess) return;
  if (sess.state === "p:new:title") {
    const title = raw.trim();
    if (!title) {
      await deleteAndSend(chatId, undefined, { text: "❌ Пустое название. Попробуйте ещё раз." });
      return;
    }
    await setSession(adminId, "p:new:price", { title });
    await deleteAndSend(chatId, undefined, {
      text: "Шаг 2/2: введите <b>цену в USDT</b> (число):",
      parse_mode: "HTML",
    });
    return;
  }
  if (sess.state === "p:new:price") {
    const price = Number(raw.replace(",", "."));
    if (!isFinite(price) || price < 0) {
      await deleteAndSend(chatId, undefined, { text: "❌ Цена должна быть числом ≥ 0. Попробуйте ещё раз." });
      return;
    }
    const title = String(sess.payload.title);
    const { data, error } = await supabase
      .from("products")
      .insert({
        title,
        price,
        project_id: "vieto",
        product_type: "simple",
        is_active: false,
      })
      .select("id")
      .single();
    if (error || !data) {
      await deleteAndSend(chatId, undefined, { text: `❌ Не удалось создать товар: ${error?.message ?? "ошибка"}` });
      return;
    }
    await writeAuditLog(adminId, "product.create", data.id, { title, price });
    await clearSession(adminId);
    await showProduct(chatId, undefined, data.id);
  }
}

// --- photo upload: applies to `image` (replace) or `gallery` (append) ---
export async function applyEditProductPhoto(
  chatId: number,
  adminId: number,
  id: string,
  field: string,
  fileId: string,
) {
  if (field !== "image" && field !== "gallery") return;
  const up = await uploadTelegramPhoto(fileId, "product-images", id);
  if (!up.ok) {
    await deleteAndSend(chatId, undefined, { text: `❌ Загрузка не удалась: ${up.error}` });
    return;
  }
  if (field === "image") {
    await supabase.from("products").update({ image: up.url, updated_at: new Date().toISOString() }).eq("id", id);
  } else {
    const { data: cur } = await supabase.from("products").select("gallery").eq("id", id).maybeSingle();
    const arr = Array.isArray(cur?.gallery) ? cur!.gallery as any[] : [];
    arr.push({ url: up.url });
    await supabase.from("products").update({ gallery: arr, updated_at: new Date().toISOString() }).eq("id", id);
  }
  await writeAuditLog(adminId, "product.update", id, { field, value: up.url });
  await clearSession(adminId);
  await showProduct(chatId, undefined, id);
}
