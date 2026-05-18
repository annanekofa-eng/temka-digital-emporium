import { Link, useLocation } from 'react-router-dom';
import { Home, ShoppingCart, User } from 'lucide-react';
import { useStorefront, useStorefrontPath } from '@/contexts/StorefrontContext';

const WheelIcon = ({ active }: { active: boolean }) => (
  <span
    className={`text-xl leading-none transition ${
      active ? 'grayscale-0 opacity-100' : 'opacity-70'
    }`}
    aria-hidden
  >
    🎰
  </span>
);

const BottomNav = () => {
  const location = useLocation();
  const { cartCount } = useStorefront();
  const buildPath = useStorefrontPath();

  const navItems = [
    { path: buildPath('/'), icon: Home, label: 'Главная', exact: true },
    { path: buildPath('/wheel'), icon: Home, label: 'Удача' },
    { path: buildPath('/cart'), icon: ShoppingCart, label: 'Корзина' },
    { path: buildPath('/account'), icon: User, label: 'Профиль' },
  ];

  return (
    <nav className="lg:hidden fixed bottom-0 left-0 right-0 z-50 glass-strong border-t border-border/30 safe-area-bottom">
      <div className="flex items-center justify-around h-14 max-w-lg mx-auto">
        {navItems.map((item) => {
          const isActive = item.exact
            ? location.pathname === item.path
            : location.pathname.startsWith(item.path);

          return (
            <Link
              key={item.path}
              to={item.path}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 h-full transition-colors ${
                isActive ? 'text-primary' : 'text-muted-foreground'
              }`}
            >
              <div className="relative">
                {item.label === 'Удача' ? (
                  <WheelIcon active={isActive} />
                ) : (
                  <item.icon className="w-5 h-5" />
                )}
                {item.label === 'Корзина' && cartCount > 0 && (
                  <span className="absolute -top-1.5 -right-2.5 w-4 h-4 bg-primary text-primary-foreground text-[9px] font-bold rounded-full flex items-center justify-center">
                    {cartCount}
                  </span>
                )}
              </div>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
