// Promocodes admin: CRUD over `promocodes`.
import { deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession, getSession } from "../_shared/session.ts";

function backRow() { return [{ text: "← Меню", callback_data: "a:menu" }]; }
function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

const FIELDS: Record<string, { label: string; type: "text" | "num" | "date" }> = {
  code: { label: "Код", type: "text" },
  discount_type: { label: "Тип (percent / fixed)", type: "text" },
  discount_value: { label: "Размер скидки", type: "num" },
  max_uses: { label: "Лимит использований", type: "num" },
  max_uses_per_user: { label: "Лимит на пользователя", type: "num" },
  valid_until: { label: "Действителен до (YYYY-MM-DD или -)", type: "date" },
};

export async function showPromoList(chatId: number, msgId?: number) {
  const { data } = await supabase
    .from("promocodes")
    .select("id, code, discount_type, discount_value, is_active, used_count, max_uses, valid_until")
    .order("is_active", { ascending: false })
    .order("code");
  const rows = (data ?? []).map((p) => {
    const v = p.discount_type === "percent" ? `${p.discount_value}%` : `${p.discount_value}$`;
    return [{
      text: safeSlice(`${p.is_active ? "🟢" : "🔴"} ${p.code} · ${v} · ${p.used_count}/${p.max_uses ?? "∞"}`, 60),
      callback_data: `a:pc:v:${p.id}`,
    }];
  });
  rows.push([{ text: "➕ Создать", callback_data: "a:pc:n" }]);
  rows.push(backRow());
  await deleteAndSend(chatId, msgId, {
    text: "🏷 <b>Промокоды</b>",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showPromo(chatId: number, msgId: number | undefined, id: string) {
  const { data: p } = await supabase.from("promocodes").select("*").eq("id", id).maybeSingle();
  if (!p) return showPromoList(chatId, msgId);
  const v = p.discount_type === "percent" ? `${p.discount_value}%` : `${p.discount_value}$`;
  const text = [
    `🏷 <b>${escapeHtml(p.code)}</b>`,
    `Скидка: <b>${v}</b> (${p.discount_type})`,
    `Использовано: ${p.used_count}/${p.max_uses ?? "∞"}`,
    p.max_uses_per_user ? `Лимит на юзера: ${p.max_uses_per_user}` : "",
    p.valid_until ? `Действителен до: ${new Date(p.valid_until).toLocaleDateString("ru-RU")}` : "",
    `Статус: ${p.is_active ? "🟢 активен" : "🔴 выключен"}`,
  ].filter(Boolean).join("\n");

  const kb = [
    [
      { text: "📝 Код", callback_data: `a:pc:e:${id}:code` },
      { text: "💯 Тип", callback_data: `a:pc:e:${id}:discount_type` },
    ],
    [
      { text: "💵 Размер", callback_data: `a:pc:e:${id}:discount_value` },
      { text: "📅 До даты", callback_data: `a:pc:e:${id}:valid_until` },
    ],
    [
      { text: "♾ Лимит всего", callback_data: `a:pc:e:${id}:max_uses` },
      { text: "👤 На юзера", callback_data: `a:pc:e:${id}:max_uses_per_user` },
    ],
    [{ text: p.is_active ? "🔴 Выключить" : "🟢 Включить", callback_data: `a:pc:t:${id}` }],
    [{ text: "🗑 Удалить", callback_data: `a:pc:d:${id}` }],
    [{ text: "← К списку", callback_data: "a:pc" }, ...backRow()],
  ];
  await deleteAndSend(chatId, msgId, { text, parse_mode: "HTML", reply_markup: { inline_keyboard: kb } });
}

export async function togglePromo(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  const { data: p } = await supabase.from("promocodes").select("is_active").eq("id", id).maybeSingle();
  if (!p) return showPromoList(chatId, msgId);
  await supabase.from("promocodes").update({ is_active: !p.is_active }).eq("id", id);
  await writeAuditLog(adminId, "promo.toggle", id, { is_active: !p.is_active });
  return showPromo(chatId, msgId, id);
}

export async function askDeletePromo(chatId: number, msgId: number | undefined, id: string) {
  await deleteAndSend(chatId, msgId, {
    text: "⚠️ Удалить промокод?",
    reply_markup: {
      inline_keyboard: [
        [{ text: "✅ Да", callback_data: `a:pc:dc:${id}` }],
        [{ text: "Отмена", callback_data: `a:pc:v:${id}` }],
      ],
    },
  });
}
export async function confirmDeletePromo(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  await supabase.from("promocodes").delete().eq("id", id);
  await writeAuditLog(adminId, "promo.delete", id, {});
  return showPromoList(chatId, msgId);
}

export async function startEditPromo(
  chatId: number, msgId: number | undefined, id: string, field: string, adminId: number,
) {
  const f = FIELDS[field];
  if (!f) return showPromo(chatId, msgId, id);
  await setSession(adminId, `pc:edit:${id}:${field}`, {});
  await deleteAndSend(chatId, msgId, {
    text: `✏️ Введите значение для «<b>${f.label}</b>».\nОтправьте <code>-</code> чтобы очистить.`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: `a:pc:v:${id}` }]] },
  });
}

