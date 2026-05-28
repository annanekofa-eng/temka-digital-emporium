import { Link, NavLink, useNavigate } from 'react-router-dom';
import { Search, X, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStorefront, useStorefrontPath } from '@/contexts/StorefrontContext';
import { useState } from 'react';
import hustlifyLogo from '@/assets/logo-hustlify.jpg';

interface HeaderProps {
  name?: string;
  nameInitial?: string;
  nameHighlight?: string;
  avatarUrl?: string;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
}

const Header = ({ name, nameInitial, nameHighlight, avatarUrl, searchQuery, setSearchQuery }: HeaderProps) => {
  const [searchOpen, setSearchOpen] = useState(false);
  const effectiveAvatar = avatarUrl || hustlifyLogo;
  const navigate = useNavigate();
  const buildPath = useStorefrontPath();
  const { cartCount } = useStorefront();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) navigate(`${buildPath('/catalog')}?search=${encodeURIComponent(searchQuery)}`);
  };

  const navItems = [
    { to: buildPath('/'), label: 'Главная', end: true },
    { to: buildPath('/catalog'), label: 'Каталог' },
    { to: buildPath('/account'), label: 'Профиль' },
  ];

  return (
    <header className="sticky top-0 z-50 glass-strong">
      <a
        href="https://t.me/telestoretestbot"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Открыть пример магазина в Telegram"
        className="group relative block w-full overflow-hidden border-b border-primary/40 bg-gradient-to-r from-primary/20 via-primary/10 to-primary/20 text-center py-2 px-4 animate-pulse-glow"
      >
        <span className="relative z-10 inline-flex items-center gap-2 text-xs sm:text-sm font-bold uppercase tracking-wide text-primary [text-shadow:_0_0_8px_hsl(var(--primary)/0.8),_0_0_16px_hsl(var(--primary)/0.5)]">
          <span className="hidden sm:inline-block w-2 h-2 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary)),_0_0_20px_hsl(var(--primary))] animate-pulse" />
          👉 Пример магазина — открыть в Telegram
          <span className="underline underline-offset-2 decoration-primary/70 group-hover:decoration-primary">@telestoretestbot</span>
        </span>
        <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(110deg,transparent_30%,hsl(var(--primary)/0.25)_50%,transparent_70%)] bg-[length:200%_100%] animate-shimmer" />
      </a>
      <div className="container-main mx-auto flex items-center justify-between gap-3 px-4 py-2.5">
        <Link to={buildPath('/')} className="flex items-center gap-2 shrink-0">
          <img
            src={effectiveAvatar}
            alt={name || 'Hustlify'}
            loading="lazy"
            className="w-7 h-7 rounded-lg object-cover bg-black"
          />
          <span className="font-display font-bold text-base tracking-tight">
            {nameHighlight ? (
              <>{name}<span className="text-primary">{nameHighlight}</span></>
            ) : (
              name || 'Магазин'
            )}
          </span>
        </Link>

        {/* Desktop nav */}
        <nav className="hidden lg:flex items-center gap-1">
          {navItems.map(it => (
            <NavLink
              key={it.to}
              to={it.to}
              end={it.end}
              className={({ isActive }) =>
                `px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                  isActive ? 'text-foreground bg-secondary' : 'text-muted-foreground hover:text-foreground'
                }`
              }
            >
              {it.label}
            </NavLink>
          ))}
        </nav>

        <div className="flex items-center gap-1">
          {searchOpen ? (
            <form onSubmit={handleSearch} className="flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Поиск товаров..."
                  aria-label="Поиск товаров"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full lg:w-64 h-9 pl-9 pr-9 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                  autoFocus
                />
                <button type="button" aria-label="Закрыть поиск" onClick={() => setSearchOpen(false)} className="absolute right-2 top-1/2 -translate-y-1/2">
                  <X className="w-4 h-4 text-muted-foreground" />
                </button>
              </div>
            </form>
          ) : (
            <Button variant="ghost" size="icon" aria-label="Открыть поиск" className="shrink-0 w-9 h-9" onClick={() => setSearchOpen(true)}>
              <Search className="w-5 h-5" />
            </Button>
          )}
          {/* Desktop cart icon */}
          <Link to={buildPath('/cart')} aria-label={`Корзина${cartCount > 0 ? `, ${cartCount} товаров` : ''}`} className="hidden lg:inline-flex relative">
            <Button variant="ghost" size="icon" aria-hidden="true" tabIndex={-1} className="w-9 h-9">
              <ShoppingCart className="w-5 h-5" />
            </Button>
            {cartCount > 0 && (
              <span className="absolute -top-0.5 -right-0.5 w-4 h-4 bg-primary text-primary-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </Link>
        </div>
      </div>
    </header>
  );
};

export default Header;
