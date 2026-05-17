-- Remove NFT product functionality from schema
DELETE FROM public.products WHERE product_type = 'nft_variant';
ALTER TABLE public.products DROP COLUMN IF EXISTS nft_variants;