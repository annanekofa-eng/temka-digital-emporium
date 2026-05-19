import { USD_RUB_RATE } from '@/lib/sbp';

/** Hardcoded USDT/USD → RUB rate (80 ₽). */
export const useExchangeRate = () => {
  return { data: USD_RUB_RATE, isLoading: false, error: null as unknown };
};

/** Format USD price to RUB string */
export const formatRub = (usdPrice: number, rate: number = USD_RUB_RATE): string => {
  const rub = usdPrice * rate;
  return `${Math.round(rub).toLocaleString('ru-RU')} ₽`;
};
