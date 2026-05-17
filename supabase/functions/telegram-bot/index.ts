// Telegram bot: /start, /rep, /admin command + callback router
import { tg, deleteAndSend, answerCallback, maskToken } from "./_shared/tg.ts";
import { supabase, getSetting, writeAuditLog } from "./_shared/db.ts";
import { isAdmin } from "./_shared/auth.ts";
import { getSession, clearSession } from "./_shared/session.ts";
import { sendAdminMenu, notImplementedStub } from "./admin/menu.ts";
import {
  showProductList, showProduct, toggleProduct, askDeleteProduct, confirmDeleteProduct,
  startEditProduct, applyEditProduct, startCreateProduct, handleCreateProductStep,
  applyEditProductPhoto,
} from "./admin/products.ts";
import {
  showCategoryList, showCategory, toggleCategory, askDeleteCategory, confirmDeleteCategory,
  startEditCategory, applyEditCategory, startCreateCategory, handleCreateCategoryStep,
} from "./admin/categories.ts";
import {
  showProjectList, showProject, toggleProject, startEditProject, applyEditProject,
} from "./admin/projects.ts";
import {
  showOrderList, showOrder, showStatusPicker, setOrderStatus, setOrderPayment, sendOrderRep,
  fulfilFromInventory, refundOrderToBalance, startOrderMessage, applyOrderMessage,
} from "./admin/orders.ts";
import {
  showUsersMenu, showRecentUsers, startSearchUser, showUser, toggleBlock,
  startBalanceChange, showBalanceHistory, startEditNote, handleUserText,
} from "./admin/users.ts";
import {
  showPromoList, showPromo, togglePromo, askDeletePromo, confirmDeletePromo,
  startEditPromo, applyEditPromo, startCreatePromo, handleCreatePromoStep, setNewPromoType,
} from "./admin/promocodes.ts";
import {
  showSettingsMenu, startEditSetting, showTemplateList, showTemplate, toggleTemplate,
  deleteTemplate, startEditTemplate, startNewTemplate, handleSettingsText,
} from "./admin/settings.ts";
import {
  showInventoryProducts, showInventoryProduct, startAddInventory, applyAddInventory, deleteAllAvailable,
} from "./admin/inventory.ts";
import {
  showReviewList, showReview, approveReview, rejectReview, deleteReview,
} from "./admin/reviews.ts";
import { showLogs } from "./admin/logs.ts";
import {
  showSbpList, showSbp, approveSbp, startRejectSbp, applyRejectSbp,
} from "./admin/sbp.ts";
import {
  showBroadcastList, showBroadcast, startNewBroadcast, handleNewBroadcastStep,
  deleteBroadcast, sendBroadcast, setBroadcastAudience, testBroadcast,
  handleNewBroadcastPhoto,
} from "./admin/broadcasts.ts";
import { showStats } from "./admin/stats.ts";

const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const WEBAPP_URL = Deno.env.get("WEBAPP_URL") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";

const FALLBACK_WELCOME =
  "👋 Добро пожаловать в наш магазин!\n\nНажмите кнопку ниже, чтобы открыть каталог 👇";

async function handleStart(chatId: number) {
  const welcome = await getSetting("welcome_text", FALLBACK_WELCOME);
  const url = WEBAPP_URL?.trim();
  let keyboard: any = undefined;
  if (url?.startsWith("https://")) {
    keyboard = { inline_keyboard: [[{ text: "🛍 Открыть магазин", web_app: { url } }]] };
  } else if (url?.startsWith("http://")) {
    keyboard = { inline_keyboard: [[{ text: "🛍 Открыть магазин", url }]] };
  }
  await tg("sendMessage", { chat_id: chatId, text: welcome, reply_markup: keyboard });
}

