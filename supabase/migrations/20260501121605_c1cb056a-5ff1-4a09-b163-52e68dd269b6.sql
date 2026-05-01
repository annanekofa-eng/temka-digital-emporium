-- =====================================================================
-- SECURITY FIX (Critical): close public access to payment-credential tables
-- =====================================================================
-- Problem: policies "Allow service role full access to ..." were scoped
-- to role {public} with USING true / WITH CHECK true, allowing any
-- anonymous client to read encrypted CryptoBot/xRocket tokens, TON
-- wallets, masked card numbers, buyer telegram_ids and SBP receipts,
-- AND to mutate these rows (e.g. mark a payment request as 'paid').
--
-- Fix: restrict the policy to {service_role} (matches the policy name).
-- Storefront still needs masked SBP details for checkout, so we expose
-- only the safe columns through a SECURITY DEFINER view, following
-- the established project pattern.
-- =====================================================================

-- 1. shop_payment_methods: lock the table down to service_role only.
DROP POLICY IF EXISTS "Allow service role full access to shop_payment_methods"
  ON public.shop_payment_methods;

CREATE POLICY "Service role manages shop_payment_methods"
  ON public.shop_payment_methods
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 2. shop_payment_requests: same fix.
DROP POLICY IF EXISTS "Allow service role full access to shop_payment_requests"
  ON public.shop_payment_requests;

CREATE POLICY "Service role manages shop_payment_requests"
  ON public.shop_payment_requests
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- 3. Public-safe view for the storefront. Exposes only non-secret
--    columns, never config_encrypted. Limited to active shops.
CREATE OR REPLACE VIEW public.public_shop_payment_methods
WITH (security_invoker = off) AS
SELECT
  spm.shop_id,
  spm.method,
  spm.enabled,
  spm.config_masked
FROM public.shop_payment_methods spm
WHERE spm.enabled = true
  AND public.is_shop_active(spm.shop_id);

GRANT SELECT ON public.public_shop_payment_methods TO anon, authenticated;
