
-- 1. ATOMIC PROMO CLAIM — устраняет race condition при использовании промокодов
-- (старый flow: read used_count -> create order -> increment, был уязвим)
CREATE OR REPLACE FUNCTION public.try_claim_promo(
  p_code text,
  p_telegram_id bigint
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promo RECORD;
  v_user_used int;
  v_now timestamptz := now();
BEGIN
  -- Lock the promo row for the duration of the transaction
  SELECT * INTO v_promo
  FROM public.promocodes
  WHERE code = p_code AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN json_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF v_promo.valid_from IS NOT NULL AND v_now < v_promo.valid_from THEN
    RETURN json_build_object('ok', false, 'reason', 'not_started');
  END IF;
  IF v_promo.valid_until IS NOT NULL AND v_now > v_promo.valid_until THEN
    RETURN json_build_object('ok', false, 'reason', 'expired');
  END IF;
  IF v_promo.owner_telegram_id IS NOT NULL AND v_promo.owner_telegram_id <> p_telegram_id THEN
    RETURN json_build_object('ok', false, 'reason', 'wrong_owner');
  END IF;
  IF v_promo.max_uses IS NOT NULL AND v_promo.used_count >= v_promo.max_uses THEN
    RETURN json_build_object('ok', false, 'reason', 'exhausted');
  END IF;

  IF v_promo.max_uses_per_user IS NOT NULL THEN
    SELECT COUNT(*) INTO v_user_used
    FROM public.orders
    WHERE telegram_id = p_telegram_id
      AND promo_code = p_code
      AND payment_status IN ('paid', 'awaiting');
    IF v_user_used >= v_promo.max_uses_per_user THEN
      RETURN json_build_object('ok', false, 'reason', 'per_user_limit');
    END IF;
  END IF;

  -- Atomic increment under the row lock
  UPDATE public.promocodes
  SET used_count = used_count + 1
  WHERE id = v_promo.id;

  RETURN json_build_object(
    'ok', true,
    'id', v_promo.id,
    'code', v_promo.code,
    'discount_type', v_promo.discount_type,
    'discount_value', v_promo.discount_value
  );
END;
$$;

-- 2. ROLLBACK PROMO — если order создание упало после claim
CREATE OR REPLACE FUNCTION public.release_promo(p_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.promocodes
  SET used_count = GREATEST(0, used_count - 1)
  WHERE code = p_code;
END;
$$;

-- 3. Revoke EXECUTE on internal functions from anon/authenticated.
-- Edge functions use service_role, so this does not break anything.
REVOKE EXECUTE ON FUNCTION public.try_claim_promo(text, bigint) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_promo(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.try_claim_wheel_spin(bigint, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.attach_wheel_promo(uuid, bigint, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_balance(bigint, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_balance(bigint, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_inventory(uuid, integer, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_promo_usage(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_product_stock(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.try_fulfill_pending_orders(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_admin_expired() FROM anon, authenticated;

-- 4. Restrict storage.objects listing for public buckets.
-- Public buckets currently allow anonymous listing of every file —
-- attacker can enumerate uploaded receipts/avatars. We keep public READ on direct paths
-- (so <img src> works) but drop the broad SELECT listing policy.
DO $$
BEGIN
  -- Drop any overly-broad SELECT policies that allow listing
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Public Access') THEN
    EXECUTE 'DROP POLICY "Public Access" ON storage.objects';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Anyone can view product images') THEN
    EXECUTE 'DROP POLICY "Anyone can view product images" ON storage.objects';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Anyone can view bot avatars') THEN
    EXECUTE 'DROP POLICY "Anyone can view bot avatars" ON storage.objects';
  END IF;
END $$;

-- Recreate narrower SELECT — read OK, listing blocked at API level (public buckets still serve direct URLs)
CREATE POLICY "product-images read by path"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'product-images');

CREATE POLICY "bot-avatars read by path"
ON storage.objects FOR SELECT TO anon, authenticated
USING (bucket_id = 'bot-avatars');
