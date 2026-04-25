import { Outlet } from 'react-router-dom';
import { ShopProvider, useShop } from '@/contexts/ShopContext';
import { StorefrontProvider } from '@/contexts/StorefrontContext';
import Header from '@/components/Header';
import Footer from '@/components/Footer';
import BottomNav from '@/components/BottomNav';
import { Loader2, ShieldAlert, AlertTriangle } from 'lucide-react';
import { useParams } from 'react-router-dom';

const ShopUnavailableScreen = ({ type }: { type: 'paused' | 'deleted' }) => (
  <div className="min-h-screen flex flex-col items-center justify-center px-6 text-center bg-background">
    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-6">
      {type === 'paused' ? (
        <ShieldAlert className="w-8 h-8 text-muted-foreground" />
      ) : (
        <AlertTriangle className="w-8 h-8 text-muted-foreground" />
      )}
    </div>
    <h1 className="font-display text-xl font-bold mb-2 text-foreground">
      {type === 'paused' ? 'Магазин временно недоступен' : 'Магазин не найден'}
    </h1>
    <p className="text-muted-foreground text-sm max-w-sm">
      {type === 'paused'
        ? 'Этот магазин временно приостановлен. Пожалуйста, обратитесь в поддержку для получения информации.'
        : 'Магазин был удалён или не существует. Если вы перешли по старой ссылке, она больше не действительна.'}
    </p>
  </div>
);

const ShopContent = () => {
  const { shopId } = useParams();
  const { shop, loading, error, cartCount, searchQuery, setSearchQuery } = useShop();
  const basePath = `/shop/${shopId}`;

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  // Shop not found at all (deleted or never existed)
  if (error || !shop) {
    return <ShopUnavailableScreen type="deleted" />;
  }

  // Shop exists but is not active (paused/deactivated)
  if (shop.status !== 'active') {
    return <ShopUnavailableScreen type="paused" />;
  }

  return (
    <StorefrontProvider basePath={basePath} cartCount={cartCount} shopName={shop.name} supportLink={shop.support_link} botUsername={shop.bot_username} botAvatarUrl={shop.bot_avatar_url} slug={shop.slug}>
      <div className="min-h-screen flex flex-col">
        <Header
          name={shop.name}
          nameInitial={shop.name?.[0]?.toUpperCase() || 'S'}
          avatarUrl={shop.bot_avatar_url || undefined}
          searchQuery={searchQuery}
          setSearchQuery={setSearchQuery}
        />
        <main className="flex-1 pb-14">
          <Outlet />
        </main>
        <Footer />
        <BottomNav />
      </div>
    </StorefrontProvider>
  );
};

const ShopLayout = () => (
  <ShopProvider>
    <ShopContent />
  </ShopProvider>
);

export default ShopLayout;
