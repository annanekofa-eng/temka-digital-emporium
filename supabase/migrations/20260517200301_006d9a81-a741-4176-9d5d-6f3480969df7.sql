-- SBP requisites (single-row config managed by admin via bot)
CREATE TABLE public.sbp_requisites (
  key text PRIMARY KEY,
  bank text NOT NULL DEFAULT '',
  card text NOT NULL DEFAULT '',
  holder_name text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.sbp_requisites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access sbp_requisites"
  ON public.sbp_requisites FOR ALL TO public
  USING (false);

CREATE POLICY "Service role manages sbp_requisites"
  ON public.sbp_requisites FOR ALL TO service_role
  USING (true) WITH CHECK (true);

INSERT INTO public.sbp_requisites (key) VALUES ('current') ON CONFLICT DO NOTHING;

-- SBP payment records (one per SBP-paid order)
CREATE TABLE public.sbp_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  telegram_id bigint NOT NULL,
  amount_usd numeric NOT NULL,
  amount_rub numeric NOT NULL,
  rate numeric NOT NULL DEFAULT 80,
  receipt_url text,
  status text NOT NULL DEFAULT 'awaiting_receipt',
  reject_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  reviewed_by bigint
);
CREATE INDEX idx_sbp_payments_order ON public.sbp_payments(order_id);
CREATE INDEX idx_sbp_payments_status ON public.sbp_payments(status);
CREATE INDEX idx_sbp_payments_telegram_id ON public.sbp_payments(telegram_id);

ALTER TABLE public.sbp_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "No public access sbp_payments"
  ON public.sbp_payments FOR ALL TO public
  USING (false);

CREATE POLICY "Service role manages sbp_payments"
  ON public.sbp_payments FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Private storage bucket for receipts
INSERT INTO storage.buckets (id, name, public)
VALUES ('sbp-receipts', 'sbp-receipts', false)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Service role manages sbp receipts"
  ON storage.objects FOR ALL TO service_role
  USING (bucket_id = 'sbp-receipts')
  WITH CHECK (bucket_id = 'sbp-receipts');