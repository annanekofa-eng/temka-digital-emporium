import { Link } from 'react-router-dom';
import { useStorefront, useStorefrontPath } from '@/contexts/StorefrontContext';

const Footer = () => {
  const { shopName } = useStorefront();
  const buildPath = useStorefrontPath();
  const displayName = shopName || 'TeleStore';

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
        <p className="mt-4 text-center text-[10px] text-muted-foreground/60">© {displayName}</p>
      </div>
    </footer>
  );
};

export default Footer;
