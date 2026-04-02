import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useStorefront, useStorefrontPath } from '@/contexts/StorefrontContext';
import { CheckCircle2, Package, MessageCircle, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useOrders } from '@/hooks/useOrders';
import { useShop } from '@/contexts/ShopContext';

const ShopOrderSuccess = () => {
  const buildPath = useStorefrontPath();
  const navigate = useNavigate();
  const { supportLink } = useStorefront();
  const { shop, clearCart } = useShop();
  const shopId = shop?.id;
  const [searchParams] = useSearchParams();
  const orderNumber = searchParams.get('order');
  const { data: orders } = useOrders(shopId);

  const order = orders?.find(o => o.order_number === orderNumber);
  const isPaid = order?.payment_status === 'paid';
  const isDelivered = order?.status === 'delivered' || order?.status === 'completed';

  useEffect(() => {
    if (isPaid) clearCart();
  }, [isPaid, clearCart]);

  useEffect(() => {
    if (order && !isPaid) {
      navigate(`${buildPath('/order-status')}?order=${orderNumber}`, { replace: true });
    }
  }, [order, isPaid, navigate, buildPath, orderNumber]);

  if (order && !isPaid) return null;

  return (
    <div className="container-main mx-auto px-4 py-12 sm:py-16 text-center max-w-md">
      <div className="animate-fade-in">
        <div className="w-14 h-14 rounded-full bg-primary/20 text-primary flex items-center justify-center mx-auto mb-4">
          <CheckCircle2 className="w-7 h-7" />
        </div>
        <h1 className="font-display text-xl sm:text-2xl font-bold">{isDelivered ? 'Товар доставлен!' : 'Оплата подтверждена!'}</h1>
        <p className="text-muted-foreground text-sm mt-2">{isDelivered ? 'Данные товара отправлены вам в Telegram.' : 'Ваш товар будет доставлен в ближайшее время.'}</p>

        <div className="bg-card border border-border/50 rounded-xl p-4 mt-5 text-left space-y-2.5">
          <div className="flex justify-between text-xs">
            <span className="text-muted-foreground">ID заказа</span>
            <span className="font-mono font-medium">{orderNumber || '—'}</span>
          </div>
          {order && (() => {
            const total = Number(order.total_amount);
            const discountAmt = Number(order.discount_amount || 0);
            const finalAmount = Math.max(0, total - discountAmt);
            return (
              <>
                {discountAmt > 0 && (
                  <>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Сумма</span>
                      <span className="font-medium line-through text-muted-foreground">${total.toFixed(2)}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-muted-foreground">Промокод {order.promo_code ? `(${order.promo_code})` : ''}</span>
                      <span className="font-medium text-primary">-${discountAmt.toFixed(2)}</span>
                    </div>
                  </>
                )}
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{discountAmt > 0 ? 'Итого' : 'Сумма'}</span>
                  <span className="font-medium">${finalAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">Статус</span>
                  <span className="font-medium text-primary">
                    ✅ Оплачен
                  </span>
                </div>
              </>
            );
          })()}
        </div>

        <div className="flex flex-col gap-2 mt-5">
          <Link to={buildPath('/account')}><Button variant="outline" size="sm" className="w-full"><Package className="w-4 h-4 mr-1" /> Мои заказы</Button></Link>
          {supportLink && <a href={supportLink} target="_blank" rel="noopener noreferrer"><Button variant="outline" size="sm" className="w-full"><MessageCircle className="w-4 h-4 mr-1" /> Поддержка</Button></a>}
          <Link to={buildPath('/catalog')}><Button variant="hero" size="sm" className="w-full"><ShoppingCart className="w-4 h-4 mr-1" /> Продолжить покупки</Button></Link>
        </div>
      </div>
    </div>
  );
};

export default ShopOrderSuccess;
