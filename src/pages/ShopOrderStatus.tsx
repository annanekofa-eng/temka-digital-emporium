import { useEffect, useState, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStorefront, useStorefrontPath } from '@/contexts/StorefrontContext';
import { Package, MessageCircle, ShoppingCart, Clock, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOrders } from '@/hooks/useOrders';
import { supabase } from '@/integrations/supabase/client';
import { useQueryClient, useQuery } from '@tanstack/react-query';
import { useTelegram } from '@/contexts/TelegramContext';
import { useShop } from '@/contexts/ShopContext';

const ShopOrderStatus = () => {
  const buildPath = useStorefrontPath();
  const navigate = useNavigate();
  const { supportLink } = useStorefront();
  const { shop, clearCart } = useShop();
  const shopId = shop?.id;
  const [searchParams] = useSearchParams();
  const orderNumber = searchParams.get('order');
  const { data: orders } = useOrders(shopId);
  const queryClient = useQueryClient();
  const { initData, user } = useTelegram();
  const [polling, setPolling] = useState(true);
  const [expired, setExpired] = useState(false);

  // Найти заказ в кеше; если его там ещё нет (свежесозданный) — подгрузить точечно.
  const cachedOrder = orders?.find(o => o.order_number === orderNumber);
  const { data: fetchedOrder } = useQuery({
    queryKey: ['shop-order-by-number', shopId, orderNumber],
    enabled: !!shopId && !!orderNumber && !cachedOrder,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('shop_orders')
        .select('*')
        .eq('shop_id', shopId!)
        .eq('order_number', orderNumber!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const order: any = cachedOrder || fetchedOrder;

  const checkPayment = useCallback(async () => {
    if (!order?.id) return;
    if (order.payment_status === 'paid') {
      setPolling(false);
      clearCart();
      navigate(`${buildPath('/order-success')}?order=${orderNumber}`, { replace: true });
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke('check-payment', {
        body: { orderId: order.id, initData, shopId },
      });
      if (error) return;
      if (data?.paymentStatus === 'paid') {
        setPolling(false);
        clearCart();
        // Optimistically update the cached order so the success page sees `paid`
        // immediately and doesn't bounce us back to `/order-status`.
        queryClient.setQueryData<any[]>(['orders', user?.id, shopId], (prev) => {
          if (!Array.isArray(prev)) return prev;
          return prev.map((o) => o.id === order.id
            ? { ...o, payment_status: 'paid', status: data?.status || 'paid' }
            : o);
        });
        // Refresh related data, then refetch orders before navigating to make sure
        // the server-side state lands in cache.
        queryClient.invalidateQueries({ queryKey: ['user-profile'] });
        queryClient.invalidateQueries({ queryKey: ['balance-history'] });
        queryClient.invalidateQueries({ queryKey: ['user-stats'] });
        await queryClient.refetchQueries({ queryKey: ['orders', user?.id, shopId] });
        navigate(`${buildPath('/order-success')}?order=${orderNumber}`, { replace: true });
      } else if (data?.paymentStatus === 'expired') {
        setExpired(true);
        setPolling(false);
        queryClient.invalidateQueries({ queryKey: ['orders', user?.id, shopId] });
      }
    } catch {}
  }, [order?.id, order?.payment_status, queryClient, initData, shopId, user?.id, clearCart, navigate, buildPath, orderNumber]);

  useEffect(() => {
    if (!order?.id || expired) return;
    if (order.payment_status === 'paid') {
      clearCart();
      navigate(`${buildPath('/order-success')}?order=${orderNumber}`, { replace: true });
      return;
    }
    const interval = setInterval(checkPayment, 5000);
    const timeout = setTimeout(() => { setPolling(false); clearInterval(interval); }, 5 * 60 * 1000);
    checkPayment();
    return () => { clearInterval(interval); clearTimeout(timeout); };
  }, [order?.id, order?.payment_status, expired, checkPayment, clearCart, navigate, buildPath, orderNumber]);

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
              {polling ? <Loader2 className="w-7 h-7 animate-spin" /> : <Clock className="w-7 h-7" />}
            </div>
            <h1 className="font-display text-xl sm:text-2xl font-bold">Ожидание оплаты</h1>
            <p className="text-muted-foreground text-sm mt-2">{polling ? 'Проверяем статус оплаты...' : 'Оплатите заказ через CryptoBot или СБП. После подтверждения мы автоматически обновим статус.'}</p>
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
                <span className="font-medium">${Math.max(0, Number(order.total_amount) - Number(order.discount_amount || 0)).toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Статус оплаты</span>
                <span className={`font-medium ${expired ? 'text-destructive' : 'text-warning'}`}>
                  {expired ? '❌ Истёк' : '⏳ Ожидание оплаты'}
                </span>
              </div>
            </>
          )}
        </div>

        <div className="flex flex-col gap-2 mt-5">
          {expired && <Link to={buildPath('/catalog')}><Button variant="hero" size="sm" className="w-full"><ShoppingCart className="w-4 h-4 mr-1" /> Оформить заново</Button></Link>}
          <Link to={buildPath('/account')}><Button variant="outline" size="sm" className="w-full"><Package className="w-4 h-4 mr-1" /> Мои заказы</Button></Link>
          {supportLink && <a href={supportLink} target="_blank" rel="noopener noreferrer"><Button variant="outline" size="sm" className="w-full"><MessageCircle className="w-4 h-4 mr-1" /> Поддержка</Button></a>}
          {!expired && <Link to={buildPath('/catalog')}><Button variant="hero" size="sm" className="w-full"><ShoppingCart className="w-4 h-4 mr-1" /> Продолжить покупки</Button></Link>}
        </div>
      </div>
    </div>
  );
};

export default ShopOrderStatus;
