import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

interface ExchangeRateResponse {
  rate: number;
  source: string;
  target: string;
  updated_at: string;
}

const fetchExchangeRate = async (): Promise<number> => {
  const { data, error } = await supabase.functions.invoke('get-exchange-rate');
  if (error) throw error;
  return (data as ExchangeRateResponse).rate;
};

export const useExchangeRate = () => {
  return useQuery({
    queryKey: ['exchange-rate', 'usdt-rub'],
    queryFn: fetchExchangeRate,
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000,
    retry: 2,
    refetchOnWindowFocus: false,
  });
};

/** Format USD price to RUB string */
export const formatRub = (usdPrice: number, rate: number): string => {
  const rub = usdPrice * rate;
  return `${Math.round(rub).toLocaleString('ru-RU')} ₽`;
};