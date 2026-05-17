// SBP manual moderation: list pending/approved/rejected, approve (credit balance
// or mark order paid) or reject with comment.
import { tg, deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession } from "../_shared/session.ts";

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function backMenu() { return [{ text: "← Меню", callback_data: "a:menu" }]; }

const PAGE = 6;
const FILTERS: Record<string, { label: string; status: string | null }> = {
  pending:  { label: "⏳ На модерации", status: "pending" },
  approved: { label: "✅ Одобренные",   status: "approved" },
  rejected: { label: "❌ Отклонённые",  status: "rejected" },
  all:      { label: "📋 Все",          status: null },
};
const TYPE_LABELS: Record<string, string> = { order: "🛒 Заказ", topup: "💰 Пополнение" };

export async function showSbpList(
  chatId: number, msgId: number | undefined, filter = "pending", page = 0,
) {
  const f = FILTERS[filter] ?? FILTERS.pending;
  let q = supabase
    .from("sbp_requests")
    .select("id, telegram_id, type, amount_usd, amount_rub, status, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (f.status) q = q.eq("status", f.status);
  const { data, count } = await q;

  const filterRow = Object.entries(FILTERS).map(([k, v]) => ({
    text: safeSlice((filter === k ? "• " : "") + v.label, 30),
    callback_data: `a:sb:f:${k}`,
  }));

  const rows: any[] = [filterRow];
  for (const r of data ?? []) {
    const tag = r.status === "pending" ? "⏳" : r.status === "approved" ? "✅" : "❌";
    rows.push([{
      text: safeSlice(
        `${tag} ${TYPE_LABELS[r.type] ?? r.type} · ${Number(r.amount_rub).toFixed(0)}₽ (${Number(r.amount_usd).toFixed(2)}$) · id ${r.telegram_id}`,
        60,
      ),
      callback_data: `a:sb:v:${r.id}`,
    }]);
  }

  const total = count ?? 0;
  const nav: any[] = [];
  if (page > 0) nav.push({ text: "‹", callback_data: `a:sb:p:${filter}:${page - 1}` });
  nav.push({ text: `${page + 1}/${Math.max(1, Math.ceil(total / PAGE))}`, callback_data: `a:sb:f:${filter}` });
  if ((page + 1) * PAGE < total) nav.push({ text: "›", callback_data: `a:sb:p:${filter}:${page + 1}` });
  if (nav.length > 1) rows.push(nav);
  rows.push(backMenu());

  await deleteAndSend(chatId, msgId, {
    text: `📨 <b>Заявки СБП — ${escapeHtml(f.label)}</b>\nВсего: <b>${total}</b>`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showSbp(chatId: number, msgId: number | undefined, id: string) {
  const { data: r } = await supabase.from("sbp_requests").select("*").eq("id", id).maybeSingle();
  if (!r) return showSbpList(chatId, msgId, "pending", 0);

  const { data: user } = await supabase
    .from("user_profiles").select("first_name, username, balance")
    .eq("telegram_id", r.telegram_id).maybeSingle();

  let orderLine = "";
  if (r.order_id) {
    const { data: o } = await supabase
      .from("orders").select("order_number, total_amount, status, payment_status")
      .eq("id", r.order_id).maybeSingle();
    if (o) orderLine = `\nЗаказ: <b>#${o.order_number}</b> · ${Number(o.total_amount).toFixed(2)}$ · ${o.status}/${o.payment_status}`;
  }

  const txt = [
    `📨 <b>Заявка СБП</b>`,
    `Тип: ${TYPE_LABELS[r.type] ?? r.type}`,
    `Статус: <code>${escapeHtml(r.status)}</code>`,
    `Сумма: <b>${Number(r.amount_rub).toFixed(0)} ₽</b> (≈ ${Number(r.amount_usd).toFixed(2)}$)`,
    r.rate ? `Курс: ${Number(r.rate).toFixed(2)}` : "",
    `Создана: ${new Date(r.created_at).toLocaleString("ru-RU")}`,
    orderLine,
    "",
    `<b>Покупатель:</b> ${escapeHtml(user?.first_name ?? "—")}${user?.username ? ` @${user.username}` : ""}`,
    `Telegram ID: <code>${r.telegram_id}</code>`,
    user ? `Баланс: ${Number(user.balance).toFixed(2)}$` : "",
    r.comment ? `\n📝 От клиента: ${escapeHtml(r.comment)}` : "",
    r.receipt_url ? `\n🧾 Чек: ${escapeHtml(r.receipt_url)}` : "",
    r.admin_comment ? `\n👤 Комментарий админа: ${escapeHtml(r.admin_comment)}` : "",
    r.reviewed_at ? `\nПроверена: ${new Date(r.reviewed_at).toLocaleString("ru-RU")}` : "",
  ].filter(Boolean).join("\n");

  const kb: any[] = [];
  if (r.status === "pending") {
    kb.push([{ text: "✅ Одобрить", callback_data: `a:sb:a:${id}` }]);
    kb.push([{ text: "❌ Отклонить (причина)", callback_data: `a:sb:r:${id}` }]);
  }
  kb.push([{ text: "👤 Покупатель", callback_data: `a:u:v:${r.telegram_id}` }]);
  if (r.order_id) kb.push([{ text: "🛒 Заказ", callback_data: `a:o:v:${r.order_id}` }]);
  kb.push([{ text: "← К списку", callback_data: "a:sb" }]);

  await deleteAndSend(chatId, msgId, { text: txt, parse_mode: "HTML", reply_markup: { inline_keyboard: kb } });
}

export async function approveSbp(
  chatId: number, msgId: number | undefined, id: string, adminId: number,
) {
  const { data: r } = await supabase.from("sbp_requests").select("*").eq("id", id).maybeSingle();
  if (!r || r.status !== "pending") return showSbp(chatId, msgId, id);

  const amount = Number(r.amount_usd);
  let resultText = "";

  if (r.type === "topup") {
    const { data: bal } = await supabase.rpc("credit_balance", {
      p_telegram_id: r.telegram_id, p_amount: amount,
    });
    await supabase.from("balance_history").insert({
      telegram_id: r.telegram_id, admin_telegram_id: adminId, amount, type: "credit",
      comment: `СБП пополнение, заявка ${id.slice(0, 8)}`, balance_after: Number(bal ?? 0),
    });
    resultText = `💰 Ваш баланс пополнен на <b>${amount.toFixed(2)}$</b> (СБП).`;
  } else if (r.type === "order" && r.order_id) {
    await supabase.from("orders").update({
      payment_status: "paid", status: "paid", updated_at: new Date().toISOString(),
    }).eq("id", r.order_id);
    const { data: o } = await supabase.from("orders").select("order_number").eq("id", r.order_id).maybeSingle();
    resultText = `✅ Оплата по заказу <b>#${o?.order_number ?? ""}</b> подтверждена.`;
  }

  await supabase.from("sbp_requests").update({
    status: "approved", admin_telegram_id: adminId, reviewed_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq("id", id);
  await writeAuditLog(adminId, "sbp.approve", id, { type: r.type, amount, order_id: r.order_id });

  await tg("sendMessage", { chat_id: r.telegram_id, text: resultText, parse_mode: "HTML" });
  return showSbp(chatId, msgId, id);
}

export async function startRejectSbp(
  chatId: number, msgId: number | undefined, id: string, adminId: number,
) {
  await setSession(adminId, `sb:rej:${id}`, {});
  await deleteAndSend(chatId, msgId, {
    text: "❌ Укажите <b>причину отклонения</b> одним сообщением (отправится клиенту).\nИли <code>-</code> чтобы без причины.",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "← Отмена", callback_data: `a:sb:v:${id}` }]] },
  });
}

export async function applyRejectSbp(
  chatId: number, adminId: number, id: string, reason: string,
) {
  await clearSession(adminId);
  const { data: r } = await supabase.from("sbp_requests").select("telegram_id, type, amount_rub").eq("id", id).maybeSingle();
  if (!r) {
    await tg("sendMessage", { chat_id: chatId, text: "❌ Заявка не найдена." });
    return;
  }
  const comment = reason.trim() === "-" ? null : reason.trim();
  await supabase.from("sbp_requests").update({
    status: "rejected", admin_telegram_id: adminId, admin_comment: comment,
    reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", id);
  await writeAuditLog(adminId, "sbp.reject", id, { reason: comment });

  const userText = [
    `❌ Ваша заявка СБП на <b>${Number(r.amount_rub).toFixed(0)} ₽</b> отклонена.`,
    comment ? `\nПричина: ${escapeHtml(comment)}` : "",
  ].join("");
  await tg("sendMessage", { chat_id: r.telegram_id, text: userText, parse_mode: "HTML" });

  return showSbp(chatId, undefined, id);
}
