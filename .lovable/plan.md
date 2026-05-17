## Цель

Реализовать `/admin` в Telegram-боте — инлайн-меню (12 кнопок как на скрине), которое **закрывает §10 ТЗ полностью** и опирается на остальные разделы (§7–§9, §11, §13, §14). NFT-аренда, NFT-покупка и NFT-юзернеймы исключаются из проекта полностью (см. §«Зачистка»).

## Маппинг ТЗ → разделы админки

| ТЗ | Раздел `/admin` | Что делает |
|---|---|---|
| §10.1 «название магазина» | ⚙️ Настройки → `site_settings.shop_name` | редактирование |
| §10.1 «бегущая строка» (§2.1) | ⚙️ Настройки → `site_settings.marquee_text` | вкл/выкл + текст |
| §10.1 «FAQ-ссылка» (§2.4) | ⚙️ Настройки → `site_settings.faq_url` | Telegraph URL |
| §10.1 «баннеры, описания» проектов | 📁 Проекты | редактирование FLUX/VIETO/CURSOR (banner/title/subtitle/description/icon) |
| §10.1 «категории» (§4.2) | 📂 Категории | CRUD категорий VIETO (Футболки/Худи…) |
| §10.1 «товары, цены, вкл/выкл» (§3–§6) | 📦 Товары | CRUD + флаг `is_active`, цена, slug, привязка к проекту, дефолт `vieto` |
| §6.1 Premium term_options | 📦 Товары → редактор `term_options` | сроки 3/6/9 мес + цены |
| §6.3 Звёзды min/max | 📦 Товары → `min_qty`/`max_qty` | дефолт max 10000 |
| §10.1 «примеры работ» (§3.5) | 📦 Товары → `gallery` | URL-список превью со ссылками |
| §10.1 «внешние ссылки» | 📦 Товары → `external_link` | редактирование |
| §10.1 «отзывы» (§2.3) | ⭐ Отзывы | CRUD + рейтинг + аватар |
| §10.1 «модерация заявок» | 📨 Заявки | список `reviews.moderation_status='pending'` → approve/reject |
| §8 «заказы», §8.3 статусы | 🛒 Заказы | фильтры (статус/дата/проект), карточка, ручная смена `status`/`payment_status` |
| §10.2 `/rep #номер` | 🛒 Заказы → кнопка «Отправить /rep» + 📜 Логи | one-click отправка, лог в `admin_log` |
| §10.1 «шаблоны сообщений» | ⚙️ Настройки → Шаблоны | редактор `message_templates` (`rep_default` + др.) |
| §11 «пользователь» | 👥 Пользователи | поиск, баланс, блок/разблок, заметка |
| §14 «логирование критичных действий» | 📜 Логи | просмотр `admin_log` + `balance_history` |
| §11 «инструкция/шаблон сообщения» | 📣 Рассылка | разовая рассылка по аудитории, прогресс |
| §6.3 «склад» (цифровая выдача) | 🏗 Склад | bulk-добавление `inventory_items` по товару |
| общая статистика | 📊 Статистика | заказы/выручка/новые юзеры за день/7/30 |

Итого 12 кнопок: **Товары · Категории · Заказы · Пользователи · Заявки · Статистика · Промокоды · Склад · Логи · Настройки · Рассылка · Отзывы** — 1:1 со скрином.

## Архитектура (с учётом §14 «безопасность»)

```
TG update → telegram-bot → verify X-Telegram-Bot-Api-Secret-Token
  → if /admin or callback "a:*": requireAdmin(ADMIN_TELEGRAM_IDS)
    → router → handler → service_role SQL → admin_log
```

- Сессии мастеров (создание товара, рассылка, ручной баланс) — в новой таблице `admin_sessions` (PK `telegram_id`, `state`, `payload jsonb`, `expires_at`).
- Длинные ID — через `admin_callbacks` (8-симв токен → payload), чтобы уложиться в 64 байта `callback_data` (memory: «Telegram Button Encoding»).
- Все TG-вызовы в try/catch, `maskToken` в логах (memory: «Token Leak Prevention»).
- Обновление экрана = `deleteMessage` + `sendMessage`/`sendPhoto` (memory: «Bot UX Stability»).
- Каждая мутация → `admin_log` (action/target/meta с diff), §14.
- Баланс — только через `credit_balance`/`deduct_balance` RPC + строка в `balance_history` (memory: «Transactional Integrity»).
- Цены/итоги пересчитываются на бэкенде (§14).

## Новые таблицы (одна миграция)

| Таблица | Назначение |
|---|---|
| `admin_sessions` | FSM-стейт админских мастеров, TTL 30 мин |
| `admin_callbacks` | токен → payload для длинных параметров |
| `broadcasts` | очередь и прогресс рассылок (text, photo_url, audience, status, sent/failed counts) |

RLS: только `service_role`, `No public access`.
`pg_cron` каждые 5 мин чистит просроченные `admin_sessions`/`admin_callbacks`.

## Что НЕ относится к админке, но проверяем за один проход (§ТЗ)

