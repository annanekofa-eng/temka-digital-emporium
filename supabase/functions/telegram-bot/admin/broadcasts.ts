// Broadcasts: compose text broadcast, optional photo, send to all users.
// Synchronous batch send with light throttling; updates `broadcasts` row.
import { tg, deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession } from "../_shared/session.ts";

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function backMenu() { return [{ text: "← Меню", callback_data: "a:menu" }]; }
const PAGE = 6;

export async function showBroadcastList(chatId: number, msgId?: number, page = 0) {
  const from = page * PAGE;
  const { data, count } = await supabase
    .from("broadcasts")
    .select("id, text, status, sent_count, failed_count, total_count, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE - 1);

  const rows: any[] = (data ?? []).map((b) => [{
    text: safeSlice(`${b.status === "sent" ? "✅" : b.status === "sending" ? "📤" : b.status === "failed" ? "❌" : "📝"} ` +
      `${b.text || "(пусто)"} · ${b.sent_count}/${b.total_count}`, 60),
    callback_data: `a:bc:v:${b.id}`,
  }]);

  rows.push([{ text: "➕ Новая рассылка", callback_data: "a:bc:n" }]);

  const total = count ?? 0;
  const nav: any[] = [];
  if (page > 0) nav.push({ text: "‹", callback_data: `a:bc:p:${page - 1}` });
  nav.push({ text: `${page + 1}/${Math.max(1, Math.ceil(total / PAGE))}`, callback_data: "a:bc" });
  if (from + PAGE < total) nav.push({ text: "›", callback_data: `a:bc:p:${page + 1}` });
  if (nav.length > 1) rows.push(nav);
  rows.push(backMenu());

  await deleteAndSend(chatId, msgId, {
    text: `📣 <b>Рассылки</b>\nВсего: <b>${total}</b>`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showBroadcast(chatId: number, msgId: number | undefined, id: string) {
  const { data: b } = await supabase.from("broadcasts").select("*").eq("id", id).maybeSingle();
  if (!b) return showBroadcastList(chatId, msgId, 0);
  const txt = [
    `📣 <b>Рассылка</b>`,
    `Статус: <code>${escapeHtml(b.status)}</code>`,
    `Отправлено: <b>${b.sent_count}</b> / <b>${b.total_count}</b> · Ошибок: <b>${b.failed_count}</b>`,
    `Дата: ${new Date(b.created_at).toLocaleString("ru-RU")}`,
    ``,
    b.photo_url ? `🖼 ${escapeHtml(b.photo_url)}\n` : "",
    escapeHtml(b.text || ""),
    b.error_message ? `\n\n⚠️ ${escapeHtml(b.error_message)}` : "",
  ].join("\n");
  const kb: any[] = [];
  if (b.status === "draft") {
    kb.push([{ text: "🚀 Отправить всем", callback_data: `a:bc:send:${id}` }]);
    kb.push([{ text: "🗑 Удалить", callback_data: `a:bc:d:${id}` }]);
  }
  kb.push([{ text: "← К списку", callback_data: "a:bc" }]);
  await deleteAndSend(chatId, msgId, { text: txt, parse_mode: "HTML", reply_markup: { inline_keyboard: kb } });
}

export async function startNewBroadcast(chatId: number, msgId: number | undefined, adminId: number) {
  await setSession(adminId, "bc:new:text", {});
  await deleteAndSend(chatId, msgId, {
    text: "✏️ Отправьте <b>текст</b> рассылки (HTML разрешён).\nПосле текста спрошу про фото.",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "a:bc" }]] },
  });
}

export async function handleNewBroadcastStep(
  chatId: number,
  adminId: number,
  state: string,
  payload: Record<string, unknown>,
  text: string,
) {
  const step = state.split(":")[2];
  if (step === "text") {
    await setSession(adminId, "bc:new:photo", { text });
    await deleteAndSend(chatId, undefined, {
      text: "🖼 Отправьте URL фото или <code>-</code> чтобы без фото.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "a:bc" }]] },
    });
    return;
  }
  if (step === "photo") {
    const photo = text.trim() === "-" ? null : text.trim();
    const body = String(payload.text ?? "");
    const { data, error } = await supabase
      .from("broadcasts")
      .insert({
        admin_telegram_id: adminId,
        text: body,
        photo_url: photo,
        audience: "all",
        status: "draft",
      })
      .select("id")
      .single();
    await clearSession(adminId);
    if (error || !data) {
      await tg("sendMessage", { chat_id: chatId, text: `⚠️ Ошибка: ${error?.message ?? "не удалось создать"}` });
      return showBroadcastList(chatId);
    }
    await writeAuditLog(adminId, "broadcast.create", data.id, {});
    return showBroadcast(chatId, undefined, data.id);
  }
}

export async function deleteBroadcast(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  await supabase.from("broadcasts").delete().eq("id", id);
  await writeAuditLog(adminId, "broadcast.delete", id, {});
  return showBroadcastList(chatId, msgId, 0);
}

// Synchronous send to all non-blocked users. Throttled to ~25 msg/sec.
export async function sendBroadcast(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  const { data: b } = await supabase.from("broadcasts").select("*").eq("id", id).maybeSingle();
  if (!b || b.status !== "draft") return showBroadcast(chatId, msgId, id);

  const { data: users, count } = await supabase
    .from("user_profiles")
    .select("telegram_id", { count: "exact" })
    .eq("is_blocked", false);

  const total = count ?? users?.length ?? 0;
  await supabase.from("broadcasts").update({
    status: "sending",
    total_count: total,
    sent_count: 0,
    failed_count: 0,
    error_message: null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  await deleteAndSend(chatId, msgId, {
    text: `📤 Рассылка запущена. Получателей: <b>${total}</b>`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Обновить", callback_data: `a:bc:v:${id}` }]] },
  });

  // fire-and-forget loop
  (async () => {
    let sent = 0, failed = 0;
    for (const u of users ?? []) {
      try {
        const payload: any = { chat_id: u.telegram_id, parse_mode: "HTML" };
        let res;
        if (b.photo_url) {
          res = await tg("sendPhoto", { ...payload, photo: b.photo_url, caption: b.text });
        } else {
          res = await tg("sendMessage", { ...payload, text: b.text });
        }
        if (res?.ok) sent++; else failed++;
      } catch { failed++; }
      // throttle a bit
      if ((sent + failed) % 25 === 0) {
        await supabase.from("broadcasts").update({
          sent_count: sent, failed_count: failed, cursor_telegram_id: u.telegram_id,
        }).eq("id", id);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
    await supabase.from("broadcasts").update({
      sent_count: sent, failed_count: failed, status: "sent",
      updated_at: new Date().toISOString(),
    }).eq("id", id);
    await writeAuditLog(adminId, "broadcast.send", id, { sent, failed });
  })();
}
