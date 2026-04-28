-- Trial должен быть нейтральным, без привязки к тарифу "Старт"
ALTER TABLE public.platform_users ALTER COLUMN subscription_plan DROP DEFAULT;
ALTER TABLE public.platform_users ALTER COLUMN subscription_plan DROP NOT NULL;

-- Очистим существующих trial-пользователей от ложной привязки к "start"
UPDATE public.platform_users
SET subscription_plan = NULL,
    billing_price_usd = NULL,
    pricing_tier = NULL,
    updated_at = now()
WHERE subscription_status = 'trial'
  AND first_paid_at IS NULL;