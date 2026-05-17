// Telegram bot: /start, /rep, /admin command + callback router
import { tg, deleteAndSend, answerCallback, maskToken } from "./_shared/tg.ts";
import { supabase, getSetting, writeAuditLog } from "./_shared/db.ts";
import { isAdmin } from "./_shared/auth.ts";
import { sendAdminMenu, notImplementedStub } from "./admin/menu.ts";

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

// Map "a:<section>" callbacks to handlers. As blocks land in later steps the
// stubs here will be swapped for real screens.
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
  const parts = data.split(":"); // a:<section>:<...>
  const section = parts[1] ?? "menu";

  switch (section) {
    case "menu":
      await sendAdminMenu(chatId, fromId, msgId);
      return;
    case "p":
      return notImplementedStub(chatId, msgId, "Товары");
    case "c":
      return notImplementedStub(chatId, msgId, "Категории");
    case "o":
      return notImplementedStub(chatId, msgId, "Заказы");
    case "u":
      return notImplementedStub(chatId, msgId, "Пользователи");
    case "rv":
      return notImplementedStub(chatId, msgId, "Отзывы / Заявки");
    case "st":
      return notImplementedStub(chatId, msgId, "Статистика");
    case "pc":
      return notImplementedStub(chatId, msgId, "Промокоды");
    case "inv":
      return notImplementedStub(chatId, msgId, "Склад");
    case "lg":
      return notImplementedStub(chatId, msgId, "Логи");
    case "se":
      return notImplementedStub(chatId, msgId, "Настройки");
    case "bc":
      return notImplementedStub(chatId, msgId, "Рассылка");
    default:
      await sendAdminMenu(chatId, fromId, msgId);
  }
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
    // --- callback_query ---
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

    // --- messages ---
    const message = update?.message ?? update?.edited_message;
    const chatId = message?.chat?.id as number | undefined;
    const fromId = message?.from?.id as number | undefined;
    const text: string = message?.text ?? "";

    if (chatId && fromId) {
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
      }
    }
  } catch (e) {
    console.error("Bot error:", maskToken(String(e)));
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
