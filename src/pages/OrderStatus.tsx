import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStorefrontPath, useStorefront } from '@/contexts/StorefrontContext';
import { Package, MessageCircle, ShoppingCart, Clock, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOrders } from '@/hooks/useOrders';
import { useSupportUsername } from '@/hooks/useSupportUsername';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient } from '@tanstack/react-query';
import { useTelegram } from '@/contexts/TelegramContext';

const OrderStatus = () => {
  const buildPath = useStorefrontPath();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const orderNumber = searchParams.get('order');
  const { data: orders } = useOrders();
  const queryClient = useQueryClient();
  const { data: supportUsername } = useSupportUsername();
  const { supportLink } = useStorefront();
  const { initData, user } = useTelegram();
  const [polling, setPolling] = useState(true);
  const [expired, setExpired] = useState(false);

  const order = orders?.find(o => o.order_number === orderNumber);

  const checkPayment = useCallback(async () => {
    if (!order?.id) return;
    if (order.payment_status === 'paid') {
      setPolling(false);
      navigate(`${buildPath('/order-success')}?order=${orderNumber}`, { replace: true });
      return;
    }

    try {
      const { data, error } = await supabase.functions.invoke('check-payment', {
        body: { orderId: order.id, initData },
      });

      if (error) {
        console.error('Check payment error:', error);
        return;
      }

      if (data?.paymentStatus === 'paid') {
        setPolling(false);
        queryClient.setQueryData<any[]>(['orders', user?.id, undefined], (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((o) => o.id === order.id
            ? { ...o, payment_status: 'paid', status: data?.status || 'paid' }
            : o);
        });
        queryClient.invalidateQueries({ queryKey: ['user-profile'] });
        queryClient.invalidateQueries({ queryKey: ['balance-history'] });
        queryClient.invalidateQueries({ queryKey: ['user-stats'] });
        await queryClient.refetchQueries({ queryKey: ['orders', user?.id, undefined] });
        navigate(`${buildPath('/order-success')}?order=${orderNumber}`, { replace: true });
      } else if (data?.paymentStatus === 'expired') {
        setExpired(true);
        setPolling(false);
        queryClient.invalidateQueries({ queryKey: ['orders', user?.id, undefined] });
      }
    } catch (err) {
      console.error('Payment check failed:', err);
    }
  }, [order?.id, order?.payment_status, queryClient, initData, user?.id, navigate, buildPath, orderNumber]);

  useEffect(() => {
    if (!order?.id || expired) return;

    if (order.payment_status === 'paid') {
      navigate(`${buildPath('/order-success')}?order=${orderNumber}`, { replace: true });
      return;
    }

    const interval = setInterval(checkPayment, 5000);
    const timeout = setTimeout(() => {
      setPolling(false);
      clearInterval(interval);
    }, 5 * 60 * 1000);

    checkPayment();

    return () => {
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [order?.id, order?.payment_status, expired, checkPayment, navigate, buildPath, orderNumber]);

  const normalizedSupportUsername = (supportUsername || '').replace(/^@/, '').replace(/[^a-zA-Z0-9_]/g, '');
  const resolvedSupportLink = supportLink || (normalizedSupportUsername ? `https://t.me/${normalizedSupportUsername}` : undefined);

  return (
    <div className="container-main mx-auto px-4 py-12 sm:py-16 text-center max-w-md">
      <div className="animate-fade-in">
        {expired ? (
          <>
            <div className="w-14 h-14 rounded-full bg-destructive/20 text-destructive flex items-center justify-center mx-auto mb-4">
              <XCircle className="w-7 h-7" />
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold">Инвойс истёк</h1>
            <p className="text-muted-foreground text-sm mt-2">Время оплаты истекло. Попробуйте оформить заказ снова.</p>
          </>
        ) : (
          <>
            <div className="w-14 h-14 rounded-full bg-warning/20 text-warning flex items-center justify-center mx-auto mb-4">
              {polling ? (
                <Loader2 className="w-7 h-7 animate-spin" />
              ) : (
                <Clock className="w-7 h-7" />
              )}
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold">Ожидание оплаты</h1>
            <p className="text-muted-foreground text-sm mt-2">
              {polling
                ? 'Проверяем статус оплаты через CryptoBot...'
                : 'Оплатите инвойс в CryptoBot. После подтверждения мы автоматически обновим статус заказа.'}
            </p>
          </>
        )}

        <div className="bg-card border border-border/50 rounded-xl p-4 mt-5 text-left space-y-2.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">ID заказа</span>
            <span className="font-mono font-medium">{orderNumber || '—'}</span>
          </div>
          {order && (
            <>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Сумма</span>
                <span className="font-medium">
                  ${Math.max(0, Number(order.total_amount) - Number(order.discount_amount || 0)).toFixed(2)}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Статус оплаты</span>
                <span className={`font-medium ${expired ? 'text-destructive' : 'text-warning'}`}>
                  {expired ? '❌ Истёк' : '⏳ Ожидание оплаты'}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Доставка</span>
                <span className="font-medium">После подтверждения оплаты</span>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 mt-5">
          {expired ? (
            <Link to={buildPath('/catalog')}><Button variant="hero" size="sm" className="w-full"><ShoppingCart className="w-4 h-4 mr-1" /> Оформить заново</Button></Link>
          ) : (
            <Link to={buildPath('/account')}><Button variant="outline" size="sm" className="w-full"><Package className="w-4 h-4 mr-1" /> Мои заказы</Button></Link>
          )}
          {resolvedSupportLink && (
            <a href={resolvedSupportLink} target="_blank" rel="noopener noreferrer">
              <Button variant="outline" size="sm" className="w-full"><MessageCircle className="w-4 h-4 mr-1" /> Поддержка в Telegram</Button>
            </a>
          )}
          {!expired && (
            <Link to={buildPath('/catalog')}><Button variant="hero" size="sm" className="w-full"><ShoppingCart className="w-4 h-4 mr-1" /> Продолжить покупки</Button></Link>
          )}
        </div>
      </div>
    </div>
  );
};

export default OrderStatus;
