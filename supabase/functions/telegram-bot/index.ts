// Standalone shop Telegram bot: /start welcome from DB + WebApp button + /rep admin command
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const WEBAPP_URL = Deno.env.get("WEBAPP_URL") ?? "";
const ADMIN_TELEGRAM_IDS = (Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const FALLBACK_WELCOME =
  "👋 Добро пожаловать в наш магазин!\n\nНажмите кнопку ниже, чтобы открыть каталог 👇";

async function tg(method: string, body: unknown) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function getSetting(key: string, fallback = ""): Promise<string> {
  const { data } = await supabase
    .from("site_settings")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  return (data?.value as string) ?? fallback;
}

function isAdmin(tgId: number | string): boolean {
  return ADMIN_TELEGRAM_IDS.includes(String(tgId));
}

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
  // /rep #1234 — find order, send template to user
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

  await supabase.from("admin_log").insert({
    admin_telegram_id: adminId,
    action: "rep",
    target: order.order_number,
    meta: { ok: !!send?.ok, response: send },
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

  const message = update?.message ?? update?.edited_message;
  const chatId = message?.chat?.id as number | undefined;
  const fromId = message?.from?.id as number | undefined;
  const text: string = message?.text ?? "";

  try {
    if (chatId && fromId) {
      if (text.startsWith("/start") || text === "/help") {
        await handleStart(chatId);
      } else if (text.startsWith("/rep")) {
        if (!isAdmin(fromId)) {
          await tg("sendMessage", { chat_id: chatId, text: "⛔ Команда доступна только администраторам." });
        } else {
          await handleRep(chatId, fromId, text.replace(/^\/rep\s*/, ""));
        }
      }
    }
  } catch (e) {
    console.error("Bot error:", e);
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
