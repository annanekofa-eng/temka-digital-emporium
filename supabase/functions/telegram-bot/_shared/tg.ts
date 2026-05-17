// Shared Telegram helpers for telegram-bot edge function
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";
const TG_API = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}`;

export async function tg(method: string, body: unknown): Promise<any> {
  try {
    const res = await fetch(`${TG_API}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return await res.json();
  } catch (e) {
    console.error("[tg] call failed:", method, maskToken(String(e)));
    return { ok: false, description: String(e) };
  }
}

// Trim a string so its UTF-8 byte length stays under `maxBytes`. Telegram
// button labels and callback_data have byte-based limits. We iterate by
// codepoint (not UTF-16 unit) so we never split a surrogate pair.
export function safeSlice(input: string, maxBytes: number): string {
  if (!input) return "";
  const enc = new TextEncoder();
  if (enc.encode(input).length <= maxBytes) return input;
  let out = "";
  let bytes = 0;
  for (const ch of input) {
    const chBytes = enc.encode(ch).length;
    if (bytes + chBytes > maxBytes) break;
    out += ch;
    bytes += chBytes;
  }
  return out;
}

// Replace Telegram bot tokens in any string with a redacted placeholder so we
// don't accidentally leak credentials through logs (memory: Token Leak Prevention).
export function maskToken(input: string): string {
  if (!input) return input;
  return input
    .replace(/\d{6,12}:[A-Za-z0-9_-]{20,}/g, "<bot_token>")
    .replace(/bot\d{6,12}:[A-Za-z0-9_-]{20,}/g, "bot<bot_token>");
}

// Update an "screen": Telegram editMessageText is brittle for media/long
// updates, so we delete the previous message and send a fresh one.
export async function deleteAndSend(
  chatId: number,
  messageId: number | undefined,
  payload: Record<string, unknown>,
  withPhoto?: string,
) {
  if (messageId) {
    await tg("deleteMessage", { chat_id: chatId, message_id: messageId });
  }
  if (withPhoto) {
    return tg("sendPhoto", { chat_id: chatId, photo: withPhoto, ...payload });
  }
  return tg("sendMessage", { chat_id: chatId, ...payload });
}

export async function answerCallback(callbackId: string, text?: string, alert = false) {
  return tg("answerCallbackQuery", {
    callback_query_id: callbackId,
    text: text ? safeSlice(text, 180) : undefined,
    show_alert: alert,
  });
}
