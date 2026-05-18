
CREATE OR REPLACE FUNCTION public.sync_product_stock(p_product_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.products
     SET stock = COALESCE((
       SELECT COUNT(*) FROM public.inventory_items
        WHERE product_id = p_product_id AND status = 'available'
     ), 0),
     updated_at = now()
   WHERE id = p_product_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.inventory_items_sync_stock()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.sync_product_stock(NEW.product_id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM public.sync_product_stock(OLD.product_id);
  ELSE
    PERFORM public.sync_product_stock(NEW.product_id);
    IF NEW.product_id IS DISTINCT FROM OLD.product_id THEN
      PERFORM public.sync_product_stock(OLD.product_id);
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_inventory_items_sync_stock ON public.inventory_items;
CREATE TRIGGER trg_inventory_items_sync_stock
AFTER INSERT OR UPDATE OR DELETE ON public.inventory_items
FOR EACH ROW EXECUTE FUNCTION public.inventory_items_sync_stock();

-- Backfill: recompute stock for every product that already has inventory rows.
UPDATE public.products p
   SET stock = COALESCE(c.cnt, 0),
       updated_at = now()
  FROM (
    SELECT product_id, COUNT(*) FILTER (WHERE status = 'available') AS cnt
      FROM public.inventory_items GROUP BY product_id
  ) c
 WHERE p.id = c.product_id;
