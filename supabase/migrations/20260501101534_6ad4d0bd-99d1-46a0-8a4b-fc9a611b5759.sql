-- ─────────────────────────────────────────────────────────────
-- Bulk plan migration: Basic/Premium → Start
-- Trial users: keep trial status, set plan to start
-- ─────────────────────────────────────────────────────────────

-- 1) Аудит-снимок ДО миграции (для возможности отката)
DO $$
DECLARE
  affected_basic int;
  affected_premium int;
  affected_trial int;
BEGIN
  SELECT COUNT(*) INTO affected_basic
  FROM public.platform_users
  WHERE subscription_plan = 'basic';

  SELECT COUNT(*) INTO affected_premium
  FROM public.platform_users
  WHERE subscription_plan = 'premium';

  SELECT COUNT(*) INTO affected_trial
  FROM public.platform_users
  WHERE subscription_status = 'trial' AND subscription_plan IS DISTINCT FROM 'start';

  INSERT INTO public.admin_logs (admin_telegram_id, action, entity_type, entity_id, details)
  VALUES (
    0,
    'bulk_plan_migration',
    'system',
    'plan-rename-basic-to-plus',
    jsonb_build_object(
      'migrated_basic', affected_basic,
      'migrated_premium', affected_premium,
      'migrated_trial', affected_trial,
      'migrated_at', now(),
      'note', 'Все платные подписки и активные триалы переведены на план start. Период действия сохранён.'
    )
  );
END $$;

-- 2) Перевод платных подписок (active / grace_period) → start
UPDATE public.platform_users
SET
  subscription_plan = 'start',
  updated_at = now()
WHERE subscription_plan IN ('basic', 'premium')
  AND subscription_status IN ('active', 'grace_period');

-- 3) Перевод пробных подписок → start (статус trial сохраняется)
UPDATE public.platform_users
SET
  subscription_plan = 'start',
  updated_at = now()
WHERE subscription_status = 'trial'
  AND subscription_plan IS DISTINCT FROM 'start';

-- 4) Любые остальные не-NULL планы basic/premium (например, истёкшие) тоже привести к start
UPDATE public.platform_users
SET
  subscription_plan = 'start',
  updated_at = now()
WHERE subscription_plan IN ('basic', 'premium');
