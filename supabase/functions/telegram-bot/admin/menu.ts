import { tg, deleteAndSend } from "../_shared/tg.ts";
import { clearSession } from "../_shared/session.ts";

// Inline keyboard layout matching the reference screenshot.
// callback_data uses a tiny "a:<section>" scheme so we never approach the
// 64-byte limit even when section names grow.
export function adminMenuKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: "📦 Товары", callback_data: "a:p" },
        { text: "📂 Категории", callback_data: "a:c" },
      ],
      [
        { text: "🛒 Заказы", callback_data: "a:o" },
        { text: "👥 Пользователи", callback_data: "a:u" },
      ],
      [
        { text: "📁 Проекты", callback_data: "a:pr" },
        { text: "📊 Статистика", callback_data: "a:st" },
      ],
      [
        { text: "🏷 Промокоды", callback_data: "a:pc" },
        { text: "🏗 Склад", callback_data: "a:inv" },
      ],
      [
        { text: "📜 Логи", callback_data: "a:lg" },
        { text: "⚙️ Настройки", callback_data: "a:se" },
      ],
      [
        { text: "📣 Рассылка", callback_data: "a:bc" },
        { text: "⭐ Отзывы", callback_data: "a:rv" },
      ],
    ],
  };
}

export async function sendAdminMenu(chatId: number, telegramId: number, replaceMsgId?: number) {
  await clearSession(telegramId);
  const text = "🛠 <b>Админ-панель</b>\n\nВыберите раздел:";
  await deleteAndSend(
    chatId,
    replaceMsgId,
    {
      text,
      parse_mode: "HTML",
      reply_markup: adminMenuKeyboard(),
    },
  );
}

export async function notImplementedStub(chatId: number, msgId: number | undefined, section: string) {
  await deleteAndSend(chatId, msgId, {
    text: `🚧 Раздел <b>${section}</b> в разработке.`,
    parse_mode: "HTML",
    reply_markup: {
      inline_keyboard: [[{ text: "← Назад", callback_data: "a:menu" }]],
    },
  });
}
