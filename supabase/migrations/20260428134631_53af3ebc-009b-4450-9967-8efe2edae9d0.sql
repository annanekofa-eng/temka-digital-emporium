
-- 1. platform_users: новые поля
ALTER TABLE public.platform_users
  ADD COLUMN IF NOT EXISTS subscription_plan text NOT NULL DEFAULT 'start'
    CHECK (subscription_plan IN ('start','basic','premium')),
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz;

CREATE INDEX IF NOT EXISTS idx_platform_users_plan ON public.platform_users(subscription_plan);

-- Миграция текущих платных юзеров → start
UPDATE public.platform_users
SET subscription_plan = 'start', current_period_end = subscription_expires_at
WHERE subscription_status IN ('active','trial','grace_period');

-- 2. shops: timestamp последней AI-генерации аватарки
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS ai_avatar_generated_at timestamptz;

-- 3. tariff_prices
CREATE TABLE IF NOT EXISTS public.tariff_prices (
  plan text PRIMARY KEY CHECK (plan IN ('start','basic','premium')),
  price_usd numeric NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.tariff_prices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public reads tariff_prices" ON public.tariff_prices FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "Service role manages tariff_prices" ON public.tariff_prices FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.tariff_prices(plan, price_usd, is_enabled) VALUES
  ('start', 5, true),
  ('basic', 9, true),
  ('premium', 19, true)
ON CONFLICT (plan) DO NOTHING;

-- 4. paid_content
CREATE TABLE IF NOT EXISTS public.paid_content (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan text NOT NULL CHECK (plan IN ('basic','premium')),
  title text NOT NULL,
  body text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_paid_content_plan ON public.paid_content(plan, is_active);
ALTER TABLE public.paid_content ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access paid_content" ON public.paid_content FOR ALL TO public USING (false);
CREATE POLICY "Service role manages paid_content" ON public.paid_content FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 5. paid_content_logs (idempotency для рассылки)
CREATE TABLE IF NOT EXISTS public.paid_content_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL,
  content_id uuid NOT NULL REFERENCES public.paid_content(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent','failed')),
  error text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(telegram_id, content_id)
);
CREATE INDEX IF NOT EXISTS idx_paid_content_logs_user ON public.paid_content_logs(telegram_id);
ALTER TABLE public.paid_content_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access paid_content_logs" ON public.paid_content_logs FOR ALL TO public USING (false);
CREATE POLICY "Service role manages paid_content_logs" ON public.paid_content_logs FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 6. chat_invites
CREATE TABLE IF NOT EXISTS public.chat_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL,
  invite_link text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_chat_invites_user ON public.chat_invites(telegram_id, created_at DESC);
ALTER TABLE public.chat_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access chat_invites" ON public.chat_invites FOR ALL TO public USING (false);
CREATE POLICY "Service role manages chat_invites" ON public.chat_invites FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 7. customization_requests
CREATE TABLE IF NOT EXISTS public.customization_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id uuid NOT NULL,
  owner_telegram_id bigint NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','in_progress','done','rejected')),
  curator_response text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_customization_requests_shop ON public.customization_requests(shop_id);
CREATE INDEX IF NOT EXISTS idx_customization_requests_status ON public.customization_requests(status, created_at DESC);
ALTER TABLE public.customization_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access customization_requests" ON public.customization_requests FOR ALL TO public USING (false);
CREATE POLICY "Service role manages customization_requests" ON public.customization_requests FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 8. platform_settings (key→value)
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public reads safe platform_settings" ON public.platform_settings FOR SELECT TO public
  USING (key IN ('global_curator_username'));
CREATE POLICY "Service role manages platform_settings" ON public.platform_settings FOR ALL TO service_role USING (true) WITH CHECK (true);

INSERT INTO public.platform_settings(key, value) VALUES
  ('global_curator_username', ''),
  ('private_chat_id', '')
ON CONFLICT (key) DO NOTHING;

-- 9. Helper function: проверка прав на уровне БД
CREATE OR REPLACE FUNCTION public.has_entitlement(p_telegram_id bigint, p_feature text)
RETURNS boolean
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_plan text;
  v_status text;
  v_expires timestamptz;
BEGIN
  SELECT subscription_plan, subscription_status, subscription_expires_at
    INTO v_plan, v_status, v_expires
  FROM platform_users WHERE telegram_id = p_telegram_id;

  IF NOT FOUND THEN RETURN false; END IF;
  -- Активная подписка или триал
  IF v_status NOT IN ('active','trial','grace_period') THEN RETURN false; END IF;
  IF v_expires IS NOT NULL AND v_expires < now() THEN RETURN false; END IF;

  -- Маппинг фич
  RETURN CASE p_feature
    WHEN 'shop_basic' THEN true  -- все тарифы
    WHEN 'curator_help' THEN v_plan IN ('basic','premium')
    WHEN 'private_chat' THEN v_plan IN ('basic','premium')
    WHEN 'suppliers' THEN v_plan IN ('basic','premium')
    WHEN 'free_basic_content' THEN v_plan IN ('basic','premium')
    WHEN 'free_premium_content' THEN v_plan = 'premium'
    WHEN 'sell_telegram_stars' THEN v_plan = 'premium'
    WHEN 'sell_telegram_premium' THEN v_plan = 'premium'
    WHEN 'ai_avatar' THEN v_plan = 'premium'
    WHEN 'shop_customization' THEN v_plan = 'premium'
    ELSE false
  END;
END;
$$;
