import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { DbProduct } from '@/types/database';

export interface DbProject {
  id: string;
  title: string;
  subtitle: string;
  description: string;
  icon: string;
  banner: string | null;
  is_active: boolean;
  sort_order: number;
}

export interface ExtendedProduct extends DbProduct {
  project_id: string | null;
  product_type: 'simple' | 'premium_term' | 'nft_variant' | 'stars';
  term_options: Array<{ months: number; price: number }>;
  nft_variants: Array<{ key: string; label: string; price: number; image?: string }>;
  min_qty: number;
  max_qty: number;
  external_link: string | null;
  gallery: string[];
}

export const useProjects = () =>
  useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('is_active', true)
        .order('sort_order');
      if (error) throw error;
      return data as DbProject[];
    },
  });

export const useProject = (id?: string) =>
  useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('*').eq('id', id!).maybeSingle();
      if (error) throw error;
      return data as DbProject | null;
    },
    enabled: !!id,
  });

export const useProjectProducts = (projectId?: string) =>
  useQuery({
    queryKey: ['products', 'project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_active', true)
        .eq('project_id', projectId!)
        .order('sort_order');
      if (error) throw error;
      return data as unknown as ExtendedProduct[];
    },
    enabled: !!projectId,
  });

export const useProjectCategories = (projectId?: string) =>
  useQuery({
    queryKey: ['categories', 'project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .eq('project_id', projectId!)
        .order('sort_order');
      if (error) throw error;
      return data;
    },
    enabled: !!projectId,
  });

export const useSiteSettings = () =>
  useQuery({
    queryKey: ['site-settings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_settings').select('key, value');
      if (error) throw error;
      const map: Record<string, string> = {};
      (data || []).forEach((row: any) => {
        map[row.key] = row.value;
      });
      return map;
    },
  });
