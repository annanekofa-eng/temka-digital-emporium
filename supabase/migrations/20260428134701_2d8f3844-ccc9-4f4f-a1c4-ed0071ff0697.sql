REVOKE EXECUTE ON FUNCTION public.has_entitlement(bigint, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.has_entitlement(bigint, text) TO service_role;