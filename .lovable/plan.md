
# План правок системы автовыдачи

## 1. Миграция БД

**Добавить флаги идемпотентности в `orders`:**
- `balance_charged_at timestamptz` — момент списания баланса (NULL = не списано)
- `fulfilled_at timestamptz` — момент успешной полной выдачи

**Унифицировать статусы:** во всех функциях использовать `status='delivered'` для выданных заказов (сейчас `check-payment` ставит `completed`). Бэкфилл существующих `completed` → `delivered`.

**Триггер авто-выдачи при пополнении склада:**
- На `AFTER INSERT` в `inventory_items` (status='available') вызывать новую функцию `try_fulfill_pending_orders(product_id)`.
- Функция ищет заказы со статусом `processing` и `payment_status='paid'`, у которых есть `order_items` на этот product без выданных `inventory_items.order_id`, и атомарно резервирует недостающее.
- Возвращает массив `(order_id, telegram_id, content[])` — edge-функция-обёртка `notify-fulfilled` шлёт сообщения покупателям. Чтобы не плодить вебхуки, прямо в SQL ставим `pg_notify('orders_fulfilled', json)` — отдельный воркер не нужен, проще: триггер записывает в новую таблицу `pending_notifications`, edge-cron каждую минуту разгребает и шлёт TG-сообщения.

## 2. Правки edge-функций

**`cryptobot-webhook/index.ts` — `handleOrder`:**
- Изменить ранний выход: `if (order.payment_status === 'paid' && order.fulfilled_at) return true` — иначе пытаемся довыдать.
- Списание баланса (`deduct_balance`) обернуть условием `if (balance_used > 0 && !order.balance_charged_at)` + сразу после успеха сохранить `balance_charged_at=now()`.
- Удалить ручной `update products.stock` после `reserve_inventory` (триггер делает).
- В конце ставить `fulfilled_at=now()` если `allDelivered`.

**`pay-with-balance/index.ts`:**
- Сразу после `deduct_balance` создавать заказ с `balance_charged_at=now()`.
- Удалить ручной `update products.stock` (5 строк).
- При частичной выдаче (`got.length < quantity`) возвращать на баланс пропорциональную разницу + запись в `balance_history` с комментарием "Возврат за невыданное".

**`check-payment/index.ts`:**
- Заменить статус `completed` → `delivered`.
- Списание баланса под флагом `!order.balance_charged_at`.
- Удалить ручной `update products.stock`.
- Поставить `fulfilled_at` при полной выдаче.
- Сообщение покупателю — выровнять с `cryptobot-webhook` (тот же формат `<code>` блоков + "Сохраните данные").

**Новая edge-функция `notify-pending-fulfillments`:**
- Дёргается по cron каждую минуту.
- Читает `pending_notifications`, шлёт TG-сообщение с выданным контентом, ставит `sent_at`, удаляет старые (>7 дней).

## 3. Финальная перепроверка (чек-лист)

После всех правок — прогон сценариев:

```text
S1. Простой заказ с балансом, склад полон
    → списание = total, статус delivered, сообщение с кодами

S2. Простой заказ с балансом, склад пуст
    → списание = 0 (нечего резервировать) или пропорциональный возврат
    → статус processing, fulfilled_at NULL

S3. После S2: админ добавляет 3 единицы в склад
    → триггер автоматически дорезервирует, заказ → delivered
    → cron-воркер шлёт покупателю коды

S4. CryptoBot оплата, склад полон
    → webhook + check-payment одновременно: только один проходит claim
    → второй видит fulfilled_at и выходит

S5. CryptoBot оплата, склад пуст
    → webhook ставит paid + processing, balance_charged_at
    → склад пополняется → S3-сценарий

S6. Повторная доставка webhook (release+retry)
    → balance_charged_at защищает от двойного списания
    → reserve_inventory вернёт пустой массив если уже выдано

S7. Авто-товар (premium/stars)
    → inventory не трогается, админ-уведомление как сейчас
```

**Тесты:**
- Deno-тест на новую функцию `try_fulfill_pending_orders` (юнит на SQL).
- Запуск `supabase--linter` — убедиться нет новых критичных warnings.
- Ручной прогон через psql эмуляции сценариев S2→S3 и S6.

## 4. Технические детали

```sql
-- migration
ALTER TABLE orders 
  ADD COLUMN balance_charged_at timestamptz,
  ADD COLUMN fulfilled_at timestamptz;
UPDATE orders SET balance_charged_at = updated_at WHERE balance_used > 0 AND payment_status = 'paid';
UPDATE orders SET fulfilled_at = updated_at WHERE status IN ('delivered','completed');
UPDATE orders SET status = 'delivered' WHERE status = 'completed';

CREATE TABLE pending_notifications (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null,
  telegram_id bigint not null,
  payload jsonb not null,
  created_at timestamptz default now(),
  sent_at timestamptz
);

-- триггер вызывает функцию, которая резервирует + пишет в pending_notifications
```

## 5. Скоуп правок

- 1 миграция (схема + триггер + функция)
- 3 edge-функции изменить (cryptobot-webhook, pay-with-balance, check-payment)
- 1 новая edge-функция (notify-pending-fulfillments) + cron-расписание
- Обновить memory `features/automated-fulfillment` с новой логикой ретрая

## Что НЕ трогаем

- Авто-товары (premium_term/stars) — текущая ручная модерация работает корректно.
- UI корзины — синхронизация уже работает.
- Webhook-подпись, rate-limits, RLS — без изменений.
