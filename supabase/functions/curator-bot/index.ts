// Curator bot — minimal webhook for issuing one-time chat invites.
// Roles:
//  - Receives /start <token> in private chat → validates token, creates one-time
//    chat invite for CURATOR_CHAT_ID via createChatInviteLink (member_limit=1),
//    sends it back to the user, marks token as used.
//  - Stays silent in groups (only logs new chat_member joins to track membership).
//  - Does NOT respond to free-form messages.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TOKEN = Deno.env.get("CURATOR_BOT_TOKEN") || "";
const CHAT_ID = Deno.env.get("CURATOR_CHAT_ID") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ADMIN_IDS = (Deno.env.get("ADMIN_TELEGRAM_IDS") || "")
  .split(",")
  .map((s) => Number(s.trim()))
  .filter(Boolean);

const TG = `https://api.telegram.org/bot${TOKEN}`;

function db() {
  return createClient(SUPABASE_URL, SERVICE_KEY);
}

async function tgCall(method: string, payload: Record<string, unknown>): Promise<any> {
  try {
    const r = await fetch(`${TG}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await r.json().catch(() => ({}));
  } catch (e) {
    console.error("tgCall error", method, (e as Error)?.message);
    return { ok: false };
  }
}

async function sendMessage(chatId: number, text: string, extra: Record<string, unknown> = {}) {
  return tgCall("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", ...extra });
}

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Active subscription with curator-chat access?
function planAllowsChat(plan: string | null | undefined): boolean {
  return plan === "basic" || plan === "premium";
}

async function handleStart(chatId: number, userId: number, token: string) {
  if (!CHAT_ID) {
    await sendMessage(chatId, "⚠️ Чат подписчиков ещё не настроен. Свяжитесь с поддержкой.");
    return;
  }
  if (!token) {
    await sendMessage(
      chatId,
      "👋 Привет! Это бот-куратор для приватного чата подписчиков TeleStore.\n\n" +
        "Чтобы получить приглашение в чат, откройте платформенный бот → раздел «Подписка» → нажмите «🔑 Войти в чат подписчиков».",
    );
    return;
  }

  const supabase = db();
  const { data: invite } = await supabase
    .from("curator_chat_invites")
    .select("id, telegram_id, plan, status, expires_at")
    .eq("token", token)
    .maybeSingle();

  if (!invite) {
    await sendMessage(chatId, "❌ Ссылка не найдена. Запросите новую в платформенном боте.");
    return;
  }
  if (invite.telegram_id !== userId) {
    await sendMessage(chatId, "❌ Эта ссылка предназначена другому пользователю.");
    return;
  }
  if (invite.status === "used") {
    await sendMessage(chatId, "ℹ️ Эта ссылка уже была использована. Запросите новую в платформенном боте.");
    return;
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    await supabase.from("curator_chat_invites").update({ status: "expired" }).eq("id", invite.id);
    await sendMessage(chatId, "⌛ Срок действия ссылки истёк. Запросите новую в платформенном боте.");
    return;
  }

  // Re-verify subscription is still active
  const { data: pUser } = await supabase
    .from("platform_users")
    .select("subscription_plan, subscription_status, subscription_expires_at")
    .eq("telegram_id", userId)
    .maybeSingle();
  const isActive =
    !!pUser &&
    ["active", "grace_period"].includes(pUser.subscription_status) &&
    planAllowsChat(pUser.subscription_plan) &&
    (!pUser.subscription_expires_at || new Date(pUser.subscription_expires_at).getTime() > Date.now());
  if (!isActive) {
    await supabase.from("curator_chat_invites").update({ status: "failed" }).eq("id", invite.id);
    await sendMessage(chatId, "❌ Ваша подписка Basic/Premium неактивна. Доступ к чату закрыт.");
    return;
  }

  // Create one-time invite (member_limit=1)
  const expiresAtUnix = Math.floor(Date.now() / 1000) + 24 * 60 * 60; // 24h to join
  const inviteRes = await tgCall("createChatInviteLink", {
    chat_id: CHAT_ID,
    member_limit: 1,
    expire_date: expiresAtUnix,
    name: `inv_${userId}`,
  });
  if (!inviteRes?.ok) {
    console.error("createChatInviteLink failed", inviteRes);
    await supabase.from("curator_chat_invites").update({ status: "failed" }).eq("id", invite.id);
    await sendMessage(
      chatId,
      "⚠️ Не удалось создать приглашение. Убедитесь, что бот добавлен в чат как администратор с правом приглашать пользователей.",
    );
    return;
  }

  const link = inviteRes.result.invite_link as string;
  await supabase
    .from("curator_chat_invites")
    .update({ status: "used", used_at: new Date().toISOString(), invite_link: link })
    .eq("id", invite.id);

  await sendMessage(
    chatId,
    `✅ <b>Ваше приглашение готово!</b>\n\n` +
      `Перейдите по ссылке, чтобы войти в чат подписчиков:\n` +
      `${esc(link)}\n\n` +
      `⏱ Ссылка действует 24 часа и только для одного входа.`,
    { disable_web_page_preview: true },
  );
}

async function handleSetChatId(chatId: number, userId: number) {
  if (!ADMIN_IDS.includes(userId)) return; // silent
  await sendMessage(
    chatId,
    `Чтобы привязать чат:\n` +
      `1. Добавьте этого бота администратором в нужный групповой чат (право «Приглашать пользователей по ссылке» обязательно).\n` +
      `2. Получите ID чата (например, через @getmyid_bot) — он будет отрицательным числом.\n` +
      `3. Обновите секрет <code>CURATOR_CHAT_ID</code> в настройках Lovable Cloud.\n\n` +
      `Текущий: <code>${esc(CHAT_ID || "не установлен")}</code>`,
  );
}

// Track joins / leaves to manage curator_chat_members
async function handleChatMember(update: any) {
  const cm = update.chat_member;
  const chatId = String(cm?.chat?.id || "");
  if (!CHAT_ID || chatId !== CHAT_ID) return;
  const user = cm?.new_chat_member?.user;
  if (!user || user.is_bot) return;
  const status = cm?.new_chat_member?.status;
  const supabase = db();
  if (["member", "administrator", "creator", "restricted"].includes(status)) {
    await supabase
      .from("curator_chat_members")
      .upsert(
        { telegram_id: user.id, joined_at: new Date().toISOString(), kicked_at: null, kick_reason: null },
        { onConflict: "telegram_id" },
      );
  } else if (["left", "kicked"].includes(status)) {
    await supabase
      .from("curator_chat_members")
      .update({ kicked_at: new Date().toISOString(), kick_reason: status === "kicked" ? "kicked" : "left" })
      .eq("telegram_id", user.id);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (!TOKEN) return new Response("Bot not configured", { status: 503, headers: corsHeaders });

  let update: any = null;
  try {
    update = await req.json();
  } catch {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Membership tracking
    if (update.chat_member) {
      await handleChatMember(update);
      return new Response("ok", { headers: corsHeaders });
    }

    const msg = update.message;
    if (!msg) return new Response("ok", { headers: corsHeaders });
    const chatType = msg.chat?.type;
    const text: string = msg.text || "";
    const userId: number = msg.from?.id;
    const chatId: number = msg.chat?.id;

    // Silent in groups
    if (chatType !== "private") {
      return new Response("ok", { headers: corsHeaders });
    }

    if (text.startsWith("/start")) {
      const parts = text.split(/\s+/);
      const token = parts[1] || "";
      await handleStart(chatId, userId, token);
      return new Response("ok", { headers: corsHeaders });
    }
    if (text === "/setchatid") {
      await handleSetChatId(chatId, userId);
      return new Response("ok", { headers: corsHeaders });
    }
    // Default: minimal hint
    await sendMessage(
      chatId,
      "ℹ️ Я выдаю ссылки в приватный чат подписчиков. Запросите доступ через платформенный бот → «Подписка» → «Войти в чат подписчиков».",
    );
    return new Response("ok", { headers: corsHeaders });
  } catch (e) {
    console.error("curator-bot error", (e as Error)?.message);
    return new Response("ok", { headers: corsHeaders });
  }
});