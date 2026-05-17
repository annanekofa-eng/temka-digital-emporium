// Reviews moderation: list pending/approved/rejected, approve/reject/delete.
import { deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function backMenu() { return [{ text: "← Меню", callback_data: "a:menu" }]; }

const PAGE = 6;
const FILTERS: Record<string, { label: string; status: string | null }> = {
  pending: { label: "⏳ На модерации", status: "pending" },
  approved: { label: "✅ Одобренные", status: "approved" },
  rejected: { label: "❌ Отклонённые", status: "rejected" },
  all: { label: "📋 Все", status: null },
};

export async function showReviewList(
  chatId: number,
  msgId: number | undefined,
  filter = "pending",
  page = 0,
) {
  const f = FILTERS[filter] ?? FILTERS.pending;
  let q = supabase
    .from("reviews")
    .select("id, author, rating, text, moderation_status, created_at, product_id", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(page * PAGE, page * PAGE + PAGE - 1);
  if (f.status) q = q.eq("moderation_status", f.status);
  const { data, count } = await q;

  const filterRow = Object.entries(FILTERS).map(([k, v]) => ({
    text: safeSlice((filter === k ? "• " : "") + v.label, 30),
    callback_data: `a:rv:f:${k}`,
  }));

  const rows: any[] = [filterRow];
  for (const r of data ?? []) {
    const stars = "★".repeat(r.rating || 0) + "☆".repeat(5 - (r.rating || 0));
    const tag = r.moderation_status === "pending" ? "⏳" :
                r.moderation_status === "approved" ? "✅" : "❌";
    rows.push([{
      text: safeSlice(`${tag} ${stars} ${r.author}: ${r.text}`, 60),
      callback_data: `a:rv:v:${r.id}`,
    }]);
  }

  const total = count ?? 0;
  const nav: any[] = [];
  if (page > 0) nav.push({ text: "‹", callback_data: `a:rv:p:${filter}:${page - 1}` });
  nav.push({ text: `${page + 1}/${Math.max(1, Math.ceil(total / PAGE))}`, callback_data: `a:rv:f:${filter}` });
  if ((page + 1) * PAGE < total) nav.push({ text: "›", callback_data: `a:rv:p:${filter}:${page + 1}` });
  if (nav.length > 1) rows.push(nav);
  rows.push(backMenu());

  await deleteAndSend(chatId, msgId, {
    text: `⭐ <b>Отзывы — ${escapeHtml(f.label)}</b>\nВсего: <b>${total}</b>`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showReview(chatId: number, msgId: number | undefined, id: string) {
  const { data: r } = await supabase.from("reviews").select("*").eq("id", id).maybeSingle();
  if (!r) return showReviewList(chatId, msgId, "pending", 0);

  const { data: p } = await supabase.from("products").select("title").eq("id", r.product_id).maybeSingle();
  const stars = "★".repeat(r.rating || 0) + "☆".repeat(5 - (r.rating || 0));

  const txt = [
    `⭐ <b>Отзыв</b>`,
    `Товар: <b>${escapeHtml(p?.title ?? r.product_id)}</b>`,
    `Автор: <b>${escapeHtml(r.author)}</b>` + (r.telegram_id ? ` (id ${r.telegram_id})` : ""),
    `Оценка: ${stars}`,
    `Статус: <code>${escapeHtml(r.moderation_status)}</code>`,
    `Дата: ${new Date(r.created_at).toLocaleString("ru-RU")}`,
    ``,
    escapeHtml(r.text || ""),
  ].join("\n");

  const kb: any[] = [];
  if (r.moderation_status !== "approved") {
    kb.push([{ text: "✅ Одобрить", callback_data: `a:rv:a:${id}` }]);
  }
  if (r.moderation_status !== "rejected") {
    kb.push([{ text: "❌ Отклонить", callback_data: `a:rv:r:${id}` }]);
  }
  kb.push([{ text: "🗑 Удалить", callback_data: `a:rv:d:${id}` }]);
  kb.push([{ text: "← К списку", callback_data: "a:rv" }]);

  await deleteAndSend(chatId, msgId, { text: txt, parse_mode: "HTML", reply_markup: { inline_keyboard: kb } });
}

async function setStatus(chatId: number, msgId: number | undefined, id: string, status: string, adminId: number) {
  await supabase.from("reviews").update({ moderation_status: status }).eq("id", id);
  await writeAuditLog(adminId, "review.moderate", id, { status });
  return showReview(chatId, msgId, id);
}
export const approveReview = (c: number, m: number | undefined, id: string, a: number) => setStatus(c, m, id, "approved", a);
export const rejectReview  = (c: number, m: number | undefined, id: string, a: number) => setStatus(c, m, id, "rejected", a);

export async function deleteReview(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  await supabase.from("reviews").delete().eq("id", id);
  await writeAuditLog(adminId, "review.delete", id, {});
  return showReviewList(chatId, msgId, "pending", 0);
}
