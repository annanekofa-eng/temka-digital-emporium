
-- ============================================
-- 1. PROJECTS
-- ============================================
CREATE TABLE public.projects (
  id text PRIMARY KEY,
  title text NOT NULL,
  subtitle text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  banner text,
  icon text NOT NULL DEFAULT '✨',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Projects are publicly readable" ON public.projects FOR SELECT USING (is_active = true);

-- ============================================
-- 2. EXTEND categories
-- ============================================
ALTER TABLE public.categories
  ADD COLUMN project_id text REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD COLUMN parent_id text REFERENCES public.categories(id) ON DELETE CASCADE;
CREATE INDEX idx_categories_project ON public.categories(project_id);

-- ============================================
-- 3. EXTEND products
-- ============================================
ALTER TABLE public.products
  ADD COLUMN project_id text REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD COLUMN product_type text NOT NULL DEFAULT 'simple',
  ADD COLUMN external_link text,
  ADD COLUMN gallery jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN min_qty integer NOT NULL DEFAULT 1,
  ADD COLUMN max_qty integer NOT NULL DEFAULT 10000,
  ADD COLUMN term_options jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN nft_variants jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE INDEX idx_products_project ON public.products(project_id);
CREATE INDEX idx_products_type ON public.products(product_type);

-- ============================================
-- 4. EXTEND orders / order_items
-- ============================================
ALTER TABLE public.orders
  ADD COLUMN project_id text REFERENCES public.projects(id),
  ADD COLUMN external_ref text;

ALTER TABLE public.order_items
  ADD COLUMN params jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN external_payload jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ============================================
-- 5. CART_ITEMS
-- ============================================
CREATE TABLE public.cart_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  product_title text NOT NULL,
  product_type text NOT NULL DEFAULT 'simple',
  unit_price numeric NOT NULL,
  qty integer NOT NULL DEFAULT 1,
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cart_items_user ON public.cart_items(telegram_id);
ALTER TABLE public.cart_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access cart" ON public.cart_items FOR ALL USING (false);
CREATE POLICY "Service role manages cart" ON public.cart_items FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 6. SITE_SETTINGS
-- ============================================
CREATE TABLE public.site_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Site settings are publicly readable" ON public.site_settings FOR SELECT USING (true);
CREATE POLICY "Service role manages site_settings" ON public.site_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 7. MESSAGE_TEMPLATES
-- ============================================
CREATE TABLE public.message_templates (
  key text PRIMARY KEY,
  title text NOT NULL DEFAULT '',
  body text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Templates publicly readable" ON public.message_templates FOR SELECT USING (is_active = true);
CREATE POLICY "Service role manages message_templates" ON public.message_templates FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 8. ADMIN_LOG
-- ============================================
CREATE TABLE public.admin_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_telegram_id bigint NOT NULL,
  action text NOT NULL,
  target text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_admin_log_admin ON public.admin_log(admin_telegram_id);
CREATE INDEX idx_admin_log_created ON public.admin_log(created_at DESC);
ALTER TABLE public.admin_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access admin_log" ON public.admin_log FOR ALL USING (false);
CREATE POLICY "Service role manages admin_log" ON public.admin_log FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ============================================
-- 9. SEED
-- ============================================
INSERT INTO public.projects (id, title, subtitle, description, icon, sort_order) VALUES
  ('flux',   'FLUX',   'Дизайн и креатив',  'Кастомные дизайны, графика, брендинг и креативные услуги под ключ.', '🎨', 1),
  ('vieto',  'VIETO',  'Стрит-мерч',        'Лимитированный мерч в собственном стиле — футболки, худи, аксессуары.', '👕', 2),
  ('cursor', 'CURSOR', 'Цифровые товары',   'Подписки, NFT-товары, звёзды Telegram и аренда NFT-юзернеймов.', '🪙', 3);

INSERT INTO public.categories (id, name, description, icon, sort_order, project_id) VALUES
  ('vieto-tshirts', 'Футболки', 'Базовые и оверсайз', '👕', 1, 'vieto'),
  ('vieto-hoodies', 'Худи',     'Тёплые и плотные',   '🧥', 2, 'vieto'),
  ('vieto-caps',    'Кепки',    'Стрит-аксессуары',   '🧢', 3, 'vieto');

-- FLUX (simple)
INSERT INTO public.products (project_id, product_type, title, subtitle, description, price, stock, sort_order) VALUES
  ('flux', 'simple', 'Логотип «Минимал»',           'Минималистичный логотип',     'Чистый лаконичный знак + типографика. До 3 концептов.',  50,  999, 1),
  ('flux', 'simple', 'Брендинг под ключ',            'Логотип, гайдлайн, визитки',  'Полный пакет фирменного стиля.',                         350, 999, 2),
  ('flux', 'simple', 'Обложка для Telegram-канала',  'Дизайн обложки + аватар',     'Стильная обложка и аватар в едином стиле.',              30,  999, 3),
  ('flux', 'simple', 'Постер A2',                    'Авторский цифровой постер',   'Цифровой принт высокого разрешения.',                    25,  999, 4);

-- VIETO (simple, по категориям)
INSERT INTO public.products (project_id, category_id, product_type, title, subtitle, description, price, stock, sort_order) VALUES
  ('vieto', 'vieto-tshirts', 'simple', 'Футболка «Static»',  'Хлопок 220 г', 'Оверсайз, чёрный.',  35, 50, 1),
  ('vieto', 'vieto-tshirts', 'simple', 'Футболка «Noise»',   'Хлопок 220 г', 'Графика на спине.',  40, 30, 2),
  ('vieto', 'vieto-hoodies', 'simple', 'Худи «Heavy»',       'Хлопок 360 г', 'Тяжёлый худи.',      85, 20, 1),
  ('vieto', 'vieto-caps',    'simple', 'Кепка «Logo»',       'Регулируемая', 'С вышивкой.',        25, 40, 1);

-- CURSOR Premium
INSERT INTO public.products (project_id, product_type, title, subtitle, description, price, stock, sort_order, term_options) VALUES
  ('cursor', 'premium_term', 'Telegram Premium', 'Подписка', 'Активация Telegram Premium на выбранный срок.', 0, 999, 1,
   '[{"months":3,"price":12},{"months":6,"price":22},{"months":9,"price":30}]'::jsonb);

-- CURSOR НФТ
INSERT INTO public.products (project_id, product_type, title, subtitle, description, price, stock, sort_order, nft_variants) VALUES
  ('cursor', 'nft_variant', 'НФТ Подарки', 'Коллекционные подарки', 'Выберите вариант коллекционного NFT-подарка.', 0, 999, 2,
   '[{"key":"plush_pepe","label":"Plush Pepe","price":120},{"key":"signet_ring","label":"Signet Ring","price":85},{"key":"durov_cap","label":"Durov''s Cap","price":210}]'::jsonb);

-- CURSOR Stars
INSERT INTO public.products (project_id, product_type, title, subtitle, description, price, stock, sort_order, min_qty, max_qty) VALUES
  ('cursor', 'stars', 'Telegram Stars', 'Звёзды Telegram', 'Покупка звёзд Telegram по выгодному курсу.', 0.015, 999999, 3, 50, 10000);

-- CURSOR NFT Rent / Buy
INSERT INTO public.products (project_id, product_type, title, subtitle, description, price, stock, sort_order) VALUES
  ('cursor', 'nft_rent', 'NFT Аренда',   'Аренда юзернеймов и подарков', 'Список доступных NFT для аренды через GetGems.', 0, 999, 4),
  ('cursor', 'nft_buy',  'NFT Покупка',  'Покупка NFT-подарков',         'Список доступных NFT для покупки через GetGems.', 0, 999, 5);

INSERT INTO public.site_settings (key, value) VALUES
  ('shop_name',        'TEMKA SHOP'),
  ('marquee_text',     '🔥 Распродажа · NFT-подарки -20% · Premium 9 мес со скидкой · Доставка моментально'),
  ('welcome_text',     '👋 Добро пожаловать в TEMKA SHOP! Цифровые товары, мерч и NFT — всё в одном месте. Жми кнопку ниже, чтобы открыть магазин 👇'),
  ('faq_url',          'https://telegra.ph/FAQ-temka-shop-01-01'),
  ('policy_url',       'https://telegra.ph/Politika-konfidencialnosti-01-01'),
  ('support_username', 'support');

INSERT INTO public.message_templates (key, title, body) VALUES
  ('rep_default',
   'Шаблон /rep',
   E'✅ Ваш заказ {{order_number}} успешно обработан.\n\nЕсли возникнут вопросы — пишите в поддержку: @{{support}}'),
  ('nft_rent_instruction',
   'Инструкция NFT Аренда',
   E'🎁 Аренда NFT по заказу {{order_number}} оформлена.\n\nДля привязки откройте мини-апп → Профиль → История → Заказ.');
