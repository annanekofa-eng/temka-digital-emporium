REVOKE ALL ON FUNCTION public.get_shop_ai_avatar_quota(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_shop_ai_avatar_quota(uuid) TO service_role;