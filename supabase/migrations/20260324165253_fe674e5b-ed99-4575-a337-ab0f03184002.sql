
-- Remove status='active' filter from public_shop_storefront view
-- The view only exposes safe columns (no tokens/owner_id), 
-- and the frontend needs to see all statuses to show proper UI screens
DROP VIEW IF EXISTS public.public_shop_storefront;

CREATE VIEW public.public_shop_storefront WITH (security_invoker = off) AS
SELECT
  id, name, slug, color, hero_title, hero_description, welcome_message,
  support_link, status, bot_username, created_at, updated_at
FROM public.shops;

GRANT SELECT ON public.public_shop_storefront TO anon, authenticated;
