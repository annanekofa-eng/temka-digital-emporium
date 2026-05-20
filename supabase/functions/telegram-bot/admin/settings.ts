// Settings admin: site_settings (shop_name, marquee, faq_url, welcome, support)
// + message_templates (rep_default + others).
import { deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog, getSetting } from "../_shared/db.ts";
import { setSession, clearSession } from "../_shared/session.ts";

function backRow() { return [{ text: "← Меню", callback_data: "a:menu" }]; }
function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const SETTINGS: { key: string; label: string }[] = [
  { key: "shop_name", label: "🏷 Название магазина" },
  { key: "welcome_text", label: "👋 Текст приветствия" },
  { key: "welcome_photo", label: "🖼 Фото приветствия" },
  { key: "marquee_text", label: "📰 Бегущая строка" },
  { key: "marquee_enabled", label: "🟢 Бегущая строка вкл (true/false)" },
  { key: "faq_url", label: "❓ FAQ URL" },
  { key: "support_username", label: "💬 Username поддержки" },
  { key: "op_channel_id", label: "📢 ОП: ID/@username канала" },
  { key: "op_channel_url", label: "🔗 ОП: ссылка на канал (https://t.me/...)" },
];

export async function showSettingsMenu(chatId: number, msgId?: number) {
  const values = await Promise.all(SETTINGS.map(async (s) => ({
    ...s, value: await getSetting(s.key, ""),
  })));
  const lines = values.map((s) => {
    const v = s.value ? safeSlice(s.value, 60) : "<i>не задано</i>";
    return `<b>${escapeHtml(s.label)}</b>\n<code>${escapeHtml(v)}</code>`;
  }).join("\n\n");
  const kb = values.map((s) => [{ text: s.label, callback_data: `a:se:e:${s.key}` }]);
  kb.push([{ text: "🏦 Реквизиты СБП", callback_data: "a:sbp:req" }]);
  kb.push([{ text: "📋 Шаблоны сообщений", callback_data: "a:se:tpl" }]);
  kb.push(backRow());
  await deleteAndSend(chatId, msgId, {
    text: `⚙️ <b>Настройки магазина</b>\n\n${lines}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: kb },
  });
}

export async function startEditSetting(chatId: number, msgId: number | undefined, key: string, adminId: number) {
  const s = SETTINGS.find((x) => x.key === key);
  if (!s) return showSettingsMenu(chatId, msgId);
  const current = await getSetting(key, "");
  await setSession(adminId, `se:edit:${key}`, {});
  const hint = key === "welcome_photo"
    ? "\n\nПришлите <b>фото</b> прямо в чат (можно с подписью — она станет текстом приветствия), или URL картинки, или <code>-</code> чтобы убрать."
    : key === "op_channel_id"
    ? "\n\nВведите <b>@username</b> канала или числовой ID (например <code>-1001234567890</code>).\n⚠️ Бот должен быть <b>администратором</b> канала, иначе проверка подписки не работает.\nЧтобы отключить ОП — отправьте <code>-</code>."
    : key === "op_channel_url"
    ? "\n\nВведите публичную ссылку на канал, например <code>https://t.me/your_channel</code>, или <code>-</code> чтобы очистить."
    : "\n\nВведите новое значение или <code>-</code> чтобы очистить:";
  await deleteAndSend(chatId, msgId, {
    text: `✏️ <b>${escapeHtml(s.label)}</b>\n\nТекущее значение:\n<code>${escapeHtml(current || "—")}</code>${hint}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "a:se" }]] },
  });
}

export async function applyEditSetting(chatId: number, adminId: number, key: string, raw: string) {
  const value = raw === "-" ? "" : raw;
  await supabase.from("site_settings").upsert({ key, value, updated_at: new Date().toISOString() });
  await writeAuditLog(adminId, "setting.update", key, { value });
  await clearSession(adminId);
  await showSettingsMenu(chatId, undefined);
}

// --- message templates ---

