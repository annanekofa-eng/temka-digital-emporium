-- Add bot avatar URL to shops
ALTER TABLE public.shops
  ADD COLUMN IF NOT EXISTS bot_avatar_url text;

-- Recreate public storefront view with the new field (security_invoker stays default off as before)
DROP VIEW IF EXISTS public.public_shop_storefront;
CREATE VIEW public.public_shop_storefront AS
SELECT
  id,
  name,
  slug,
  color,
  hero_title,
  hero_description,
  welcome_message,
  support_link,
  status,
  bot_username,
  bot_avatar_url,
  created_at,
  updated_at
FROM public.shops;

GRANT SELECT ON public.public_shop_storefront TO anon, authenticated;

-- Public storage bucket for bot avatars
INSERT INTO storage.buckets (id, name, public)
VALUES ('bot-avatars', 'bot-avatars', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- Public read policy for bot-avatars bucket (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage' AND tablename = 'objects'
      AND policyname = 'Public read bot-avatars'
  ) THEN
    EXECUTE $p$CREATE POLICY "Public read bot-avatars"
      ON storage.objects FOR SELECT
      USING (bucket_id = 'bot-avatars')$p$;
  END IF;
END $$;