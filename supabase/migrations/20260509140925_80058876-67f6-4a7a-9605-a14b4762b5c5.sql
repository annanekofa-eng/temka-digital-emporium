
-- Drop all platform/shop/curator tables (CASCADE removes dependent objects)
DROP TABLE IF EXISTS public.platform_promo_usages CASCADE;
DROP TABLE IF EXISTS public.platform_subscription_promos CASCADE;
DROP TABLE IF EXISTS public.platform_referral_earnings CASCADE;
DROP TABLE IF EXISTS public.platform_referral_payouts CASCADE;
DROP TABLE IF EXISTS public.platform_referral_settings CASCADE;
DROP TABLE IF EXISTS public.platform_referrals CASCADE;
DROP TABLE IF EXISTS public.platform_retention_log CASCADE;
DROP TABLE IF EXISTS public.platform_sessions CASCADE;
DROP TABLE IF EXISTS public.platform_settings CASCADE;
DROP TABLE IF EXISTS public.platform_balance_history CASCADE;
DROP TABLE IF EXISTS public.platform_admins CASCADE;
DROP TABLE IF EXISTS public.platform_users CASCADE;

DROP TABLE IF EXISTS public.subscription_payments CASCADE;
DROP TABLE IF EXISTS public.subscription_plans CASCADE;

DROP TABLE IF EXISTS public.curator_chat_invites CASCADE;
DROP TABLE IF EXISTS public.curator_chat_members CASCADE;
DROP TABLE IF EXISTS public.chat_invites CASCADE;
DROP TABLE IF EXISTS public.customization_requests CASCADE;

DROP TABLE IF EXISTS public.paid_content_logs CASCADE;
DROP TABLE IF EXISTS public.paid_content CASCADE;

DROP TABLE IF EXISTS public.admin_logs CASCADE;
DROP TABLE IF EXISTS public.admin_sessions CASCADE;
DROP TABLE IF EXISTS public.admin_users CASCADE;

DROP TABLE IF EXISTS public.seller_sessions CASCADE;

-- Shop multi-tenant tables
DROP TABLE IF EXISTS public.shop_admin_logs CASCADE;
DROP TABLE IF EXISTS public.shop_ai_avatar_generations CASCADE;
DROP TABLE IF EXISTS public.shop_auto_products CASCADE;
DROP TABLE IF EXISTS public.shop_balance_history CASCADE;
DROP TABLE IF EXISTS public.shop_referral_earnings CASCADE;
DROP TABLE IF EXISTS public.shop_referral_payouts CASCADE;
DROP TABLE IF EXISTS public.shop_referral_settings CASCADE;
DROP TABLE IF EXISTS public.shop_referrals CASCADE;
DROP TABLE IF EXISTS public.shop_promocodes CASCADE;
DROP TABLE IF EXISTS public.shop_payment_requests CASCADE;
DROP TABLE IF EXISTS public.shop_payment_methods CASCADE;
DROP TABLE IF EXISTS public.shop_order_items CASCADE;
DROP TABLE IF EXISTS public.shop_orders CASCADE;
DROP TABLE IF EXISTS public.shop_inventory CASCADE;
DROP TABLE IF EXISTS public.shop_products CASCADE;
DROP TABLE IF EXISTS public.shop_categories CASCADE;
DROP TABLE IF EXISTS public.shop_customers CASCADE;
DROP TABLE IF EXISTS public.shop_settings CASCADE;
DROP TABLE IF EXISTS public.shops CASCADE;

-- Drop functions tied to removed tables
DROP FUNCTION IF EXISTS public.platform_credit_balance(bigint, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.platform_deduct_balance(bigint, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.platform_credit_referral_for_subscription(uuid, bigint, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.platform_admin_create_referral_payout(bigint, numeric, bigint, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.validate_platform_subscription_promo(text, bigint) CASCADE;
DROP FUNCTION IF EXISTS public.increment_platform_promo_usage(uuid, bigint, uuid, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.has_entitlement(bigint, text) CASCADE;

DROP FUNCTION IF EXISTS public.shop_credit_balance(uuid, bigint, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.shop_deduct_balance(uuid, bigint, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.shop_credit_referral_for_order(uuid, uuid, bigint, numeric) CASCADE;
DROP FUNCTION IF EXISTS public.shop_has_premium_features(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.is_shop_active(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.ensure_shop_customer(uuid, bigint, text, text, text, boolean, text) CASCADE;
DROP FUNCTION IF EXISTS public.check_shop_payments_configured(uuid) CASCADE;
DROP FUNCTION IF EXISTS public.validate_shop_promo_code(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.increment_shop_promo_usage(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS public.reserve_shop_inventory(uuid, integer, uuid) CASCADE;
DROP FUNCTION IF EXISTS public.get_shop_ai_avatar_quota(uuid) CASCADE;

DROP FUNCTION IF EXISTS public.decrypt_token(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.encrypt_token(text, text) CASCADE;

-- Drop scheduled cron jobs related to platform (ignore errors if extension not present)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobname) FROM cron.job
      WHERE jobname IN ('subscription-enforce', 'curator-kick-cron', 'retention-check');
  END IF;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
