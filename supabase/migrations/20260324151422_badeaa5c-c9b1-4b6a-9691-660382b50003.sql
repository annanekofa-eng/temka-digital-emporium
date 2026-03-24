
-- 1) Sanitize avatar URLs that contain bot file paths (token leakage)
UPDATE public.reviews
SET avatar = ''
WHERE avatar ILIKE 'https://api.telegram.org/file/bot%';

UPDATE public.shop_reviews
SET avatar = ''
WHERE avatar ILIKE 'https://api.telegram.org/file/bot%';

-- 2) Recreate public views with strict server-side filters
DROP VIEW IF EXISTS public.public_reviews;

CREATE VIEW public.public_reviews AS
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

CREATE VIEW public.public_shop_reviews AS
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
