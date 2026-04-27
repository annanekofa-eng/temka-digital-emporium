-- Таблица выплат реферальных вознаграждений (платформа)
CREATE TABLE IF NOT EXISTS public.platform_referral_payouts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_telegram_id bigint NOT NULL,
  amount numeric NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'paid',
  comment text,
  provider_ref text,
  created_by_admin_telegram_id bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prp_referrer ON public.platform_referral_payouts(referrer_telegram_id);
CREATE INDEX IF NOT EXISTS idx_prp_created_at ON public.platform_referral_payouts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_prp_status ON public.platform_referral_payouts(status);

ALTER TABLE public.platform_referral_payouts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "No public access" ON public.platform_referral_payouts;
CREATE POLICY "No public access" ON public.platform_referral_payouts
  FOR ALL TO public USING (false);

DROP POLICY IF EXISTS "Service role manages platform_referral_payouts" ON public.platform_referral_payouts;
CREATE POLICY "Service role manages platform_referral_payouts" ON public.platform_referral_payouts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Атомарное создание выплаты под advisory lock
CREATE OR REPLACE FUNCTION public.platform_admin_create_referral_payout(
  p_referrer_telegram_id bigint,
  p_amount numeric,
  p_admin_telegram_id bigint,
  p_comment text DEFAULT NULL,
  p_provider_ref text DEFAULT NULL
)
RETURNS TABLE(payout_id uuid, available_after numeric)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_earned numeric := 0;
  v_total_paid numeric := 0;
  v_available numeric := 0;
  v_payout_id uuid;
BEGIN
  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Invalid amount: %', p_amount USING ERRCODE = '22023';
  END IF;

  -- Транзакционная блокировка по реферреру (предотвращает гонку)
  PERFORM pg_advisory_xact_lock(hashtextextended('ref_payout', p_referrer_telegram_id));

  SELECT COALESCE(SUM(reward_amount), 0) INTO v_total_earned
  FROM platform_referral_earnings
  WHERE referrer_telegram_id = p_referrer_telegram_id
    AND status IN ('pending', 'paid');

  SELECT COALESCE(SUM(amount), 0) INTO v_total_paid
  FROM platform_referral_payouts
  WHERE referrer_telegram_id = p_referrer_telegram_id
    AND status = 'paid';

  v_available := v_total_earned - v_total_paid;

  IF p_amount > v_available THEN
    RAISE EXCEPTION 'Amount % exceeds available % USD', p_amount, v_available USING ERRCODE = '22023';
  END IF;

  INSERT INTO platform_referral_payouts(
    referrer_telegram_id, amount, status, comment, provider_ref, created_by_admin_telegram_id
  ) VALUES (
    p_referrer_telegram_id, p_amount, 'paid', NULLIF(p_comment, ''), NULLIF(p_provider_ref, ''), p_admin_telegram_id
  )
  RETURNING id INTO v_payout_id;

  RETURN QUERY SELECT v_payout_id, (v_available - p_amount);
END;
$$;