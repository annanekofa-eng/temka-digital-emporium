import { useStorefront } from '@/contexts/StorefrontContext';
import { useSiteSettings } from '@/hooks/useShop';
import { FileText, HelpCircle, MessageCircle } from 'lucide-react';

const DEFAULT_FAQ = 'https://telegra.ph/FAQ-temka-shop-01-01';
const DEFAULT_POLICY = 'https://telegra.ph/Politika-konfidencialnosti-01-01';

const Footer = () => {
  const { shopName } = useStorefront();
  const { data: settings } = useSiteSettings();
  const displayName = settings?.shop_name || shopName || 'Hustlify';
  const faqUrl = settings?.faq_url || DEFAULT_FAQ;
  const policyUrl = settings?.policy_url || DEFAULT_POLICY;
  const support = settings?.support_username;

  return (
    <footer className="border-t border-border/40 bg-card/40 pb-20 mt-8">
      <div className="container-main mx-auto px-4 py-8">
        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm">
          <a
            href={faqUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors"
          >
            <HelpCircle className="w-3.5 h-3.5" /> FAQ
          </a>
          <a
            href={policyUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors"
          >
            <FileText className="w-3.5 h-3.5" /> Политика конфиденциальности
          </a>
          {support && (
            <a
              href={`https://t.me/${support.replace('@', '')}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-primary transition-colors"
            >
              <MessageCircle className="w-3.5 h-3.5" /> Поддержка
            </a>
          )}
        </div>
        <p className="mt-4 text-center text-xs text-muted-foreground/70">© {displayName}</p>
      </div>
    </footer>
  );
};

export default Footer;
