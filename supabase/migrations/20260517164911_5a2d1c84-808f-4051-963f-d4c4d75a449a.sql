
-- SBP manual moderation queue
CREATE TABLE public.sbp_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_id BIGINT NOT NULL,
  order_id UUID,
  type TEXT NOT NULL DEFAULT 'order', -- 'order' | 'topup'
  amount_usd NUMERIC NOT NULL DEFAULT 0,
  amount_rub NUMERIC NOT NULL DEFAULT 0,
  rate NUMERIC NOT NULL DEFAULT 0,
  receipt_url TEXT,
  comment TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  admin_telegram_id BIGINT,
  admin_comment TEXT,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sbp_requests_status ON public.sbp_requests(status, created_at DESC);
CREATE INDEX idx_sbp_requests_telegram ON public.sbp_requests(telegram_id);
CREATE INDEX idx_sbp_requests_order ON public.sbp_requests(order_id);

ALTER TABLE public.sbp_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access sbp_requests"
ON public.sbp_requests FOR ALL TO public USING (false);

CREATE POLICY "Service role manages sbp_requests"
ON public.sbp_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
