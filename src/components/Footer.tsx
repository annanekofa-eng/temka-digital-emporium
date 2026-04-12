import { Link } from 'react-router-dom';
import { useStorefront, useStorefrontPath } from '@/contexts/StorefrontContext';
import { Flag } from 'lucide-react';
import { APP_URL } from '@/config/app';

const HIDE_PLATFORM_BADGE_SLUGS = ['sakura-store'];

const Footer = () => {
  const { shopName, basePath, botUsername, slug } = useStorefront();
  const buildPath = useStorefrontPath();
  const displayName = shopName || 'TeleStore';

  const isShopStorefront = basePath.startsWith('/shop/');
  const showPlatformBadge = isShopStorefront && !HIDE_PLATFORM_BADGE_SLUGS.includes(slug || '');

  const shopIdentifier = botUsername
    ? `@${botUsername}`
    : `${APP_URL}${basePath}`;

  const reportText = encodeURIComponent(
    `Здравствуйте. Магазин «${displayName}» (${shopIdentifier}) нарушает правила платформы.\nПрошу проверить.\nВ следующем сообщении опишу причину нарушения.`
  );

  return (
    <footer className="border-t border-border/30 bg-card/30 pb-20">
      <div className="container-main mx-auto px-4 py-6">
        <div className="grid grid-cols-2 gap-4 text-center">
          <div>
            <h4 className="font-display font-semibold text-xs mb-2">Информация</h4>
            <ul className="space-y-1">
              <li><Link to={buildPath('/about')} className="text-xs text-muted-foreground hover:text-primary transition-colors">О нас</Link></li>
              <li><Link to={buildPath('/faq')} className="text-xs text-muted-foreground hover:text-primary transition-colors">FAQ</Link></li>
              <li><Link to={buildPath('/delivery')} className="text-xs text-muted-foreground hover:text-primary transition-colors">Доставка</Link></li>
              <li><Link to={buildPath('/guarantees')} className="text-xs text-muted-foreground hover:text-primary transition-colors">Гарантии</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-display font-semibold text-xs mb-2">Документы</h4>
            <ul className="space-y-1">
              <li><Link to={buildPath('/terms')} className="text-xs text-muted-foreground hover:text-primary transition-colors">Условия и отказ</Link></li>
            </ul>
          </div>
        </div>

        {showPlatformBadge && (
          <div className="mt-5 pt-5 border-t border-border/30 flex flex-col items-center gap-3">
            <p className="text-xs text-muted-foreground/70">
              Магазин создан через{' '}
              <a
                href="https://t.me/Tele_Store_Robot?start=platform"
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary/80 hover:text-primary transition-colors underline underline-offset-2 font-medium"
              >
                TeleStore
              </a>
            </p>
            <a
              href={`https://t.me/TeleStoreHelp?text=${reportText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-xs text-muted-foreground/50 hover:text-destructive/70 transition-colors"
            >
              <Flag className="w-3 h-3" />
              Пожаловаться на магазин
            </a>
          </div>
        )}
      </div>
    </footer>
  );
};

export default Footer;
