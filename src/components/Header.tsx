import { Link, useNavigate } from 'react-router-dom';
import { Search, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStorefrontPath } from '@/contexts/StorefrontContext';
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
  const navigate = useNavigate();
  const buildPath = useStorefrontPath();

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) navigate(`${buildPath('/catalog')}?search=${encodeURIComponent(searchQuery)}`);
  };

  return (
    <header className="sticky top-0 z-50 glass-strong">
      <div className="container-main mx-auto flex items-center justify-between gap-3 px-4 py-2.5">
        <Link to={buildPath('/')} className="flex items-center gap-2 shrink-0">
          {avatarUrl ? (
            <img
              src={avatarUrl}
              alt={name || 'Логотип магазина'}
              loading="lazy"
              className="w-7 h-7 rounded-lg object-cover bg-secondary"
              onError={(e) => {
                // Fallback to initial badge if image fails to load
                const target = e.currentTarget;
                const fallback = target.nextElementSibling as HTMLElement | null;
                target.style.display = 'none';
                if (fallback) fallback.style.display = 'flex';
              }}
            />
          ) : null}
          <div
            className="w-7 h-7 rounded-lg bg-primary items-center justify-center"
            style={{ display: avatarUrl ? 'none' : 'flex' }}
          >
            <span className="text-primary-foreground font-bold text-xs font-display">
              {nameInitial || 'T'}
            </span>
          </div>
          <span className="font-display font-bold text-base tracking-tight">
            {nameHighlight ? (
              <>{name}<span className="text-primary">{nameHighlight}</span></>
            ) : (
              name || 'Магазин'
            )}
          </span>
        </Link>

        {searchOpen ? (
          <form onSubmit={handleSearch} className="flex-1">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Поиск товаров..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full h-9 pl-9 pr-9 bg-secondary border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50"
                autoFocus
              />
              <button type="button" onClick={() => setSearchOpen(false)} className="absolute right-2 top-1/2 -translate-y-1/2">
                <X className="w-4 h-4 text-muted-foreground" />
              </button>
            </div>
          </form>
        ) : (
          <Button variant="ghost" size="icon" className="shrink-0 w-9 h-9" onClick={() => setSearchOpen(true)}>
            <Search className="w-5 h-5" />
          </Button>
        )}
      </div>
    </header>
  );
};

export default Header;
