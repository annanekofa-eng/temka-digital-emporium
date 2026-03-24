
-- Allow anon/authenticated to read approved reviews through the view
CREATE POLICY "Anon reads approved reviews"
ON public.reviews
FOR SELECT
TO anon, authenticated
USING (verified = true AND moderation_status = 'approved');

CREATE POLICY "Anon reads approved shop_reviews"
ON public.shop_reviews
FOR SELECT
TO anon, authenticated
USING (verified = true AND moderation_status = 'approved');
