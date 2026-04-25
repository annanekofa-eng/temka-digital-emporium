import { useParams, Link } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { ArrowLeft, ShoppingCart, Zap, CheckCircle2, ChevronRight, Shield, MessageCircle, X, ZoomIn } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { useShop } from '@/contexts/ShopContext';
import { useStorefront } from '@/contexts/StorefrontContext';
import { useStorefrontPath } from '@/contexts/StorefrontContext';
import ShopProductCard from '@/components/ShopProductCard';
import { toast } from 'sonner';
import PriceRub from '@/components/PriceRub';

const ShopProductDetails = () => {
  const { productId } = useParams();
  const { products, addToCart, productsLoading, shop } = useShop();
  const { supportLink } = useStorefront();
  const product = products.find(p => p.id === productId);
  const buildPath = useStorefrontPath();
  const shopId = shop?.id || '';
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    if (!lightboxOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxOpen(false); };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [lightboxOpen]);

  if (productsLoading) {
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

  if (!product) {
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
  const outOfStock = product.stock <= 0;
  const similar = products.filter(p => p.id !== product.id).slice(0, 4);

  const handleAdd = () => {
    if (outOfStock) return;
    addToCart(product);
    toast.success('Добавлено в корзину');
  };

  return (
    <div className="container-main mx-auto px-4 py-6 sm:py-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6 overflow-x-auto whitespace-nowrap">
        <Link to={buildPath('/')} className="hover:text-foreground shrink-0">Главная</Link>
        <ChevronRight className="w-3 h-3 shrink-0" />
        <Link to={buildPath('/catalog')} className="hover:text-foreground shrink-0">Каталог</Link>
        <ChevronRight className="w-3 h-3 shrink-0" />
        <span className="text-foreground truncate">{product.name}</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 sm:gap-8">
        <div className="bg-card border border-border/50 rounded-2xl p-6 sm:p-8 flex items-center justify-center min-h-[250px] sm:min-h-[300px] lg:min-h-[400px] relative overflow-hidden">
          {product.image ? (
            <button
              type="button"
              onClick={() => setLightboxOpen(true)}
              aria-label="Открыть фото в полном размере"
              className="absolute inset-0 group cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <img src={product.image} alt={product.name} className="w-full h-full object-cover" />
              <span className="absolute top-3 right-3 inline-flex items-center justify-center w-9 h-9 rounded-full bg-background/70 backdrop-blur-sm text-foreground opacity-0 group-hover:opacity-100 transition-opacity">
                <ZoomIn className="w-4 h-4" />
              </span>
            </button>
          ) : (
            <div className="text-center">
              <div className="text-6xl sm:text-8xl mb-4">📦</div>
            </div>
          )}
          {outOfStock && (
            <div className="absolute inset-0 bg-background/60 rounded-2xl flex items-center justify-center pointer-events-none">
              <span className="text-lg font-bold text-muted-foreground">Нет в наличии</span>
            </div>
          )}
        </div>

        <div>
          <div className="flex flex-wrap gap-2 mb-3">
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary flex items-center gap-1">
              <Zap className="w-3 h-3" /> МГНОВЕННАЯ ДОСТАВКА
            </span>
          </div>

          <h1 className="font-display text-xl sm:text-2xl md:text-3xl font-bold">{product.name}</h1>
          {product.subtitle && (
            <p className="text-muted-foreground text-sm sm:text-base mt-2">{product.subtitle}</p>
          )}

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
            <span className="flex items-center gap-1"><Shield className="w-3.5 h-3.5 text-primary" /> Гарантия</span>
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
            <Button variant="hero" size="xl" className="flex-1" onClick={handleAdd} disabled={outOfStock}>
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
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed whitespace-pre-line">{product.description}</p>
          <div className="p-4 bg-card border border-border/50 rounded-xl">
            <h4 className="font-display font-semibold text-sm mb-2">Информация о доставке</h4>
            <p className="text-xs sm:text-sm text-muted-foreground">
              Этот товар доставляется мгновенно после подтверждения оплаты.
            </p>
          </div>
        </div>
      )}

      {/* Similar */}
      {similar.length > 0 && (
        <section className="mt-12 sm:mt-16">
          <h2 className="font-display text-lg sm:text-xl font-bold mb-4 sm:mb-6">Похожие товары</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {similar.map(p => <ShopProductCard key={p.id} product={p} shopId={shopId} />)}
          </div>
        </section>
      )}

      {/* Support */}
      {supportLink && (
        <div className="mt-8 sm:mt-12 p-4 sm:p-6 bg-card border border-border/50 rounded-xl flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3 text-center sm:text-left">
            <MessageCircle className="w-8 h-8 text-primary shrink-0 hidden sm:block" />
            <div>
              <h4 className="font-display font-semibold text-sm sm:text-base">Есть вопросы по этому товару?</h4>
              <p className="text-xs sm:text-sm text-muted-foreground">Наша поддержка поможет вам 24/7</p>
            </div>
          </div>
          <a href={supportLink} target="_blank" rel="noopener noreferrer">
            <Button variant="outline">Связаться с поддержкой</Button>
          </a>
        </div>
      )}

      {lightboxOpen && product.image && (
        <div
          className="fixed inset-0 z-[100] bg-background/95 backdrop-blur-md flex items-center justify-center p-4 sm:p-8 animate-in fade-in"
          onClick={() => setLightboxOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Просмотр фото"
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxOpen(false); }}
            aria-label="Закрыть"
            className="absolute top-4 right-4 sm:top-6 sm:right-6 inline-flex items-center justify-center w-11 h-11 rounded-full bg-card border border-border text-foreground hover:bg-secondary transition-colors z-10"
          >
            <X className="w-5 h-5" />
          </button>
          <img
            src={product.image}
            alt={product.name}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
          />
        </div>
      )}
    </div>
  );
};

export default ShopProductDetails;
