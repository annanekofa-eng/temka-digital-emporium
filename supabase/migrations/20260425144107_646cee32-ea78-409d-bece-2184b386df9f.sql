CREATE OR REPLACE FUNCTION public.shop_credit_referral_for_order(
  p_shop_id uuid,
  p_order_id uuid,
  p_referred_telegram_id bigint,
  p_order_amount numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_referrer_id bigint;
  v_settings RECORD;
  v_reward numeric;
  v_earning_id uuid;
BEGIN
  -- 1. Find the referrer for this customer in this shop
  SELECT referrer_telegram_id INTO v_referrer_id
  FROM shop_referrals
  WHERE shop_id = p_shop_id AND referred_telegram_id = p_referred_telegram_id;

  IF v_referrer_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- 2. Load shop referral settings
  SELECT is_enabled, reward_percent INTO v_settings
  FROM shop_referral_settings
  WHERE shop_id = p_shop_id;

  IF NOT FOUND OR NOT v_settings.is_enabled OR v_settings.reward_percent <= 0 THEN
    RETURN NULL;
  END IF;

  -- 3. Compute reward
  v_reward := ROUND(p_order_amount * v_settings.reward_percent / 100.0, 2);
  IF v_reward <= 0 THEN
    RETURN NULL;
  END IF;

  -- 4. Insert (idempotent via UNIQUE(order_id))
  INSERT INTO shop_referral_earnings (
    shop_id, order_id, referrer_telegram_id, referred_telegram_id,
    order_amount, reward_amount, reward_percent, status
  )
  VALUES (
    p_shop_id, p_order_id, v_referrer_id, p_referred_telegram_id,
    p_order_amount, v_reward, v_settings.reward_percent, 'pending'
  )
  ON CONFLICT (order_id) DO NOTHING
  RETURNING id INTO v_earning_id;

  RETURN v_earning_id;
END;
$$;