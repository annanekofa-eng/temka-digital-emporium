-- ─── PLATFORM REFERRAL SYSTEM ──────────────────────────────────
-- Mirrors the per-shop referral logic but for the platform-level subscription.

-- 1. Global settings (singleton row id=1)
CREATE TABLE IF NOT EXISTS public.platform_referral_settings (
  id integer PRIMARY KEY CHECK (id = 1),
  is_enabled boolean NOT NULL DEFAULT true,
  reward_percent numeric NOT NULL DEFAULT 10,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.platform_referral_settings (id, is_enabled, reward_percent)
VALUES (1, true, 10)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.platform_referral_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access"
  ON public.platform_referral_settings FOR ALL TO public USING (false);

CREATE POLICY "Service role manages platform_referral_settings"
  ON public.platform_referral_settings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 2. Referral links (who invited whom)
CREATE TABLE IF NOT EXISTS public.platform_referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_telegram_id bigint NOT NULL,
  referred_telegram_id bigint NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_platform_referrals_referrer
  ON public.platform_referrals (referrer_telegram_id);

ALTER TABLE public.platform_referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access"
  ON public.platform_referrals FOR ALL TO public USING (false);

CREATE POLICY "Service role manages platform_referrals"
  ON public.platform_referrals FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 3. Earnings — one row per subscription payment (idempotent via UNIQUE)
CREATE TABLE IF NOT EXISTS public.platform_referral_earnings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_payment_id uuid NOT NULL UNIQUE,
  referrer_telegram_id bigint NOT NULL,
  referred_telegram_id bigint NOT NULL,
  payment_amount numeric NOT NULL DEFAULT 0,
  reward_amount numeric NOT NULL DEFAULT 0,
  reward_percent numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_platform_referral_earnings_referrer
  ON public.platform_referral_earnings (referrer_telegram_id);

CREATE INDEX IF NOT EXISTS idx_platform_referral_earnings_status
  ON public.platform_referral_earnings (status);

ALTER TABLE public.platform_referral_earnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access"
  ON public.platform_referral_earnings FOR ALL TO public USING (false);

CREATE POLICY "Service role manages platform_referral_earnings"
  ON public.platform_referral_earnings FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- 4. Atomic credit RPC — idempotent via UNIQUE(subscription_payment_id)
CREATE OR REPLACE FUNCTION public.platform_credit_referral_for_subscription(
  p_subscription_payment_id uuid,
  p_referred_telegram_id bigint,
  p_payment_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_referrer_id bigint;
  v_settings RECORD;
  v_reward numeric;
  v_earning_id uuid;
BEGIN
  -- Find the referrer for this user
  SELECT referrer_telegram_id INTO v_referrer_id
  FROM platform_referrals
  WHERE referred_telegram_id = p_referred_telegram_id;

  IF v_referrer_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Load global settings
  SELECT is_enabled, reward_percent INTO v_settings
  FROM platform_referral_settings WHERE id = 1;

  IF NOT FOUND OR NOT v_settings.is_enabled OR v_settings.reward_percent <= 0 THEN
    RETURN NULL;
  END IF;

  -- Compute reward
  v_reward := ROUND(p_payment_amount * v_settings.reward_percent / 100.0, 2);
  IF v_reward <= 0 THEN
    RETURN NULL;
  END IF;

  -- Insert (idempotent via UNIQUE on subscription_payment_id)
  INSERT INTO platform_referral_earnings (
    subscription_payment_id, referrer_telegram_id, referred_telegram_id,
    payment_amount, reward_amount, reward_percent, status
  )
  VALUES (
    p_subscription_payment_id, v_referrer_id, p_referred_telegram_id,
    p_payment_amount, v_reward, v_settings.reward_percent, 'pending'
  )
  ON CONFLICT (subscription_payment_id) DO NOTHING
  RETURNING id INTO v_earning_id;

  RETURN v_earning_id;
END;
$$;