import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { DbProduct, DbCategory, DbReview } from '@/types/database';

export const useProducts = () => {
  return useQuery({
    queryKey: ['products'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as unknown as DbProduct[];
    },
  });
};

export const useProduct = (id: string) => {
  return useQuery({
    queryKey: ['product', id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();
      if (error) throw error;
      return data as unknown as DbProduct;
    },
    enabled: !!id,
  });
};

export const useCategories = () => {
  return useQuery({
    queryKey: ['categories'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data as unknown as DbCategory[];
    },
  });
};

export const useReviews = (productId?: string) => {
  return useQuery({
    queryKey: ['reviews', productId],
    queryFn: async () => {
      let query = supabase
        .from('public_reviews' as any)
        .select('*')
        .eq('verified', true)
        .order('created_at', { ascending: false });
      if (productId) query = query.eq('product_id', productId);
      const { data, error } = await query;
      if (error) throw error;
      return data as unknown as DbReview[];
    },
  });
};

export const useProductStats = () => {
  return useQuery({
    queryKey: ['product-stats'],
    queryFn: async () => {
      const { data: products, error } = await supabase
        .from('products')
        .select('id, stock, category_id')
        .eq('is_active', true);
      if (error) throw error;
      const items = products as unknown as Pick<DbProduct, 'id' | 'stock' | 'category_id'>[];
      return {
        totalProducts: items.length,
        inStock: items.filter(p => p.stock > 0).length,
        categories: new Set(items.map(p => p.category_id)).size,
      };
    },
  });
};

export const useShopStats = () => {
  return useQuery({
    queryKey: ['shop-stats'],
    queryFn: async () => {
      const [productsRes, reviewsRes] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('is_active', true),
        supabase.from('public_reviews' as any).select('id', { count: 'exact', head: true }).eq('verified', true),
      ]);

      if (productsRes.error) throw productsRes.error;
      if (reviewsRes.error) throw reviewsRes.error;

      return {
        users: 0,
        completedOrders: 0,
        totalOrders: 0,
        activeProducts: productsRes.count ?? 0,
        approvedReviews: reviewsRes.count ?? 0,
      };
    },
    staleTime: 5 * 60 * 1000,
  });
};
