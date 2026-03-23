import { Link } from 'react-router-dom';
import { Trash2, Plus, Minus, ArrowRight, Shield, Zap, Clock, Tag } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStore } from '@/contexts/StoreContext';
import ProductCard from '@/components/ProductCard';
import { useProducts } from '@/hooks/useProducts';
import { useTelegram } from '@/contexts/TelegramContext';

const categoryEmoji: Record<string, string> = {
  'social-media': '📱', 'gaming': '🎮', 'streaming': '🎬', 'software': '🔑',
  'premium': '👑', 'automation': '🤖', 'ai-tools': '🧠', 'services': '⚡',
};

const Cart = () => {
  const {
    cart, removeFromCart, updateQuantity, cartTotal, clearCart,
    promoCode, setPromoCode, promoResult, promoError, promoLoading,
    applyPromo, discount, totalAfterDiscount,
  } = useStore();
  const { user, initData } = useTelegram();
  const { data: products } = useProducts();

  const recommended = products?.filter(p => !cart.some(c => c.product.id === p.id)).slice(0, 4) || [];

  if (cart.length === 0) {
    return (
      <div className="container-main mx-auto px-4 py-16 sm:py-20 text-center">
        <div className="text-5xl sm:text-6xl mb-4">🛒</div>
        <h2 className="font-display text-xl sm:text-2xl font-bold">Ваша корзина пуста</h2>
        <p className="text-muted-foreground text-sm mt-2">Загляните в каталог и найдите то, что вам понравится!</p>
        <Link to="/catalog"><Button variant="hero" className="mt-6">Перейти в каталог <ArrowRight className="w-4 h-4 ml-1" /></Button></Link>
      </div>
    );
  }

  return (
    <div className="container-main mx-auto px-4 py-6 sm:py-8">
      <h1 className="font-display text-2xl sm:text-3xl font-bold mb-6 sm:mb-8">Корзина</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 sm:gap-8">
        <div className="lg:col-span-2 space-y-3 sm:space-y-4">
          {cart.map(item => {
            const outOfStock = item.product.stock <= 0;
            return (
              <div key={item.product.id} className={`bg-card border border-border/50 rounded-xl p-3 sm:p-4 flex gap-3 sm:gap-4 ${outOfStock ? 'opacity-60' : ''}`}>
                <div className="w-16 h-16 sm:w-20 sm:h-20 bg-secondary/50 rounded-lg flex items-center justify-center text-2xl sm:text-3xl shrink-0 overflow-hidden">
                  {item.product.image ? (
                    <img src={item.product.image} alt={item.product.title} className="w-full h-full object-cover" />
                  ) : (
                    categoryEmoji[item.product.category_id || ''] || '⚡'
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <Link to={`/product/${item.product.id}`} className="font-display font-semibold text-xs sm:text-sm hover:text-primary transition-colors line-clamp-1">{item.product.title}</Link>
                  <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">{item.product.subtitle}</p>
                  <div className="flex items-center gap-1 mt-1">
                    {item.product.delivery_type === 'instant' ? (
                      <span className="text-[10px] text-primary flex items-center gap-0.5"><Zap className="w-3 h-3" /> Мгновенно</span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground flex items-center gap-0.5"><Clock className="w-3 h-3" /> Вручную</span>
                    )}
                    {outOfStock && <span className="text-[10px] text-destructive ml-2">Нет в наличии</span>}
                  </div>
                  <div className="flex items-center justify-between mt-2 sm:mt-3">
                    <div className="flex items-center gap-1.5 sm:gap-2">
                      <button onClick={() => updateQuantity(item.product.id, item.quantity - 1)}
                        className="w-7 h-7 rounded-md bg-secondary flex items-center justify-center hover:bg-secondary/80 transition-colors">
                        <Minus className="w-3 h-3" />
                      </button>
                      <span className="text-sm font-medium w-6 text-center">{item.quantity}</span>
                      <button onClick={() => updateQuantity(item.product.id, item.quantity + 1)}
                        disabled={item.quantity >= item.product.stock}
                        className="w-7 h-7 rounded-md bg-secondary flex items-center justify-center hover:bg-secondary/80 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>
                    <div className="flex items-center gap-2 sm:gap-3">
                      <span className="font-display font-bold text-sm sm:text-base">${(Number(item.product.price) * item.quantity).toFixed(2)}</span>
                      <button onClick={() => removeFromCart(item.product.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
          <Button variant="ghost" size="sm" onClick={clearCart} className="text-muted-foreground">Очистить корзину</Button>
        </div>

        <div className="space-y-4">
          <div className="bg-card border border-border/50 rounded-xl p-4 sm:p-6 space-y-4 sticky top-24">
            <h3 className="font-display font-semibold text-base sm:text-lg">Итого</h3>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted-foreground">Подытог</span><span>${cartTotal.toFixed(2)}</span></div>
              {promoResult && (
                <div className="flex justify-between text-primary">
                  <span>Промокод ({promoResult.discountType === 'percent' ? `-${promoResult.discountValue}%` : `-$${promoResult.discountValue}`})</span>
                  <span>-${discount.toFixed(2)}</span>
                </div>
              )}
              <div className="border-t border-border/30 pt-2 flex justify-between font-display font-bold text-lg">
                <span>Итого</span><span>${totalAfterDiscount.toFixed(2)}</span>
              </div>
            </div>
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Tag className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
                  <input type="text" placeholder="Промокод" value={promoCode} onChange={e => { setPromoCode(e.target.value); }}
                    className="w-full h-9 pl-8 pr-3 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
                </div>
                <Button variant="outline" size="sm" onClick={() => applyPromo(promoCode, user?.id, initData)} disabled={promoLoading}>
                  {promoLoading ? '...' : 'Применить'}
                </Button>
              </div>
              {promoError && <p className="text-xs text-destructive">{promoError}</p>}
              {promoResult && <p className="text-xs text-primary">✅ Промокод применён!</p>}
            </div>
            <Link to="/checkout" className="block">
              <Button variant="hero" size="xl" className="w-full">
                Оформить заказ <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </Link>
            <div className="space-y-2 pt-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1.5"><Shield className="w-3 h-3 text-primary" /> Безопасная оплата</span>
              <span className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-primary" /> Мгновенная цифровая доставка</span>
            </div>
          </div>
        </div>
      </div>

      {recommended.length > 0 && (
        <section className="mt-12 sm:mt-16">
          <h2 className="font-display text-lg sm:text-xl font-bold mb-4 sm:mb-6">Вам может понравиться</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {recommended.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}
    </div>
  );
};

export default Cart;
