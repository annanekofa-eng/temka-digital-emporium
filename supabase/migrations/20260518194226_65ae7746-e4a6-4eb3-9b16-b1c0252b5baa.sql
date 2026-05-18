REVOKE EXECUTE ON FUNCTION public.get_wheel_status(bigint) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_wheel_status(bigint) TO service_role;