import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { StoreProvider, useStore } from "@/contexts/StoreContext";
import { TelegramProvider } from "@/contexts/TelegramContext";
import { StorefrontProvider } from "@/contexts/StorefrontContext";
import Header from "@/components/Header";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import { Outlet } from "react-router-dom";
import React, { Suspense } from "react";
import ScrollToTop from "@/components/ScrollToTop";

// Lazy load all pages
const Index = React.lazy(() => import("./pages/Index"));
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
const InfoPages = React.lazy(() => import("./pages/InfoPages").then(m => ({ default: m.Delivery })));
const Delivery = React.lazy(() => import("./pages/InfoPages").then(m => ({ default: m.Delivery })));
const Guarantees = React.lazy(() => import("./pages/InfoPages").then(m => ({ default: m.Guarantees })));
const PlatformTerms = React.lazy(() => import("./pages/PlatformTerms"));
const PlatformPrivacy = React.lazy(() => import("./pages/PlatformPrivacy"));
const PlatformRules = React.lazy(() => import("./pages/PlatformRules"));
const PlatformSubscription = React.lazy(() => import("./pages/PlatformSubscription"));
const PlatformConsent = React.lazy(() => import("./pages/PlatformConsent"));
const PlatformProfile = React.lazy(() => import("./pages/PlatformProfile"));
const NotFound = React.lazy(() => import("./pages/NotFound"));
const Landing = React.lazy(() => import("./pages/Landing"));
const Guides = React.lazy(() => import("./pages/Guides"));
const Adm = React.lazy(() => import("./pages/Adm"));
const ShopLayout = React.lazy(() => import("./pages/ShopLayout"));
const ShopIndex = React.lazy(() => import("./pages/ShopIndex"));
const ShopCatalog = React.lazy(() => import("./pages/ShopCatalog"));
const ShopProductDetails = React.lazy(() => import("./pages/ShopProductDetails"));
const ShopCart = React.lazy(() => import("./pages/ShopCart"));
const ShopCheckout = React.lazy(() => import("./pages/ShopCheckout"));
const ShopOrderSuccess = React.lazy(() => import("./pages/ShopOrderSuccess"));
const ShopOrderStatus = React.lazy(() => import("./pages/ShopOrderStatus"));
const ShopAutoPremium = React.lazy(() => import("./pages/ShopAutoPremium"));
const ShopAutoStars = React.lazy(() => import("./pages/ShopAutoStars"));

const PageLoader = () => (
  <div className="flex items-center justify-center min-h-[50vh]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
  </div>
);

const MainLayoutInner = () => {
  const { cartCount, searchQuery, setSearchQuery } = useStore();

  return (
    <StorefrontProvider basePath="" cartCount={cartCount} shopName="TeleStore" supportLink="https://t.me/TeleStoreHelp">
      <div className="min-h-screen flex flex-col theme-light">
        <Header
          name="YOUR"
          nameInitial="Y"
          nameHighlight=".STORE"
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
                {/* Platform pages — standalone, no layout */}
                <Route path="/landing" element={<Landing />} />
                <Route path="/guides" element={<Guides />} />
                <Route path="/adm" element={<Adm />} />
                <Route path="/platform/profile" element={<PlatformProfile />} />
                <Route path="/platform/terms" element={<PlatformTerms />} />
                <Route path="/platform/privacy" element={<PlatformPrivacy />} />
                <Route path="/platform/rules" element={<PlatformRules />} />
                <Route path="/platform/subscription" element={<PlatformSubscription />} />
                <Route path="/platform/consent" element={<PlatformConsent />} />
                {/* Legacy redirect */}
                <Route path="/platform/disclaimer" element={<PlatformTerms />} />

                {/* Seller shop storefront */}
                <Route path="/shop/:shopId" element={<ShopLayout />}>
                  <Route index element={<ShopIndex />} />
                  <Route path="catalog" element={<ShopCatalog />} />
                  <Route path="product/:productId" element={<ShopProductDetails />} />
                  <Route path="cart" element={<ShopCart />} />
                  <Route path="checkout" element={<ShopCheckout />} />
                  <Route path="order-success" element={<ShopOrderSuccess />} />
                  <Route path="order-status" element={<ShopOrderStatus />} />
                  <Route path="auto/premium" element={<ShopAutoPremium />} />
                  <Route path="auto/stars" element={<ShopAutoStars />} />
                  <Route path="account" element={<Account />} />
                  <Route path="faq" element={<FAQ />} />
                  <Route path="about" element={<About />} />
                  <Route path="terms" element={<Legal />} />
                  <Route path="privacy" element={<Legal />} />
                  <Route path="refund" element={<Legal />} />
                  <Route path="disclaimer" element={<Legal />} />
                  <Route path="delivery" element={<Delivery />} />
                  <Route path="guarantees" element={<Guarantees />} />
                  <Route path="*" element={<NotFound />} />
                </Route>

                {/* Main platform */}
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
