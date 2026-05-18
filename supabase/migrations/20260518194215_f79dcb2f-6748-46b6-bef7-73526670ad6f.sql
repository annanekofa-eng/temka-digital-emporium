CREATE TABLE public.wheel_spins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL,
  prize_value integer NOT NULL,
  promo_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_wheel_spins_user_time ON public.wheel_spins (telegram_id, created_at DESC);

ALTER TABLE public.wheel_spins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access wheel_spins"
  ON public.wheel_spins FOR ALL TO public
  USING (false);

CREATE POLICY "Service role manages wheel_spins"
  ON public.wheel_spins FOR ALL TO service_role
  USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.get_wheel_status(p_telegram_id bigint)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  last_spin RECORD;
  next_at timestamptz;
BEGIN
  SELECT created_at, prize_value, promo_code
    INTO last_spin
    FROM wheel_spins
    WHERE telegram_id = p_telegram_id
    ORDER BY created_at DESC
    LIMIT 1;

  IF NOT FOUND THEN
    RETURN json_build_object('canSpin', true, 'nextSpinAt', null, 'lastPrize', null, 'lastCode', null);
  END IF;

  next_at := last_spin.created_at + interval '24 hours';
  RETURN json_build_object(
    'canSpin', now() >= next_at,
    'nextSpinAt', next_at,
    'lastPrize', last_spin.prize_value,
    'lastCode', last_spin.promo_code
  );
END;
$$;