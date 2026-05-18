
-- 1) Schema additions
ALTER TABLE public.orders 
  ADD COLUMN IF NOT EXISTS balance_charged_at timestamptz,
  ADD COLUMN IF NOT EXISTS fulfilled_at timestamptz;

-- Backfill existing
UPDATE public.orders
   SET balance_charged_at = updated_at
 WHERE balance_used > 0 AND payment_status = 'paid' AND balance_charged_at IS NULL;

UPDATE public.orders
   SET fulfilled_at = updated_at
 WHERE status IN ('delivered','completed') AND fulfilled_at IS NULL;

UPDATE public.orders
   SET status = 'delivered'
 WHERE status = 'completed';

-- 2) Notification queue
CREATE TABLE IF NOT EXISTS public.pending_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL,
  telegram_id bigint NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE INDEX IF NOT EXISTS idx_pending_notifications_unsent
  ON public.pending_notifications(created_at) WHERE sent_at IS NULL;

ALTER TABLE public.pending_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "No public access pending_notifications" ON public.pending_notifications;
CREATE POLICY "No public access pending_notifications" ON public.pending_notifications FOR ALL TO public USING (false);
DROP POLICY IF EXISTS "Service role manages pending_notifications" ON public.pending_notifications;
CREATE POLICY "Service role manages pending_notifications" ON public.pending_notifications FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 3) Retry function: when stock arrives, fulfil paid-but-pending orders for this product
CREATE OR REPLACE FUNCTION public.try_fulfill_pending_orders(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oi RECORD;
  reserved_rows jsonb;
  reserved_count int;
BEGIN
  -- For each order_item on this product whose order is paid but not fulfilled,
  -- and which currently has fewer inventory_items.order_id rows than its quantity, try to reserve.
  FOR oi IN
    SELECT oi.id AS order_item_id,
           oi.order_id,
           oi.product_id,
           oi.quantity,
           oi.product_title,
           o.telegram_id,
           o.order_number,
           COALESCE((SELECT COUNT(*) FROM public.inventory_items i 
                     WHERE i.order_id = oi.order_id AND i.product_id = oi.product_id), 0) AS already
      FROM public.order_items oi
      JOIN public.orders o ON o.id = oi.order_id
     WHERE oi.product_id = p_product_id
       AND o.payment_status = 'paid'
       AND o.fulfilled_at IS NULL
       AND COALESCE(o.is_auto, false) = false
     ORDER BY o.created_at ASC
  LOOP
    IF oi.already >= oi.quantity THEN
      CONTINUE;
    END IF;

    -- Reserve remaining
    WITH reserved AS (
      SELECT i.id, i.content
        FROM public.inventory_items i
       WHERE i.product_id = oi.product_id
         AND i.status = 'available'
       ORDER BY i.created_at
       LIMIT (oi.quantity - oi.already)
       FOR UPDATE SKIP LOCKED
    ), upd AS (
      UPDATE public.inventory_items inv
         SET status = 'sold', order_id = oi.order_id, sold_at = now()
       FROM reserved r
       WHERE inv.id = r.id
      RETURNING inv.id, inv.content
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'content', content)), '[]'::jsonb),
           COALESCE(COUNT(*), 0)
      INTO reserved_rows, reserved_count
      FROM upd;

    IF reserved_count > 0 THEN
      -- Queue notification
      INSERT INTO public.pending_notifications(order_id, telegram_id, payload)
        VALUES (oi.order_id, oi.telegram_id, jsonb_build_object(
          'order_number', oi.order_number,
          'product_title', oi.product_title,
          'items', reserved_rows,
          'kind', 'fulfilled_retry'
        ));

      -- Mark order as delivered if now fully covered across all order_items
      IF NOT EXISTS (
        SELECT 1 FROM public.order_items x
         WHERE x.order_id = oi.order_id
           AND COALESCE((SELECT COUNT(*) FROM public.inventory_items i 
                         WHERE i.order_id = x.order_id AND i.product_id = x.product_id), 0) < x.quantity
      ) THEN
        UPDATE public.orders
           SET status = 'delivered', fulfilled_at = now(), updated_at = now()
         WHERE id = oi.order_id AND fulfilled_at IS NULL;
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.try_fulfill_pending_orders(uuid) FROM PUBLIC, anon, authenticated;

-- 4) Trigger on inventory_items: when an available unit appears, try to fulfil pending orders.
CREATE OR REPLACE FUNCTION public.inventory_items_try_fulfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'available' THEN
    PERFORM public.try_fulfill_pending_orders(NEW.product_id);
  ELSIF TG_OP = 'UPDATE' AND NEW.status = 'available' AND OLD.status <> 'available' THEN
    PERFORM public.try_fulfill_pending_orders(NEW.product_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_items_try_fulfill ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_try_fulfill
  AFTER INSERT OR UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.inventory_items_try_fulfill();
