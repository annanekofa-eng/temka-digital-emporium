
UPDATE public.products p
   SET stock = COALESCE((
         SELECT COUNT(*) FROM public.inventory_items i
          WHERE i.product_id = p.id AND i.status = 'available'
       ), 0),
       updated_at = now()
 WHERE p.product_type NOT IN ('premium_term', 'stars');
