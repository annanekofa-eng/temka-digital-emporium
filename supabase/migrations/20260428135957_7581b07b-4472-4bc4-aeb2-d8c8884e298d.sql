
ALTER TABLE public.subscription_payments
  ADD COLUMN IF NOT EXISTS plan text,
  ADD COLUMN IF NOT EXISTS months integer;

CREATE INDEX IF NOT EXISTS subscription_payments_plan_idx ON public.subscription_payments(plan);
CREATE INDEX IF NOT EXISTS subscription_payments_status_idx ON public.subscription_payments(status);
