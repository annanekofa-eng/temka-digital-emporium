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

// Server-side check: does the shop owner have Premium plan?
// Required to show Stars/Premium sections to customers.
export const useShopHasPremiumFeatures = (shopId?: string) => {
  return useQuery({
    queryKey: ['shop-has-premium', shopId],
    enabled: !!shopId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('shop_has_premium_features' as any, {
        p_shop_id: shopId!,
      });
      if (error) throw error;
      return Boolean(data);
    },
  });
};

export const useShopAutoProducts = (shopId?: string) => {
  return useQuery({
    queryKey: ['shop-auto-products', shopId, 'gated'],
    enabled: !!shopId,
    queryFn: async () => {
      // Gate: only show Stars/Premium auto products if shop owner has Premium plan
      const { data: hasPremium } = await supabase.rpc('shop_has_premium_features' as any, {
        p_shop_id: shopId!,
      });
      if (!hasPremium) return [] as ShopAutoProduct[];
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
    queryKey: ['shop-auto-product', shopId, type, 'gated'],
    enabled: !!shopId,
    queryFn: async () => {
      // Gate: hide entirely if owner not on Premium
      const { data: hasPremium } = await supabase.rpc('shop_has_premium_features' as any, {
        p_shop_id: shopId!,
      });
      if (!hasPremium) return null;
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
