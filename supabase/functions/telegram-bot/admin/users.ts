// Users admin: search, profile, balance +/-, block/unblock, internal note.
import { deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession, getSession } from "../_shared/session.ts";

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function backRow() { return [{ text: "← Меню", callback_data: "a:menu" }]; }

export async function showUsersMenu(chatId: number, msgId?: number) {
  await deleteAndSend(chatId, msgId, {
    text: "👥 <b>Пользователи</b>\n\nНайдите пользователя по Telegram ID или @username.",
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [
        [{ text: "🔎 Найти", callback_data: "a:u:s" }],
        [{ text: "📋 Последние 10", callback_data: "a:u:recent" }],
        backRow(),
      ],
    },
  });
}

export async function showRecentUsers(chatId: number, msgId?: number) {
  const { data } = await supabase
    .from("user_profiles")
    .select("telegram_id, first_name, username, balance, is_blocked, created_at")
    .order("created_at", { ascending: false })
    .limit(10);
  const rows = (data ?? []).map((u) => [{
    text: safeSlice(
      `${u.is_blocked ? "🚫 " : ""}${u.first_name ?? "—"}${u.username ? ` @${u.username}` : ""} · ${Number(u.balance).toFixed(2)}$`,
      60,
    ),
    callback_data: `a:u:v:${u.telegram_id}`,
  }]);
  rows.push([{ text: "← Назад", callback_data: "a:u" }]);
  await deleteAndSend(chatId, msgId, {
    text: "📋 <b>Последние регистрации</b>",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function startSearchUser(chatId: number, msgId: number | undefined, adminId: number) {
  await setSession(adminId, "u:search", {});
  await deleteAndSend(chatId, msgId, {
    text: "🔎 Введите <b>Telegram ID</b> (число) или <b>@username</b>:",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "a:u" }]] },
  });
}

export async function applySearchUser(chatId: number, adminId: number, raw: string) {
  await clearSession(adminId);
  const q = raw.trim().replace(/^@/, "");
  let user: any = null;
  if (/^\d+$/.test(q)) {
    const { data } = await supabase.from("user_profiles").select("telegram_id").eq("telegram_id", Number(q)).maybeSingle();
    user = data;
  } else {
    const { data } = await supabase.from("user_profiles").select("telegram_id").ilike("username", q).maybeSingle();
    user = data;
  }
  if (!user) {
    await deleteAndSend(chatId, undefined, {
      text: "❌ Пользователь не найден.",
      reply_markup: { inline_keyboard: [[{ text: "← Назад", callback_data: "a:u" }]] },
    });
    return;
  }
  await showUser(chatId, undefined, String(user.telegram_id));
}

export async function showUser(chatId: number, msgId: number | undefined, telegramIdStr: string) {
  const telegramId = Number(telegramIdStr);
  const { data: u } = await supabase.from("user_profiles").select("*").eq("telegram_id", telegramId).maybeSingle();
  if (!u) return showUsersMenu(chatId, msgId);
  const { count: ordersCount } = await supabase
    .from("orders").select("id", { count: "exact", head: true }).eq("telegram_id", telegramId);

  const text = [
    `👤 <b>${escapeHtml(u.first_name)}${u.last_name ? " " + escapeHtml(u.last_name) : ""}</b>`,
    u.username ? `@${u.username}` : "",
    `ID: <code>${u.telegram_id}</code>`,
    "",
    `💰 Баланс: <b>${Number(u.balance).toFixed(2)}$</b>`,
    `🛒 Заказов: ${ordersCount ?? 0}`,
    `Статус: ${u.is_blocked ? "🚫 ЗАБЛОКИРОВАН" : "🟢 активен"}`,
    u.is_premium ? "⭐ Telegram Premium" : "",
    `Регистрация: ${new Date(u.created_at).toLocaleDateString("ru-RU")}`,
    u.internal_note ? `\n📝 <i>${escapeHtml(u.internal_note)}</i>` : "",
  ].filter(Boolean).join("\n");

  const kb = [
    [
      { text: "💵 +Баланс", callback_data: `a:u:bc:${telegramId}` },
      { text: "💸 −Баланс", callback_data: `a:u:bd:${telegramId}` },
    ],
    [{ text: "📜 История баланса", callback_data: `a:u:bh:${telegramId}` }],
    [
      { text: u.is_blocked ? "🟢 Разблокировать" : "🚫 Заблокировать", callback_data: `a:u:bl:${telegramId}` },
    ],
    [{ text: "📝 Заметка", callback_data: `a:u:nt:${telegramId}` }],
    [{ text: "← К поиску", callback_data: "a:u" }, ...backRow()],
  ];

  await deleteAndSend(chatId, msgId, { text, parse_mode: "HTML", reply_markup: { inline_keyboard: kb } });
}

