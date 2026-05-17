// Projects admin: edit FLUX / VIETO / CURSOR (no create/delete; fixed set).
import { deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession } from "../_shared/session.ts";

const FIELDS: Record<string, { label: string; type: "text" | "bool" }> = {
  title: { label: "Название", type: "text" },
  subtitle: { label: "Подзаголовок", type: "text" },
  description: { label: "Описание", type: "text" },
  banner: { label: "Баннер (URL)", type: "text" },
  icon: { label: "Иконка (emoji)", type: "text" },
  sort_order: { label: "Порядок", type: "text" },
  is_active: { label: "Активен", type: "bool" },
};

function backRow() {
  return [{ text: "← Меню", callback_data: "a:menu" }];
}

export async function showProjectList(chatId: number, msgId?: number) {
  const { data } = await supabase
    .from("projects")
    .select("id, title, icon, is_active, sort_order")
    .order("sort_order");
  const rows = (data ?? []).map((p) => [
    {
      text: safeSlice(`${p.icon ?? "✨"} ${p.title}${p.is_active ? "" : " (off)"}`, 60),
      callback_data: `a:pr:v:${p.id}`,
    },
  ]);
  rows.push(backRow());
  await deleteAndSend(chatId, msgId, {
    text: "📁 <b>Проекты</b>\n\nВыберите проект для редактирования:",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showProject(chatId: number, msgId: number | undefined, id: string) {
  const { data: p } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (!p) return showProjectList(chatId, msgId);

  const lines = [
    `📁 <b>${escapeHtml(p.title)}</b>  <code>${p.id}</code>`,
    p.subtitle ? `<i>${escapeHtml(p.subtitle)}</i>` : "",
    "",
    p.description ? escapeHtml(p.description) : "<i>нет описания</i>",
    "",
    `Иконка: ${p.icon}`,
    `Баннер: ${p.banner ? "✅" : "—"}`,
    `Сортировка: ${p.sort_order}`,
    `Статус: ${p.is_active ? "🟢 активен" : "🔴 выключен"}`,
  ].filter(Boolean).join("\n");

  const kb = [
    [
      { text: "📝 Название", callback_data: `a:pr:e:${id}:title` },
      { text: "📝 Подзаголовок", callback_data: `a:pr:e:${id}:subtitle` },
    ],
    [
      { text: "📝 Описание", callback_data: `a:pr:e:${id}:description` },
      { text: "🖼 Баннер", callback_data: `a:pr:e:${id}:banner` },
    ],
    [
      { text: "✨ Иконка", callback_data: `a:pr:e:${id}:icon` },
      { text: "↕ Порядок", callback_data: `a:pr:e:${id}:sort_order` },
    ],
    [{ text: p.is_active ? "🔴 Выключить" : "🟢 Включить", callback_data: `a:pr:t:${id}` }],
    [{ text: "← К проектам", callback_data: "a:pr" }, ...backRow()],
  ];

  await deleteAndSend(chatId, msgId, {
    text: lines,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: kb },
  });
}

export async function toggleProject(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  const { data: p } = await supabase.from("projects").select("is_active").eq("id", id).maybeSingle();
  if (!p) return showProjectList(chatId, msgId);
  await supabase.from("projects").update({ is_active: !p.is_active, updated_at: new Date().toISOString() }).eq("id", id);
  await writeAuditLog(adminId, "project.toggle", id, { is_active: !p.is_active });
  return showProject(chatId, msgId, id);
}

export async function startEditProject(
  chatId: number,
  msgId: number | undefined,
  id: string,
  field: string,
  adminId: number,
) {
  const f = FIELDS[field];
  if (!f) return showProject(chatId, msgId, id);
  await setSession(adminId, `pr:edit:${id}:${field}`, {});
  await deleteAndSend(chatId, msgId, {
    text: `✏️ Введите новое значение для «<b>${f.label}</b>».\n\nОтправьте <code>-</code> чтобы очистить.`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: `a:pr:v:${id}` }]] },
  });
}

export async function applyEditProject(
  chatId: number,
  adminId: number,
  id: string,
  field: string,
  raw: string,
) {
  const value = raw === "-" ? null : raw;
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (field === "sort_order") patch[field] = parseInt(value ?? "0") || 0;
  else patch[field] = value;
  await supabase.from("projects").update(patch).eq("id", id);
  await writeAuditLog(adminId, "project.update", id, { field, value });
  await clearSession(adminId);
  await showProject(chatId, undefined, id);
}

function escapeHtml(s: string) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
