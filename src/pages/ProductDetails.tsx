import { useParams, Link } from 'react-router-dom';
import { Zap, Clock, Shield, ShoppingCart, CheckCircle2, ChevronRight, ArrowLeft, MessageCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProductCard from '@/components/ProductCard';
import ProductCardSkeleton from '@/components/ProductCardSkeleton';
import { useProduct, useProducts } from '@/hooks/useProducts';
import { useStore } from '@/contexts/StoreContext';
import { Skeleton } from '@/components/ui/skeleton';
import { useSupportUsername } from '@/hooks/useSupportUsername';
import { useStorefront, useStorefrontPath } from '@/contexts/StorefrontContext';
import PriceRub from '@/components/PriceRub';

const categoryEmoji: Record<string, string> = {
  'social-media': '📱', 'gaming': '🎮', 'streaming': '🎬', 'software': '🔑',
  'premium': '👑', 'automation': '🤖', 'ai-tools': '🧠', 'services': '⚡',
};

const ProductDetails = () => {
  const { id } = useParams<{ id: string }>();
  const { data: product, isLoading, error } = useProduct(id || '');
  const { data: allProducts } = useProducts();
  const { addToCart } = useStore();
  const { data: supportUsername } = useSupportUsername();
  const { supportLink } = useStorefront();
  const buildPath = useStorefrontPath();

  if (isLoading) {
    return (
      <div className="container-main mx-auto px-4 py-6 sm:py-8 space-y-6">
        <Skeleton className="h-4 w-48" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Skeleton className="h-[300px] rounded-2xl" />
          <div className="space-y-4">
            <Skeleton className="h-6 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-12 w-full" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !product) {
    return (
      <div className="container-main mx-auto px-4 py-20 text-center">
        <div className="text-5xl mb-4">😕</div>
        <h2 className="font-display text-2xl font-bold">Товар не найден</h2>
        <p className="text-muted-foreground mt-2">Товар, который вы ищете, не существует или был удалён.</p>
        <Link to={buildPath('/catalog')}><Button variant="outline" className="mt-4"><ArrowLeft className="w-4 h-4 mr-1" /> Назад в каталог</Button></Link>
      </div>
    );
  }

  const discount = product.old_price ? Math.round((1 - Number(product.price) / Number(product.old_price)) * 100) : 0;
  const similar = allProducts?.filter(p => p.category_id === product.category_id && p.id !== product.id).slice(0, 4) || [];
  const outOfStock = product.stock <= 0;

  return (
    <div className="container-main mx-auto px-4 py-6 sm:py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6 overflow-x-auto whitespace-nowrap">
        <Link to={buildPath('/')} className="hover:text-foreground shrink-0">Главная</Link>
        <ChevronRight className="w-3 h-3 shrink-0" />
        <Link to={buildPath('/catalog')} className="hover:text-foreground shrink-0">Каталог</Link>
        <ChevronRight className="w-3 h-3 shrink-0" />
        <Link to={`${buildPath('/catalog')}?category=${product.category_id}`} className="hover:text-foreground capitalize shrink-0">{product.category_id?.replace('-', ' ')}</Link>
        <ChevronRight className="w-3 h-3 shrink-0" />
        <span className="text-foreground truncate">{product.title}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        <div className="bg-card border border-border/50 rounded-2xl p-6 sm:p-8 flex items-center justify-center min-h-[250px] sm:min-h-[300px] lg:min-h-[400px] relative overflow-hidden">
          {product.image ? (
            <img src={product.image} alt={product.title} className="w-full h-full object-cover absolute inset-0" />
          ) : (
            <div className="text-center">
              <div className="text-6xl sm:text-8xl mb-4">{categoryEmoji[product.category_id || ''] || '⚡'}</div>
              <span className="text-xs text-muted-foreground uppercase tracking-wider">{product.platform}</span>
            </div>
          )}
          {outOfStock && (
            <div className="absolute inset-0 bg-background/60 rounded-2xl flex items-center justify-center">
              <span className="text-lg font-bold text-muted-foreground">Нет в наличии</span>
            </div>
          )}
        </div>

        <div>
          <div className="flex flex-wrap gap-2 mb-3">
            {product.tags.map(tag => (
              <span key={tag} className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-primary/30 bg-primary/5 text-primary uppercase">
                {tag === 'hot' ? 'ХИТ' : tag === 'new' ? 'НОВИНКА' : tag === 'sale' ? 'СКИДКА' : tag === 'best-seller' ? 'БЕСТСЕЛЛЕР' : tag}
              </span>
            ))}
            {product.delivery_type === 'instant' && (
              <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary flex items-center gap-1">
                <Zap className="w-3 h-3" /> МГНОВЕННАЯ ДОСТАВКА
              </span>
            )}
          </div>

          <h1 className="font-display text-xl sm:text-2xl md:text-3xl font-bold">{product.title}</h1>
          <p className="text-muted-foreground text-sm sm:text-base mt-2">{product.subtitle}</p>

          <div className="flex items-baseline gap-3 mt-4">
            <span className="font-display text-2xl sm:text-3xl font-bold">${Number(product.price).toFixed(2)}</span>
            <PriceRub usd={Number(product.price)} className="text-base" />
            {product.old_price && (
              <>
                <span className="text-base sm:text-lg text-muted-foreground line-through">${Number(product.old_price).toFixed(2)}</span>
                <span className="text-sm font-semibold text-primary bg-primary/10 px-2 py-0.5 rounded-full">-{discount}%</span>
              </>
            )}
          </div>

          <div className="flex flex-wrap gap-3 sm:gap-4 mt-4 text-xs text-muted-foreground">
            {product.guarantee && <span className="flex items-center gap-1"><Shield className="w-3.5 h-3.5 text-primary" /> {product.guarantee}</span>}
            <span className="flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5 text-primary" /> Проверенный товар</span>
            {outOfStock ? (
              <span className="flex items-center gap-1 text-destructive">❌ Нет в наличии</span>
            ) : product.stock < 10 ? (
              <span className="flex items-center gap-1 text-warning">⚠️ Осталось {product.stock}</span>
            ) : (
              <span className="flex items-center gap-1 text-primary">✓ В наличии ({product.stock})</span>
            )}
          </div>

          <div className="flex gap-3 mt-6">
            <Button variant="hero" size="xl" className="flex-1" onClick={() => addToCart(product)} disabled={outOfStock}>
              <ShoppingCart className="w-4 h-4 mr-1" /> {outOfStock ? 'Нет в наличии' : 'В корзину'}
            </Button>
          </div>

          {product.features.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-6">
              {product.features.map((f, i) => (
                <div key={i} className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground">
                  <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" /> {f}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {product.description && (
        <div className="mt-8 sm:mt-12 max-w-3xl space-y-4">
          <h2 className="font-display text-lg font-bold">Описание</h2>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{product.description}</p>
          <div className="p-4 bg-card border border-border/50 rounded-xl">
            <h4 className="font-display font-semibold text-sm mb-2">Информация о доставке</h4>
            <p className="text-xs sm:text-sm text-muted-foreground">
              {product.delivery_type === 'instant'
                ? 'Этот товар доставляется мгновенно после подтверждения оплаты.'
                : 'Этот товар требует ручной обработки. Доставка обычно занимает от 1 до 24 часов.'}
            </p>
          </div>
        </div>
      )}

      {/* Similar */}
      {similar.length > 0 && (
        <section className="mt-12 sm:mt-16">
          <h2 className="font-display text-lg sm:text-xl font-bold mb-4 sm:mb-6">Похожие товары</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {similar.map(p => <ProductCard key={p.id} product={p} />)}
          </div>
        </section>
      )}

      {/* Support */}
      <div className="mt-8 sm:mt-12 p-4 sm:p-6 bg-card border border-border/50 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3 text-center sm:text-left">
          <MessageCircle className="w-8 h-8 text-primary shrink-0 hidden sm:block" />
          <div>
            <h4 className="font-display font-semibold text-sm sm:text-base">Есть вопросы по этому товару?</h4>
            <p className="text-xs sm:text-sm text-muted-foreground">Наша поддержка поможет вам 24/7</p>
          </div>
        </div>
        <a href={supportLink || `https://t.me/${supportUsername}`} target="_blank" rel="noopener noreferrer"><Button variant="outline">Связаться с поддержкой</Button></a>
      </div>
    </div>
  );
};

export default ProductDetails;
