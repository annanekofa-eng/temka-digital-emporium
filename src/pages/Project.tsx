import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ShoppingCart, Plus, Minus, ExternalLink, Star } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Slider } from '@/components/ui/slider';
import { useProject, useProjectProducts, useProjectCategories, type ExtendedProduct } from '@/hooks/useShop';
import { useStore } from '@/contexts/StoreContext';
import { toast } from 'sonner';
import logoPremium from '@/assets/logo-tg-premium.webp';
import logoStars from '@/assets/logo-tg-stars.jpg';
import logoNft from '@/assets/logo-tg-nft.png';

const LogoBox = ({ src, alt }: { src: string; alt: string }) => (
  <img src={src} alt={alt} className="w-12 h-12 rounded-xl object-cover bg-black shrink-0" loading="lazy" />
);

const SimpleProductCard = ({ product }: { product: ExtendedProduct }) => {
  const { addToCart } = useStore();
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
      <div className="aspect-square bg-secondary flex items-center justify-center text-5xl">
        {product.image ? (
          <img src={product.image} alt={product.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span>📦</span>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <h3 className="font-display font-semibold text-sm leading-tight line-clamp-2">{product.title}</h3>
        {product.subtitle && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{product.subtitle}</p>}
        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          <span className="font-display font-bold text-base">${Number(product.price).toFixed(2)}</span>
          <Button
            size="sm"
            onClick={() => {
              addToCart(product as any);
              toast.success('Добавлено в корзину');
            }}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

// FLUX-style: list row, no image, title + price button
const FluxItemCard = ({ product }: { product: ExtendedProduct }) => {
  const { addToCart } = useStore();
  const navigate = useNavigate();
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
      <button
        onClick={() => navigate(`/product/${product.id}`)}
        className="flex-1 min-w-0 text-left"
      >
        <h3 className="font-display font-semibold text-base leading-tight line-clamp-1">
          {product.title}
        </h3>
        {product.subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{product.subtitle}</p>
        )}
      </button>
      <Button
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          addToCart(product as any);
          toast.success('Добавлено в корзину');
        }}
        className="shrink-0 font-display font-bold"
      >
        ${Number(product.price).toFixed(0)}
      </Button>
    </div>
  );
};

const PremiumTermCard = ({ product }: { product: ExtendedProduct }) => {
  const { addToCart } = useStore();
  const [selected, setSelected] = useState(0);
  const opt = product.term_options?.[selected];
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3 mb-3">
        <LogoBox src={logoPremium} alt="Telegram Premium" />
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-base">{product.title}</h3>
          <p className="text-xs text-muted-foreground line-clamp-1">{product.subtitle || 'Telegram Premium подписка'}</p>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mb-3">
        {product.term_options?.map((o, i) => (
          <button
            key={i}
            onClick={() => setSelected(i)}
            className={`rounded-xl border px-2 py-2 text-center transition-all ${
              selected === i ? 'border-primary bg-primary/10' : 'border-border bg-secondary/40'
            }`}
          >
            <div className="text-xs text-muted-foreground">{o.months} мес</div>
            <div className="font-display font-bold text-sm mt-0.5">${o.price}</div>
          </button>
        ))}
      </div>
      <Button
        className="w-full"
        onClick={() => {
          if (!opt) return;
          addToCart({ ...product, price: opt.price, title: `${product.title} · ${opt.months} мес` } as any);
          toast.success('Добавлено в корзину');
        }}
      >
        <ShoppingCart className="w-4 h-4 mr-2" /> Купить за ${opt?.price ?? 0}
      </Button>
    </div>
  );
};

const NftVariantCard = ({ product }: { product: ExtendedProduct }) => {
  const { addToCart } = useStore();
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3 mb-3">
        <LogoBox src={logoNft} alt="NFT подарки" />
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-base">{product.title}</h3>
          <p className="text-xs text-muted-foreground line-clamp-1">{product.subtitle || 'Подарки Telegram'}</p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {product.nft_variants?.map((v) => (
          <button
            key={v.key}
            onClick={() => {
              addToCart({ ...product, price: v.price, title: `${product.title} · ${v.label}` } as any);
              toast.success(`${v.label} в корзине`);
            }}
            className="rounded-xl border border-border bg-secondary/40 p-3 text-left hover:border-primary/40 transition-all"
          >
            <div className="text-sm font-medium leading-tight">{v.label}</div>
            <div className="font-display font-bold text-base mt-1">${v.price}</div>
          </button>
        ))}
      </div>
    </div>
  );
};

const StarsCard = ({ product }: { product: ExtendedProduct }) => {
  const { addToCart } = useStore();
  const [qty, setQty] = useState(product.min_qty || 50);
  const total = (qty * Number(product.price)).toFixed(2);
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center text-2xl">⭐</div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-base">{product.title}</h3>
          <p className="text-xs text-muted-foreground line-clamp-1">${Number(product.price).toFixed(3)} за звезду</p>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <Button variant="outline" size="icon" onClick={() => setQty(Math.max(product.min_qty, qty - 50))}>
          <Minus className="w-4 h-4" />
        </Button>
        <input
          type="number"
          value={qty}
          min={product.min_qty}
          max={product.max_qty}
          onChange={(e) =>
            setQty(Math.min(product.max_qty, Math.max(product.min_qty, Number(e.target.value) || product.min_qty)))
          }
          className="flex-1 h-10 text-center bg-secondary border border-border rounded-lg font-display font-bold"
        />
        <Button variant="outline" size="icon" onClick={() => setQty(Math.min(product.max_qty, qty + 50))}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <Button
        className="w-full"
        onClick={() => {
          addToCart({
            ...product,
            price: Number(total),
            title: `${product.title} · ${qty}⭐`,
          } as any);
          toast.success('Звёзды добавлены');
        }}
      >
        <ShoppingCart className="w-4 h-4 mr-2" /> Купить за ${total}
      </Button>
    </div>
  );
};