- **§3.5/§10.1 «примеры работ → внешние ссылки»** — поле редактора `gallery[].href` уже поддерживается схемой (`gallery jsonb`); в редакторе товара выводим как список.
- **§13 «цена изменилась до оплаты», «товар недоступен»** — уже сделано в `Cart.tsx` (`syncCartWithProducts`). Админка ничего нового не вводит.
- **§8.3 статусы** — уже соответствуют `ORDER_STATUS_LABELS`. Админка просто их выставляет вручную.

## Полное удаление NFT-функционала (по твоей правке)

- DB: удалить столбец `products.nft_variants`; удалить записи `products.product_type IN ('nft','nft_rent','nft_purchase','nft_username')`; удалить категорию/товары `cursor` касающиеся NFT-аренды/покупки/юзернеймов.
- Сторфронт: удалить `NftCatalogDialog.tsx`, любые ветки `product_type === 'nft*'` в `ProductDetails.tsx`, `Cart.tsx`, `Catalog.tsx`. Убрать кнопку «NFT Аренда/Покупка/Звёзды-юзернеймы» из CURSOR.
- Edge: удалить функцию `portals-gifts` (она же tonapi/getgems-related). Снять упоминания GetGems из `Cart`/`Checkout`.
- Зависимости: удалить `tonapi`/`tonweb`/`@getgems/*` если есть. Перечитаю `package.json` перед сносом.
- В CURSOR оставляем только: **Premium** (термы) и **Звёзды** (слайдер qty). Premium и Звёзды — это не NFT, это inline-конфигурация по ТЗ §6.1/§6.3.

## Файловая структура

```
supabase/functions/telegram-bot/
  index.ts                  — роутер /start /rep /admin + callback_query
  _shared/tg.ts             — tg(), safeSlice, deleteAndSend, maskToken
  _shared/session.ts        — get/set/clear session + callback tokens
  _shared/auth.ts           — isAdmin, requireAdmin
  _shared/log.ts            — writeAuditLog
  admin/menu.ts             — главное меню /admin
  admin/products.ts         — list + wizard create/edit (term_options, gallery, min/max, project=vieto)
  admin/categories.ts       — CRUD категорий VIETO
  admin/projects.ts         — редактирование FLUX/VIETO/CURSOR
  admin/orders.ts           — фильтры, карточка, статус, one-click /rep
  admin/users.ts            — поиск, баланс ±, блок, заметка
  admin/reviews.ts          — модерация + CRUD
  admin/stats.ts            — KPI 1/7/30
  admin/promocodes.ts       — CRUD
  admin/inventory.ts        — bulk add по product_id
  admin/logs.ts             — admin_log + balance_history
  admin/settings.ts         — site_settings + message_templates + marquee + faq_url
  admin/broadcast.ts        — wizard + self-invoke воркер
```

## Тесты (Deno, рядом с кодом)

- `_shared/auth_test.ts` — `isAdmin` whitelist.
- `_shared/session_test.ts` — set/get/expire, callback token round-trip.
- `_shared/tg_test.ts` — `safeSlice` UTF-8 границы, `maskToken`.
- `admin/products_test.ts` — wizard FSM, дефолт `project_id='vieto'`, валидация `term_options`/`min_qty`/`max_qty`.
- `admin/orders_test.ts` — фильтр + смена статуса + лог.
- `admin/users_test.ts` — баланс ±, запись в `balance_history`, блок.
- `admin/broadcast_test.ts` — батч, прогресс.
- Smoke через `supabase--curl_edge_functions`: симулируем `/admin` и по одному `callback_query` на раздел.
- После каждого блока — прогон тестов, фиксы до зелёного.

## План реализации (поэтапно, тесты обязательны после каждого шага)

1. **Снос NFT** (DB + код + удаление `portals-gifts`) + правка сторфронта (`NftCatalogDialog` и ветки `nft_*`). Smoke сторфронта.
2. **Фундамент админки**: миграция `admin_sessions`/`admin_callbacks`/`broadcasts` + cleanup-cron; `_shared/*`; команда `/admin` → меню. Тесты shared.
3. **Товары + Категории + Проекты** (с дефолтом VIETO, term_options, gallery, min/max). Тесты.
4. **Заказы** (фильтры, статусы по §8.3, one-click `/rep`). Тесты.
5. **Пользователи + балансы** (RPC + history). Тесты.
6. **Промокоды + Настройки + Шаблоны + Marquee + FAQ_url**. Тесты.
7. **Склад + Отзывы/Заявки**. Тесты.
8. **Статистика + Логи**.
9. **Рассылка** (wizard + self-invoke воркер с курсором).
10. **Финальный QA**: чек-лист §16 ТЗ (главный экран, FLUX/VIETO/CURSOR, корзина, оплата, /rep, контент из админки, пустые состояния, ошибки).

## Что НЕ входит

- Веб-страница `/admin` в Mini App (по скрину админка — в боте).
- Multi-admin роли (используем `ADMIN_TELEGRAM_IDS` из секретов).
- Загрузка фото товара из бота в Storage (на этом этапе — URL; bucket `product-images` уже есть, добавлю uploader отдельной итерацией если попросишь).
