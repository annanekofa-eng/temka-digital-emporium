// Admin action logs viewer.
import { deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase } from "../_shared/db.ts";

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function backMenu() { return [{ text: "← Меню", callback_data: "a:menu" }]; }

const PAGE = 12;

export async function showLogs(chatId: number, msgId: number | undefined, page = 0) {
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
  if (page > 0) nav.push({ text: "‹", callback_data: `a:lg:p:${page - 1}` });
  nav.push({ text: `${page + 1}/${Math.max(1, Math.ceil(total / PAGE))}`, callback_data: "a:lg" });
  if (from + PAGE < total) nav.push({ text: "›", callback_data: `a:lg:p:${page + 1}` });

  const kb: any[] = [];
  if (nav.length > 1) kb.push(nav);
  kb.push(backMenu());

  await deleteAndSend(chatId, msgId, {
    text: `📜 <b>Логи действий</b>\nВсего: <b>${total}</b>\n\n${lines}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: kb },
  });
}
