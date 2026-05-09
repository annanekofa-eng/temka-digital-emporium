import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTelegram } from '@/contexts/TelegramContext';
import type { DbOrder, DbOrderItem, DbBalanceHistory, DbInventoryItem } from '@/types/database';

async function fetchMyData(initData: string, action: string, extra?: Record<string, unknown>) {
  const { data, error } = await supabase.functions.invoke('get-my-data', {
    body: { initData, action, ...extra },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

export const useOrders = () => {
  const { user, initData } = useTelegram();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ['orders', user?.id],
    queryFn: async () => {
      if (!initData) return [];
      const result = await fetchMyData(initData, 'orders');
      return (result.orders || []) as DbOrder[];
    },
    enabled: !!user?.id && !!initData,
  });

  useEffect(() => {
    if (!user?.id) return;
    const interval = setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ['orders', user.id] });
    }, 15000);
    return () => clearInterval(interval);
  }, [user?.id, queryClient]);

  return query;
};

export const useOrderItems = (orderId: string) => {
  const { initData } = useTelegram();
  return useQuery({
    queryKey: ['order-items', orderId],
    queryFn: async () => {
      if (!initData) return [];
      const result = await fetchMyData(initData, 'order-items', { orderId });
      return (result.items || []) as DbOrderItem[];
    },
    enabled: !!orderId && !!initData,
  });
};

export const useOrderInventoryItems = (orderId: string) => {
  const { initData } = useTelegram();
  return useQuery({
    queryKey: ['order-inventory', orderId],
    queryFn: async () => {
      if (!initData) return [];
      const result = await fetchMyData(initData, 'order-inventory', { orderId });
      return (result.items || []) as DbInventoryItem[];
    },
    enabled: !!orderId && !!initData,
  });
};

export const useUserStats = () => {
  const { user, initData } = useTelegram();
  return useQuery({
    queryKey: ['user-stats', user?.id],
    queryFn: async () => {
      if (!initData) return { orderCount: 0, totalSpent: 0 };
      const result = await fetchMyData(initData, 'stats');
      return result.stats as { orderCount: number; totalSpent: number };
    },
    enabled: !!user?.id && !!initData,
  });
};

export const useUserProfile = () => {
  const { user, initData } = useTelegram();
  return useQuery({
    queryKey: ['user-profile', user?.id],
    queryFn: async () => {
      if (!initData) return null;
      const result = await fetchMyData(initData, 'profile');
      return result.profile as { balance: number; role: string; is_blocked: boolean } | null;
    },
    enabled: !!user?.id && !!initData,
    staleTime: 0,
    refetchOnMount: 'always',
  });
};

export const useBalanceHistory = () => {
  const { user, initData } = useTelegram();
  return useQuery({
    queryKey: ['balance-history', user?.id],
    queryFn: async () => {
      if (!initData) return [];
      const result = await fetchMyData(initData, 'balance-history');
      return (result.history || []) as DbBalanceHistory[];
    },
    enabled: !!user?.id && !!initData,
  });
};
