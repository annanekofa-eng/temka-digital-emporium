-- Реферальные настройки магазина
CREATE TABLE public.shop_referral_settings (
  shop_id uuid PRIMARY KEY,
  is_enabled boolean NOT NULL DEFAULT true,
  reward_percent numeric NOT NULL DEFAULT 10 CHECK (reward_percent >= 0 AND reward_percent <= 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.shop_referral_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access" ON public.shop_referral_settings
  FOR ALL TO public USING (false);

CREATE POLICY "Service role manages shop_referral_settings" ON public.shop_referral_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Реферальные связи: кто кого пригласил в конкретном магазине
CREATE TABLE public.shop_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  referrer_telegram_id bigint NOT NULL,
  referred_telegram_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (shop_id, referred_telegram_id),
  CHECK (referrer_telegram_id <> referred_telegram_id)
);

CREATE INDEX idx_shop_referrals_shop_referrer ON public.shop_referrals (shop_id, referrer_telegram_id);
CREATE INDEX idx_shop_referrals_shop_referred ON public.shop_referrals (shop_id, referred_telegram_id);

ALTER TABLE public.shop_referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access" ON public.shop_referrals
  FOR ALL TO public USING (false);

CREATE POLICY "Service role manages shop_referrals" ON public.shop_referrals
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Начисления по реферальной программе (одно начисление на заказ)
CREATE TABLE public.shop_referral_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  order_id uuid NOT NULL UNIQUE,
  referrer_telegram_id bigint NOT NULL,
  referred_telegram_id bigint NOT NULL,
  order_amount numeric NOT NULL DEFAULT 0,
  reward_amount numeric NOT NULL DEFAULT 0,
  reward_percent numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending', -- pending|paid
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_shop_ref_earnings_shop_referrer ON public.shop_referral_earnings (shop_id, referrer_telegram_id);
CREATE INDEX idx_shop_ref_earnings_shop_status ON public.shop_referral_earnings (shop_id, status);

ALTER TABLE public.shop_referral_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access" ON public.shop_referral_earnings
  FOR ALL TO public USING (false);

CREATE POLICY "Service role manages shop_referral_earnings" ON public.shop_referral_earnings
  FOR ALL TO service_role USING (true) WITH CHECK (true);