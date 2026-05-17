import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { adminMenuKeyboard } from "./admin/menu.ts";

Deno.test("adminMenuKeyboard: contains the expected admin sections", () => {
  const kb = adminMenuKeyboard();
  const labels = kb.inline_keyboard.flat().map((b) => b.text);
  const expected = [
    "📦 Товары",
    "📂 Категории",
    "🛒 Заказы",
    "👥 Пользователи",
    "📁 Проекты",
    "📊 Статистика",
    "🏷 Промокоды",
    "🏗 Склад",
    "📜 Логи",
    "⚙️ Настройки",
    "📣 Рассылка",
    "⭐ Отзывы",
    "🤖 Авто-заказы",
  ];
  for (const label of expected) {
    assertEquals(labels.includes(label), true, `missing button: ${label}`);
  }
});

Deno.test("adminMenuKeyboard: includes the new Авто-заказы section", () => {
  const kb = adminMenuKeyboard();
  const buttons = kb.inline_keyboard.flat();
  const autoBtn = buttons.find((b) => b.text === "🤖 Авто-заказы");
  assertEquals(!!autoBtn, true, "Авто-заказы button missing");
  assertEquals(autoBtn?.callback_data, "a:ao");
});

Deno.test("adminMenuKeyboard: every callback_data stays within 64 bytes", () => {
  const kb = adminMenuKeyboard();
  for (const row of kb.inline_keyboard) {
    for (const btn of row) {
      const bytes = new TextEncoder().encode(btn.callback_data as string).length;
      assertEquals(bytes <= 64, true, `callback too long: ${btn.callback_data}`);
    }
  }
});
