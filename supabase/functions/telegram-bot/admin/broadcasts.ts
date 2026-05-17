// Broadcasts: wizard (text → photo → audience → preview), test-send, mass-send
// with audience filter and resume from cursor. Photo can be uploaded via TG.
import { tg, deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession } from "../_shared/session.ts";
import { uploadTelegramPhoto } from "../_shared/upload.ts";

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function backMenu() { return [{ text: "← Меню", callback_data: "a:menu" }]; }
const PAGE = 6;

const AUDIENCES: Record<string, { label: string; desc: string }> = {
  all:          { label: "👥 Все",           desc: "все незаблокированные" },
  buyers:       { label: "🛒 Покупатели",    desc: "хотя бы 1 оплаченный заказ" },
  no_orders:    { label: "🆕 Без заказов",   desc: "ещё ничего не покупали" },
  with_balance: { label: "💰 С балансом",    desc: "баланс > 0" },
};

const STATUS_ICON: Record<string, string> = {
  draft: "📝", sending: "📤", sent: "✅", failed: "❌",
};

export async function showBroadcastList(chatId: number, msgId?: number, page = 0) {
  const from = page * PAGE;
  const { data, count } = await supabase
    .from("broadcasts")
    .select("id, text, status, sent_count, failed_count, total_count, audience, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + PAGE - 1);

  const rows: any[] = (data ?? []).map((b) => [{
    text: safeSlice(`${STATUS_ICON[b.status] ?? "·"} ${AUDIENCES[b.audience]?.label ?? b.audience} · ${b.text || "(пусто)"} · ${b.sent_count}/${b.total_count}`, 60),
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
  const aud = AUDIENCES[b.audience] ?? { label: b.audience, desc: "" };
  const txt = [
    `📣 <b>Рассылка</b>`,
    `Статус: ${STATUS_ICON[b.status] ?? ""} <code>${escapeHtml(b.status)}</code>`,
    `Аудитория: <b>${aud.label}</b> <i>(${escapeHtml(aud.desc)})</i>`,
    `Отправлено: <b>${b.sent_count}</b> / <b>${b.total_count}</b> · Ошибок: <b>${b.failed_count}</b>`,
    b.cursor_telegram_id ? `Курсор: <code>${b.cursor_telegram_id}</code>` : "",
    `Дата: ${new Date(b.created_at).toLocaleString("ru-RU")}`,
    ``,
    b.photo_url ? `🖼 ${escapeHtml(b.photo_url)}\n` : "",
    escapeHtml(b.text || ""),
    b.error_message ? `\n\n⚠️ ${escapeHtml(b.error_message)}` : "",
  ].filter(Boolean).join("\n");

  const kb: any[] = [];
  if (b.status === "draft" || b.status === "failed") {
    // Audience picker
    kb.push(Object.entries(AUDIENCES).map(([k, v]) => ({
      text: (b.audience === k ? "• " : "") + v.label,
      callback_data: `a:bc:aud:${id}:${k}`,
    })));
    kb.push([{ text: "🧪 Тест себе", callback_data: `a:bc:test:${id}` }]);
    kb.push([{ text: "🚀 Отправить", callback_data: `a:bc:send:${id}` }]);
    kb.push([{ text: "🗑 Удалить", callback_data: `a:bc:d:${id}` }]);
  } else if (b.status === "sending") {
    kb.push([{ text: "🔄 Обновить", callback_data: `a:bc:v:${id}` }]);
  } else if (b.status === "sent") {
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

async function createDraft(adminId: number, text: string, photoUrl: string | null) {
  const { data, error } = await supabase
    .from("broadcasts")
    .insert({
      admin_telegram_id: adminId,
      text,
      photo_url: photoUrl,
      audience: "all",
      status: "draft",
    })
    .select("id")
    .single();
  if (!error && data) await writeAuditLog(adminId, "broadcast.create", data.id, {});
  return { data, error };
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
      text: "🖼 Пришлите <b>фото</b> прямо в чат, или URL картинки, или <code>-</code> чтобы без фото.",
      parse_mode: "HTML",
      reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "a:bc" }]] },
    });
    return;
  }
  if (step === "photo") {
    const body = String(payload.text ?? "");
    const t = text.trim();
    const photo = t === "-" ? null : t;
    const { data, error } = await createDraft(adminId, body, photo);
    await clearSession(adminId);
    if (error || !data) {
      await tg("sendMessage", { chat_id: chatId, text: `⚠️ Ошибка: ${error?.message ?? "не удалось создать"}` });
      return showBroadcastList(chatId);
    }
    return showBroadcast(chatId, undefined, data.id);
  }
}

