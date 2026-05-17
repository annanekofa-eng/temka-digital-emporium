
REVOKE EXECUTE ON FUNCTION public.deduct_balance(bigint, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.credit_balance(bigint, numeric) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.increment_promo_usage(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_inventory(uuid, integer, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.validate_promo_code(text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.cleanup_admin_expired() FROM anon, authenticated;
