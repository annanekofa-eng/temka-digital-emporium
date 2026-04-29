CREATE OR REPLACE FUNCTION public.get_shop_ai_avatar_quota(p_shop_id uuid)
 RETURNS json
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner_id uuid;
  v_cycle_start timestamptz;
  v_last_payment timestamptz;
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

  SELECT trial_started_at, first_paid_at, created_at
    INTO v_trial, v_first_paid, v_created
    FROM public.platform_users
    WHERE id = v_owner_id;

  -- Дата последнего успешного платежа (продление через CryptoBot/баланс)
  SELECT MAX(created_at) INTO v_last_payment
    FROM public.subscription_payments
    WHERE user_id = v_owner_id AND status = 'paid';

  -- Начало текущего цикла = последний платёж ИЛИ начало триала ИЛИ создание аккаунта.
  -- Это даёт корректный отсчёт уже сделанных генераций в текущем оплаченном периоде.
  -- При следующем платеже v_last_payment сдвинется вперёд и счётчик автоматически сбросится.
  v_cycle_start := COALESCE(v_last_payment, v_trial, v_first_paid, v_created, now() - interval '30 days');

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