
CREATE TABLE IF NOT EXISTS public.curator_chat_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  telegram_id bigint NOT NULL,
  plan text NOT NULL,
  invite_link text,
  status text NOT NULL DEFAULT 'issued', -- issued | used | expired | failed
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_curator_chat_invites_tg ON public.curator_chat_invites(telegram_id);
CREATE INDEX IF NOT EXISTS idx_curator_chat_invites_status ON public.curator_chat_invites(status);

ALTER TABLE public.curator_chat_invites ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access curator_chat_invites" ON public.curator_chat_invites FOR ALL USING (false);
CREATE POLICY "Service role manages curator_chat_invites" ON public.curator_chat_invites FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.curator_chat_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id bigint NOT NULL UNIQUE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  kicked_at timestamptz,
  kick_reason text,
  last_checked_at timestamptz
);
CREATE INDEX IF NOT EXISTS idx_curator_chat_members_kicked ON public.curator_chat_members(kicked_at);

ALTER TABLE public.curator_chat_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY "No public access curator_chat_members" ON public.curator_chat_members FOR ALL USING (false);
CREATE POLICY "Service role manages curator_chat_members" ON public.curator_chat_members FOR ALL TO service_role USING (true) WITH CHECK (true);
