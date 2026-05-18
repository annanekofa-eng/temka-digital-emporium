
CREATE OR REPLACE FUNCTION public.try_fulfill_pending_orders(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  reserved_rows jsonb;
  reserved_count int;
BEGIN
  FOR r IN
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
    IF r.already >= r.quantity THEN
      CONTINUE;
    END IF;

    WITH reserved AS (
      SELECT i.id, i.content
        FROM public.inventory_items i
       WHERE i.product_id = r.product_id
         AND i.status = 'available'
       ORDER BY i.created_at
       LIMIT (r.quantity - r.already)
       FOR UPDATE SKIP LOCKED
    ), upd AS (
      UPDATE public.inventory_items inv
         SET status = 'sold', order_id = r.order_id, sold_at = now()
       FROM reserved res
       WHERE inv.id = res.id
      RETURNING inv.id, inv.content
    )
    SELECT COALESCE(jsonb_agg(jsonb_build_object('id', id, 'content', content)), '[]'::jsonb),
           COALESCE(COUNT(*), 0)
      INTO reserved_rows, reserved_count
      FROM upd;

    IF reserved_count > 0 THEN
      INSERT INTO public.pending_notifications(order_id, telegram_id, payload)
        VALUES (r.order_id, r.telegram_id, jsonb_build_object(
          'order_number', r.order_number,
          'product_title', r.product_title,
          'items', reserved_rows,
          'kind', 'fulfilled_retry'
        ));

      IF NOT EXISTS (
        SELECT 1 FROM public.order_items x
         WHERE x.order_id = r.order_id
           AND COALESCE((SELECT COUNT(*) FROM public.inventory_items i 
                         WHERE i.order_id = x.order_id AND i.product_id = x.product_id), 0) < x.quantity
      ) THEN
        UPDATE public.orders
           SET status = 'delivered', fulfilled_at = now(), updated_at = now()
         WHERE id = r.order_id AND fulfilled_at IS NULL;
      END IF;
    END IF;
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.try_fulfill_pending_orders(uuid) FROM PUBLIC, anon, authenticated;
