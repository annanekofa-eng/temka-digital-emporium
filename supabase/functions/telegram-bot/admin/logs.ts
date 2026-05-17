// Admin action logs viewer. Two tabs: admin_log + balance_history (§14).
import { deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase } from "../_shared/db.ts";

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function backMenu() { return [{ text: "← Меню", callback_data: "a:menu" }]; }

const PAGE = 12;

function tabs(active: "a" | "b") {
  return [
    { text: (active === "a" ? "• " : "") + "📜 Действия", callback_data: "a:lg:t:a:0" },
    { text: (active === "b" ? "• " : "") + "💰 Баланс", callback_data: "a:lg:t:b:0" },
  ];
}

async function showAdminLog(chatId: number, msgId: number | undefined, page: number) {
  const from = page * PAGE;
  const { data, count } = await supabase
    .from("admin_log")
    .select("id, admin_telegram_id, action, target, meta, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE - 1);

  const lines = (data ?? []).map((l) => {
    const when = new Date(l.created_at).toLocaleString("ru-RU");
    const target = l.target ? ` <code>${escapeHtml(safeSlice(l.target, 24))}</code>` : "";
    return `<code>${when}</code> · <b>${escapeHtml(l.action)}</b>${target}\n   by ${l.admin_telegram_id}`;
  }).join("\n\n") || "<i>пока пусто</i>";

  const total = count ?? 0;
  const nav: any[] = [];
  if (page > 0) nav.push({ text: "‹", callback_data: `a:lg:t:a:${page - 1}` });
  nav.push({ text: `${page + 1}/${Math.max(1, Math.ceil(total / PAGE))}`, callback_data: "a:lg" });
  if (from + PAGE < total) nav.push({ text: "›", callback_data: `a:lg:t:a:${page + 1}` });

  const kb: any[] = [tabs("a")];
  if (nav.length > 1) kb.push(nav);
  kb.push(backMenu());

  await deleteAndSend(chatId, msgId, {
    text: `📜 <b>Логи действий</b>\nВсего: <b>${total}</b>\n\n${lines}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: kb },
  });
}

async function showBalanceLog(chatId: number, msgId: number | undefined, page: number) {
  const from = page * PAGE;
  const { data, count } = await supabase
    .from("balance_history")
    .select("id, telegram_id, admin_telegram_id, type, amount, balance_after, comment, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE - 1);

  const lines = (data ?? []).map((r) => {
    const when = new Date(r.created_at).toLocaleString("ru-RU");
    const sign = r.type === "credit" ? "+" : "−";
    const who = r.admin_telegram_id ? ` by ${r.admin_telegram_id}` : "";
    return `<code>${when}</code> · ${sign}${Number(r.amount).toFixed(2)}$ → ${Number(r.balance_after).toFixed(2)}$\n   id <code>${r.telegram_id}</code>${who} · ${escapeHtml(safeSlice(r.comment ?? "", 60))}`;
  }).join("\n\n") || "<i>пока пусто</i>";

  const total = count ?? 0;
  const nav: any[] = [];
  if (page > 0) nav.push({ text: "‹", callback_data: `a:lg:t:b:${page - 1}` });
  nav.push({ text: `${page + 1}/${Math.max(1, Math.ceil(total / PAGE))}`, callback_data: "a:lg" });
  if (from + PAGE < total) nav.push({ text: "›", callback_data: `a:lg:t:b:${page + 1}` });

  const kb: any[] = [tabs("b")];
  if (nav.length > 1) kb.push(nav);
  kb.push(backMenu());

  await deleteAndSend(chatId, msgId, {
    text: `💰 <b>История баланса</b>\nВсего: <b>${total}</b>\n\n${lines}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: kb },
  });
}

export async function showLogs(
  chatId: number, msgId: number | undefined, page = 0, tab: "a" | "b" = "a",
) {
  if (tab === "b") return showBalanceLog(chatId, msgId, page);
  return showAdminLog(chatId, msgId, page);
}
