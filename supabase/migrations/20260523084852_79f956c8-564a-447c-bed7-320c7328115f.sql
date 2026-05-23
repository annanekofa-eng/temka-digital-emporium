
-- 1. site_settings: add is_public flag and restrict public SELECT
ALTER TABLE public.site_settings
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

UPDATE public.site_settings
  SET is_public = true
  WHERE key IN (
    'shop_name', 'marquee_enabled', 'marquee_text',
    'faq_url', 'policy_url', 'support_username',
    'welcome_photo', 'welcome_text'
  );

DROP POLICY IF EXISTS "Site settings are publicly readable" ON public.site_settings;

CREATE POLICY "Public site settings are readable"
  ON public.site_settings
  FOR SELECT
  TO anon, authenticated
  USING (is_public = true);

-- 2. message_templates: remove public SELECT; service role retains full access
DROP POLICY IF EXISTS "Templates publicly readable" ON public.message_templates;
