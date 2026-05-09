import { useStorefront } from '@/contexts/StorefrontContext';
import { useSiteSettings } from '@/hooks/useShop';

const Footer = () => {
  const { shopName } = useStorefront();
  const { data: settings } = useSiteSettings();
  const displayName = settings?.shop_name || shopName || 'TEMKA SHOP';
  const faqUrl = settings?.faq_url;
  const policyUrl = settings?.policy_url;
  const support = settings?.support_username;

  return (
    <footer className="border-t border-border/40 bg-card/40 pb-20 mt-8">
      <div className="container-main mx-auto px-4 py-8">
        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
          {faqUrl && (
            <a href={faqUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
              FAQ
            </a>
          )}
          {policyUrl && (
            <a href={policyUrl} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
              Политика
            </a>
          )}
          {support && (
            <a href={`https://t.me/${support.replace('@', '')}`} target="_blank" rel="noopener noreferrer" className="text-muted-foreground hover:text-primary transition-colors">
              Поддержка
            </a>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground/70">© {displayName}</p>
      </div>
    </footer>
  );
};

export default Footer;
