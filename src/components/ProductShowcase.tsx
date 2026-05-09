import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { useProducts } from '@/hooks/useProducts';
import { useStorefrontPath } from '@/contexts/StorefrontContext';

interface Props {
  title?: string;
  subtitle?: string;
  limit?: number;
}

const ProductShowcase = ({
  title = 'Подборка из каталога',
  subtitle = 'Популярные товары прямо сейчас',
  limit = 8,
}: Props) => {
  const { data: allProducts } = useProducts();
  const buildPath = useStorefrontPath();

  const featured = (allProducts || [])
    .filter(p => p.is_featured || p.is_popular || p.is_new)
    .slice(0, limit);
  const showcase = featured.length ? featured : (allProducts || []).slice(0, limit);

  if (!showcase.length) return null;

  return (
    <section className="pt-10">
      <div className="container-main mx-auto max-w-2xl px-4">
        <div className="flex items-end justify-between mb-4">
          <div>
            <h2 className="font-display text-2xl font-black tracking-tight">{title}</h2>
            <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>
          </div>
          <Link
            to={buildPath('/catalog')}
            className="text-xs text-primary inline-flex items-center gap-1 hover:underline shrink-0"
          >
            Весь каталог <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-3 scrollbar-hide snap-x snap-mandatory">
        {showcase.map(p => {
          const discount = p.old_price
            ? Math.round((1 - Number(p.price) / Number(p.old_price)) * 100)
            : 0;
          return (
            <Link
              key={p.id}
              to={buildPath(`/product/${p.id}`)}
              className="group w-40 sm:w-48 shrink-0 snap-start bg-card border border-border/50 rounded-xl overflow-hidden hover:border-primary/40 transition-colors"
            >
              <div className="relative aspect-square bg-secondary/40 flex items-center justify-center overflow-hidden">
                {p.image ? (
                  <img
                    src={p.image}
                    alt={p.title}
                    loading="lazy"
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                ) : (
                  <span className="text-4xl">📦</span>
                )}
                {discount > 0 && (
                  <span className="absolute top-2 left-2 text-[10px] font-bold bg-destructive text-destructive-foreground px-1.5 py-0.5 rounded">
                    −{discount}%
                  </span>
                )}
              </div>
              <div className="p-3">
                <h3 className="text-xs sm:text-sm font-semibold line-clamp-2 min-h-[2.5rem]">{p.title}</h3>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-sm font-bold">${Number(p.price).toFixed(2)}</span>
                  {p.old_price && (
                    <span className="text-[10px] text-muted-foreground line-through">
                      ${Number(p.old_price).toFixed(2)}
                    </span>
                  )}
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
};

export default ProductShowcase;
