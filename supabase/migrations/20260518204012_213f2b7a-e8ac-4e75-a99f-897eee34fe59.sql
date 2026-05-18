
REVOKE EXECUTE ON FUNCTION public.sync_product_stock(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inventory_items_sync_stock() FROM PUBLIC, anon, authenticated;
