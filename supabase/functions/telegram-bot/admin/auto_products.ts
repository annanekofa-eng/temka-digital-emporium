// Auto-products admin module: edit Stars (price/min/max) and Premium (term options).
import { deleteAndSend } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession, getSession } from "../_shared/session.ts";

type Kind = "s" | "p";
const KIND_TYPE: Record<Kind, string> = { s: "stars", p: "premium_term" };
const KIND_LABEL: Record<Kind, string> = { s: "⭐ Telegram Stars", p: "👑 Telegram Premium" };

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function loadProduct(kind: Kind) {
  const { data } = await supabase
    .from("products")
    .select("id, title, price, min_qty, max_qty, term_options, is_active")
    .eq("product_type", KIND_TYPE[kind])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function showAutoProductsMenu(chatId: number, msgId: number | undefined) {
  const [stars, premium] = await Promise.all([loadProduct("s"), loadProduct("p")]);
  const lines: string[] = ["⚙️ <b>Авто-товары</b>\n"];
  lines.push(
    stars
      ? `⭐ <b>${escapeHtml(stars.title)}</b> · $${Number(stars.price).toFixed(3)}/звезда · ${stars.min_qty}–${stars.max_qty} · ${stars.is_active ? "вкл" : "выкл"}`
      : "⭐ Stars: товар не найден",
  );
  const terms = Array.isArray(premium?.term_options) ? (premium!.term_options as any[]) : [];
  lines.push(
    premium
      ? `👑 <b>${escapeHtml(premium.title)}</b> · тарифов: ${terms.length} · ${premium.is_active ? "вкл" : "выкл"}`
      : "👑 Premium: товар не найден",
  );

  const rows: any[] = [];
  if (stars) rows.push([{ text: "⭐ Настроить Stars", callback_data: "a:ap:v:s" }]);
  if (premium) rows.push([{ text: "👑 Настроить Premium", callback_data: "a:ap:v:p" }]);
  rows.push([{ text: "← К авто-заказам", callback_data: "a:ao" }]);

  return deleteAndSend(chatId, msgId, {
    text: lines.join("\n"),
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showAutoProduct(chatId: number, msgId: number | undefined, kind: Kind) {
  const p = await loadProduct(kind);
  if (!p) {
    return deleteAndSend(chatId, msgId, {
      text: `❌ Товар "${KIND_LABEL[kind]}" не найден в БД.`,
      reply_markup: { inline_keyboard: [[{ text: "← Назад", callback_data: "a:ap" }]] },
    });
  }

  const rows: any[] = [];
  let text = `${KIND_LABEL[kind]}\n\n`;
  text += `📛 Название: <b>${escapeHtml(p.title)}</b>\n`;
  text += `🔘 Статус: ${p.is_active ? "✅ вкл" : "⛔ выкл"}\n`;

  if (kind === "s") {
    text += `💵 Цена за 1⭐: <b>$${Number(p.price).toFixed(4)}</b>\n`;
    text += `📉 Мин. количество: <b>${p.min_qty}</b>\n`;
    text += `📈 Макс. количество: <b>${p.max_qty}</b>\n`;
    rows.push([
      { text: "✏️ Название", callback_data: "a:ap:e:s:title" },
      { text: "💵 Цена/⭐", callback_data: "a:ap:e:s:price" },
    ]);
    rows.push([
      { text: "📉 Мин.", callback_data: "a:ap:e:s:min" },
      { text: "📈 Макс.", callback_data: "a:ap:e:s:max" },
    ]);
  } else {
    const terms = Array.isArray(p.term_options) ? (p.term_options as any[]) : [];
    text += `\n<b>Тарифы Premium</b> (${terms.length}):\n`;
    if (terms.length === 0) {
      text += "— пусто — добавьте первый тариф.\n";
    } else {
      terms.forEach((t, i) => {
        text += `${i + 1}. ${t.months} мес — $${t.price}\n`;
      });
    }
    rows.push([{ text: "✏️ Название", callback_data: "a:ap:e:p:title" }]);
    rows.push([{ text: "➕ Добавить тариф", callback_data: "a:ap:pn" }]);
    terms.forEach((t: any, i: number) => {
      rows.push([
        { text: `🗑 Удалить «${t.months} мес / $${t.price}»`, callback_data: `a:ap:pd:${i}` },
      ]);
    });
  }

  rows.push([{ text: p.is_active ? "⛔ Выключить" : "✅ Включить", callback_data: `a:ap:t:${kind}` }]);
  rows.push([{ text: "← Назад", callback_data: "a:ap" }]);

  return deleteAndSend(chatId, msgId, {
    text,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function toggleAutoProduct(
  chatId: number, msgId: number | undefined, kind: Kind, adminId: number,
) {
  const p = await loadProduct(kind);
  if (!p) return showAutoProductsMenu(chatId, msgId);
  await supabase.from("products")
    .update({ is_active: !p.is_active, updated_at: new Date().toISOString() })
    .eq("id", p.id);
  await writeAuditLog(adminId, "auto_product.toggle", p.id, { kind, is_active: !p.is_active });
  return showAutoProduct(chatId, msgId, kind);
}

export async function startEditAutoProduct(
  chatId: number, msgId: number | undefined, kind: Kind, field: string, adminId: number,
) {
  const allowedStars = ["title", "price", "min", "max"];
  const allowedPremium = ["title"];
  const allowed = kind === "s" ? allowedStars : allowedPremium;
  if (!allowed.includes(field)) return showAutoProduct(chatId, msgId, kind);

  await setSession(adminId, `ap:e:${kind}:${field}`, {});
  const hints: Record<string, string> = {
    title: "Введите новое <b>название</b> товара:",
    price: "Введите <b>цену за 1⭐</b> в USDT (например 0.018):",
    min: "Введите <b>минимальное количество</b> звёзд (целое ≥1):",
    max: "Введите <b>максимальное количество</b> звёзд (целое):",
  };
  return deleteAndSend(chatId, msgId, {
    text: hints[field],
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: `a:ap:v:${kind}` }]] },
  });
}

export async function applyEditAutoProduct(
  chatId: number, adminId: number, kind: Kind, field: string, raw: string,
) {
  await clearSession(adminId);
  const p = await loadProduct(kind);
  if (!p) return;
  const patch: Record<string, any> = { updated_at: new Date().toISOString() };

  if (field === "title") {
    const v = raw.trim();
    if (!v) {
      await deleteAndSend(chatId, undefined, { text: "❌ Пустое название." });
      return showAutoProduct(chatId, undefined, kind);
    }
    patch.title = v;
  } else if (field === "price") {
    const n = Number(raw.replace(",", "."));
    if (!isFinite(n) || n < 0) {
      await deleteAndSend(chatId, undefined, { text: "❌ Цена должна быть числом ≥ 0." });
      return showAutoProduct(chatId, undefined, kind);
    }
    patch.price = n;
  } else if (field === "min" || field === "max") {
    const n = parseInt(raw.trim(), 10);
    if (!Number.isFinite(n) || n < 1) {
      await deleteAndSend(chatId, undefined, { text: "❌ Введите целое число ≥ 1." });
      return showAutoProduct(chatId, undefined, kind);
    }
    if (field === "min") patch.min_qty = n;
    if (field === "max") patch.max_qty = n;
  }

  await supabase.from("products").update(patch).eq("id", p.id);
  await writeAuditLog(adminId, "auto_product.edit", p.id, { kind, field, value: patch });
  return showAutoProduct(chatId, undefined, kind);
}

// --- Premium term_options management ---

export async function startNewPremiumTerm(
  chatId: number, msgId: number | undefined, adminId: number,
) {
  await setSession(adminId, "ap:pn:m", {});
  return deleteAndSend(chatId, msgId, {
    text: "➕ <b>Новый тариф Premium</b>\n\nШаг 1/2: введите <b>срок в месяцах</b> (целое ≥1):",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: "a:ap:v:p" }]] },
  });
}