async function handleRep(adminChatId: number, adminId: number, args: string) {
  const match = args.match(/#?(\S+)/);
  if (!match) {
    await tg("sendMessage", { chat_id: adminChatId, text: "❌ Использование: /rep #номер_заказа" });
    return;
  }
  const orderNumber = match[1].replace(/^#/, "");

  const { data: order } = await supabase
    .from("orders")
    .select("id, order_number, telegram_id")
    .eq("order_number", orderNumber)
    .maybeSingle();

  if (!order) {
    await tg("sendMessage", { chat_id: adminChatId, text: `❌ Заказ #${orderNumber} не найден.` });
    return;
  }

  const { data: tpl } = await supabase
    .from("message_templates")
    .select("body")
    .eq("key", "rep_default")
    .maybeSingle();

  const support = await getSetting("support_username", "support");
  const body = (tpl?.body ?? "✅ Ваш заказ {{order_number}} успешно обработан.")
    .replaceAll("{{order_number}}", `#${order.order_number}`)
    .replaceAll("{{support}}", support);

  const send = await tg("sendMessage", { chat_id: order.telegram_id, text: body });

  await writeAuditLog(adminId, "rep", String(order.order_number), {
    ok: !!send?.ok,
    response: send,
  });

  if (send?.ok) {
    await tg("sendMessage", {
      chat_id: adminChatId,
      text: `✅ Сообщение по заказу #${order.order_number} отправлено пользователю.`,
    });
  } else {
    await tg("sendMessage", {
      chat_id: adminChatId,
      text: `⚠️ Не удалось доставить сообщение пользователю по заказу #${order.order_number}.\n${send?.description ?? ""}`,
    });
  }
}

async function handleAdminCallback(
  chatId: number,
  fromId: number,
  msgId: number | undefined,
  callbackId: string,
  data: string,
) {
  if (!isAdmin(fromId)) {
    await answerCallback(callbackId, "⛔ Только для администраторов", true);
    return;
  }
  await answerCallback(callbackId);
  // a:<section>:<op>:<arg>:<extra>
  const parts = data.split(":");
  const section = parts[1] ?? "menu";
  const op = parts[2];
  const arg = parts[3];
  const extra = parts[4];

  switch (section) {
    case "menu":
      return sendAdminMenu(chatId, fromId, msgId);

    // --- products ---
    case "p": {
      if (!op) return showProductList(chatId, msgId, 0);
      if (op === "l") return showProductList(chatId, msgId, parseInt(arg ?? "0") || 0);
      if (op === "v" && arg) return showProduct(chatId, msgId, arg);
      if (op === "t" && arg) return toggleProduct(chatId, msgId, arg, fromId);
      if (op === "d" && arg) return askDeleteProduct(chatId, msgId, arg);
      if (op === "dc" && arg) return confirmDeleteProduct(chatId, msgId, arg, fromId);
      if (op === "e" && arg && extra) return startEditProduct(chatId, msgId, arg, extra, fromId);
      if (op === "n") return startCreateProduct(chatId, msgId, fromId);
      return showProductList(chatId, msgId, 0);
    }

    // --- categories ---
    case "c": {
      if (!op) return showCategoryList(chatId, msgId);
      if (op === "v" && arg) return showCategory(chatId, msgId, arg);
      if (op === "t" && arg) return toggleCategory(chatId, msgId, arg, fromId);
      if (op === "d" && arg) return askDeleteCategory(chatId, msgId, arg);
      if (op === "dc" && arg) return confirmDeleteCategory(chatId, msgId, arg, fromId);
      if (op === "e" && arg && extra) return startEditCategory(chatId, msgId, arg, extra, fromId);
      if (op === "n") return startCreateCategory(chatId, msgId, fromId);
      return showCategoryList(chatId, msgId);
    }

    // --- projects ---
    case "pr": {
      if (!op) return showProjectList(chatId, msgId);
      if (op === "v" && arg) return showProject(chatId, msgId, arg);
      if (op === "t" && arg) return toggleProject(chatId, msgId, arg, fromId);
      if (op === "e" && arg && extra) return startEditProject(chatId, msgId, arg, extra, fromId);
      return showProjectList(chatId, msgId);
    }

    case "o": {
      if (!op) return showOrderList(chatId, msgId, "all", 0);
      if (op === "f" && arg) return showOrderList(chatId, msgId, arg, 0);
      if (op === "p" && arg) return showOrderList(chatId, msgId, arg, parseInt(extra ?? "0") || 0);
      if (op === "v" && arg) return showOrder(chatId, msgId, arg);
      if (op === "ss" && arg) return showStatusPicker(chatId, msgId, arg, "status");
      if (op === "sp" && arg) return showStatusPicker(chatId, msgId, arg, "pay");
      if (op === "st" && arg && extra) return setOrderStatus(chatId, msgId, arg, extra, fromId);
      if (op === "pt" && arg && extra) return setOrderPayment(chatId, msgId, arg, extra, fromId);
      if (op === "rep" && arg) return sendOrderRep(chatId, msgId, arg, fromId);
      if (op === "dl" && arg) return fulfilFromInventory(chatId, msgId, arg, fromId);
      if (op === "rf" && arg) return refundOrderToBalance(chatId, msgId, arg, fromId);
      if (op === "msg" && arg) return startOrderMessage(chatId, msgId, arg, fromId);
      return showOrderList(chatId, msgId, "all", 0);
    }
    case "u": {
      if (!op) return showUsersMenu(chatId, msgId);
      if (op === "s") return startSearchUser(chatId, msgId, fromId);
      if (op === "recent") return showRecentUsers(chatId, msgId);
      if (op === "v" && arg) return showUser(chatId, msgId, arg);
      if (op === "bl" && arg) return toggleBlock(chatId, msgId, arg, fromId);
      if (op === "bc" && arg) return startBalanceChange(chatId, msgId, arg, "credit", fromId);
      if (op === "bd" && arg) return startBalanceChange(chatId, msgId, arg, "deduct", fromId);
      if (op === "bh" && arg) return showBalanceHistory(chatId, msgId, arg);
      if (op === "nt" && arg) return startEditNote(chatId, msgId, arg, fromId);
      return showUsersMenu(chatId, msgId);
    }
    case "rv": {
      if (!op) return showReviewList(chatId, msgId, "pending", 0);
      if (op === "f" && arg) return showReviewList(chatId, msgId, arg, 0);
      if (op === "p" && arg) return showReviewList(chatId, msgId, arg, parseInt(extra ?? "0") || 0);
      if (op === "v" && arg) return showReview(chatId, msgId, arg);
      if (op === "a" && arg) return approveReview(chatId, msgId, arg, fromId);
      if (op === "r" && arg) return rejectReview(chatId, msgId, arg, fromId);
      if (op === "d" && arg) return deleteReview(chatId, msgId, arg, fromId);
      return showReviewList(chatId, msgId, "pending", 0);
    }
    case "sb": {
      if (!op) return showSbpList(chatId, msgId, "pending", 0);
      if (op === "f" && arg) return showSbpList(chatId, msgId, arg, 0);
      if (op === "p" && arg) return showSbpList(chatId, msgId, arg, parseInt(extra ?? "0") || 0);
      if (op === "v" && arg) return showSbp(chatId, msgId, arg);
      if (op === "a" && arg) return approveSbp(chatId, msgId, arg, fromId);
      if (op === "r" && arg) return startRejectSbp(chatId, msgId, arg, fromId);
      return showSbpList(chatId, msgId, "pending", 0);
      if (!op) return showStats(chatId, msgId, "w");
      if (op === "r" && arg) return showStats(chatId, msgId, arg);
      return showStats(chatId, msgId, "w");
    }
    case "pc": {
      if (!op) return showPromoList(chatId, msgId);
      if (op === "v" && arg) return showPromo(chatId, msgId, arg);
      if (op === "t" && arg) return togglePromo(chatId, msgId, arg, fromId);
      if (op === "d" && arg) return askDeletePromo(chatId, msgId, arg);
      if (op === "dc" && arg) return confirmDeletePromo(chatId, msgId, arg, fromId);
      if (op === "e" && arg && extra) return startEditPromo(chatId, msgId, arg, extra, fromId);
      if (op === "n") return startCreatePromo(chatId, msgId, fromId);
      if (op === "nt" && arg) return setNewPromoType(chatId, msgId, arg, fromId);
      return showPromoList(chatId, msgId);
    }
    case "inv": {
      if (!op) return showInventoryProducts(chatId, msgId, 0);
      if (op === "p" && arg) return showInventoryProducts(chatId, msgId, parseInt(arg) || 0);
      if (op === "v" && arg) return showInventoryProduct(chatId, msgId, arg);
      if (op === "a" && arg) return startAddInventory(chatId, msgId, arg, fromId);
      if (op === "dx" && arg) return deleteAllAvailable(chatId, msgId, arg, fromId);
      return showInventoryProducts(chatId, msgId, 0);
    }
    case "lg": {
      if (!op) return showLogs(chatId, msgId, 0);
      if (op === "p" && arg) return showLogs(chatId, msgId, parseInt(arg) || 0);
      return showLogs(chatId, msgId, 0);
    }
    case "se": {
      if (!op) return showSettingsMenu(chatId, msgId);
      if (op === "e" && arg) return startEditSetting(chatId, msgId, arg, fromId);
      if (op === "tpl") return showTemplateList(chatId, msgId);
      if (op === "tn") return startNewTemplate(chatId, msgId, fromId);
      if (op === "t" && arg) return showTemplate(chatId, msgId, arg);
      if (op === "tt" && arg) return toggleTemplate(chatId, msgId, arg, fromId);
      if (op === "td" && arg) return deleteTemplate(chatId, msgId, arg, fromId);
      if (op === "te" && arg && extra) return startEditTemplate(chatId, msgId, arg, extra, fromId);
      return showSettingsMenu(chatId, msgId);
    }
    case "bc": {
      if (!op) return showBroadcastList(chatId, msgId, 0);
      if (op === "p" && arg) return showBroadcastList(chatId, msgId, parseInt(arg) || 0);
      if (op === "n") return startNewBroadcast(chatId, msgId, fromId);
      if (op === "v" && arg) return showBroadcast(chatId, msgId, arg);
      if (op === "d" && arg) return deleteBroadcast(chatId, msgId, arg, fromId);
      if (op === "send" && arg) return sendBroadcast(chatId, msgId, arg, fromId);
      if (op === "test" && arg) return testBroadcast(chatId, msgId, arg, fromId);
      if (op === "aud" && arg && extra) return setBroadcastAudience(chatId, msgId, arg, extra, fromId);
      return showBroadcastList(chatId, msgId, 0);
    }
    default:
      return sendAdminMenu(chatId, fromId, msgId);
  }
}

// Route plain-text input by admin FSM state (`<scope>:<verb>:...`).
async function handleAdminText(chatId: number, fromId: number, text: string): Promise<boolean> {
  if (!isAdmin(fromId)) return false;
  const sess = await getSession(fromId);
  if (!sess) return false;
  if (text.startsWith("/")) {
    await clearSession(fromId);
    return false;
  }
  const [scope, verb, a, b] = sess.state.split(":");

  if (scope === "p" && verb === "new") {
    await handleCreateProductStep(chatId, fromId, text);
    return true;
  }
  if (scope === "p" && verb === "edit" && a && b) {
    await applyEditProduct(chatId, fromId, a, b, text);
    return true;
  }
  if (scope === "c" && verb === "new") {
    await handleCreateCategoryStep(chatId, fromId, text);
    return true;
  }
  if (scope === "c" && verb === "edit" && a && b) {
    await applyEditCategory(chatId, fromId, a, b, text);
    return true;
  }
  if (scope === "pr" && verb === "edit" && a && b) {
    await applyEditProject(chatId, fromId, a, b, text);
    return true;
  }
  if (scope === "u") {
    return await handleUserText(chatId, fromId, sess.state, text);
  }
  if (scope === "o" && verb === "msg" && a) {
    await applyOrderMessage(chatId, fromId, a, text);
    return true;
  }
  if (scope === "pc" && verb === "new") {
    await handleCreatePromoStep(chatId, fromId, text);
    return true;
  }
  if (scope === "pc" && verb === "edit" && a && b) {
    await applyEditPromo(chatId, fromId, a, b, text);
    return true;
  }
  if (scope === "se") {
    return await handleSettingsText(chatId, fromId, sess.state, sess.payload, text);
  }
  if (scope === "inv" && verb === "add" && a) {
    await applyAddInventory(chatId, fromId, a, text);
    return true;
  }
  if (scope === "bc" && verb === "new") {
    await handleNewBroadcastStep(chatId, fromId, sess.state, sess.payload, text);
    return true;
  }
  return false;
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("setup") === "1") {
      const webhookUrl = `${SUPABASE_URL}/functions/v1/telegram-bot`;
      const result = await tg("setWebhook", {
        url: webhookUrl,
        secret_token: TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "edited_message", "callback_query"],
      });
      return new Response(JSON.stringify({ webhookUrl, result }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("ok");
  }

  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const provided = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!TELEGRAM_WEBHOOK_SECRET || provided !== TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: any;
  try { update = await req.json(); } catch { return new Response("Bad request", { status: 400 }); }

  try {
    const cb = update?.callback_query;
    if (cb?.data && typeof cb.data === "string" && cb.data.startsWith("a:")) {
      const chatId = cb.message?.chat?.id as number | undefined;
      const fromId = cb.from?.id as number | undefined;
      const msgId = cb.message?.message_id as number | undefined;
      if (chatId && fromId) {
        await handleAdminCallback(chatId, fromId, msgId, cb.id, cb.data);
      }
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const message = update?.message ?? update?.edited_message;
    const chatId = message?.chat?.id as number | undefined;
    const fromId = message?.from?.id as number | undefined;
    const text: string = message?.text ?? "";
    const photos = message?.photo as Array<{ file_id: string }> | undefined;

    if (chatId && fromId) {
      // Photo upload during product image/gallery edit or broadcast wizard
      if (photos?.length && isAdmin(fromId)) {
        const sess = await getSession(fromId);
        if (sess) {
          const [scope, verb, a, b] = sess.state.split(":");
          const fileId = photos[photos.length - 1].file_id; // largest
          if (scope === "p" && verb === "edit" && a && (b === "image" || b === "gallery")) {
            await applyEditProductPhoto(chatId, fromId, a, b, fileId);
            return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
          }
          if (scope === "bc" && verb === "new" && a === "photo") {
            await handleNewBroadcastPhoto(chatId, fromId, fileId);
            return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
          }
        }
      }

      if (text.startsWith("/start") || text === "/help") {
        await handleStart(chatId);
      } else if (text.startsWith("/rep")) {
        if (!isAdmin(fromId)) {
          await tg("sendMessage", { chat_id: chatId, text: "⛔ Команда доступна только администраторам." });
        } else {
          await handleRep(chatId, fromId, text.replace(/^\/rep\s*/, ""));
        }
      } else if (text === "/admin" || text.startsWith("/admin ")) {
        if (!isAdmin(fromId)) {
          await tg("sendMessage", { chat_id: chatId, text: "⛔ Команда доступна только администраторам." });
        } else {
          await sendAdminMenu(chatId, fromId);
        }
      } else if (text) {
        await handleAdminText(chatId, fromId, text);
      }
    }
  } catch (e) {
    console.error("Bot error:", maskToken(String(e)));
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
