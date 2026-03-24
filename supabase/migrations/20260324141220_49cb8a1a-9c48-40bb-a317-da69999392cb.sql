-- Security hardening: reduce public data exposure and tighten function execution rights

-- 1) Shops: remove broad public read policy, expose only safe storefront fields via a dedicated view
DROP POLICY IF EXISTS "Public reads shops for storefront" ON public.shops;
DROP POLICY IF EXISTS "Public reads active shops" ON public.shops;

CREATE VIEW public.public_shop_storefront AS
SELECT
  id,
  slug,
  name,
  hero_title,
  hero_description,
  welcome_message,
  color,
  support_link,
  status,
  bot_username,
  created_at,
  updated_at
FROM public.shops;

GRANT SELECT ON public.public_shop_storefront TO anon, authenticated;

-- 2) Shop settings: remove broad public reads, allow only safe keys
DROP POLICY IF EXISTS "Shop settings publicly readable" ON public.shop_settings;

CREATE POLICY "Public reads safe shop settings"
  ON public.shop_settings
  FOR SELECT TO public
  USING (key IN ('support_username', 'shop_name', 'currency'));

-- 3) Restrict EXECUTE on privileged RPC functions by default
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM authenticated;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

-- 4) Allow only explicitly required client-side RPCs
GRANT EXECUTE ON FUNCTION public.validate_promo_code(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.validate_shop_promo_code(uuid, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_shop_payments_configured(uuid) TO anon, authenticated;