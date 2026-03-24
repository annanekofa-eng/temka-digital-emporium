-- The public_shop_storefront view with security_invoker needs anon to read shops
-- Add a minimal read policy back (the view already limits columns)
CREATE POLICY "Anon reads shops via storefront view"
  ON public.shops
  FOR SELECT TO anon, authenticated
  USING (true);