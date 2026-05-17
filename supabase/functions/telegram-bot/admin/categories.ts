// Categories admin: CRUD over `categories` (text id, used by VIETO etc.).
import { deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession, getSession } from "../_shared/session.ts";

const FIELDS: Record<string, string> = {
  name: "Название",
  icon: "Иконка (emoji)",
  slug: "Slug",
  project_id: "Проект (flux/vieto/cursor или -)",
  sort_order: "Порядок",
  description: "Описание",
};

function backRow() {
  return [{ text: "← Меню", callback_data: "a:menu" }];
}

export async function showCategoryList(chatId: number, msgId?: number) {
  const { data } = await supabase
    .from("categories")
    .select("id, name, icon, is_active, project_id, sort_order")
    .order("sort_order");
  const rows = (data ?? []).map((c) => [
    {
      text: safeSlice(
        `${c.icon ?? "📂"} ${c.name}${c.project_id ? ` · ${c.project_id}` : ""}${c.is_active ? "" : " (off)"}`,
        60,
      ),
      callback_data: `a:c:v:${c.id}`,
    },
  ]);
  rows.push([{ text: "➕ Создать", callback_data: "a:c:n" }]);
  rows.push(backRow());
  await deleteAndSend(chatId, msgId, {
    text: "📂 <b>Категории</b>",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showCategory(chatId: number, msgId: number | undefined, id: string) {
  const { data: c } = await supabase.from("categories").select("*").eq("id", id).maybeSingle();
  if (!c) return showCategoryList(chatId, msgId);
  const text = [
    `${c.icon ?? "📂"} <b>${escapeHtml(c.name)}</b>`,
    `<code>${c.id}</code>`,
    c.slug ? `Slug: <code>${c.slug}</code>` : "",
    c.project_id ? `Проект: <code>${c.project_id}</code>` : "",
    `Сортировка: ${c.sort_order}`,
    `Статус: ${c.is_active ? "🟢 активна" : "🔴 выключена"}`,
    c.description ? `\n${escapeHtml(c.description)}` : "",
  ].filter(Boolean).join("\n");

  const kb = [
    [
      { text: "📝 Название", callback_data: `a:c:e:${id}:name` },
      { text: "✨ Иконка", callback_data: `a:c:e:${id}:icon` },
    ],
    [
      { text: "🔗 Slug", callback_data: `a:c:e:${id}:slug` },
      { text: "📁 Проект", callback_data: `a:c:e:${id}:project_id` },
    ],
    [
      { text: "↕ Порядок", callback_data: `a:c:e:${id}:sort_order` },
      { text: "📝 Описание", callback_data: `a:c:e:${id}:description` },
    ],
    [{ text: c.is_active ? "🔴 Выключить" : "🟢 Включить", callback_data: `a:c:t:${id}` }],
    [{ text: "🗑 Удалить", callback_data: `a:c:d:${id}` }],
    [{ text: "← К категориям", callback_data: "a:c" }, ...backRow()],
  ];

  await deleteAndSend(chatId, msgId, { text, parse_mode: "HTML", reply_markup: { inline_keyboard: kb } });
}

export async function toggleCategory(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  const { data: c } = await supabase.from("categories").select("is_active").eq("id", id).maybeSingle();
  if (!c) return showCategoryList(chatId, msgId);
  await supabase.from("categories").update({ is_active: !c.is_active }).eq("id", id);
  await writeAuditLog(adminId, "category.toggle", id, { is_active: !c.is_active });
  return showCategory(chatId, msgId, id);
}

export async function askDeleteCategory(chatId: number, msgId: number | undefined, id: string) {
  await deleteAndSend(chatId, msgId, {
    text: `⚠️ Удалить категорию <code>${id}</code>?\n\nТовары с этой категорией останутся, поле очистится.`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Да, удалить", callback_data: `a:c:dc:${id}` }],
        [{ text: "Отмена", callback_data: `a:c:v:${id}` }],
      ],
    },
  });
}

export async function confirmDeleteCategory(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  await supabase.from("products").update({ category_id: null }).eq("category_id", id);
  await supabase.from("categories").delete().eq("id", id);
  await writeAuditLog(adminId, "category.delete", id, {});
  return showCategoryList(chatId, msgId);
}

export async function startEditCategory(
  chatId: number,
  msgId: number | undefined,
  id: string,
  field: string,
  adminId: number,
) {
  const label = FIELDS[field];
  if (!label) return showCategory(chatId, msgId, id);
  await setSession(adminId, `c:edit:${id}:${field}`, {});
  await deleteAndSend(chatId, msgId, {
    text: `✏️ Введите новое значение для «<b>${label}</b>».\n\nОтправьте <code>-</code> чтобы очистить.`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: `a:c:v:${id}` }]] },
  });
}

export async function applyEditCategory(
  chatId: number,
  adminId: number,
  id: string,
  field: string,
  raw: string,
) {
  const value = raw === "-" ? null : raw;
  const patch: Record<string, unknown> = {};
  if (field === "sort_order") patch[field] = parseInt(value ?? "0") || 0;
  else patch[field] = value;
  await supabase.from("categories").update(patch).eq("id", id);
  await writeAuditLog(adminId, "category.update", id, { field, value });
  await clearSession(adminId);
  await showCategory(chatId, undefined, id);
}

// --- create wizard ---

export async function startCreateCategory(chatId: number, msgId: number | undefined, adminId: number) {
  await setSession(adminId, "c:new:id", {});
  await deleteAndSend(chatId, msgId, {
    text: "➕ <b>Новая категория</b>\n\nШаг 1/2: введите <b>ID</b> (латиница/цифры/дефис, напр. <code>tshirts</code>):",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "a:c" }]] },
  });
}

export async function handleCreateCategoryStep(chatId: number, adminId: number, raw: string) {
  const sess = await getSession(adminId);
  if (!sess) return;
  if (sess.state === "c:new:id") {
    const id = raw.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
    if (!id) {
      await deleteAndSend(chatId, undefined, { text: "❌ Неверный ID. Только латиница/цифры/дефис. Попробуйте ещё раз." });
      return;
    }
    const { data: exists } = await supabase.from("categories").select("id").eq("id", id).maybeSingle();
    if (exists) {
      await deleteAndSend(chatId, undefined, { text: `❌ Категория <code>${id}</code> уже существует.`, parse_mode: "HTML" });
      return;
    }
    await setSession(adminId, "c:new:name", { id });
    await deleteAndSend(chatId, undefined, {
      text: "Шаг 2/2: введите <b>название</b> категории:",
      parse_mode: "HTML",
    });
    return;
  }
  if (sess.state === "c:new:name") {
    const id = String(sess.payload.id);
    const name = raw.trim();
    if (!name) {
      await deleteAndSend(chatId, undefined, { text: "❌ Пустое название. Попробуйте ещё раз." });
      return;
    }
    await supabase.from("categories").insert({ id, name, project_id: "vieto" });
    await writeAuditLog(adminId, "category.create", id, { name });
    await clearSession(adminId);
    await showCategory(chatId, undefined, id);
  }
}

function escapeHtml(s: string) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
