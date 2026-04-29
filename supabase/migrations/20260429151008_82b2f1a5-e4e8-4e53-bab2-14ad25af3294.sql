CREATE OR REPLACE FUNCTION public.get_shop_ai_avatar_quota(p_shop_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_cycle_start timestamptz;
  v_expires timestamptz;
  v_trial timestamptz;
  v_first_paid timestamptz;
  v_created timestamptz;
  v_used int;
  v_limit int := 3;
BEGIN
  SELECT owner_id INTO v_owner_id FROM public.shops WHERE id = p_shop_id;
  IF v_owner_id IS NULL THEN
    RETURN json_build_object('limit', v_limit, 'used', 0, 'remaining', v_limit, 'cycle_start', null);
  END IF;

  SELECT subscription_expires_at, trial_started_at, first_paid_at, created_at
    INTO v_expires, v_trial, v_first_paid, v_created
    FROM public.platform_users
    WHERE id = v_owner_id;

  -- Скользящее окно: 30 дней до даты окончания подписки.
  -- Любое продление (cryptobot/баланс/админ) двигает expires_at вперёд => окно сдвигается => счётчик сбрасывается.
  IF v_expires IS NOT NULL THEN
    v_cycle_start := v_expires - interval '30 days';
  ELSE
    v_cycle_start := COALESCE(v_first_paid, v_trial, v_created, now() - interval '30 days');
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
$function$;