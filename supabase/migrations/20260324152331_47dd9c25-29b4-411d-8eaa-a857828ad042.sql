
-- Recreate public_shop_storefront as SECURITY DEFINER (default) so anon can read through it
-- The view only exposes safe columns — no tokens, no owner_id
DROP VIEW IF EXISTS public.public_shop_storefront;

CREATE VIEW public.public_shop_storefront AS
SELECT
  id, name, slug, color, hero_title, hero_description, welcome_message,
  support_link, status, bot_username, created_at, updated_at
FROM public.shops
WHERE status = 'active';

GRANT SELECT ON public.public_shop_storefront TO anon, authenticated;
