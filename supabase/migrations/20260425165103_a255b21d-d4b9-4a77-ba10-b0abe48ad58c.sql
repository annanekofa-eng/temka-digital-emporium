-- Add payment_method column to shop_orders to track which payment provider was used
-- This allows the seller-bot-webhook to differentiate between Stars / xRocket / Tonkeeper / CryptoBot
ALTER TABLE public.shop_orders
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'cryptobot';

-- Index for fast lookup by invoice_id (used by webhooks)
CREATE INDEX IF NOT EXISTS idx_shop_orders_invoice_id ON public.shop_orders (invoice_id) WHERE invoice_id IS NOT NULL;

-- Index for fast lookup by order_number (used in successful_payment payload as invoice_payload)
CREATE INDEX IF NOT EXISTS idx_shop_orders_order_number ON public.shop_orders (order_number);

-- Comment documenting allowed values
COMMENT ON COLUMN public.shop_orders.payment_method IS 'Payment provider used for this order: cryptobot, sbp_card, stars, xrocket, tonkeeper';