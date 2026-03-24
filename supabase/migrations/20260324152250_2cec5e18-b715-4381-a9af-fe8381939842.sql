
-- 1) Fix shops RLS: restrict anon SELECT to safe columns only via the view
-- Drop the overly permissive policy
DROP POLICY IF EXISTS "Anon reads shops via storefront view" ON public.shops;

-- 2) Sanitize existing photo_url fields that contain bot token URLs
UPDATE public.user_profiles SET photo_url = NULL WHERE photo_url ILIKE 'https://api.telegram.org/file/bot%';
UPDATE public.shop_customers SET photo_url = NULL WHERE photo_url ILIKE 'https://api.telegram.org/file/bot%';
UPDATE public.platform_users SET photo_url = NULL WHERE photo_url ILIKE 'https://api.telegram.org/file/bot%';
