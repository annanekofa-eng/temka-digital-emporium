
-- REVOKE FROM PUBLIC (default grant) on all internal SECURITY DEFINER funcs
REVOKE EXECUTE ON FUNCTION public.try_claim_promo(text, bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.release_promo(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.try_claim_wheel_spin(bigint, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.attach_wheel_promo(uuid, bigint, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_wheel_status(bigint) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.credit_balance(bigint, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.deduct_balance(bigint, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_inventory(uuid, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_promo_usage(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sync_product_stock(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.try_fulfill_pending_orders(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_promo_code(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_admin_expired() FROM PUBLIC;

-- Drop any other broad storage SELECT policy that allowed listing
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT policyname FROM pg_policies
     WHERE schemaname='storage' AND tablename='objects'
       AND cmd='SELECT'
       AND policyname NOT IN ('product-images read by path','bot-avatars read by path')
       AND policyname ILIKE '%public%'
  LOOP
    EXECUTE format('DROP POLICY %I ON storage.objects', r.policyname);
  END LOOP;
END $$;
