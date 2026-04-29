CREATE OR REPLACE FUNCTION public.get_shop_ai_avatar_quota(p_shop_id uuid)
RETURNS json
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_owner_tg bigint;
  v_cycle_start timestamptz;
  v_used int;
  v_limit int := 3;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = p_shop_id;
  IF v_owner_id IS NULL THEN
    RETURN json_build_object('limit', v_limit, 'used', 0, 'remaining', v_limit, 'cycle_start', null);
  END IF;

  SELECT telegram_id,
         COALESCE(
           (
             SELECT MAX(sp.created_at)
             FROM public.subscription_payments sp
             WHERE sp.user_id = v_owner_id
               AND sp.status = 'paid'
           ),
           first_paid_at,
           trial_started_at,
           created_at
         )
    INTO v_owner_tg, v_cycle_start
    FROM public.platform_users
    WHERE id = v_owner_id;

  IF v_cycle_start IS NULL THEN
    v_cycle_start := now() - interval '30 days';
  END IF;

  SELECT COUNT(*) INTO v_used
    FROM public.shop_ai_avatar_generations
    WHERE shop_id = p_shop_id
      AND created_at >= v_cycle_start;

  RETURN json_build_object(
    'limit', v_limit,
    'used', v_used,
    'remaining', GREATEST(0, v_limit - v_used),
    'cycle_start', v_cycle_start
  );
END;
$$;