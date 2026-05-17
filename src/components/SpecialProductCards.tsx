import { useState } from 'react';
import { ShoppingCart, Plus, Minus, LayoutGrid } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import NftCatalogDialog from '@/components/NftCatalogDialog';
import { useStore } from '@/contexts/StoreContext';
import { toast } from 'sonner';
import logoPremium from '@/assets/logo-tg-premium.jpg';
import logoStars from '@/assets/logo-tg-stars.jpg';
import logoNft from '@/assets/logo-tg-nft.png';
import type { ExtendedProduct } from '@/hooks/useShop';

export const STAR_PRESETS = [15, 25, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

export const SPECIAL_PRODUCT_TYPES = [
  'premium_term',
  'nft_variant',
  'stars',
] as const;

export const isSpecialProduct = (p: any) =>
  p?.product_type && (SPECIAL_PRODUCT_TYPES as readonly string[]).includes(p.product_type);

const LogoBox = ({ src, alt }: { src: string; alt: string }) => (
  <img
    src={src}
    alt={alt}
    className="w-12 h-12 rounded-xl object-cover bg-black shrink-0"
    loading="lazy"
  />
);

export const PremiumTermCard = ({ product }: { product: ExtendedProduct }) => {
  const { addToCart } = useStore();
  const [selected, setSelected] = useState<number | null>(null);
  const opt = selected !== null ? product.term_options?.[selected] : null;
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3 mb-3">
        <LogoBox src={logoPremium} alt="Telegram Premium" />
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-base">{product.title}</h3>
          <p className="text-xs text-muted-foreground line-clamp-1">
            {product.subtitle || 'Telegram Premium подписка'}
          </p>
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
        disabled={!opt}
        onClick={() => {
          if (!opt) return;
          addToCart({
            ...product,
            price: opt.price,
            title: `${product.title} · ${opt.months} мес`,
          } as any);
          toast.success('Добавлено в корзину');
        }}
      >
        <ShoppingCart className="w-4 h-4 mr-2" />
        {opt ? `Купить за $${opt.price}` : 'Выберите срок'}
      </Button>
    </div>
  );
};

export const NftVariantCard = ({ product }: { product: ExtendedProduct }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3 mb-3">
        <LogoBox src={logoNft} alt="NFT подарки" />
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-base">{product.title}</h3>
          <p className="text-xs text-muted-foreground line-clamp-1">
            {product.subtitle || 'Подарки Telegram'}
          </p>
        </div>
      </div>
      <Button className="w-full" onClick={() => setOpen(true)}>
        <LayoutGrid className="w-4 h-4 mr-2" /> Открыть каталог
      </Button>
      <NftCatalogDialog open={open} onClose={() => setOpen(false)} mode="gift" />
    </div>
  );
};

export const StarsCard = ({ product }: { product: ExtendedProduct }) => {
  const { addToCart } = useStore();
  const minQty = Math.max(1, Number(product.min_qty) || 1);
  const maxQty = Math.max(minQty, Number(product.max_qty) || 10000);
  const [qty, setQty] = useState<number>(minQty);
  const clamped = Math.min(maxQty, Math.max(0, Math.floor(qty || 0)));
  const total = (clamped * Number(product.price)).toFixed(2);
  const canAdd = clamped >= minQty;
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3 mb-3">
        <LogoBox src={logoStars} alt="Telegram Stars" />
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-base">{product.title}</h3>
          <p className="text-xs text-muted-foreground line-clamp-1">
            ${Number(product.price).toFixed(3)} за звезду
          </p>
        </div>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <Button variant="outline" size="icon" onClick={() => setQty(Math.max(0, clamped - 1))}>
          <Minus className="w-4 h-4" />
        </Button>
        <input
          type="number"
          min={0}
          max={maxQty}
          value={clamped}
          onChange={(e) => setQty(Number(e.target.value))}
          className="flex-1 h-10 text-center bg-secondary border border-border rounded-lg font-display font-bold text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
        />
        <Button variant="outline" size="icon" onClick={() => setQty(Math.min(maxQty, clamped + 1))}>
          <Plus className="w-4 h-4" />
        </Button>
      </div>
      <div className="px-1 mb-3">
        <Slider
          value={[clamped]}
          min={0}
          max={maxQty}
          step={1}
          onValueChange={(v) => setQty(v[0])}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1.5">
          <span>0⭐</span>
          <span>{maxQty.toLocaleString('ru')}⭐</span>
        </div>
      </div>
      <Button
        className="w-full"
        disabled={!canAdd}
        onClick={() => {
          if (!canAdd) return;
          addToCart({
            ...product,
            price: Number(total),
            title: `${product.title} · ${clamped}⭐`,
          } as any);
          toast.success('Звёзды добавлены');
        }}
      >
        <ShoppingCart className="w-4 h-4 mr-2" />
        {canAdd ? `Купить за $${total}` : `Минимум ${minQty}⭐`}
      </Button>
    </div>
  );
};

export const renderSpecialProduct = (p: ExtendedProduct) => {
  switch (p.product_type) {
    case 'premium_term':
      return <PremiumTermCard key={p.id} product={p} />;
    case 'nft_variant':
      return <NftVariantCard key={p.id} product={p} />;
    case 'stars':
      return <StarsCard key={p.id} product={p} />;
    default:
      return null;
  }
};