export async function showTemplateList(chatId: number, msgId?: number) {
  const { data } = await supabase
    .from("message_templates")
    .select("key, title, is_active")
    .order("key");
  const rows = (data ?? []).map((t) => [{
    text: safeSlice(`${t.is_active ? "" : "🚫 "}${t.title || t.key}`, 60),
    callback_data: `a:se:t:${t.key}`,
  }]);
  rows.push([{ text: "➕ Создать", callback_data: "a:se:tn" }]);
  rows.push([{ text: "← К настройкам", callback_data: "a:se" }]);
  await deleteAndSend(chatId, msgId, {
    text: "📋 <b>Шаблоны сообщений</b>\n\nПеременные: <code>{{order_number}}</code>, <code>{{support}}</code>",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showTemplate(chatId: number, msgId: number | undefined, key: string) {
  const { data: t } = await supabase.from("message_templates").select("*").eq("key", key).maybeSingle();
  if (!t) return showTemplateList(chatId, msgId);
  const text = [
    `📋 <b>${escapeHtml(t.title || t.key)}</b>`,
    `Key: <code>${t.key}</code>`,
    `Статус: ${t.is_active ? "🟢 активен" : "🔴 выключен"}`,
    "",
    "<b>Содержимое:</b>",
    `<pre>${escapeHtml(t.body)}</pre>`,
  ].join("\n");
  const kb = [
    [
      { text: "📝 Заголовок", callback_data: `a:se:te:${key}:title` },
      { text: "📝 Тело", callback_data: `a:se:te:${key}:body` },
    ],
    [{ text: t.is_active ? "🔴 Выключить" : "🟢 Включить", callback_data: `a:se:tt:${key}` }],
    [{ text: "🗑 Удалить", callback_data: `a:se:td:${key}` }],
    [{ text: "← К шаблонам", callback_data: "a:se:tpl" }],
  ];
  await deleteAndSend(chatId, msgId, { text, parse_mode: "HTML", reply_markup: { inline_keyboard: kb } });
}

export async function toggleTemplate(chatId: number, msgId: number | undefined, key: string, adminId: number) {
  const { data: t } = await supabase.from("message_templates").select("is_active").eq("key", key).maybeSingle();
  if (!t) return showTemplateList(chatId, msgId);
  await supabase.from("message_templates").update({ is_active: !t.is_active }).eq("key", key);
  await writeAuditLog(adminId, "template.toggle", key, { is_active: !t.is_active });
  return showTemplate(chatId, msgId, key);
}

export async function deleteTemplate(chatId: number, msgId: number | undefined, key: string, adminId: number) {
  await supabase.from("message_templates").delete().eq("key", key);
  await writeAuditLog(adminId, "template.delete", key, {});
  return showTemplateList(chatId, msgId);
}

export async function startEditTemplate(
  chatId: number, msgId: number | undefined, key: string, field: string, adminId: number,
) {
  if (!["title", "body"].includes(field)) return;
  await setSession(adminId, `se:tedit:${key}:${field}`, {});
  await deleteAndSend(chatId, msgId, {
    text: `✏️ Введите новое <b>${field === "title" ? "название" : "тело"}</b> шаблона.`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: `a:se:t:${key}` }]] },
  });
}

export async function applyEditTemplate(
  chatId: number, adminId: number, key: string, field: string, raw: string,
) {
  await supabase.from("message_templates").update({ [field]: raw, updated_at: new Date().toISOString() }).eq("key", key);
  await writeAuditLog(adminId, "template.update", key, { field });
  await clearSession(adminId);
  await showTemplate(chatId, undefined, key);
}

export async function startNewTemplate(chatId: number, msgId: number | undefined, adminId: number) {
  await setSession(adminId, "se:tnew:key", {});
  await deleteAndSend(chatId, msgId, {
    text: "➕ <b>Новый шаблон</b>\nШаг 1/2: введите <b>key</b> (латиница/цифры/_):",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "a:se:tpl" }]] },
  });
}

export async function handleNewTemplateStep(
  chatId: number, adminId: number, sessState: string, payload: Record<string, unknown>, raw: string,
) {
  if (sessState === "se:tnew:key") {
    const key = raw.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    if (!key) { await deleteAndSend(chatId, undefined, { text: "❌ Неверный key." }); return; }
    const { data: ex } = await supabase.from("message_templates").select("key").eq("key", key).maybeSingle();
    if (ex) { await deleteAndSend(chatId, undefined, { text: "❌ Такой key уже есть." }); return; }
    await setSession(adminId, "se:tnew:body", { key });
    await deleteAndSend(chatId, undefined, { text: "Шаг 2/2: введите <b>тело</b> шаблона:", parse_mode: "HTML" });
    return;
  }
  if (sessState === "se:tnew:body") {
    const key = String(payload.key);
    await supabase.from("message_templates").insert({ key, title: key, body: raw, is_active: true });
    await writeAuditLog(adminId, "template.create", key, {});
    await clearSession(adminId);
    await showTemplate(chatId, undefined, key);
  }
}

// FSM dispatch for se:* and pc:* states
export async function handleSettingsText(
  chatId: number, adminId: number, sessState: string, payload: Record<string, unknown>, text: string,
): Promise<boolean> {
  if (sessState.startsWith("se:edit:")) {
    const key = sessState.split(":")[2];
    await applyEditSetting(chatId, adminId, key, text);
    return true;
  }
  if (sessState.startsWith("se:tedit:")) {
    const [, , key, field] = sessState.split(":");
    await applyEditTemplate(chatId, adminId, key, field, text);
    return true;
  }
  if (sessState.startsWith("se:tnew:")) {
    await handleNewTemplateStep(chatId, adminId, sessState, payload, text);
    return true;
  }
  return false;
}
