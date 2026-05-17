## Цель

Пройти все 12 разделов админки + общий слой (router/auth/session/log) и найти/починить все баги, разрывы связей между модулями, нарушения §14 (безопасность/целостность), сломанные callback'и и расхождения с ТЗ.

## Этап 1 — Сбор фактов (read-only)

1. **Router-карта.** Прочитать `index.ts` целиком и составить таблицу `callback prefix → handler → ожидаемые args`. Сверить с тем, что реально шлют `admin/*.ts` (кнопки `callback_data`).
2. **Контракт shared-слоя.** `_shared/auth.ts`, `session.ts`, `tg.ts`, `db.ts`, `upload.ts` — проверить:
   - `safeSlice` применяется ко всем `text` кнопок и `callback_data` ≤ 64 B;
   - все `tg()` вызовы обёрнуты в try/catch и логи проходят через `maskToken`;
   - `deleteAndSend` используется вместо `editMessage` (memory: Bot UX Stability);
   - сессии/callback-токены чистятся `cleanup_admin_expired` (cron жив).
3. **Проверка прав.** В каждой точке входа (`/admin`, `/rep`, callback `a:*`, текст в FSM) вызывается `isAdmin`. Найти пути в обход.
4. **DB-схема vs код.** Сопоставить поля, которые читает/пишет каждый модуль, со схемой `<supabase-tables>` (типы, nullable, default). Особое внимание: `orders.balance_used`, `sbp_requests.status enum`, `products.term_options`/`gallery`/`min_qty`/`max_qty`, `broadcasts.cursor_telegram_id`, `balance_history.balance_after`.
5. **Аудит-лог.** Каждая мутация → `writeAuditLog`. Найти модули, где `update/insert/delete` идёт без логирования.
6. **Транзакционность баланса.** Любые движения баланса — только через `credit_balance`/`deduct_balance` + строка в `balance_history`. Найти прямые `update user_profiles set balance` (особенно в `users.ts`, `sbp.ts`).

## Этап 2 — Покомпонентный аудит

Для каждого модуля — чек-лист: список view, callback'ов, FSM-стейтов, мутаций; что валидируется; что логируется; пустые состояния; пагинация.

| Модуль | Что особенно проверить |
|---|---|
| `menu.ts` | 12 кнопок, длины callback_data, иконки совпадают с ТЗ |
| `products.ts` | wizard FSM (все шаги доводят до save), upload фото (bucket `product-images`, путь, public URL), `term_options`/`gallery` JSON-валидация, `min_qty ≤ max_qty`, дефолт `project_id='vieto'` |
| `categories.ts` | CRUD, slug-уникальность, защита от удаления категории, на которой висят товары |
| `projects.ts` | редактор FLUX/VIETO/CURSOR, обновление баннера через upload, нельзя удалить |
| `orders.ts` | фильтры status/date/project, смена `status`+`payment_status`, one-click `/rep` (доставка содержимого `inventory_items` + `external_payload`), запись `admin_log` action=`rep_sent` |
| `users.ts` | поиск по `telegram_id`/`username`, ± баланс через RPC + `balance_history`, блок/разблок (`is_blocked`), заметка (`internal_note`) |
| `reviews.ts` | approve/reject/delete, `moderation_status` enum, обновление UI |
| `sbp.ts` | approve→`credit_balance`+order paid+уведомление клиенту, reject→причина+уведомление, идемпотентность (`status` переход только из `pending`) |
| `promocodes.ts` | CRUD, типы percent/fixed, лимиты, валидация дат |
| `inventory.ts` | bulk-add (split по строкам), trim, `status='available'`, лог |
| `logs.ts` | `admin_log` + `balance_history` пагинация, без N+1 |
| `settings.ts` | `site_settings` upsert по `key`, `message_templates` CRUD, marquee toggle, faq_url |
| `stats.ts` | окна 24h/7d/30d/all, top products/buyers, daily ASCII; проверить лимит 1000 строк |
| `broadcasts.ts` | wizard (text→photo→audience→preview→send), self-invoke воркер, курсор, throttle ~25/сек, fallback sendPhoto→sendMessage, прогресс |

## Этап 3 — Связи между модулями

- `orders` ⇄ `inventory_items` (reserve/release при ручной смене статуса).
- `sbp_requests` ⇄ `orders` ⇄ `balance_history`.
- `products` ⇄ `categories`/`projects` (FK-целостность на уровне приложения).
- `broadcasts` ⇄ `user_profiles` (сегменты `all/buyers/no_orders/with_balance`).
- `admin_callbacks` ⇄ длинные payload'ы (UUID товаров/заказов) — нет ли потери токена при перезаходе.

## Этап 4 — Сценарии E2E (curl_edge_functions + read_query)

Симулировать `update` для каждого основного callback (по 1–2 на модуль): `/admin`, открыть товары→создать→upload фото→сохранить; заказ→сменить статус→/rep; user→±баланс→блок; sbp→approve; broadcast→test-send. После каждого — `read_query` в соответствующие таблицы + `admin_log`.

## Этап 5 — Линтер и тесты

- `supabase--linter` для DB-варнингов.
- `deno test` по shared + admin (`admin_menu_test`, `shared_auth_test`, `shared_tg_test` + добавить недостающие на `products`, `orders`, `users`, `broadcasts` FSM).
- `edge_function_logs telegram-bot` за последние сутки — отфильтровать `error`/`failed`.

## Этап 6 — Реестр дефектов и фикс

По итогам 1–5 — единый список «дефект → файл:строка → фикс → тест». Чиним группами:
1. Безопасность/целостность (баланс, isAdmin, idempotency).
2. Сломанные callback'и/длины.
3. Расхождения со схемой/RLS.
4. UX (delete+send, пустые состояния, ошибки).
5. Логирование (`admin_log` пробелы).
6. Производительность (лимит 1000, индексы при необходимости — отдельной миграцией).

Каждый фикс — точечный edit, после блока — повторный smoke + тесты.

## Этап 7 — Финальный прогон §16 ТЗ

Полный чек по `.lovable/plan.md` шаг 10 (главный экран, FLUX/VIETO/CURSOR, корзина, оплата, /rep, контент из админки, пустые состояния, ошибки) и сводный отчёт.

## Что НЕ входит

- Веб-страница `/admin` (по решению пользователя).
- Multi-admin роли.
- Новые фичи сверх ТЗ.

## Технические детали

- Read-only инструменты: `code--view`, `rg`, `supabase--read_query`, `supabase--linter`, `supabase--edge_function_logs`, `supabase--curl_edge_functions`.
- Любые изменения схемы — отдельной миграцией с описанием.
- Все фиксы — через `code--line_replace`, без перезаписи файлов целиком.
- Деплой `telegram-bot` после каждой группы фиксов + smoke.
