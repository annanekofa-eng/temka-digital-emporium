
-- Create shop_payment_methods table
CREATE TABLE public.shop_payment_methods (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  method text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  config_encrypted text,
  config_masked jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(shop_id, method)
);

ALTER TABLE public.shop_payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access to shop_payment_methods"
  ON public.shop_payment_methods
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Create shop_payment_requests table
CREATE TABLE public.shop_payment_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES public.shop_orders(id) ON DELETE CASCADE,
  buyer_telegram_id bigint NOT NULL,
  payment_method text NOT NULL DEFAULT 'sbp_card',
  amount_usd numeric NOT NULL DEFAULT 0,
  amount_rub numeric,
  status text NOT NULL DEFAULT 'pending',
  receipt_url text,
  receipt_path text,
  receipt_mime text,
  note text,
  rejection_reason text,
  reviewed_by_telegram_id bigint,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shop_payment_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access to shop_payment_requests"
  ON public.shop_payment_requests
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Add price_input columns to shop_products (for RUB price tracking)
ALTER TABLE public.shop_products ADD COLUMN IF NOT EXISTS price_input_currency text DEFAULT 'usd';
ALTER TABLE public.shop_products ADD COLUMN IF NOT EXISTS price_input_value numeric;
ALTER TABLE public.shop_products ADD COLUMN IF NOT EXISTS price_input_rate numeric;
ALTER TABLE public.shop_products ADD COLUMN IF NOT EXISTS price_converted_at timestamptz;
