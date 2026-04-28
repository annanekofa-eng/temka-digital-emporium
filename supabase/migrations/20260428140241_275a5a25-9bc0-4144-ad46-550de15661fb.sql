
CREATE OR REPLACE FUNCTION public.shop_has_premium_features(p_shop_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_plan text;
  v_status text;
  v_expires timestamptz;
BEGIN
  SELECT owner_id INTO v_owner FROM public.shops WHERE id = p_shop_id;
  IF v_owner IS NULL THEN RETURN false; END IF;

  SELECT subscription_plan, subscription_status, subscription_expires_at
  INTO v_plan, v_status, v_expires
  FROM public.platform_users WHERE id = v_owner;

  IF v_plan IS NULL THEN RETURN false; END IF;
  IF v_status NOT IN ('active','trial','grace_period') THEN RETURN false; END IF;
  IF v_expires IS NOT NULL AND v_expires < now() THEN RETURN false; END IF;
  RETURN v_plan = 'premium';
END;
$$;

REVOKE ALL ON FUNCTION public.shop_has_premium_features(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.shop_has_premium_features(uuid) TO anon, authenticated, service_role;
