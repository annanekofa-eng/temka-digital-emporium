-- Fix: storefront pages (ShopCheckout, ShopAutoStars, ShopAutoPremium) load
-- payment methods via the public_shop_payment_methods view, which internally
-- calls is_shop_active(). The previous migration restricted RLS but did not
-- grant EXECUTE on is_shop_active to anon/authenticated, so the view returned
-- "permission denied for function is_shop_active" — breaking checkout.
GRANT EXECUTE ON FUNCTION public.is_shop_active(uuid) TO anon, authenticated;

-- Also ensure the view itself is selectable by anon/authenticated. The view
-- still hides config_encrypted (it's not in the SELECT list) and only returns
-- enabled methods for active shops, so this is safe.
GRANT SELECT ON public.public_shop_payment_methods TO anon, authenticated;