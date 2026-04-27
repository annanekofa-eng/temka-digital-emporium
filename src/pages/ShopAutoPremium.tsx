import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Crown, Loader2, Shield, Zap, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useShop } from '@/contexts/ShopContext';
import { useStorefront, useStorefrontPath } from '@/contexts/StorefrontContext';
import { useTelegram } from '@/contexts/TelegramContext';
import { useShopAutoProduct, validateTelegramTarget } from '@/hooks/useShopAutoProducts';
import { useUserProfile } from '@/hooks/useOrders';
import { supabase } from '@/integrations/supabase/client';
import PriceRub from '@/components/PriceRub';
import AutoPaymentMethodSelector, { type AutoPaymentMethod } from '@/components/storefront/AutoPaymentMethodSelector';
import AutoSbpPaymentSheet from '@/components/storefront/AutoSbpPaymentSheet';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';

type Duration = '3m' | '6m' | '12m';
const DURATIONS: { value: Duration; label: string; months: number }[] = [
  { value: '3m', label: '3 месяца', months: 3 },
  { value: '6m', label: '6 месяцев', months: 6 },
  { value: '12m', label: '12 месяцев', months: 12 },
];

const ShopAutoPremium = () => {
  const { shop } = useShop();
  const { supportLink } = useStorefront();
  const buildPath = useStorefrontPath();
  const navigate = useNavigate();
  const { initData } = useTelegram();
  const { data: autoProduct, isLoading } = useShopAutoProduct(shop?.id, 'telegram_premium');
  const { data: profile } = useUserProfile(shop?.id);
  const balance = Number(profile?.balance || 0);

  // Detect if shop has CryptoBot configured (for showing/disabling option)
  const { data: cryptoConfigured = false } = useQuery({
    queryKey: ['shop-payments-configured', shop?.id],
    enabled: !!shop?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('check_shop_payments_configured', { p_shop_id: shop!.id });
      if (error) return false;
      return !!data;
    },
  });

  // Detect if shop has SBP enabled
  const { data: sbpAvailable = false } = useQuery({
    queryKey: ['shop-sbp-enabled', shop?.id],
    enabled: !!shop?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shop_payment_methods')
        .select('enabled')
        .eq('shop_id', shop!.id)
        .eq('method', 'sbp_card')
        .maybeSingle();
      if (error) return false;
      return !!data?.enabled;
    },
  });

  const [target, setTarget] = useState('');
  const [duration, setDuration] = useState<Duration>('3m');
  const [paymentMethod, setPaymentMethod] = useState<AutoPaymentMethod>('cryptobot');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sbpStarted, setSbpStarted] = useState(false);

  const availableDurations = useMemo(() => {
    if (!autoProduct) return [];
    return DURATIONS.filter(d => {
      const price = (autoProduct as any)[`price_${d.value}`];
      return price != null && Number(price) > 0;
    });
  }, [autoProduct]);

  // Auto-correct duration if current one is unavailable
  const effectiveDuration: Duration = availableDurations.find(d => d.value === duration)?.value
    ?? availableDurations[0]?.value ?? '3m';

  const price = autoProduct ? Number((autoProduct as any)[`price_${effectiveDuration}`] || 0) : 0;

  // Auto-prefer balance if it covers price and crypto is unavailable
  useMemo(() => {
    if (price > 0 && !cryptoConfigured && balance >= price) setPaymentMethod('balance');
  }, [cryptoConfigured, balance, price]);

  const handleSubmit = async () => {
    setError('');
    const valid = validateTelegramTarget(target);
    if (!valid.ok) { setError(valid.error || 'Некорректный получатель'); return; }
    if (!autoProduct || price <= 0) { setError('Товар временно недоступен'); return; }
    if (!initData) { setError('Откройте магазин через Telegram'); return; }
    if (paymentMethod === 'balance' && balance < price) {
      setError('Недостаточно средств на балансе');
      return;
    }

    if (paymentMethod === 'sbp') {
      setSbpStarted(true);
      return;
    }

    setSubmitting(true);
    try {
      const { data, error: fnError } = await supabase.functions.invoke('create-auto-order', {
        body: {
          initData,
          shopId: shop!.id,
          productType: 'telegram_premium',
          targetUser: valid.value!,
          premiumDuration: effectiveDuration,
          paymentMethod,
        },
      });
      if (fnError) throw new Error(fnError.message || 'Ошибка');
      if ((data as any)?.error) throw new Error((data as any).error);
      const result = data as { orderNumber: string; paid?: boolean; payUrl?: string; miniAppUrl?: string };
      if (result.paid) {
        toast.success('Заказ оплачен с баланса');
      } else if (result.miniAppUrl) {
        const tg = (window as any)?.Telegram?.WebApp;
        if (tg?.openTelegramLink) tg.openTelegramLink(result.miniAppUrl);
        else window.open(result.miniAppUrl, '_blank');
      } else if (result.payUrl) {
        window.open(result.payUrl, '_blank');
      }
      navigate(`${buildPath('/order-status')}?order=${result.orderNumber}`);
    } catch (e: any) {
      setError(e?.message || 'Не удалось создать заказ');
      toast.error(e?.message || 'Не удалось создать заказ');
    } finally {
      setSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="container-main mx-auto px-4 py-12 text-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground mx-auto" />
      </div>
    );
  }

  if (!autoProduct || availableDurations.length === 0) {
    return (
      <div className="container-main mx-auto px-4 py-20 text-center">
        <div className="text-5xl mb-4">😕</div>
        <h2 className="font-display text-2xl font-bold">Товар недоступен</h2>
        <p className="text-muted-foreground mt-2">Telegram Premium временно не продаётся в этом магазине.</p>
        <Link to={buildPath('/catalog')}>
          <Button variant="outline" className="mt-4"><ArrowLeft className="w-4 h-4 mr-1" /> Назад в каталог</Button>
        </Link>
      </div>
    );
  }

  // SBP flow takes over the page once user has confirmed inputs
  if (sbpStarted && shop?.id) {
    const valid = validateTelegramTarget(target);
    return (
      <div className="container-main mx-auto px-4 py-6 sm:py-8 max-w-xl">
        <h1 className="font-display text-xl font-bold mb-4">Оплата по СБП — Telegram Premium</h1>
        <AutoSbpPaymentSheet
          shopId={shop.id}
          amountUsd={price}
          productType="telegram_premium"
          targetUser={valid.value || target}
          premiumDuration={effectiveDuration}
          supportLink={supportLink}
          onBack={() => setSbpStarted(false)}
        />
      </div>
    );
  }

  return (
    <div className="container-main mx-auto px-4 py-6 sm:py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6 overflow-x-auto whitespace-nowrap">
        <Link to={buildPath('/')} className="hover:text-foreground shrink-0">Главная</Link>
        <ChevronRight className="w-3 h-3 shrink-0" />
        <Link to={buildPath('/catalog')} className="hover:text-foreground shrink-0">Каталог</Link>
        <ChevronRight className="w-3 h-3 shrink-0" />
        <span className="text-foreground truncate">Telegram Premium</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        <div className="bg-gradient-to-br from-primary/15 to-primary/5 border border-primary/20 rounded-2xl p-8 sm:p-12 flex items-center justify-center min-h-[280px] sm:min-h-[400px]">
          <div className="text-center">
            <Crown className="w-24 h-24 sm:w-32 sm:h-32 text-primary mx-auto mb-3" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Telegram Premium</span>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary flex items-center gap-1">
              <Zap className="w-3 h-3" /> ОФИЦИАЛЬНАЯ ПОДПИСКА
            </span>
            {autoProduct.label && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-border bg-card text-muted-foreground">
                {autoProduct.label}
              </span>
            )}
          </div>

          <h1 className="font-display text-xl sm:text-2xl md:text-3xl font-bold">Telegram Premium</h1>
          <p className="text-muted-foreground text-sm sm:text-base mt-2">
            Подписка Telegram Premium с расширенными функциями: больше каналов, эксклюзивные стикеры, повышенные лимиты и многое другое.
          </p>

          <div className="flex items-baseline gap-3 mt-4">
            <span className="font-display text-2xl sm:text-3xl font-bold">${price.toFixed(2)}</span>
            <PriceRub usd={price} className="text-base" />
          </div>

          {/* Target user */}
          <div className="mt-6 space-y-2">
            <label htmlFor="tg-target" className="text-sm font-medium">Получатель (username или ID)</label>
            <input
              id="tg-target"
              type="text"
              value={target}
              onChange={(e) => { setTarget(e.target.value); setError(''); }}
              placeholder="@username или 123456789"
              maxLength={64}
              className="w-full h-11 px-3 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">Укажите аккаунт Telegram, на который будет активирована подписка.</p>
          </div>

          {/* Duration */}
          <div className="mt-5 space-y-2">
            <span className="text-sm font-medium">Срок подписки</span>
            <div className="grid grid-cols-3 gap-2">
              {availableDurations.map((d) => {
                const dPrice = Number((autoProduct as any)[`price_${d.value}`] || 0);
                const active = d.value === effectiveDuration;
                return (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => setDuration(d.value)}
                    className={`p-3 rounded-xl border text-left transition-colors ${
                      active
                        ? 'bg-primary/10 border-primary text-foreground'
                        : 'bg-card border-border hover:border-primary/40'
                    }`}
                  >
                    <div className="text-xs text-muted-foreground">{d.label}</div>
                    <div className="font-display text-sm font-bold mt-0.5">${dPrice.toFixed(2)}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Payment method */}
          <div className="mt-5">
            <AutoPaymentMethodSelector
              value={paymentMethod}
              onChange={setPaymentMethod}
              balance={balance}
              totalPrice={price}
              cryptoAvailable={cryptoConfigured}
            />
          </div>

          {error && (
            <div className="mt-4 p-3 rounded-lg bg-destructive/10 border border-destructive/30 text-sm text-destructive">
              {error}
            </div>
          )}

          <div className="flex flex-col gap-3 mt-6">
            <Button
              variant="hero" size="xl" className="w-full"
              onClick={handleSubmit}
              disabled={submitting || (paymentMethod === 'balance' && balance < price) || (paymentMethod === 'cryptobot' && !cryptoConfigured)}
            >
              {submitting
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Создание заказа...</>
                : paymentMethod === 'balance'
                  ? <>Оплатить с баланса ${price.toFixed(2)}</>
                  : <>Купить за ${price.toFixed(2)}</>}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-6 text-xs sm:text-sm text-muted-foreground">
            <div className="flex items-center gap-2"><Shield className="w-3.5 h-3.5 text-primary shrink-0" /> Гарантия активации</div>
            <div className="flex items-center gap-2"><Zap className="w-3.5 h-3.5 text-primary shrink-0" /> Обработка до 24ч</div>
          </div>
        </div>
      </div>

      {/* Support */}
      {supportLink && (
        <div className="mt-8 sm:mt-12 p-4 sm:p-6 bg-card border border-border/50 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <MessageCircle className="w-8 h-8 text-primary shrink-0 hidden sm:block" />
            <div>
              <h4 className="font-display font-semibold text-sm sm:text-base">Нужна помощь с заказом?</h4>
              <p className="text-xs sm:text-sm text-muted-foreground">Поддержка ответит в Telegram</p>
            </div>
          </div>
          <a href={supportLink} target="_blank" rel="noopener noreferrer">
            <Button variant="outline">Связаться с поддержкой</Button>
          </a>
        </div>
      )}
    </div>
  );
};

export default ShopAutoPremium;
