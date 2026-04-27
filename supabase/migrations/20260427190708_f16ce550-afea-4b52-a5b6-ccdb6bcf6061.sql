-- Настройки авто-товаров для каждого магазина
CREATE TABLE public.shop_auto_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  product_type text NOT NULL CHECK (product_type IN ('telegram_premium', 'telegram_stars')),
  is_enabled boolean NOT NULL DEFAULT false,
  -- Premium: цены за 3/6/12 месяцев в USD
  price_3m numeric,
  price_6m numeric,
  price_12m numeric,
  -- Stars: цена за 1 star в USD + min/max количество
  price_per_star numeric,
  min_stars integer DEFAULT 50,
  max_stars integer DEFAULT 100000,
  -- Кастомизация
  label text DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shop_id, product_type)
);

ALTER TABLE public.shop_auto_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access" ON public.shop_auto_products FOR ALL USING (false);
CREATE POLICY "Service role manages shop_auto_products" ON public.shop_auto_products
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Публичное чтение включенных авто-товаров активных магазинов
CREATE POLICY "Public reads enabled auto products" ON public.shop_auto_products
  FOR SELECT TO anon, authenticated
  USING (is_enabled = true AND public.is_shop_active(shop_id));

CREATE INDEX idx_shop_auto_products_shop ON public.shop_auto_products(shop_id);

-- Расширение shop_orders для авто-товаров
ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS product_type text,
  ADD COLUMN IF NOT EXISTS target_user text,
  ADD COLUMN IF NOT EXISTS premium_duration text,
  ADD COLUMN IF NOT EXISTS stars_amount integer,
  ADD COLUMN IF NOT EXISTS fulfillment_status text DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS fulfillment_comment text,
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfilled_by_telegram_id bigint;

CREATE INDEX IF NOT EXISTS idx_shop_orders_product_type ON public.shop_orders(shop_id, product_type) WHERE product_type IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_shop_orders_fulfillment ON public.shop_orders(shop_id, fulfillment_status) WHERE product_type IS NOT NULL;