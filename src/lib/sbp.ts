// Fixed conversion rate for SBP payments (RUB per 1 USD).
export const USD_RUB_RATE = 80;

export const usdToRub = (usd: number) => Math.round(usd * USD_RUB_RATE);

export const formatRub = (rub: number) =>
  new Intl.NumberFormat('ru-RU').format(rub) + ' ₽';