export async function applyEditPromo(
  chatId: number, adminId: number, id: string, field: string, raw: string,
) {
  const f = FIELDS[field];
  if (!f) return;
  let value: unknown;
  if (raw === "-") {
    value = (field === "discount_value") ? 0 : null;
  } else if (f.type === "num") {
    const n = Number(raw.replace(",", "."));
    if (!isFinite(n)) { await deleteAndSend(chatId, undefined, { text: "❌ Нужно число." }); return; }
    value = n;
  } else if (f.type === "date") {
    const d = new Date(raw);
    if (isNaN(d.getTime())) { await deleteAndSend(chatId, undefined, { text: "❌ Дата YYYY-MM-DD." }); return; }
    value = d.toISOString();
  } else {
    value = raw;
  }
  await supabase.from("promocodes").update({ [field]: value }).eq("id", id);
  await writeAuditLog(adminId, "promo.update", id, { field, value });
  await clearSession(adminId);
  await showPromo(chatId, undefined, id);
}

// --- create wizard: code → type → value ---

export async function startCreatePromo(chatId: number, msgId: number | undefined, adminId: number) {
  await setSession(adminId, "pc:new:code", {});
  await deleteAndSend(chatId, msgId, {
    text: "➕ <b>Новый промокод</b>\nШаг 1/3: введите <b>код</b> (буквы/цифры):",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "a:pc" }]] },
  });
}

export async function handleCreatePromoStep(chatId: number, adminId: number, raw: string) {
  const sess = await getSession(adminId);
  if (!sess) return;
  if (sess.state === "pc:new:code") {
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9_-]{2,32}$/.test(code)) {
      await deleteAndSend(chatId, undefined, { text: "❌ Код 2–32 символа A-Z/0-9/_-." });
      return;
    }
    const { data: ex } = await supabase.from("promocodes").select("id").eq("code", code).maybeSingle();
    if (ex) { await deleteAndSend(chatId, undefined, { text: "❌ Такой код уже есть." }); return; }
    await setSession(adminId, "pc:new:type", { code });
    await deleteAndSend(chatId, undefined, {
      text: "Шаг 2/3: тип скидки?",
      reply_markup: { inline_keyboard: [[
        { text: "Проценты", callback_data: "a:pc:nt:percent" },
        { text: "Фикс. сумма", callback_data: "a:pc:nt:fixed" },
      ]]},
    });
    return;
  }
  if (sess.state === "pc:new:value") {
    const v = Number(raw.replace(",", "."));
    if (!isFinite(v) || v <= 0) { await deleteAndSend(chatId, undefined, { text: "❌ Число > 0." }); return; }
    const { code, discount_type } = sess.payload as any;
    const { data, error } = await supabase
      .from("promocodes")
      .insert({ code, discount_type, discount_value: v, is_active: true })
      .select("id").single();
    if (error || !data) { await deleteAndSend(chatId, undefined, { text: `❌ ${error?.message ?? "ошибка"}` }); return; }
    await writeAuditLog(adminId, "promo.create", data.id, { code, discount_type, discount_value: v });
    await clearSession(adminId);
    await showPromo(chatId, undefined, data.id);
  }
}

export async function setNewPromoType(chatId: number, msgId: number | undefined, type: string, adminId: number) {
  const sess = await getSession(adminId);
  if (!sess || sess.state !== "pc:new:type") return showPromoList(chatId, msgId);
  await setSession(adminId, "pc:new:value", { ...sess.payload, discount_type: type });
  await deleteAndSend(chatId, msgId, {
    text: `Шаг 3/3: введите размер скидки${type === "percent" ? " в %" : " в USDT"}:`,
  });
}