export async function handleNewPremiumTermStep(chatId: number, adminId: number, raw: string) {
  const sess = await getSession(adminId);
  if (!sess) return;
  if (sess.state === "ap:pn:m") {
    const n = parseInt(raw.trim(), 10);
    if (!Number.isFinite(n) || n < 1 || n > 60) {
      await deleteAndSend(chatId, undefined, { text: "❌ Срок 1–60 месяцев." });
      return;
    }
    await setSession(adminId, "ap:pn:p", { months: n });
    await deleteAndSend(chatId, undefined, {
      text: `Шаг 2/2: введите <b>цену в USDT</b> для ${n} мес:`,
      parse_mode: "HTML",
    });
    return;
  }
  if (sess.state === "ap:pn:p") {
    const price = Number(raw.replace(",", "."));
    if (!isFinite(price) || price <= 0) {
      await deleteAndSend(chatId, undefined, { text: "❌ Цена должна быть числом > 0." });
      return;
    }
    const months = Number(sess.payload?.months);
    const p = await loadProduct("p");
    if (!p) {
      await clearSession(adminId);
      return;
    }
    const cur = Array.isArray(p.term_options) ? (p.term_options as any[]) : [];
    const filtered = cur.filter((t) => Number(t.months) !== months);
    const next = [...filtered, { months, price }].sort(
      (a: any, b: any) => Number(a.months) - Number(b.months),
    );
    await supabase.from("products")
      .update({ term_options: next, updated_at: new Date().toISOString() })
      .eq("id", p.id);
    await writeAuditLog(adminId, "auto_product.term_add", p.id, { months, price });
    await clearSession(adminId);
    return showAutoProduct(chatId, undefined, "p");
  }
}

export async function deletePremiumTerm(
  chatId: number, msgId: number | undefined, idx: number, adminId: number,
) {
  const p = await loadProduct("p");
  if (!p) return showAutoProductsMenu(chatId, msgId);
  const cur = Array.isArray(p.term_options) ? (p.term_options as any[]) : [];
  if (idx < 0 || idx >= cur.length) return showAutoProduct(chatId, msgId, "p");
  const removed = cur[idx];
  const next = cur.filter((_, i) => i !== idx);
  await supabase.from("products")
    .update({ term_options: next, updated_at: new Date().toISOString() })
    .eq("id", p.id);
  await writeAuditLog(adminId, "auto_product.term_remove", p.id, { removed });
  return showAutoProduct(chatId, msgId, "p");
}