const NftLinkCard = ({ product, mode }: { product: ExtendedProduct; mode: 'rent' | 'buy' }) => {
  // Mock GetGems link
  const url = product.external_link || `https://getgems.io/?mode=${mode}`;
  const label = mode === 'rent' ? 'Перейти в аренду' : 'Перейти к покупке';
  const emoji = mode === 'rent' ? '🔄' : '💎';
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-12 h-12 rounded-xl bg-secondary flex items-center justify-center text-2xl">{emoji}</div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-base">{product.title}</h3>
          <p className="text-xs text-muted-foreground line-clamp-2">
            {product.subtitle || 'Через GetGems · оплата на платформе'}
          </p>
        </div>
      </div>
      <a href={url} target="_blank" rel="noopener noreferrer">
        <Button className="w-full" variant="outline">
          <ExternalLink className="w-4 h-4 mr-2" /> {label}
        </Button>
      </a>
    </div>
  );
};

const renderProduct = (p: ExtendedProduct) => {
  switch (p.product_type) {
    case 'premium_term':
      return <PremiumTermCard key={p.id} product={p} />;
    case 'nft_variant':
      return <NftVariantCard key={p.id} product={p} />;
    case 'stars':
      return <StarsCard key={p.id} product={p} />;
    case 'nft_rent':
      return <NftLinkCard key={p.id} product={p} mode="rent" />;
    case 'nft_buy':
      return <NftLinkCard key={p.id} product={p} mode="buy" />;
    default:
      return null;
  }
};

const Project = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading: pLoad } = useProject(id);
  const { data: products, isLoading: prLoad } = useProjectProducts(id);
  const { data: categories } = useProjectCategories(id);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const simple = (products || []).filter((p) => p.product_type === 'simple');
  const special = (products || []).filter((p) => p.product_type !== 'simple');

  const filteredSimple = activeCat ? simple.filter((p) => p.category_id === activeCat) : simple;

  if (pLoad) {
    return (
      <div className="px-4 py-6">
        <Skeleton className="h-10 w-40 mb-4" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-muted-foreground">Проект не найден</p>
        <Link to="/" className="text-primary text-sm">
          ← На главную
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-8">
      {/* Header */}
      <section className="px-4 pt-4 pb-6">
        <div className="container-main mx-auto max-w-2xl">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-4"
          >
            <ArrowLeft className="w-4 h-4" /> На главную
          </button>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl overflow-hidden border border-border bg-card"
          >
            {project.banner ? (
              <div className="aspect-[21/9] bg-secondary">
                <img src={project.banner} alt={project.title} className="w-full h-full object-cover" />
              </div>
            ) : (
              <div className="aspect-[21/9] bg-gradient-to-br from-secondary to-muted flex items-center justify-center text-7xl">
                {project.icon}
              </div>
            )}
            <div className="p-5">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{project.icon}</span>
                <h1 className="font-display text-3xl font-black tracking-tight">{project.title}</h1>
              </div>
              {project.subtitle && (
                <p className="text-muted-foreground mt-2">{project.subtitle}</p>
              )}
              {project.description && (
                <p className="text-sm text-muted-foreground/80 mt-2">{project.description}</p>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      <div className="container-main mx-auto max-w-2xl px-4 space-y-6">
        {/* Special products (premium / nft / stars / etc.) */}
        {special.length > 0 && (
          <section>
            <h2 className="font-display text-lg font-bold mb-3 px-1">Специальные товары</h2>
            <div className="grid gap-3">{special.map(renderProduct)}</div>
          </section>
        )}

        {/* Categories filter */}
        {categories && categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
            <button
              onClick={() => setActiveCat(null)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                !activeCat ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary border-border'
              }`}
            >
              Все
            </button>
            {categories.map((c: any) => (
              <button
                key={c.id}
                onClick={() => setActiveCat(c.id)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  activeCat === c.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary border-border'
                }`}
              >
                <span className="mr-1">{c.icon}</span>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Simple products */}
        {prLoad ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-2xl" />
            ))}
          </div>
        ) : filteredSimple.length > 0 ? (
          <section>
            <h2 className="font-display text-lg font-bold mb-3 px-1">Каталог</h2>
            {project.id === 'flux' ? (
              <div className="grid gap-2">
                {filteredSimple.map((p) => (
                  <FluxItemCard key={p.id} product={p} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredSimple.map((p) => (
                  <SimpleProductCard key={p.id} product={p} />
                ))}
              </div>
            )}
          </section>
        ) : null}

        {special.length === 0 && simple.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Star className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Товары скоро появятся</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Project;
