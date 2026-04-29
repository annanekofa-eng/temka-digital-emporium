CREATE OR REPLACE FUNCTION public.get_shop_ai_avatar_quota(p_shop_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_owner_tg bigint;
  v_cycle_start timestamptz;
  v_last_payment timestamptz;
  v_last_admin_action timestamptz;
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

  SELECT telegram_id, trial_started_at, first_paid_at, created_at
    INTO v_owner_tg, v_trial, v_first_paid, v_created
    FROM public.platform_users
    WHERE id = v_owner_id;

  -- Последний клиентский платёж
  SELECT MAX(created_at) INTO v_last_payment
    FROM public.subscription_payments
    WHERE user_id = v_owner_id AND status = 'paid';

  -- Последнее админское продление/активация (для случая ручной выдачи периода админом)
  SELECT MAX(created_at) INTO v_last_admin_action
    FROM public.admin_logs
    WHERE entity_type = 'user'
      AND entity_id = v_owner_tg::text
      AND action IN ('extend_subscription', 'activate_subscription', 'grant_free_period', 'change_subscription_plan');

  -- Начало цикла = самая поздняя из дат: платёж, админское действие, триал, первый платёж, создание.
  v_cycle_start := GREATEST(
    COALESCE(v_last_payment, '-infinity'::timestamptz),
    COALESCE(v_last_admin_action, '-infinity'::timestamptz),
    COALESCE(v_trial, '-infinity'::timestamptz),
    COALESCE(v_first_paid, '-infinity'::timestamptz),
    COALESCE(v_created, '-infinity'::timestamptz)
  );

  IF v_cycle_start = '-infinity'::timestamptz THEN
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
$function$;