export async function toggleBlock(chatId: number, msgId: number | undefined, telegramIdStr: string, adminId: number) {
  const tid = Number(telegramIdStr);
  const { data: u } = await supabase.from("user_profiles").select("is_blocked").eq("telegram_id", tid).maybeSingle();
  if (!u) return showUsersMenu(chatId, msgId);
  await supabase.from("user_profiles").update({ is_blocked: !u.is_blocked }).eq("telegram_id", tid);
  await writeAuditLog(adminId, "user.block", String(tid), { is_blocked: !u.is_blocked });
  return showUser(chatId, msgId, telegramIdStr);
}

export async function startBalanceChange(
  chatId: number, msgId: number | undefined, telegramIdStr: string, dir: "credit" | "deduct", adminId: number,
) {
  await setSession(adminId, `u:bal:${telegramIdStr}:${dir}`, {});
  await deleteAndSend(chatId, msgId, {
    text: `${dir === "credit" ? "💵 Начислить" : "💸 Списать"} баланс\n\nВведите сумму USDT и (опционально) комментарий через пробел.\nПример: <code>10 бонус</code>`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: `a:u:v:${telegramIdStr}` }]] },
  });
}

export async function applyBalanceChange(
  chatId: number, adminId: number, telegramIdStr: string, dir: "credit" | "deduct", raw: string,
) {
  const tid = Number(telegramIdStr);
  const m = raw.trim().match(/^(\S+)(?:\s+([\s\S]+))?$/);
  if (!m) {
    await deleteAndSend(chatId, undefined, { text: "❌ Неверный формат. Пример: <code>10 бонус</code>", parse_mode: "HTML" });
    return;
  }
  const amount = Number(m[1].replace(",", "."));
  const comment = m[2]?.trim() ?? "";
  if (!isFinite(amount) || amount <= 0) {
    await deleteAndSend(chatId, undefined, { text: "❌ Сумма должна быть числом > 0." });
    return;
  }
  const rpc = dir === "credit" ? "credit_balance" : "deduct_balance";
  const { data: newBal, error } = await supabase.rpc(rpc, { p_telegram_id: tid, p_amount: amount });
  if (error) {
    await deleteAndSend(chatId, undefined, { text: `❌ Ошибка: ${error.message}` });
    return;
  }
  await supabase.from("balance_history").insert({
    telegram_id: tid,
    admin_telegram_id: adminId,
    type: dir,
    amount,
    balance_after: Number(newBal ?? 0),
    comment: comment || (dir === "credit" ? "Начисление администратором" : "Списание администратором"),
  });
  await writeAuditLog(adminId, `user.balance.${dir}`, String(tid), { amount, comment, balance_after: newBal });
  await clearSession(adminId);
  await showUser(chatId, undefined, telegramIdStr);
}

export async function showBalanceHistory(chatId: number, msgId: number | undefined, telegramIdStr: string) {
  const tid = Number(telegramIdStr);
  const { data } = await supabase
    .from("balance_history")
    .select("type, amount, balance_after, comment, created_at, admin_telegram_id")
    .eq("telegram_id", tid)
    .order("created_at", { ascending: false })
    .limit(20);

  const lines = (data ?? []).map((r) => {
    const sign = r.type === "credit" ? "+" : "−";
    const date = new Date(r.created_at).toLocaleString("ru-RU");
    return `${sign}${Number(r.amount).toFixed(2)}$ → ${Number(r.balance_after).toFixed(2)}$ · ${escapeHtml(r.comment)}\n<i>${date}</i>`;
  }).join("\n\n");

  await deleteAndSend(chatId, msgId, {
    text: `📜 <b>История баланса</b>\n\n${lines || "<i>Нет операций</i>"}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "← К пользователю", callback_data: `a:u:v:${telegramIdStr}` }]] },
  });
}

export async function startEditNote(chatId: number, msgId: number | undefined, telegramIdStr: string, adminId: number) {
  await setSession(adminId, `u:note:${telegramIdStr}`, {});
  await deleteAndSend(chatId, msgId, {
    text: "📝 Введите заметку (видна только админам).\nОтправьте <code>-</code> чтобы очистить.",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: `a:u:v:${telegramIdStr}` }]] },
  });
}

export async function applyEditNote(chatId: number, adminId: number, telegramIdStr: string, raw: string) {
  const tid = Number(telegramIdStr);
  const value = raw === "-" ? null : raw;
  await supabase.from("user_profiles").update({ internal_note: value }).eq("telegram_id", tid);
  await writeAuditLog(adminId, "user.note", String(tid), { value });
  await clearSession(adminId);
  await showUser(chatId, undefined, telegramIdStr);
}

// FSM dispatch helper for u:* states (called from index.ts handleAdminText).
export async function handleUserText(chatId: number, adminId: number, sessState: string, text: string): Promise<boolean> {
  const parts = sessState.split(":");
  if (parts[0] !== "u") return false;
  if (parts[1] === "search") { await applySearchUser(chatId, adminId, text); return true; }
  if (parts[1] === "bal" && parts[2] && (parts[3] === "credit" || parts[3] === "deduct")) {
    await applyBalanceChange(chatId, adminId, parts[2], parts[3], text); return true;
  }
  if (parts[1] === "note" && parts[2]) { await applyEditNote(chatId, adminId, parts[2], text); return true; }
  return false;
}
