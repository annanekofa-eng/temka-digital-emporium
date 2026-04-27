import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

export interface ShopAutoProduct {
  id: string;
  shop_id: string;
  product_type: 'telegram_premium' | 'telegram_stars';
  is_enabled: boolean;
  price_3m: number | null;
  price_6m: number | null;
  price_12m: number | null;
  price_per_star: number | null;
  min_stars: number | null;
  max_stars: number | null;
  label: string;
}

export const useShopAutoProducts = (shopId?: string) => {
  return useQuery({
    queryKey: ['shop-auto-products', shopId],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shop_auto_products' as any)
        .select('*')
        .eq('shop_id', shopId!)
        .eq('is_enabled', true);
      if (error) throw error;
      return (data || []) as unknown as ShopAutoProduct[];
    },
  });
};

export const useShopAutoProduct = (
  shopId: string | undefined,
  type: 'telegram_premium' | 'telegram_stars',
) => {
  return useQuery({
    queryKey: ['shop-auto-product', shopId, type],
    enabled: !!shopId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shop_auto_products' as any)
        .select('*')
        .eq('shop_id', shopId!)
        .eq('product_type', type)
        .eq('is_enabled', true)
        .maybeSingle();
      if (error) throw error;
      return (data || null) as unknown as ShopAutoProduct | null;
    },
  });
};

// Validate Telegram username/id input (shared between Premium and Stars pages)
export type ValidationResult =
  | { ok: true; value: string; error: null }
  | { ok: false; value: null; error: string };

export function validateTelegramTarget(raw: string): ValidationResult {
  const trimmed = (raw || '').trim().replace(/^@/, '');
  if (!trimmed) return { ok: false, value: null, error: 'Укажите получателя' };
  // Numeric ID
  if (/^\d{4,15}$/.test(trimmed)) return { ok: true, value: trimmed, error: null };
  // Telegram username
  if (/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(trimmed)) return { ok: true, value: '@' + trimmed, error: null };
  return { ok: false, value: null, error: 'Введите username (5-32 символа) или числовой ID' };
}