// Called by index.ts when admin uploads a photo while bc:new:photo session active.
export async function handleNewBroadcastPhoto(chatId: number, adminId: number, fileId: string) {
  const upload = await uploadTelegramPhoto(fileId, "product-images", "broadcasts");
  if (!upload.ok) {
    await tg("sendMessage", { chat_id: chatId, text: `⚠️ Не удалось загрузить фото: ${upload.error}` });
    return;
  }
  const sess = await (await import("../_shared/session.ts")).getSession(adminId);
  const body = String(sess?.payload?.text ?? "");
  const { data, error } = await createDraft(adminId, body, upload.url);
  await clearSession(adminId);
  if (error || !data) {
    await tg("sendMessage", { chat_id: chatId, text: `⚠️ Ошибка: ${error?.message ?? "не удалось создать"}` });
    return showBroadcastList(chatId);
  }
  return showBroadcast(chatId, undefined, data.id);
}

export async function setBroadcastAudience(
  chatId: number, msgId: number | undefined, id: string, aud: string, adminId: number,
) {
  if (!AUDIENCES[aud]) return showBroadcast(chatId, msgId, id);
  await supabase.from("broadcasts").update({ audience: aud, updated_at: new Date().toISOString() }).eq("id", id);
  await writeAuditLog(adminId, "broadcast.audience", id, { audience: aud });
  return showBroadcast(chatId, msgId, id);
}

export async function deleteBroadcast(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  await supabase.from("broadcasts").delete().eq("id", id);
  await writeAuditLog(adminId, "broadcast.delete", id, {});
  return showBroadcastList(chatId, msgId, 0);
}

async function sendOne(targetId: number, b: { text: string; photo_url: string | null }) {
  if (b.photo_url) {
    const r = await tg("sendPhoto", { chat_id: targetId, photo: b.photo_url, caption: b.text, parse_mode: "HTML" });
    if (r?.ok) return r;
    // photo failed → fallback to text
  }
  return tg("sendMessage", { chat_id: targetId, text: b.text, parse_mode: "HTML" });
}

export async function testBroadcast(
  chatId: number, msgId: number | undefined, id: string, adminId: number,
) {
  const { data: b } = await supabase.from("broadcasts").select("text, photo_url").eq("id", id).maybeSingle();
  if (!b) return showBroadcastList(chatId, msgId, 0);
  const r = await sendOne(adminId, b as any);
  await writeAuditLog(adminId, "broadcast.test", id, { ok: !!r?.ok });
  await deleteAndSend(chatId, msgId, {
    text: r?.ok ? "✅ Тест отправлен вам." : `⚠️ Ошибка теста: ${escapeHtml(r?.description ?? "")}`,
    reply_markup: { inline_keyboard: [[{ text: "← К рассылке", callback_data: `a:bc:v:${id}` }]] },
  });
}

