import { useState } from 'react';
import cryptobotLogo from '@/assets/cryptobot-logo.jpeg';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, Zap, Lock, CheckCircle2, ArrowLeft, Wallet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/contexts/StoreContext';
import { useTelegram } from '@/contexts/TelegramContext';
import { useStorefrontPath } from '@/contexts/StorefrontContext';
import PriceRub from '@/components/PriceRub';

import { useUserProfile } from '@/hooks/useOrders';
import { supabase } from '@/integrations/supabase/client';

const Checkout = () => {
  const { cart, cartTotal, clearCart, discount, totalAfterDiscount, promoResult } = useStore();
  const { user, isInTelegram, openTelegramLink, haptic, initData } = useTelegram();
  const { data: profile } = useUserProfile();
  const navigate = useNavigate();
  const buildPath = useStorefrontPath();
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  const displayName = user
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : 'Telegram User';
  const avatar = user?.firstName?.[0]?.toUpperCase() || 'T';

  const balance = Number(profile?.balance || 0);
  const balanceUsed = Math.min(balance, totalAfterDiscount);
  const toPay = Math.max(0, totalAfterDiscount - balanceUsed);

  if (cart.length === 0) {
    return (
      <div className="container-main mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-4">🛒</div>
        <h2 className="font-display text-xl font-bold">Нечего оформлять</h2>
        <Link to={buildPath('/catalog')}><Button variant="hero" className="mt-4">Перейти в каталог</Button></Link>
      </div>
    );
  }

  const handleCheckout = async () => {
    setProcessing(true);
    setError('');
    haptic.impact('medium');

    try {
      const orderNumber = `TK-${Date.now().toString(36).toUpperCase()}`;
      const description = cart.map(item => `${item.product.title} ×${item.quantity}`).join(', ');
      const itemsPayload = cart.map(item => ({
        productId: item.product.id,
        productTitle: item.product.title,
        productPrice: Number(item.product.price),
        quantity: item.quantity,
      }));

      if (toPay <= 0) {
        // Full balance payment
        const { data, error: fnError } = await supabase.functions.invoke('pay-with-balance', {
          body: {
            initData,
            orderNumber,
            items: itemsPayload,
            promoCode: promoResult?.code || null,
          },
        });
        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);
        haptic.notification('success');
        clearCart();
        navigate(`${buildPath('/order-success')}?order=${data?.orderNumber || orderNumber}`);
      } else {
        // CryptoBot payment (partial or full)
        const { data, error: fnError } = await supabase.functions.invoke('create-invoice', {
          body: {
            initData,
            amount: toPay.toFixed(2),
            currency: 'USD',
            description,
            orderNumber,
            items: itemsPayload,
            promoCode: promoResult?.code || null,
            balanceUsed: balanceUsed,
          },
        });

        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);

        if (isInTelegram && data?.payUrl) {
          openTelegramLink(data.payUrl);
          navigate(`${buildPath('/order-status')}?order=${data.orderNumber || orderNumber}`);
        } else if (data?.payUrl) {
          window.open(data.payUrl, '_blank');
          navigate(`${buildPath('/order-status')}?order=${data.orderNumber || orderNumber}`);
        } else {
          throw new Error('Не удалось создать инвойс');
        }
      }
    } catch (err: any) {
      console.error('Checkout error:', err);
      setError(err.message || 'Ошибка при создании заказа');
      haptic.notification('error');
    } finally {
      setProcessing(false);
    }
  };

  return (
    <div className="container-main mx-auto px-4 py-4 sm:py-6">
      <Link to={buildPath('/cart')} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="w-3 h-3" /> Назад в корзину
      </Link>
      <h1 className="font-display text-xl sm:text-2xl font-bold mb-4">Оформление заказа</h1>

      <div className="space-y-3">
        <div className="bg-card border border-border/50 rounded-xl p-4">
          <h3 className="font-display font-semibold text-sm mb-2">Ваш аккаунт</h3>
          <div className="flex items-center gap-2">
            {user?.photoUrl ? (
              <img src={user.photoUrl} alt={displayName} className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">{avatar}</div>
            )}
            <div>
              <div className="text-sm font-medium">{displayName}</div>
              <div className="text-[10px] text-muted-foreground">Заказ привязан к вашему Telegram профилю</div>
            </div>
          </div>
        </div>

        <div className="bg-card border border-border/50 rounded-xl p-4">
          <h3 className="font-display font-semibold text-sm mb-3">Способ оплаты</h3>
          <div className="mb-3 flex items-center justify-between p-2.5 rounded-lg bg-secondary/50 border border-border/30">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Ваш баланс</span>
            </div>
            <span className="text-sm font-bold text-primary">${balance.toFixed(2)}</span>
          </div>
          {toPay > 0 ? (
            <div className="p-3 rounded-xl border border-primary bg-primary/5 text-center">
              <img src={cryptobotLogo} alt="CryptoBot" className="w-8 h-8 rounded-lg mx-auto mb-1" />
              <div className="text-sm font-medium text-primary">CryptoBot</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {balanceUsed > 0
                  ? `$${balanceUsed.toFixed(2)} с баланса + $${toPay.toFixed(2)} через CryptoBot`
                  : 'Оплата криптовалютой через Telegram'}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl border border-primary bg-primary/5 text-center">
              <Wallet className="w-6 h-6 text-primary mx-auto mb-1" />
              <div className="text-sm font-medium text-primary">Оплата балансом</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Полная оплата с вашего баланса</div>
            </div>
          )}
        </div>


        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-xs text-destructive">
            {error}
          </div>
        )}

        <div className="bg-card border border-border/50 rounded-xl p-4 space-y-3">
          <h3 className="font-display font-semibold text-sm">Итого заказа</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {cart.map(item => (
              <div key={item.product.id} className="flex justify-between text-xs">
                <span className="text-muted-foreground line-clamp-1 flex-1">{item.product.title} ×{item.quantity}</span>
                <span className="font-medium ml-2">${(Number(item.product.price) * item.quantity).toFixed(2)}</span>
                <span className="ml-1"><PriceRub usd={Number(item.product.price) * item.quantity} /></span>
              </div>
            ))}
          </div>

          {discount > 0 && (
            <div className="flex justify-between text-xs text-primary">
              <span>Промокод ({promoResult?.code})</span>
              <span>-${discount.toFixed(2)}</span>
            </div>
          )}

          {balanceUsed > 0 && (
            <div className="flex justify-between text-xs text-primary">
              <span>Списание с баланса</span>
              <span>-${balanceUsed.toFixed(2)}</span>
            </div>
          )}

          <div className="border-t border-border/30 pt-2 space-y-1">
            <div className="flex justify-between text-sm text-muted-foreground">
              <span>Сумма заказа</span>
              <span>${totalAfterDiscount.toFixed(2)}</span>
            </div>
            {toPay > 0 ? (
              <div className="flex justify-between font-display font-bold text-base">
                <span>К оплате через CryptoBot</span>
                <div className="text-right">
                  <div>${toPay.toFixed(2)}</div>
                  <PriceRub usd={toPay} className="font-normal" />
                </div>
              </div>
            ) : (
              <div className="flex justify-between font-display font-bold text-base">
                <span>К оплате (баланс)</span>
                <div className="text-right">
                  <div>${totalAfterDiscount.toFixed(2)}</div>
                  <PriceRub usd={totalAfterDiscount} className="font-normal" />
                </div>
              </div>
            )}
          </div>

          <Button variant="hero" size="lg" className="w-full" onClick={handleCheckout}
            disabled={processing}>
            {processing ? (
              <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> Создание заказа...</span>
            ) : toPay > 0 ? (
              <><Lock className="w-4 h-4 mr-1" /> Оплатить — ${toPay.toFixed(2)}</>
            ) : (
              <><Wallet className="w-4 h-4 mr-1" /> Оплатить балансом</>
            )}
          </Button>

          <p className="text-[10px] text-muted-foreground text-center pt-1">
            Нажимая «Оплатить», вы соглашаетесь с{' '}
            <Link to={buildPath('/terms')} className="text-primary hover:underline">условиями сервиса</Link>.
          </p>

          <div className="space-y-1.5 pt-1 text-[10px] text-muted-foreground">
            <span className="flex items-center gap-1.5"><Shield className="w-3 h-3 text-primary" /> Безопасная оплата</span>
            <span className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-primary" /> Мгновенная доставка</span>
            <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary" /> Защита покупателя</span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Checkout;
