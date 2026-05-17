# Авто-товары: Stars / Premium — полный цикл

## Что уже есть
- На фронте есть карточки `PremiumTermCard` и `StarsCard` (`src/components/SpecialProductCards.tsx`) — кладут товар в корзину как обычный продукт.
- В БД `products` имеют `product_type` (`premium_term` / `stars`), `term_options`, `min_qty`, `max_qty`.
- Чекаут идёт через обычный flow (`pay-with-balance` / `create-invoice` → `cryptobot-webhook`).
- Админка в Telegram-боте уже модульная (`supabase/functions/telegram-bot/admin/*`).

## Чего не хватает
1. У авто-товаров в заказе нет привязки **@username получателя** (кому слать Stars/Premium).
2. Нет очереди **«Авто-заказы»** в админке бота с действиями «Выдать» / «Ошибка».
3. Нет уведомлений пользователю «Принят → Выдан».
4. Если в одном заказе авто-товар + обычный товар — нужно разделять (заказ должен быть либо полностью авто, либо обычный).

## План реализации

### 1. БД (миграция)
- В `order_items` добавить `recipient_username text` (для конкретной позиции авто-товара).
- В `orders` добавить:
  - `is_auto boolean default false` — содержит ли заказ хотя бы один авто-товар.
  - `auto_status text` — `pending` | `delivered` | `error` (для авто-заказов).
  - `auto_delivered_at timestamptz`, `auto_delivered_by bigint`, `auto_error_note text`.
- Индекс `orders(is_auto, auto_status)` для списка в админке.

### 2. Фронт: указание @username
- В `PremiumTermCard` и `StarsCard` добавить обязательное поле ввода `@username` (валидация `^@?[A-Za-z0-9_]{5,32}$`).
- Хранить `recipient_username` на уровне cart item (расширить `StoreContext` / `addToCart`).
- **Запретить смешивание**: при попытке добавить авто-товар, если в корзине есть обычный (и наоборот) — показывать toast «Авто-товары оформляются отдельным заказом» и предлагать очистить корзину.
- Передавать `recipient_username` в `create-invoice` / `pay-with-balance`.

### 3. Edge Functions
- `pay-with-balance` и `create-invoice`: принимать `items[].recipient_username`, сохранять в `order_items`, выставлять `orders.is_auto = true` если хоть одна позиция — авто-товар, и `auto_status='pending'`.
- `cryptobot-webhook` (и balance-flow): после успешной оплаты, если `is_auto = true`:
  - НЕ дёргать `reserve_inventory` для авто-позиций.
  - Слать покупателю: «✅ Заказ принят, ожидайте выдачи».
  - Слать в админ-чат (всем `ADMIN_TELEGRAM_IDS`) уведомление о новом авто-заказе с кнопкой «Открыть».

### 4. Админка бота — раздел «🤖 Авто-заказы»
Новый файл `supabase/functions/telegram-bot/admin/auto_orders.ts`:
- В главном меню (`admin/menu.ts`) добавить кнопку `🤖 Авто-заказы` (callback `a:ao`).
- Список авто-заказов: фильтр `pending` / `delivered` / `error`, постранично.
- Карточка заказа: номер, товар (Stars 50⭐ / Premium 3 мес), получатель `@username`, покупатель `telegram_id`, сумма, статус, кнопки:
  - ✅ Подтвердить выдачу → `auto_status='delivered'`, уведомление покупателю.
  - ❌ Ошибка выдачи → запросить причину текстом → `auto_status='error'`, вернуть на баланс, уведомить.
- Роутер callback-ов в `index.ts`.

### 5. Уведомления
- При создании авто-заказа: покупателю «Заказ принят», админам — новый заказ.
- При «Выдан»: покупателю «✅ Ваш заказ выдан».
- При «Ошибка»: покупателю «❌ Не удалось выдать, сумма возвращена на баланс».

### 6. Скрытие авто-товаров из обычного раздела «Товары» в админке
- В `admin/products.ts` фильтровать `product_type NOT IN ('stars','premium_term')` — управление ценами/настройками этих товаров идёт через отдельный подраздел.
- Внутри «Авто-заказы» добавить подменю «⚙️ Настройки Premium» и «⚙️ Настройки Stars» (как на скриншотах 26/27): редактирование цен 3/6/12 мес и цены за 1 звезду, min/max, включить/выключить.

## Технические детали
- `recipient_username` нормализуем — всегда сохраняем БЕЗ `@`, выводим С `@`.
- Возврат при ошибке: `credit_balance(telegram_id, total_amount)` + запись в `balance_history` (type='refund_auto').
- Идемпотентность: повторное нажатие «Выдать» — no-op если уже `delivered`.
- Все админ-действия пишутся в `admin_log` (`writeAuditLog`).

## Объём
Большая фича: ~1 миграция, 2 фронт-компонента, 1 контекст, 3 edge-функции, 1 новый файл админки + правки menu/index, новые ключи `message_templates` для уведомлений.

Подтвердите план — приступаю к миграции и реализации.
