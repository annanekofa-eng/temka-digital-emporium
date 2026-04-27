import { Link } from 'react-router-dom';
import { Zap } from 'lucide-react';
import PriceRub from '@/components/PriceRub';
import { useStorefrontPath } from '@/contexts/StorefrontContext';
import type { ShopAutoProduct } from '@/hooks/useShopAutoProducts';
import telegramPremiumImg from '@/assets/telegram-premium.jpg';
import telegramStarsImg from '@/assets/telegram-stars.jpg';

interface Props {
  product: ShopAutoProduct;
  view?: 'grid' | 'list';
}

const AutoProductCard = ({ product, view = 'grid' }: Props) => {
  const buildPath = useStorefrontPath();
  const isPremium = product.product_type === 'telegram_premium';

  const fromPrice = isPremium
    ? Math.min(...[product.price_3m, product.price_6m, product.price_12m]
        .map(v => Number(v))
        .filter(v => v > 0))
    : Number(product.price_per_star || 0) * (product.min_stars || 50);

  const title = isPremium ? 'Telegram Premium' : 'Telegram Stars';
  const subtitle = isPremium
    ? 'Официальная подписка с расширенными функциями'
    : 'Внутренняя валюта Telegram для оплаты в ботах';
  const path = isPremium ? '/auto/premium' : '/auto/stars';
  const imageSrc = isPremium ? telegramPremiumImg : telegramStarsImg;
  const borderClass = isPremium ? 'border-primary/20' : 'border-amber-500/20';

  if (view === 'list') {
    return (
      <Link
        to={buildPath(path)}
        className={`flex items-center gap-3 p-3 rounded-xl border bg-card ${borderClass} hover:shadow-md transition-all`}
      >
        <img
          src={imageSrc}
          alt={title}
          loading="lazy"
          className="w-16 h-16 rounded-lg object-cover shrink-0"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 mb-1">
            <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground inline-flex items-center gap-1">
              <Zap className="w-2.5 h-2.5" /> АВТО
            </span>
          </div>
          <h3 className="font-display font-semibold text-sm truncate">{title}</h3>
          <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-muted-foreground">от</div>
          <div className="font-display font-bold text-sm">${Number(fromPrice).toFixed(2)}</div>
        </div>
      </Link>
    );
  }

  return (
    <Link
      to={buildPath(path)}
      className={`group flex flex-col rounded-xl border bg-card ${borderClass} overflow-hidden hover:shadow-md transition-all`}
    >
      <div className="aspect-[4/3] overflow-hidden">
        <img
          src={imageSrc}
          alt={title}
          loading="lazy"
          className="w-full h-full object-cover transition-transform group-hover:scale-105"
        />
      </div>
      <div className="p-3 sm:p-4 flex flex-col flex-1">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground inline-flex items-center gap-1">
            <Zap className="w-2.5 h-2.5" /> АВТО
          </span>
        </div>
        <h3 className="font-display font-semibold text-sm sm:text-base line-clamp-1">{title}</h3>
        <p className="text-xs text-muted-foreground mt-1 line-clamp-2 flex-1">{subtitle}</p>
        <div className="flex items-baseline gap-2 mt-2">
          <span className="text-xs text-muted-foreground">от</span>
          <span className="font-display font-bold text-base sm:text-lg">${Number(fromPrice).toFixed(2)}</span>
          <PriceRub usd={Number(fromPrice)} className="text-[10px]" />
        </div>
      </div>
    </Link>
  );
};

export default AutoProductCard;
