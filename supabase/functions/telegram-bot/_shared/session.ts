// FSM sessions + callback token storage for the admin panel.
// Telegram limits callback_data to 64 bytes — we keep payload in the DB and
// reference it by an 8-char token (memory: Telegram Button Encoding).
import { supabase } from "./db.ts";

const SESSION_TTL_MIN = 30;
const CALLBACK_TTL_HOURS = 24;

export interface AdminSession {
  state: string;
  payload: Record<string, unknown>;
}

export async function getSession(telegramId: number): Promise<AdminSession | null> {
  const { data } = await supabase
    .from("admin_sessions")
    .select("state, payload, expires_at")
    .eq("telegram_id", telegramId)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) {
    await clearSession(telegramId);
    return null;
  }
  return { state: data.state as string, payload: (data.payload as Record<string, unknown>) ?? {} };
}

export async function setSession(
  telegramId: number,
  state: string,
  payload: Record<string, unknown> = {},
) {
  const expires = new Date(Date.now() + SESSION_TTL_MIN * 60 * 1000).toISOString();
  await supabase
    .from("admin_sessions")
    .upsert({
      telegram_id: telegramId,
      state,
      payload,
      updated_at: new Date().toISOString(),
      expires_at: expires,
    });
}

export async function clearSession(telegramId: number) {
  await supabase.from("admin_sessions").delete().eq("telegram_id", telegramId);
}

// --- callback token storage ---

function randomToken(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function createCallback(payload: Record<string, unknown>): Promise<string> {
  // Collisions are improbable but we still retry a few times.
  for (let i = 0; i < 5; i++) {
    const token = randomToken();
    const expires = new Date(Date.now() + CALLBACK_TTL_HOURS * 60 * 60 * 1000).toISOString();
    const { error } = await supabase
      .from("admin_callbacks")
      .insert({ token, payload, expires_at: expires });
    if (!error) return token;
  }
  throw new Error("Could not allocate callback token");
}

export async function readCallback(token: string): Promise<Record<string, unknown> | null> {
  const { data } = await supabase
    .from("admin_callbacks")
    .select("payload, expires_at")
    .eq("token", token)
    .maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at as string).getTime() < Date.now()) return null;
  return (data.payload as Record<string, unknown>) ?? {};
}
