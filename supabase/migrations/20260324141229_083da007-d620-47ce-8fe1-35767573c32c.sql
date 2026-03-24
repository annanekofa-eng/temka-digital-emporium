-- Fix security definer views to use security invoker
ALTER VIEW public.public_shop_storefront SET (security_invoker = on);
ALTER VIEW public.public_reviews SET (security_invoker = on);
ALTER VIEW public.public_shop_reviews SET (security_invoker = on);