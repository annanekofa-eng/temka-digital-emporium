UPDATE shop_settings SET value = '👋 <b>Привет, {name}!</b>

<b>TeleStore</b> — это платформа для запуска магазинов цифровых товаров в Telegram с готовым Mini App <b>за 15 минут</b> 🔥

<b>Как начать:</b>
• нажми <b>«Создать магазин»</b>
• пройди короткую настройку
• подключи своего бота
• добавь товары и начни продавать

Подходит для тех, кто хочет быстро начать продавать цифровые товары в Telegram без кода и сложной настройки.

<a href="https://telestore-two.vercel.app/shop/11cd91a3-900d-4426-81cf-64a247ed1c13">🛍️ <b>Пример готового магазина</b></a>
❓ FAQ / Частые вопросы: <a href="https://telegra.ph/FAQ--TeleStore-03-17">открыть</a>
🚀 В чём преимущество Mini App: <a href="https://telegra.ph/V-chem-preimushchestvo-magazina-Mini-App-03-17">читать</a>

<blockquote>🏪 Уже создано {shops_count} магазинов</blockquote>

<i>Используй кнопки ниже для начала работы 👇</i>', updated_at = now() WHERE key = 'platform_welcome_text';