
-- 1. Drop anon SELECT policies on reviews and shop_reviews (fixes PII leak of telegram_id)
DROP POLICY IF EXISTS "Anon reads approved reviews" ON public.reviews;
DROP POLICY IF EXISTS "Anon reads approved shop_reviews" ON public.shop_reviews;

-- 2. Recreate public_reviews as SECURITY INVOKER=off (i.e. definer) view
DROP VIEW IF EXISTS public.public_reviews;
CREATE VIEW public.public_reviews WITH (security_invoker = off) AS
SELECT id, product_id, author, avatar, rating, text, verified, moderation_status, created_at
FROM public.reviews
WHERE verified = true AND moderation_status = 'approved';

-- 3. Recreate public_shop_reviews as SECURITY INVOKER=off view
DROP VIEW IF EXISTS public.public_shop_reviews;
CREATE VIEW public.public_shop_reviews WITH (security_invoker = off) AS
SELECT id, shop_id, product_id, author, avatar, rating, text, verified, moderation_status, created_at
FROM public.shop_reviews
WHERE verified = true AND moderation_status = 'approved';

-- 4. Grant SELECT on views to anon and authenticated roles
GRANT SELECT ON public.public_reviews TO anon, authenticated;
GRANT SELECT ON public.public_shop_reviews TO anon, authenticated;
