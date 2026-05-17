
REVOKE EXECUTE ON FUNCTION public.deduct_balance(bigint, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.credit_balance(bigint, numeric) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.increment_promo_usage(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.reserve_inventory(uuid, integer, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.validate_promo_code(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.cleanup_admin_expired() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deduct_balance(bigint, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.credit_balance(bigint, numeric) TO service_role;
GRANT EXECUTE ON FUNCTION public.increment_promo_usage(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.reserve_inventory(uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.validate_promo_code(text) TO service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_admin_expired() TO service_role;
