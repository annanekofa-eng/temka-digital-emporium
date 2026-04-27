import { useState, useMemo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, ChevronRight, Star, Loader2, Shield, Zap, MessageCircle } from 'lucide-react';
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

const PRESETS = [50, 100, 250, 500, 1000, 2500];

const ShopAutoStars = () => {
  const { shop } = useShop();
  const { supportLink } = useStorefront();
  const buildPath = useStorefrontPath();
  const navigate = useNavigate();
  const { initData } = useTelegram();
  const { data: autoProduct, isLoading } = useShopAutoProduct(shop?.id, 'telegram_stars');
  const { data: profile } = useUserProfile(shop?.id);
  const balance = Number(profile?.balance || 0);

  const { data: cryptoConfigured = false } = useQuery({
    queryKey: ['shop-payments-configured', shop?.id],
    enabled: !!shop?.id,
    queryFn: async () => {
      const { data, error } = await supabase.rpc('check_shop_payments_configured', { p_shop_id: shop!.id });
      if (error) return false;
      return !!data;
    },
  });

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
  const [amount, setAmount] = useState<number>(50);
  const [paymentMethod, setPaymentMethod] = useState<AutoPaymentMethod>('cryptobot');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [sbpStarted, setSbpStarted] = useState(false);

  const minStars = autoProduct?.min_stars ?? 50;
  const maxStars = autoProduct?.max_stars ?? 100000;
  const pricePerStar = Number(autoProduct?.price_per_star || 0);

  // Filter presets by min/max
  const visiblePresets = useMemo(
    () => PRESETS.filter(p => p >= minStars && p <= maxStars),
    [minStars, maxStars],
  );

  const totalPrice = useMemo(() => {
    const safe = Number.isFinite(amount) ? amount : 0;
    return Math.max(0, Math.round(safe * pricePerStar * 100) / 100);
  }, [amount, pricePerStar]);

  const isAmountValid = Number.isInteger(amount) && amount >= minStars && amount <= maxStars;

  // Auto-prefer balance if it covers price and crypto is unavailable
  useMemo(() => {
    if (totalPrice > 0 && !cryptoConfigured && balance >= totalPrice) setPaymentMethod('balance');
  }, [cryptoConfigured, balance, totalPrice]);

  const handleSubmit = async () => {
    setError('');
    const valid = validateTelegramTarget(target);
    if (!valid.ok) { setError(valid.error || 'Некорректный получатель'); return; }
    if (!autoProduct || pricePerStar <= 0) { setError('Товар временно недоступен'); return; }
    if (!isAmountValid) { setError(`Количество от ${minStars} до ${maxStars}`); return; }
    if (!initData) { setError('Откройте магазин через Telegram'); return; }
    if (paymentMethod === 'balance' && balance < totalPrice) {
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
          productType: 'telegram_stars',
          targetUser: valid.value!,
          starsAmount: amount,
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

  if (!autoProduct || pricePerStar <= 0) {
    return (
      <div className="container-main mx-auto px-4 py-20 text-center">
        <div className="text-5xl mb-4">😕</div>
        <h2 className="font-display text-2xl font-bold">Товар недоступен</h2>
        <p className="text-muted-foreground mt-2">Telegram Stars временно не продаются в этом магазине.</p>
        <Link to={buildPath('/catalog')}>
          <Button variant="outline" className="mt-4"><ArrowLeft className="w-4 h-4 mr-1" /> Назад в каталог</Button>
        </Link>
      </div>
    );
  }

  if (sbpStarted && shop?.id) {
    const valid = validateTelegramTarget(target);
    return (
      <div className="container-main mx-auto px-4 py-6 sm:py-8 max-w-xl">
        <h1 className="font-display text-xl font-bold mb-4">Оплата по СБП — Telegram Stars</h1>
        <AutoSbpPaymentSheet
          shopId={shop.id}
          amountUsd={totalPrice}
          productType="telegram_stars"
          targetUser={valid.value || target}
          starsAmount={amount}
          supportLink={supportLink}
          onBack={() => setSbpStarted(false)}
        />
      </div>
    );
  }

  return (
    <div className="container-main mx-auto px-4 py-6 sm:py-8">
      <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6 overflow-x-auto whitespace-nowrap">
        <Link to={buildPath('/')} className="hover:text-foreground shrink-0">Главная</Link>
        <ChevronRight className="w-3 h-3 shrink-0" />
        <Link to={buildPath('/catalog')} className="hover:text-foreground shrink-0">Каталог</Link>
        <ChevronRight className="w-3 h-3 shrink-0" />
        <span className="text-foreground truncate">Telegram Stars</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        <div className="bg-gradient-to-br from-amber-500/15 to-amber-500/5 border border-amber-500/20 rounded-2xl p-8 sm:p-12 flex items-center justify-center min-h-[280px] sm:min-h-[400px]">
          <div className="text-center">
            <Star className="w-24 h-24 sm:w-32 sm:h-32 fill-amber-400 text-amber-400 mx-auto mb-3" />
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Telegram Stars</span>
          </div>
        </div>

        <div>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary flex items-center gap-1">
              <Zap className="w-3 h-3" /> ОФИЦИАЛЬНАЯ ВАЛЮТА TELEGRAM
            </span>
            {autoProduct.label && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-border bg-card text-muted-foreground">
                {autoProduct.label}
              </span>
            )}
          </div>

          <h1 className="font-display text-xl sm:text-2xl md:text-3xl font-bold">Telegram Stars</h1>
          <p className="text-muted-foreground text-sm sm:text-base mt-2">
            Купите Telegram Stars — внутреннюю валюту Telegram для оплаты в ботах, премиум-контента и подарков.
          </p>

          <div className="flex items-baseline gap-3 mt-4">
            <span className="font-display text-2xl sm:text-3xl font-bold">${totalPrice.toFixed(2)}</span>
            <PriceRub usd={totalPrice} className="text-base" />
            <span className="text-sm text-muted-foreground">за {amount || 0} ⭐</span>
          </div>

          {/* Target */}
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
          </div>

          {/* Presets */}
          {visiblePresets.length > 0 && (
            <div className="mt-5 space-y-2">
              <span className="text-sm font-medium">Популярные пакеты</span>
              <div className="grid grid-cols-3 gap-2">
                {visiblePresets.map((p) => {
                  const active = amount === p;
                  return (
                    <button
                      key={p}
                      type="button"
                      onClick={() => { setAmount(p); setError(''); }}
                      className={`p-2.5 rounded-xl border text-center transition-colors ${
                        active
                          ? 'bg-primary/10 border-primary text-foreground'
                          : 'bg-card border-border hover:border-primary/40'
                      }`}
                    >
                      <div className="font-display text-sm font-bold flex items-center justify-center gap-1">
                        <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" /> {p}
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">${(p * pricePerStar).toFixed(2)}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Custom amount */}
          <div className="mt-5 space-y-2">
            <label htmlFor="stars-amount" className="text-sm font-medium">Своё количество (от {minStars} до {maxStars})</label>
            <input
              id="stars-amount"
              type="number"
              value={amount}
              min={minStars}
              max={maxStars}
              step={1}
              onChange={(e) => { setAmount(parseInt(e.target.value) || 0); setError(''); }}
              className="w-full h-11 px-3 bg-card border border-border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <p className="text-xs text-muted-foreground">Цена за 1 звезду: ${pricePerStar.toFixed(4)}</p>
          </div>

          {/* Payment method */}
          <div className="mt-5">
            <AutoPaymentMethodSelector
              value={paymentMethod}
              onChange={setPaymentMethod}
              balance={balance}
              totalPrice={totalPrice}
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
              disabled={submitting || !isAmountValid || (paymentMethod === 'balance' && balance < totalPrice) || (paymentMethod === 'cryptobot' && !cryptoConfigured)}
            >
              {submitting
                ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> Создание заказа...</>
                : paymentMethod === 'balance'
                  ? <>Оплатить с баланса ${totalPrice.toFixed(2)}</>
                  : <>Купить {amount} ⭐ за ${totalPrice.toFixed(2)}</>}
            </Button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-6 text-xs sm:text-sm text-muted-foreground">
            <div className="flex items-center gap-2"><Shield className="w-3.5 h-3.5 text-primary shrink-0" /> Гарантия зачисления</div>
            <div className="flex items-center gap-2"><Zap className="w-3.5 h-3.5 text-primary shrink-0" /> Обработка до 24ч</div>
          </div>
        </div>
      </div>

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

export default ShopAutoStars;
