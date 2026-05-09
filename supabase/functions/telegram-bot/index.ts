// Standalone shop Telegram bot: /start welcome + WebApp button + webhook secret check
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TELEGRAM_WEBHOOK_SECRET = Deno.env.get("TELEGRAM_WEBHOOK_SECRET") ?? "";
const WEBAPP_URL = Deno.env.get("WEBAPP_URL") ?? "";

const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

const WELCOME_TEXT =
  "👋 Добро пожаловать в наш магазин!\n\n" +
  "Здесь вы найдёте качественные товары и быстрое оформление заказа прямо в Telegram.\n\n" +
  "Нажмите кнопку ниже, чтобы открыть каталог 👇";

async function tg(method: string, body: unknown) {
  const res = await fetch(`${TG_API}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "GET") {
    // Convenience: /functions/v1/telegram-bot?setup=1 to register webhook
    const url = new URL(req.url);
    if (url.searchParams.get("setup") === "1") {
      const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
      const webhookUrl = `${supabaseUrl}/functions/v1/telegram-bot`;
      const result = await tg("setWebhook", {
        url: webhookUrl,
        secret_token: TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
      });
      return new Response(JSON.stringify({ webhookUrl, result }, null, 2), {
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("ok");
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const provided = req.headers.get("X-Telegram-Bot-Api-Secret-Token") ?? "";
  if (!TELEGRAM_WEBHOOK_SECRET || provided !== TELEGRAM_WEBHOOK_SECRET) {
    return new Response("Unauthorized", { status: 401 });
  }

  let update: any;
  try {
    update = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }

  const message = update?.message ?? update?.edited_message;
  const chatId = message?.chat?.id;
  const text: string = message?.text ?? "";

  if (chatId && (text.startsWith("/start") || text === "/help")) {
    console.log("WEBAPP_URL=", WEBAPP_URL);
    const url = WEBAPP_URL?.trim();
    let keyboard: any = undefined;
    if (url?.startsWith("https://")) {
      keyboard = { inline_keyboard: [[{ text: "🛍 Открыть магазин", web_app: { url } }]] };
    } else if (url?.startsWith("http://")) {
      // Telegram requires https for web_app; fall back to plain url button
      keyboard = { inline_keyboard: [[{ text: "🛍 Открыть магазин", url }]] };
    }

    const res = await tg("sendMessage", {
      chat_id: chatId,
      text: WELCOME_TEXT,
      reply_markup: keyboard,
    });
    console.log("sendMessage result:", JSON.stringify(res));
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
