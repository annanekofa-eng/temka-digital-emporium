import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import type { PromoResult } from '@/contexts/StoreContext';
import { supabase } from '@/integrations/supabase/client';

export interface ShopData {
  id: string;
  name: string;
  slug: string;
  color: string;
  hero_title: string;
  hero_description: string;
  welcome_message: string;
  support_link: string;
  status: string;
  bot_username: string | null;
  paymentsConfigured?: boolean;
}

export interface ShopProduct {
  id: string;
  shop_id: string;
  name: string;
  subtitle: string;
  description: string;
  price: number;
  old_price: number | null;
  stock: number;
  image: string | null;
  features: string[];
  type: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export interface ShopCategory {
  id: string;
  shop_id: string;
  name: string;
  icon: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
}

export interface ShopReview {
  id: string;
  shop_id: string;
  product_id: string | null;
  author: string;
  avatar: string;
  rating: number;
  text: string;
  verified: boolean;
  moderation_status: string;
  created_at: string;
}

interface ShopCartItem {
  product: ShopProduct;
  quantity: number;
}

interface ShopContextType {
  shop: ShopData | null;
  loading: boolean;
  error: string | null;
  products: ShopProduct[];
  productsLoading: boolean;
  categories: ShopCategory[];
  categoriesLoading: boolean;
  reviews: ShopReview[];
  reviewsLoading: boolean;
  cart: ShopCartItem[];
  addToCart: (product: ShopProduct) => void;
  removeFromCart: (productId: string) => void;
  updateQuantity: (productId: string, quantity: number) => void;
  clearCart: () => void;
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

const ShopContext = createContext<ShopContextType | undefined>(undefined);

function hexToHSL(hex: string): string {
  hex = hex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

export const ShopProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { shopId } = useParams<{ shopId: string }>();
  const [shop, setShop] = useState<ShopData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [products, setProducts] = useState<ShopProduct[]>([]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [categories, setCategories] = useState<ShopCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [reviews, setReviews] = useState<ShopReview[]>([]);
  const [reviewsLoading, setReviewsLoading] = useState(true);
  const [cart, setCart] = useState<ShopCartItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [promoCode, setPromoCode] = useState('');
  const [promoResult, setPromoResult] = useState<PromoResult | null>(null);
  const [promoError, setPromoError] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);

  // Load cart from localStorage scoped to shop
  useEffect(() => {
    if (!shopId) return;
    try {
      const raw = localStorage.getItem(`shop-cart-${shopId}`);
      if (raw) setCart(JSON.parse(raw));
    } catch {}
  }, [shopId]);

  // Persist cart
  useEffect(() => {
    if (!shopId) return;
    localStorage.setItem(`shop-cart-${shopId}`, JSON.stringify(cart));
  }, [cart, shopId]);

  // Load shop data
  useEffect(() => {
    if (!shopId) return;
    setLoading(true);
    setError(null);

    const fetchShop = async () => {
      let query = supabase
        .from('shops')
        .select('id, name, slug, color, hero_title, hero_description, welcome_message, support_link, status, bot_username');

      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(shopId);
      if (isUuid) {
        query = query.eq('id', shopId);
      } else {
        query = query.eq('slug', shopId);
      }

      const { data, error: err } = await query.maybeSingle();
      if (err) { setError('Ошибка загрузки магазина'); setLoading(false); return; }
      if (!data) { setError('Магазин не найден или удалён'); setLoading(false); return; }

      // If shop is not active, still set the data so ShopLayout can show proper status screen
      setShop(data as ShopData);
      setLoading(false);

      // Check if payments are configured
      supabase.rpc('check_shop_payments_configured', { p_shop_id: data.id })
        .then(({ data: configured }) => {
          setShop(prev => prev ? { ...prev, paymentsConfigured: !!configured } : prev);
        });


      // Apply color theme
      const hsl = hexToHSL(data.color || '#2B7FFF');
      document.documentElement.style.setProperty('--primary', hsl);
      document.documentElement.style.setProperty('--ring', hsl);
      document.documentElement.style.setProperty('--accent', hsl);

      // Load products
      setProductsLoading(true);
      const { data: prods } = await supabase
        .from('shop_products')
        .select('*')
        .eq('shop_id', data.id)
        .eq('is_active', true)
        .order('sort_order');
      setProducts((prods || []) as unknown as ShopProduct[]);
      setProductsLoading(false);

      // Load categories
      setCategoriesLoading(true);
      const { data: cats } = await supabase
        .from('shop_categories')
        .select('*')
        .eq('shop_id', data.id)
        .eq('is_active', true)
        .order('sort_order');
      setCategories((cats || []) as unknown as ShopCategory[]);
      setCategoriesLoading(false);

      // Load reviews (approved only)
      setReviewsLoading(true);
      const { data: revs } = await supabase
        .from('public_shop_reviews' as any)
        .select('*')
        .eq('shop_id', data.id)
        .eq('moderation_status', 'approved')
        .order('created_at', { ascending: false });
      setReviews((revs || []) as unknown as ShopReview[]);
      setReviewsLoading(false);
    };

    fetchShop();

    return () => {
      document.documentElement.style.removeProperty('--primary');
      document.documentElement.style.removeProperty('--ring');
      document.documentElement.style.removeProperty('--accent');
    };
  }, [shopId]);

  const addToCart = useCallback((product: ShopProduct) => {
    setCart(prev => {
      const existing = prev.find(item => item.product.id === product.id);
      if (existing) {
        return prev.map(item =>
          item.product.id === product.id ? { ...item, quantity: item.quantity + 1 } : item
        );
      }
      return [...prev, { product, quantity: 1 }];
    });
  }, []);

  const removeFromCart = useCallback((productId: string) => {
    setCart(prev => prev.filter(item => item.product.id !== productId));
  }, []);

  const updateQuantity = useCallback((productId: string, quantity: number) => {
    if (quantity <= 0) {
      setCart(prev => prev.filter(item => item.product.id !== productId));
      return;
    }
    setCart(prev => prev.map(item =>
      item.product.id === productId ? { ...item, quantity } : item
    ));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
    setPromoResult(null);
    setPromoCode('');
    setPromoError('');
  }, []);

  const cartTotal = cart.reduce((sum, item) => sum + Number(item.product.price) * item.quantity, 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  const discount = promoResult
    ? promoResult.discountType === 'percent'
      ? cartTotal * (promoResult.discountValue / 100)
      : promoResult.discountValue
    : 0;
  const totalAfterDiscount = Math.max(0, cartTotal - discount);

  const applyPromo = useCallback(async (code: string, telegramId?: number) => {
    if (!shop?.id) return;
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setPromoLoading(true);
    setPromoError('');
    try {
      const { data: rpcResult, error } = await supabase.rpc('validate_shop_promo_code' as any, {
        p_shop_id: shop.id,
        p_code: trimmed,
      });
      if (error) throw error;
      const data = rpcResult as any;
      if (!data || !data.found) { setPromoError('Промокод не найден'); setPromoResult(null); return; }
      const now = new Date().toISOString();
      if (data.valid_from && now < data.valid_from) { setPromoError('Промокод ещё не активен'); return; }
      if (data.valid_until && now > data.valid_until) { setPromoError('Промокод истёк'); return; }
      if (data.max_uses !== null && data.used_count >= data.max_uses) { setPromoError('Лимит использований исчерпан'); return; }

      // Check per-user usage limit via edge function (RLS blocks direct query)
      if (data.max_uses_per_user !== null && telegramId) {
        try {
          const { data: usageRes } = await supabase.functions.invoke('get-my-data', {
            body: { action: 'check-promo-usage', telegramId, code: trimmed, shopId: shop.id },
          });
          if ((usageRes?.count || 0) >= data.max_uses_per_user) {
            setPromoError('Вы уже использовали этот промокод');
            setPromoResult(null);
            return;
          }
        } catch {}
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
  }, [shop?.id]);

  const clearPromo = useCallback(() => {
    setPromoResult(null);
    setPromoCode('');
    setPromoError('');
  }, []);

  return (
    <ShopContext.Provider value={{
      shop, loading, error,
      products, productsLoading,
      categories, categoriesLoading,
      reviews, reviewsLoading,
      cart, addToCart, removeFromCart, updateQuantity, clearCart,
      cartTotal, cartCount,
      searchQuery, setSearchQuery,
      promoCode, setPromoCode, promoResult, promoError, promoLoading,
      applyPromo, clearPromo, discount, totalAfterDiscount,
    }}>
      {children}
    </ShopContext.Provider>
  );
};

export const useShop = () => {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error('useShop must be used within ShopProvider');
  return ctx;
};

/** Safe version that returns null outside ShopProvider */
export const useShopOptional = () => useContext(ShopContext) ?? null;
