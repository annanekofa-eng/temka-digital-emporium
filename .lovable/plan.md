
# План разработки: Telegram Mini App — Shop + NFT Marketplace

Разбит на 8 этапов. Каждый этап — самостоятельный, проверяемый кусок. После каждого этапа можно тестировать результат в Telegram.

---

## Этап 1. Фундамент данных и админ-доступ

Цель: подготовить БД и роли под новую структуру магазина.

**Схема БД (миграции):**
- `projects` — FLUX / VIETO / CURSOR (slug, title, banner, description, sort_order, is_active)
- Расширить `categories`: добавить `project_id` (FK), `parent_id` (для подкатегорий VIETO)
- Расширить `products`: `project_id`, `product_type` (`simple` | `premium_term` | `nft_variant` | `stars` | `nft_rent` | `nft_buy`), `external_link`, `gallery` (jsonb), `min_qty`, `max_qty`, `term_options` (jsonb), `nft_variants` (jsonb)
- `cart_items` — серверная корзина (telegram_id, product_id, params jsonb, qty, unit_price)
- `site_settings` — key/value: `shop_name`, `marquee_text`, `faq_url`, `policy_url`, `support_username`
- Расширить `orders`: `project_id`, добавить статусы (`new`, `pending_payment`, `paid`, `processing`, `done`, `cancelled`, `error`), `external_ref` (для GetGems)
- Расширить `order_items`: `params` jsonb, `external_payload` jsonb
- `message_templates` — шаблоны для `/rep` и автосообщений (key, text, is_active)
- `admin_log` — лог действий админов (admin_id, action, target, meta, created_at)
- `app_admins` — telegram_id админов (вместо ENV-секрета — управляемый список)

**RLS:** публичный SELECT для `projects`, `categories`, `products`, `site_settings`, `message_templates` (только активные). Остальное — service_role.

---

## Этап 2. Бот и приветствие

Цель: рабочий вход в мини-апп через `/start`.

- Edge function `telegram-bot` (уже есть, доработать):
  - `/start` → приветствие из `site_settings.welcome_text` + кнопка WebApp
  - Регистрация webhook
  - Базовая обработка `/help`
- Edge function `admin-rep` (вызывается ботом):
  - Команда `/rep #N` — только для `app_admins`
  - Поиск заказа, отправка шаблона из `message_templates` пользователю
  - Логирование в `admin_log`
  - Обработка ошибок (заказ не найден, юзер закрыл ЛС)

---

## Этап 3. Главный экран мини-аппа

Цель: новый Home по ТЗ §2.

- Хедер: `shop_name` из `site_settings`
- Бегущая строка `MarqueeBanner` (текст из `site_settings.marquee_text`)
- Верхний блок «featured» товары (горизонтальный скролл, клик → карточка)
- Блок проектов: 3 карточки FLUX / VIETO / CURSOR из `projects`
- Блок отзывов (слайдер из `reviews where moderation_status='approved'`)
- Футер: ссылки Политика и FAQ из `site_settings`
- Иконка корзины — глобально, плавающая в шапке

---

## Этап 4. Раздел FLUX

Цель: проектная страница + карточки услуг.

- Страница `/p/flux`:
  - Верхний блок (banner / title / description из `projects`)
  - Список товаров проекта без фото (только название + цена)
- Карточка товара FLUX:
  - Banner, title, description
  - Кнопка-цена → добавить в корзину (цена из БД)
  - Галерея «Примеры работ» (`product.gallery`) — клик открывает внешнюю ссылку
- Toast-уведомление при добавлении

---

## Этап 5. Раздел VIETO

Цель: каталог с категориями (мерч).

- Страница `/p/vieto`:
  - Верхний блок проекта
  - Список категорий (Футболки, Худи, …) из `categories where project_id=vieto`
- Страница категории: список товаров без фото
- Карточка товара VIETO: banner, title, description, кнопка-цена → корзина

---

## Этап 6. Раздел CURSOR (сложная логика)

Цель: 5 типов товаров с разной логикой.

