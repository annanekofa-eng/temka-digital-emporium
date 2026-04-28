
CREATE TABLE IF NOT EXISTS public.shop_ai_avatar_generations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL REFERENCES public.shops(id) ON DELETE CASCADE,
  owner_telegram_id bigint NOT NULL,
  prompt text NOT NULL,
  parent_id uuid REFERENCES public.shop_ai_avatar_generations(id) ON DELETE SET NULL,
  image_url text,
  subscription_cycle_start timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_ai_avatar_gen_shop ON public.shop_ai_avatar_generations(shop_id, subscription_cycle_start);
CREATE INDEX IF NOT EXISTS idx_shop_ai_avatar_gen_owner ON public.shop_ai_avatar_generations(owner_telegram_id, subscription_cycle_start);

ALTER TABLE public.shop_ai_avatar_generations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access shop_ai_avatar_generations" ON public.shop_ai_avatar_generations
  FOR ALL USING (false);
CREATE POLICY "Service role manages shop_ai_avatar_generations" ON public.shop_ai_avatar_generations
  FOR ALL TO service_role USING (true) WITH CHECK (true);

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
  SELECT owner_id INTO v_owner_id FROM shops WHERE id = p_shop_id;
  IF v_owner_id IS NULL THEN
    RETURN json_build_object('limit', v_limit, 'used', 0, 'remaining', v_limit, 'cycle_start', null);
  END IF;
  SELECT telegram_id, COALESCE(last_payment_at, first_paid_at, trial_started_at, created_at)
    INTO v_owner_tg, v_cycle_start
    FROM platform_users WHERE id = v_owner_id;
  IF v_cycle_start IS NULL THEN v_cycle_start := now() - interval '30 days'; END IF;

  SELECT COUNT(*) INTO v_used
    FROM shop_ai_avatar_generations
    WHERE shop_id = p_shop_id AND created_at >= v_cycle_start;

  RETURN json_build_object(
    'limit', v_limit,
    'used', v_used,
    'remaining', GREATEST(0, v_limit - v_used),
    'cycle_start', v_cycle_start
  );
END;
$$;
