
ALTER TABLE public.promocodes
  ADD COLUMN IF NOT EXISTS owner_telegram_id bigint;

CREATE INDEX IF NOT EXISTS idx_promocodes_owner ON public.promocodes (owner_telegram_id) WHERE owner_telegram_id IS NOT NULL;

-- Atomic spin claim: returns ok=true with spin_id on success, ok=false with next_at on cooldown.
CREATE OR REPLACE FUNCTION public.try_claim_wheel_spin(p_telegram_id bigint, p_prize integer)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_last timestamptz;
  v_spin_id uuid;
BEGIN
  -- Per-user transactional lock prevents concurrent races
  PERFORM pg_advisory_xact_lock(hashtextextended('wheel_spin:' || p_telegram_id::text, 0));

  SELECT created_at INTO v_last
    FROM public.wheel_spins
    WHERE telegram_id = p_telegram_id
    ORDER BY created_at DESC
    LIMIT 1;

  IF v_last IS NOT NULL AND v_last + interval '24 hours' > now() THEN
    RETURN json_build_object('ok', false, 'nextSpinAt', v_last + interval '24 hours');
  END IF;

  INSERT INTO public.wheel_spins(telegram_id, prize_value)
    VALUES (p_telegram_id, p_prize)
    RETURNING id INTO v_spin_id;

  RETURN json_build_object('ok', true, 'spinId', v_spin_id, 'nextSpinAt', now() + interval '24 hours');
END;
$$;

REVOKE EXECUTE ON FUNCTION public.try_claim_wheel_spin(bigint, integer) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.try_claim_wheel_spin(bigint, integer) TO service_role;

-- Attach promo code to an already-claimed spin
CREATE OR REPLACE FUNCTION public.attach_wheel_promo(p_spin_id uuid, p_telegram_id bigint, p_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.wheel_spins
    SET promo_code = p_code
    WHERE id = p_spin_id AND telegram_id = p_telegram_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.attach_wheel_promo(uuid, bigint, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attach_wheel_promo(uuid, bigint, text) TO service_role;