- Страница `/p/cursor` — список разделов: Premium / НФТ / Звёзды / NFT Аренда / NFT Покупка
- **Premium** (`product_type='premium_term'`):
  - Слайдер срока (3/6/9 мес) из `term_options`
  - Динамический пересчёт цены
  - Кнопка добавления активна только после выбора
- **НФТ** (`product_type='nft_variant'`):
  - Сетка кнопок-вариантов из `nft_variants` (label + price)
  - Клик добавляет конкретный вариант
- **Звёзды** (`product_type='stars'`):
  - Слайдер количества (1…max, default 10000)
  - Динамическая цена = qty × unit_price
  - Кнопка появляется при qty > 0

---

## Этап 7. Интеграция GetGems (NFT Аренда / Покупка)

Цель: подключить внешний маркет.

- Edge function `getgems-proxy`:
  - `list-rentable` / `list-buyable` — кэш 60 сек
  - `reserve` (после оплаты) — связка с заказом
  - Обработка недоступности API (graceful fallback, статус заказа `processing` для ручной обработки)
- UI:
  - Список товаров с ценой в RUB (через `get-exchange-rate`)
  - Кнопка «Добавить» с зафиксированной ценой
  - Empty state при недоступности API
- В корзине для NFT Аренда — селектор срока аренды над товаром

**Требуется от пользователя:** API-ключ GetGems (или подтвердить, что используется их публичный API без ключа).

---

## Этап 8. Корзина, оплата, заказы, админ-контент

**8.1 Корзина:**
- Серверный `cart_items` + локальный кэш
- Edit qty / params, удаление, пересчёт суммы
- NFT Аренда: выбор срока влияет на цену
- Кнопка «Оплатить» внизу

**8.2 Оплата:**
- Использовать существующий `create-invoice` + `cryptobot-webhook` + `check-payment`
- Создание заказа со статусами по ТЗ §8.3
- Авто-сообщение пользователю после оплаты NFT Аренда (инструкция по привязке)
- Обработка сценариев ошибок (§8.4): отмена, изменение цены, недоступность API/товара

**8.3 Админ-панель** (страница `/admin`, доступ по `app_admins`):
- Контент: shop_name, marquee, баннеры, FAQ-ссылка, политика, support
- CRUD: проекты, категории, товары, варианты, цены, отзывы, шаблоны сообщений, внешние ссылки
- Просмотр заказов + смена статуса вручную
- Лог действий

---

## Технические заметки

- **Стек:** существующий (React + Vite + Tailwind + Supabase Edge Functions). Темная тема (текущая) — без изменений.
- **Маршруты:** `/`, `/p/:projectSlug`, `/p/:projectSlug/c/:categoryId`, `/product/:id`, `/cart`, `/checkout`, `/order/:id`, `/account`, `/admin/*`
- **Серверная валидация цен:** при создании заказа цены пересчитываются на бэке из БД, фронту не доверяем
- **Безопасность:** `verify_jwt=false` + проверка Telegram `initData` HMAC во всех edge-функциях
- **Логирование:** создание заказа, оплата, `/rep`, ошибки API GetGems, ошибки доставки — в `admin_log`
- **i18n:** все тексты UI в одном словаре (RU по умолчанию)

---

## Что нужно от пользователя перед стартом

1. Подтверждение, что **существующие данные products / orders можно дропнуть** (текущий «цифровой маркетплейс» уйдёт под новую структуру).
2. **API GetGems**: нужен ли ключ, или используем публичный endpoint? Дайте ссылку на доку.
3. **Telegraph-ссылка для FAQ** и **ссылка на Политику** (можно временные).
4. **Список Telegram ID администраторов** для `app_admins`.
5. Контент для seed: названия/описания/цены для FLUX (услуги), VIETO (категории мерча), CURSOR (Premium тарифы 3/6/9, варианты НФТ, цена за звезду).

---

## Порядок выполнения

Этапы идут последовательно, но **1 → 2 → 3** дают рабочий приветственный поток уже после ~30% работы. После этого можно параллелить FLUX/VIETO/CURSOR. GetGems (Этап 7) и админка (Этап 8) — в конце, т.к. зависят от всех схем.

Начинаем с Этапа 1 после ваших ответов на 5 вопросов выше.
