// Admin authorization for the Telegram bot.
// We trust the comma-separated whitelist in ADMIN_TELEGRAM_IDS; isAdmin must
// be called for every admin-only command and every "a:*" callback.
const RAW = Deno.env.get("ADMIN_TELEGRAM_IDS") ?? "";
export const ADMIN_TELEGRAM_IDS = RAW.split(",").map((s) => s.trim()).filter(Boolean);

export function isAdmin(tgId: number | string | null | undefined): boolean {
  if (tgId === null || tgId === undefined) return false;
  return ADMIN_TELEGRAM_IDS.includes(String(tgId));
}