async function fetchAudienceIds(audience: string, afterId: number | null): Promise<number[]> {
  if (audience === "buyers") {
    // Paginate over paid orders so we never silently truncate at 1000.
    const tidSet = new Set<number>();
    const PAGE_LIMIT = 1000;
    let offset = 0;
    for (let i = 0; i < 50; i++) { // hard cap 50k orders
      const { data, error } = await supabase
        .from("orders").select("telegram_id")
        .eq("payment_status", "paid")
        .range(offset, offset + PAGE_LIMIT - 1);
      if (error || !data?.length) break;
      for (const o of data) tidSet.add(Number((o as any).telegram_id));
      if (data.length < PAGE_LIMIT) break;
      offset += PAGE_LIMIT;
    }
    const ids = Array.from(tidSet);
    if (!ids.length) return [];
    // exclude blocked
    const { data: prof } = await supabase
      .from("user_profiles").select("telegram_id, is_blocked").in("telegram_id", ids);
    const allowed = new Set((prof ?? []).filter((p: any) => !p.is_blocked).map((p: any) => Number(p.telegram_id)));
    return ids.filter((i) => allowed.has(i) && (afterId == null || i > afterId)).sort((a, b) => a - b);
  }
  if (audience === "no_orders") {
    const { data: ordered } = await supabase.from("orders").select("telegram_id");
    const had = new Set((ordered ?? []).map((o: any) => Number(o.telegram_id)));
    let q = supabase.from("user_profiles").select("telegram_id").eq("is_blocked", false).order("telegram_id", { ascending: true });
    if (afterId != null) q = q.gt("telegram_id", afterId);
    const { data } = await q;
    return (data ?? []).map((u: any) => Number(u.telegram_id)).filter((i) => !had.has(i));
  }
  if (audience === "with_balance") {
    let q = supabase.from("user_profiles").select("telegram_id").eq("is_blocked", false).gt("balance", 0).order("telegram_id", { ascending: true });
    if (afterId != null) q = q.gt("telegram_id", afterId);
    const { data } = await q;
    return (data ?? []).map((u: any) => Number(u.telegram_id));
  }
  // all
  let q = supabase.from("user_profiles").select("telegram_id").eq("is_blocked", false).order("telegram_id", { ascending: true });
  if (afterId != null) q = q.gt("telegram_id", afterId);
  const { data } = await q;
  return (data ?? []).map((u: any) => Number(u.telegram_id));
}

// Mass send. Resumes from cursor_telegram_id if status was "sending"/"failed".
export async function sendBroadcast(chatId: number, msgId: number | undefined, id: string, adminId: number) {
  const { data: b } = await supabase.from("broadcasts").select("*").eq("id", id).maybeSingle();
  if (!b) return showBroadcastList(chatId, msgId, 0);
  if (!["draft", "failed"].includes(b.status)) return showBroadcast(chatId, msgId, id);

  const resumeFrom = b.status === "failed" ? (b.cursor_telegram_id ?? null) : null;
  const targets = await fetchAudienceIds(b.audience, resumeFrom);
  const total = (b.sent_count ?? 0) + (b.failed_count ?? 0) + targets.length;

  await supabase.from("broadcasts").update({
    status: "sending",
    total_count: total,
    error_message: null,
    updated_at: new Date().toISOString(),
  }).eq("id", id);

  await deleteAndSend(chatId, msgId, {
    text: `📤 Рассылка запущена.\nАудитория: <b>${AUDIENCES[b.audience]?.label ?? b.audience}</b>\nПолучателей: <b>${targets.length}</b>${resumeFrom ? ` (продолжение с <code>${resumeFrom}</code>)` : ""}`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "🔄 Обновить", callback_data: `a:bc:v:${id}` }]] },
  });

  // Background worker. Use EdgeRuntime.waitUntil so the runtime keeps the
  // promise alive after we respond to the Telegram webhook.
  const worker = (async () => {
    let sent = b.sent_count ?? 0;
    let failed = b.failed_count ?? 0;
    let lastCursor = resumeFrom;
    try {
      for (const tgid of targets) {
        const r = await sendOne(tgid, b as any);
        if (r?.ok) sent++; else failed++;
        lastCursor = tgid;
        if ((sent + failed) % 25 === 0) {
          await supabase.from("broadcasts").update({
            sent_count: sent, failed_count: failed, cursor_telegram_id: lastCursor,
          }).eq("id", id);
          await new Promise((r) => setTimeout(r, 1000));
        }
      }
      await supabase.from("broadcasts").update({
        sent_count: sent, failed_count: failed, cursor_telegram_id: lastCursor,
        status: "sent", updated_at: new Date().toISOString(),
      }).eq("id", id);
      await writeAuditLog(adminId, "broadcast.send", id, { sent, failed, audience: b.audience });
    } catch (e) {
      await supabase.from("broadcasts").update({
        sent_count: sent, failed_count: failed, cursor_telegram_id: lastCursor,
        status: "failed", error_message: String(e).slice(0, 500),
        updated_at: new Date().toISOString(),
      }).eq("id", id);
      await writeAuditLog(adminId, "broadcast.send.failed", id, { sent, failed, error: String(e).slice(0, 200) });
    }
  })();
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") er.waitUntil(worker);
}
