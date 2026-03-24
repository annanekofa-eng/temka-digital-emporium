
-- Fix shop_products and shop_categories RLS policies that depend on shops table
-- Since anon can no longer read shops directly, we need SECURITY DEFINER functions

CREATE OR REPLACE FUNCTION public.is_shop_active(p_shop_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM shops WHERE id = p_shop_id AND status = 'active'
  );
$$;

-- Replace shop_products policy
DROP POLICY IF EXISTS "Public reads active products" ON public.shop_products;
CREATE POLICY "Public reads active products"
ON public.shop_products
FOR SELECT
TO anon, authenticated
USING (is_active = true AND public.is_shop_active(shop_id));

-- Replace shop_categories policy
DROP POLICY IF EXISTS "Public reads active shop_categories" ON public.shop_categories;
CREATE POLICY "Public reads active shop_categories"
ON public.shop_categories
FOR SELECT
TO anon, authenticated
USING (is_active = true AND public.is_shop_active(shop_id));
