// Upload a Telegram-hosted file to Supabase Storage and return its public URL.
// Used by admin product editor to accept photos sent directly into the chat.
import { tg } from "./tg.ts";
import { supabase } from "./db.ts";

const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") ?? "";

export type UploadResult = { ok: true; url: string } | { ok: false; error: string };

export async function uploadTelegramPhoto(
  fileId: string,
  bucket = "product-images",
  prefix = "",
): Promise<UploadResult> {
  try {
    const info = await tg("getFile", { file_id: fileId });
    const filePath = info?.result?.file_path as string | undefined;
    if (!filePath) return { ok: false, error: "no file_path" };

    const src = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${filePath}`;
    const res = await fetch(src);
    if (!res.ok) return { ok: false, error: `download failed ${res.status}` };
    const bytes = new Uint8Array(await res.arrayBuffer());

    const ext = (filePath.split(".").pop() || "jpg").toLowerCase();
    const safeExt = /^[a-z0-9]{2,5}$/.test(ext) ? ext : "jpg";
    const key = `${prefix ? prefix + "/" : ""}${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${safeExt}`;

    const { error } = await supabase.storage.from(bucket).upload(key, bytes, {
      contentType: safeExt === "png" ? "image/png" : safeExt === "webp" ? "image/webp" : "image/jpeg",
      upsert: false,
    });
    if (error) return { ok: false, error: error.message };

    const { data } = supabase.storage.from(bucket).getPublicUrl(key);
    return { ok: true, url: data.publicUrl };
  } catch (e) {
    return { ok: false, error: String(e) };
  }
}
