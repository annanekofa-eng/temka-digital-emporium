// Inventory admin: per-product stock units (inventory_items).
// Add bulk units (one per line), delete available units, view stats.
import { deleteAndSend, safeSlice } from "../_shared/tg.ts";
import { supabase, writeAuditLog } from "../_shared/db.ts";
import { setSession, clearSession } from "../_shared/session.ts";

function escapeHtml(s: string | null | undefined) {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function backMenu() { return [{ text: "← Меню", callback_data: "a:menu" }]; }

const PAGE = 8;

export async function showInventoryProducts(chatId: number, msgId: number | undefined, page = 0) {
  const from = page * PAGE;
  const { data: products, count } = await supabase
    .from("products")
    .select("id, title, product_type", { count: "exact" })
    .order("title")
    .range(from, from + PAGE - 1);

  const ids = (products ?? []).map((p) => p.id);
  const stats = new Map<string, { available: number; sold: number }>();
  if (ids.length) {
    const { data: items } = await supabase
      .from("inventory_items")
      .select("product_id, status")
      .in("product_id", ids);
    for (const it of items ?? []) {
      const s = stats.get(it.product_id as string) ?? { available: 0, sold: 0 };
      if (it.status === "available") s.available++;
      else if (it.status === "sold") s.sold++;
      stats.set(it.product_id as string, s);
    }
  }

  const rows = (products ?? []).map((p) => {
    const s = stats.get(p.id) ?? { available: 0, sold: 0 };
    return [{
      text: safeSlice(`${p.title} · 📦 ${s.available} / 💰 ${s.sold}`, 60),
      callback_data: `a:inv:v:${p.id}`,
    }];
  });

  const total = count ?? 0;
  const nav: any[] = [];
  if (page > 0) nav.push({ text: "‹", callback_data: `a:inv:p:${page - 1}` });
  nav.push({ text: `${page + 1}/${Math.max(1, Math.ceil(total / PAGE))}`, callback_data: "a:inv" });
  if (from + PAGE < total) nav.push({ text: "›", callback_data: `a:inv:p:${page + 1}` });
  if (nav.length > 1) rows.push(nav);
  rows.push(backMenu());

  await deleteAndSend(chatId, msgId, {
    text: `🏗 <b>Склад</b>\n\nВыберите товар. Формат: <i>доступно / продано</i>.`,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: rows },
  });
}

export async function showInventoryProduct(chatId: number, msgId: number | undefined, productId: string) {
  const { data: p } = await supabase
    .from("products")
    .select("id, title, product_type, stock")
    .eq("id", productId)
    .maybeSingle();
  if (!p) return showInventoryProducts(chatId, msgId, 0);

  const { data: items } = await supabase
    .from("inventory_items")
    .select("id, status, content, created_at, sold_at")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(50);

  const available = (items ?? []).filter((i) => i.status === "available");
  const sold = (items ?? []).filter((i) => i.status === "sold");

  const preview = available.slice(0, 10).map((i, idx) =>
    `${idx + 1}. <code>${escapeHtml(safeSlice(i.content ?? "", 60))}</code>`
  ).join("\n") || "<i>нет доступных единиц</i>";

  const txt = [
    `🏗 <b>${escapeHtml(p.title)}</b>`,
    `Тип: <code>${escapeHtml(p.product_type)}</code> · Stock-поле: <b>${p.stock}</b>`,
    ``,
    `📦 Доступно: <b>${available.length}</b>`,
    `💰 Продано: <b>${sold.length}</b>`,
    ``,
    `<b>Последние доступные:</b>`,
    preview,
  ].join("\n");

  const kb: any[] = [
    [{ text: "➕ Добавить единицы", callback_data: `a:inv:a:${productId}` }],
  ];
  if (available.length) {
    kb.push([{ text: "🗑 Удалить все доступные", callback_data: `a:inv:dx:${productId}` }]);
  }
  kb.push([{ text: "← К списку", callback_data: "a:inv" }]);

  await deleteAndSend(chatId, msgId, {
    text: txt,
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: kb },
  });
}

export async function startAddInventory(chatId: number, msgId: number | undefined, productId: string, adminId: number) {
  await setSession(adminId, `inv:add:${productId}`, {});
  await deleteAndSend(chatId, msgId, {
    text: "✏️ Отправьте единицы товара — <b>по одной на строку</b>.\nОтправьте <code>-</code> для отмены.",
    parse_mode: "HTML",
    reply_markup: { inline_keyboard: [[{ text: "Отмена", callback_data: `a:inv:v:${productId}` }]] },
  });
}

export async function applyAddInventory(chatId: number, adminId: number, productId: string, raw: string) {
  if (raw.trim() === "-") {
    await clearSession(adminId);
    return showInventoryProduct(chatId, undefined, productId);
  }
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) {
    await clearSession(adminId);
    return showInventoryProduct(chatId, undefined, productId);
  }
  const rows = lines.map((content) => ({ product_id: productId, content, status: "available" }));
  const { error } = await supabase.from("inventory_items").insert(rows);
  if (!error) {
    await supabase.rpc("set_config", {}).catch(() => null); // noop, ignore
    await writeAuditLog(adminId, "inventory.add", productId, { count: rows.length });
  }
  await clearSession(adminId);
  return showInventoryProduct(chatId, undefined, productId);
}

export async function deleteAllAvailable(chatId: number, msgId: number | undefined, productId: string, adminId: number) {
  const { data, error } = await supabase
    .from("inventory_items")
    .delete()
    .eq("product_id", productId)
    .eq("status", "available")
    .select("id");
  if (!error) {
    await writeAuditLog(adminId, "inventory.purge", productId, { count: data?.length ?? 0 });
  }
  return showInventoryProduct(chatId, msgId, productId);
}
