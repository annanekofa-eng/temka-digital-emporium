import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoreProvider, useStore } from "@/contexts/StoreContext";
import { TelegramProvider } from "@/contexts/TelegramContext";
import { StorefrontProvider } from "@/contexts/StorefrontContext";
import Header from "@/components/Header";
import { useSiteSettings } from "@/hooks/useShop";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import { Outlet } from "react-router-dom";
import React, { Suspense } from "react";
import ScrollToTop from "@/components/ScrollToTop";

const Index = React.lazy(() => import("./pages/Index"));
const Project = React.lazy(() => import("./pages/Project"));
const Catalog = React.lazy(() => import("./pages/Catalog"));
const ProductDetails = React.lazy(() => import("./pages/ProductDetails"));
const Cart = React.lazy(() => import("./pages/Cart"));
const Checkout = React.lazy(() => import("./pages/Checkout"));
const OrderSuccess = React.lazy(() => import("./pages/OrderSuccess"));
const OrderStatus = React.lazy(() => import("./pages/OrderStatus"));
const OrderFailed = React.lazy(() => import("./pages/OrderFailed"));
const Account = React.lazy(() => import("./pages/Account"));
const FAQ = React.lazy(() => import("./pages/FAQ"));
const About = React.lazy(() => import("./pages/About"));
const Legal = React.lazy(() => import("./pages/Legal"));
const Delivery = React.lazy(() => import("./pages/InfoPages").then(m => ({ default: m.Delivery })));
const Guarantees = React.lazy(() => import("./pages/InfoPages").then(m => ({ default: m.Guarantees })));
const NotFound = React.lazy(() => import("./pages/NotFound"));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
  </div>
);

const MainLayoutInner = () => {
  const { cartCount, searchQuery, setSearchQuery } = useStore();
  const { data: settings } = useSiteSettings();
  const shopName = settings?.shop_name || 'TEMKA SHOP';

  return (
    <StorefrontProvider basePath="" cartCount={cartCount} shopName={shopName} supportLink={settings?.support_username ? `https://t.me/${settings.support_username.replace('@', '')}` : 'https://t.me/TeleStoreHelp'}>
      <div className="min-h-screen flex flex-col theme-light">
        <Header
          name={shopName}
          nameInitial={shopName[0] || 'T'}
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

const MainLayout = () => <MainLayoutInner />;

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <TelegramProvider>
        <StoreProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ScrollToTop />
            <Suspense fallback={<PageLoader />}>
              <Routes>
                <Route element={<MainLayout />}>
                  <Route path="/" element={<Index />} />
                  <Route path="/catalog" element={<Catalog />} />
                  <Route path="/product/:id" element={<ProductDetails />} />
                  <Route path="/cart" element={<Cart />} />
                  <Route path="/checkout" element={<Checkout />} />
                  <Route path="/order-success" element={<OrderSuccess />} />
                  <Route path="/order-status" element={<OrderStatus />} />
                  <Route path="/order-failed" element={<OrderFailed />} />
                  <Route path="/account" element={<Account />} />
                  <Route path="/faq" element={<FAQ />} />
                  <Route path="/about" element={<About />} />
                  <Route path="/terms" element={<Legal />} />
                  <Route path="/privacy" element={<Legal />} />
                  <Route path="/refund" element={<Legal />} />
                  <Route path="/disclaimer" element={<Legal />} />
                  <Route path="/delivery" element={<Delivery />} />
                  <Route path="/guarantees" element={<Guarantees />} />
                  <Route path="*" element={<NotFound />} />
                </Route>
              </Routes>
            </Suspense>
          </BrowserRouter>
        </StoreProvider>
      </TelegramProvider>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
