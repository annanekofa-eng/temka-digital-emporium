
-- Fix security definer views by setting security_invoker = on
DROP VIEW IF EXISTS public.public_reviews;

CREATE VIEW public.public_reviews
WITH (security_invoker = on) AS
SELECT
  id,
  product_id,
  author,
  avatar,
  rating,
  text,
  verified,
  moderation_status,
  created_at
FROM public.reviews
WHERE verified = true
  AND moderation_status = 'approved';

GRANT SELECT ON public.public_reviews TO anon, authenticated;

DROP VIEW IF EXISTS public.public_shop_reviews;

CREATE VIEW public.public_shop_reviews
WITH (security_invoker = on) AS
SELECT
  id,
  shop_id,
  product_id,
  author,
  avatar,
  rating,
  text,
  verified,
  moderation_status,
  created_at
FROM public.shop_reviews
WHERE verified = true
  AND moderation_status = 'approved';

GRANT SELECT ON public.public_shop_reviews TO anon, authenticated;
