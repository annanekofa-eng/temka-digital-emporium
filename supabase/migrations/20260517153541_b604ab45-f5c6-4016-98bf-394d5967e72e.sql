DELETE FROM public.products WHERE product_type IN ('nft_rent', 'nft_buy');
DELETE FROM public.message_templates WHERE key = 'nft_rent_instruction';