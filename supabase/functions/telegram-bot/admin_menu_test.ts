import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { adminMenuKeyboard } from "./admin/menu.ts";

Deno.test("adminMenuKeyboard: contains the 12 admin sections from the brief", () => {
  const kb = adminMenuKeyboard();
  const labels = kb.inline_keyboard.flat().map((b) => b.text);
  // Spot-check each expected section. Order doesn't matter for this assertion.
  const expected = [
    "📦 Товары",
    "📂 Категории",
    "🛒 Заказы",
    "👥 Пользователи",
    "📨 Заявки СБП",
    "📁 Проекты",
    "📊 Статистика",
    "🏷 Промокоды",
    "🏗 Склад",
    "📜 Логи",
    "⚙️ Настройки",
    "📣 Рассылка",
    "⭐ Отзывы",
  ];
  for (const label of expected) {
    assertEquals(labels.includes(label), true, `missing button: ${label}`);
  }
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
