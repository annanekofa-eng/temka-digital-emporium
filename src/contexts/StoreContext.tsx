import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import type { DbProduct } from '@/types/database';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export const AUTO_PRODUCT_TYPES = ['premium_term', 'stars'] as const;
export const isAutoProduct = (p: any) =>
  !!p?.product_type && (AUTO_PRODUCT_TYPES as readonly string[]).includes(p.product_type);

interface CartItem {
  product: DbProduct;
  quantity: number;
  recipientUsername?: string;
  lineId?: string; // unique line id for auto items so they don't merge
}

export interface PromoResult {
  id: string;
  code: string;
  discountType: 'percent' | 'fixed';
  discountValue: number;
}

interface StoreContextType {
  cart: CartItem[];
  addToCart: (product: DbProduct, opts?: { recipientUsername?: string }) => boolean;
  removeFromCart: (lineKey: string) => void;
  updateQuantity: (lineKey: string, quantity: number) => void;
  clearCart: () => void;
  syncCartWithProducts: (products: DbProduct[]) => { removed: string[]; priceChanged: Array<{ title: string; oldPrice: number; newPrice: number }> };
  cartTotal: number;
  cartCount: number;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  // Promo
  promoCode: string;
  setPromoCode: (code: string) => void;
  promoResult: PromoResult | null;
  promoError: string;
  promoLoading: boolean;
  applyPromo: (code: string, telegramId?: number, initData?: string) => Promise<void>;
  clearPromo: () => void;
  discount: number;
  totalAfterDiscount: number;
}

const CART_STORAGE_KEY = 'telestore-cart';

const loadCart = (): CartItem[] => {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {}
  return [];
};

const StoreContext = createContext<StoreContextType | undefined>(undefined);

export const StoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [cart, setCart] = useState<CartItem[]>(loadCart);
  const [searchQuery, setSearchQuery] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [promoError, setPromoError] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);

  useEffect(() => {
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
  }, [cart]);

  const addToCart = useCallback((product: DbProduct, opts?: { recipientUsername?: string }) => {
    const incomingIsAuto = isAutoProduct(product);
    let allowed = true;
    setCart(prev => {
      const hasAuto = prev.some(it => isAutoProduct(it.product));
      const hasRegular = prev.some(it => !isAutoProduct(it.product));
      if (incomingIsAuto && hasRegular) {
        toast.error('Авто-товары (Stars/Premium) оформляются отдельным заказом. Очистите корзину.');
        allowed = false;
        return prev;
      }
      if (!incomingIsAuto && hasAuto) {
        toast.error('В корзине авто-товар. Оформите его отдельно или очистите корзину.');
        allowed = false;
        return prev;
      }
      if (incomingIsAuto) {
        // Each auto purchase = its own line (different recipient/amount).
        return [...prev, {
          product,
          quantity: 1,
          recipientUsername: opts?.recipientUsername,
          lineId: `${product.id}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        }];
      }
      const existing = prev.find(item => !item.lineId && item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item === existing ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
    return allowed;
  }, []);

  const lineKeyOf = (item: CartItem) => item.lineId ?? item.product.id;

  const removeFromCart = useCallback((lineKey: string) => {
    setCart(prev => prev.filter(item => lineKeyOf(item) !== lineKey));
  }, []);

  const updateQuantity = useCallback((lineKey: string, quantity: number) => {
    if (quantity <= 0) {
      setCart(prev => prev.filter(item => lineKeyOf(item) !== lineKey));
      return;
    }
    setCart(prev =>
      prev.map(item =>
        lineKeyOf(item) === lineKey ? { ...item, quantity } : item
      )
    );
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setPromoResult(null);
    setPromoCode('');
    setPromoError('');
    try {
      localStorage.removeItem(CART_STORAGE_KEY);
    } catch {}
  }, []);

  const syncCartWithProducts = useCallback((products: DbProduct[]) => {
    const map = new Map(products.map(p => [p.id, p]));
    const removed: string[] = [];
    const priceChanged: Array<{ title: string; oldPrice: number; newPrice: number }> = [];
    setCart(prev => {
      const next: CartItem[] = [];
      for (const item of prev) {
        const fresh = map.get(item.product.id);
        if (!fresh || !fresh.is_active) {
          removed.push(item.product.title);
          continue;
        }
        const oldPrice = Number(item.product.price);
        const newPrice = Number(fresh.price);
        if (Math.abs(oldPrice - newPrice) > 0.001) {
          priceChanged.push({ title: fresh.title, oldPrice, newPrice });
        }
        next.push({ product: fresh, quantity: item.quantity });
      }
      return next;
    });
    return { removed, priceChanged };
  }, []);

  const cartTotal = cart.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const discount = promoResult
    ? promoResult.discountType === 'percent'
      ? cartTotal * (promoResult.discountValue / 100)
      : promoResult.discountValue
    : 0;
  const totalAfterDiscount = Math.max(0, cartTotal - discount);

  const applyPromo = useCallback(async (code: string, telegramId?: number, initData?: string) => {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setPromoLoading(true);
    setPromoError('');
    try {
      const { data: rpcResult, error } = await supabase.rpc('validate_promo_code', { p_code: trimmed });
      if (error) throw error;
      const data = rpcResult as any;
      if (!data || !data.found) { setPromoError('Промокод не найден'); setPromoResult(null); return; }
      const now = new Date().toISOString();
      if (data.valid_from && now < data.valid_from) { setPromoError('Промокод ещё не активен'); return; }
      if (data.valid_until && now > data.valid_until) { setPromoError('Промокод истёк'); return; }
      if (data.max_uses !== null && data.used_count >= data.max_uses) { setPromoError('Лимит использований исчерпан'); return; }
      // Check per-user limit via secure edge function
      if (telegramId && (data as any).max_uses_per_user) {
        const { data: usageData } = await supabase.functions.invoke('get-my-data', {
          body: { action: 'check-promo-usage', telegramId, code: trimmed, initData },
        });
        const count = usageData?.count || 0;
        if (count >= (data as any).max_uses_per_user) {
          setPromoError('Вы уже использовали этот промокод максимальное число раз');
          return;
        }
      }
      setPromoResult({
        id: data.id,
        code: trimmed,
        discountType: data.discount_type as 'percent' | 'fixed',
        discountValue: Number(data.discount_value),
      });
      setPromoError('');
    } catch {
      setPromoError('Ошибка проверки');
    } finally {
      setPromoLoading(false);
    }
  }, []);

  const clearPromo = useCallback(() => {
    setPromoResult(null);
    setPromoCode('');
    setPromoError('');
  }, []);

  return (
    <StoreContext.Provider value={{
      cart, addToCart, removeFromCart, updateQuantity, clearCart, syncCartWithProducts,
      cartTotal, cartCount, searchQuery, setSearchQuery,
      promoCode, setPromoCode, promoResult, promoError, promoLoading,
      applyPromo, clearPromo, discount, totalAfterDiscount,
    }}>
      {children}
    </StoreContext.Provider>
  );
};

export const useStore = () => {
  const ctx = useContext(StoreContext);
  if (!ctx) throw new Error('useStore must be used within StoreProvider');
  return ctx;
};