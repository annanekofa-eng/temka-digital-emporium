import { Link } from 'react-router-dom';
import { ShoppingCart, Zap, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { DbProduct } from '@/types/database';
import { useStore } from '@/contexts/StoreContext';
import { useTelegram } from '@/contexts/TelegramContext';
import PriceRub from '@/components/PriceRub';

const tagLabels: Record<string, string> = {
  'hot': 'ХИТ', 'new': 'НОВИНКА', 'sale': 'СКИДКА', 'best-seller': 'БЕСТСЕЛЛЕР', 'instant': 'МГНОВЕННО',
};

const tagColors: Record<string, string> = {
  'hot': 'bg-destructive/20 text-destructive border-destructive/30',
  'new': 'bg-primary/20 text-primary border-primary/30',
  'sale': 'bg-warning/20 text-warning border-warning/30',
  'best-seller': 'bg-gold/20 text-gold border-gold/30',
  'instant': 'bg-primary/20 text-primary border-primary/30',
};

const categoryEmoji: Record<string, string> = {
  'social-media': '📱', 'gaming': '🎮', 'streaming': '🎬', 'software': '🔑',
  'premium': '👑', 'automation': '🤖', 'ai-tools': '🧠', 'services': '⚡',
};

const ProductCard = ({ product, view = 'grid' }: { product: DbProduct; view?: 'grid' | 'list' }) => {
  const { addToCart } = useStore();
  const { haptic } = useTelegram();
  const discount = product.old_price ? Math.round((1 - Number(product.price) / Number(product.old_price)) * 100) : 0;
  const outOfStock = product.stock <= 0;

  if (view === 'list') {
    return (
      <div className={`group relative bg-card border border-border/50 rounded-xl overflow-hidden hover:border-primary/30 transition-all duration-300 ${outOfStock ? 'opacity-60' : ''}`}>
        <div className="flex gap-3 sm:gap-4">
          <Link to={`/product/${product.id}`} className="block shrink-0">
            <div className="relative w-28 sm:w-40 h-full min-h-[112px] sm:min-h-[140px] bg-secondary/50 flex items-center justify-center overflow-hidden">
              {product.image ? (
                <img src={product.image} alt={product.title} className="w-full h-full object-cover" />
              ) : (
                <div className="text-3xl sm:text-4xl">{categoryEmoji[product.category_id || ''] || '⚡'}</div>
              )}
              {discount > 0 && (
                <span className="absolute top-1.5 left-1.5 bg-destructive text-destructive-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-full">
                  -{discount}%
                </span>
              )}
              {outOfStock && (
                <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
                  <span className="text-[10px] sm:text-xs font-semibold text-muted-foreground text-center px-1">Нет в наличии</span>
                </div>
              )}
            </div>
          </Link>

          <div className="flex-1 min-w-0 py-3 pr-3 sm:py-4 sm:pr-4 flex flex-col">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{product.platform}</span>
                <Link to={`/product/${product.id}`}>
                  <h3 className="font-display font-semibold text-sm sm:text-base mt-0.5 line-clamp-1 group-hover:text-primary transition-colors">{product.title}</h3>
                </Link>
                <p className="text-[10px] sm:text-xs text-muted-foreground mt-0.5 line-clamp-2">{product.subtitle}</p>
              </div>
              {product.tags.length > 0 && (
                <div className="hidden sm:flex flex-wrap gap-1 shrink-0">
                  {product.tags.slice(0, 2).map(tag => (
                    <span key={tag} className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${tagColors[tag] || 'bg-secondary text-secondary-foreground border-border'}`}>
                      {tagLabels[tag] || tag.replace('-', ' ').toUpperCase()}
                    </span>
                  ))}
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 mt-2">
              {product.delivery_type === 'instant' ? (
                <span className="flex items-center gap-1 text-[10px] text-primary font-medium">
                  <Zap className="w-3 h-3" /> Мгновенно
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
                  <Clock className="w-3 h-3" /> Ручная
                </span>
              )}
              {product.stock > 0 && product.stock < 10 && (
                <span className="text-[10px] text-warning font-medium">Осталось {product.stock}</span>
              )}
            </div>

            <div className="flex items-end justify-between gap-2 mt-auto pt-3">
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="font-display font-bold text-base sm:text-lg">${Number(product.price).toFixed(2)}</span>
                <PriceRub usd={Number(product.price)} />
                {product.old_price && (
                  <span className="text-[10px] sm:text-xs text-muted-foreground line-through">${Number(product.old_price).toFixed(2)}</span>
                )}
              </div>
              <Button
                size="sm"
                className="h-8 text-xs sm:text-sm shrink-0"
                disabled={outOfStock}
                onClick={() => { addToCart(product); haptic.impact('light'); }}
              >
                <ShoppingCart className="w-3.5 h-3.5 mr-1" />
                {outOfStock ? 'Нет' : 'В корзину'}
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`group relative bg-card border border-border/50 rounded-xl overflow-hidden hover-lift hover:border-primary/30 transition-all duration-300 ${outOfStock ? 'opacity-60' : ''}`}>
      <Link to={`/product/${product.id}`} className="block">
        <div className="relative h-40 sm:h-48 bg-secondary/50 flex items-center justify-center overflow-hidden">
          {product.image ? (
            <img src={product.image} alt={product.title} className="w-full h-full object-cover" />
          ) : (
            <div className="text-4xl sm:text-5xl">{categoryEmoji[product.category_id || ''] || '⚡'}</div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-card/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

          <div className="absolute top-2 left-2 flex flex-wrap gap-1">
            {product.tags.map(tag => (
              <span key={tag} className={`text-[10px] font-semibold px-1.5 sm:px-2 py-0.5 rounded-full border ${tagColors[tag] || 'bg-secondary text-secondary-foreground border-border'}`}>
                {tagLabels[tag] || tag.replace('-', ' ').toUpperCase()}
              </span>
            ))}
          </div>

          {discount > 0 && (
            <span className="absolute top-2 right-2 bg-destructive text-destructive-foreground text-[10px] font-bold px-2 py-0.5 rounded-full">
              -{discount}%
            </span>
          )}

          {outOfStock && (
            <div className="absolute inset-0 bg-background/60 flex items-center justify-center">
              <span className="text-sm font-semibold text-muted-foreground">Нет в наличии</span>
            </div>
          )}
        </div>
      </Link>

      <div className="p-3 sm:p-4">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">{product.platform}</span>

        <Link to={`/product/${product.id}`}>
          <h3 className="font-display font-semibold text-sm sm:text-base mt-1 line-clamp-1 group-hover:text-primary transition-colors">{product.title}</h3>
        </Link>
        <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 line-clamp-1">{product.subtitle}</p>

        <div className="flex items-center gap-1 mt-2">
          {product.delivery_type === 'instant' ? (
            <span className="flex items-center gap-1 text-[10px] text-primary font-medium">
              <Zap className="w-3 h-3" /> Мгновенная доставка
            </span>
          ) : (
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-medium">
              <Clock className="w-3 h-3" /> Ручная доставка
            </span>
          )}
          {product.stock > 0 && product.stock < 10 && (
            <span className="text-[10px] text-warning font-medium ml-auto">Осталось {product.stock}</span>
          )}
        </div>

        <div className="flex items-center justify-between mt-3 pt-3 border-t border-border/30">
          <div>
            <div className="flex items-baseline gap-1.5">
              <span className="font-display font-bold text-lg sm:text-xl">${Number(product.price).toFixed(2)}</span>
              <PriceRub usd={Number(product.price)} />
              {product.old_price && (
                <span className="text-[10px] sm:text-xs text-muted-foreground line-through">${Number(product.old_price).toFixed(2)}</span>
              )}
            </div>
          </div>
          <Button
            size="sm"
            className="h-8 sm:h-9 text-sm"
            disabled={outOfStock}
            onClick={() => { addToCart(product); haptic.impact('light'); }}
          >
            <ShoppingCart className="w-3.5 h-3.5 mr-1" />
            {outOfStock ? 'Нет' : 'В корзину'}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ProductCard;
