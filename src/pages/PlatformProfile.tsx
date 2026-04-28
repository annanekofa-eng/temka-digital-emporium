import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useTelegram } from '@/contexts/TelegramContext';
import { supabase } from '@/integrations/supabase/client';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Store, Crown, Wallet, Calendar, Clock, Bot, ShieldCheck, AlertTriangle, Sparkles, ChevronRight, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import SubscriptionSheet from '@/components/platform/SubscriptionSheet';
import ShopInfoSheet from '@/components/platform/ShopInfoSheet';
import BalanceTopupSheet from '@/components/platform/BalanceTopupSheet';

interface ShopStats {
  products: number;
  orders: number;
  customers: number;
  revenue: number;
}

interface ShopData {
  id: string;
  name: string;
  slug: string;
  status: string;
  bot_username: string | null;
  webhook_status: string;
  created_at: string;
  bot_avatar_url?: string | null;
  stats?: ShopStats;
}

interface ProfileData {
  user: {
    id: string;
    telegram_id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    is_premium?: boolean;
    created_at: string;
  };
  subscription: {
    status: string;
    expires_at: string | null;
    trial_started_at: string | null;
    has_used_trial: boolean;
    pricing_tier: string | null;
    billing_price_usd: number | null;
    first_paid_at: string | null;
  };
  balance: number;
  shops: ShopData[];
}

const statusConfig: Record<string, { label: string; color: string; bg: string; icon: React.ReactNode }> = {
  active: { label: 'Активна', color: 'text-emerald-600', bg: 'bg-emerald-50 border-emerald-200', icon: <ShieldCheck className="w-5 h-5 text-emerald-500" /> },
  trial: { label: 'Активна', color: 'text-blue-600', bg: 'bg-blue-50 border-blue-200', icon: <Clock className="w-5 h-5 text-blue-500" /> },
  expired: { label: 'Истекла', color: 'text-red-600', bg: 'bg-red-50 border-red-200', icon: <AlertTriangle className="w-5 h-5 text-red-500" /> },
  grace_period: { label: 'Льготный период', color: 'text-amber-600', bg: 'bg-amber-50 border-amber-200', icon: <AlertTriangle className="w-5 h-5 text-amber-500" /> },
  cancelled: { label: 'Отменена', color: 'text-gray-600', bg: 'bg-gray-50 border-gray-300', icon: <AlertTriangle className="w-5 h-5 text-gray-400" /> },
  blocked: { label: 'Заблокирована', color: 'text-red-700', bg: 'bg-red-50 border-red-300', icon: <AlertTriangle className="w-5 h-5 text-red-600" /> },
  none: { label: 'Не активна', color: 'text-gray-500', bg: 'bg-gray-50 border-gray-200', icon: <Clock className="w-5 h-5 text-gray-400" /> },
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  // Use calendar day boundaries (UTC) so countdown decreases daily at midnight UTC
  const now = new Date();
  const end = new Date(dateStr);
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const endUTC = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  return Math.max(0, Math.round((endUTC - todayUTC) / (1000 * 60 * 60 * 24)));
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const PlatformProfile: React.FC = () => {
  const { user: tgUser, initData, isInTelegram, isReady, openTelegramLink, webApp, haptic } = useTelegram();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Sheet states
  const [subSheetOpen, setSubSheetOpen] = useState(false);
  const [balanceSheetOpen, setBalanceSheetOpen] = useState(false);
  const [shopSheetOpen, setShopSheetOpen] = useState(false);
  const [selectedShop, setSelectedShop] = useState<ShopData | null>(null);
  const [subLoading, setSubLoading] = useState(false);

  // Polling refs for subscription payment
  const subPollRef = useRef<number | null>(null);
  const subPollCountRef = useRef(0);

  // TMA: set header/background colors & hide back button
  useEffect(() => {
    if (!webApp) return;
    try {
      webApp.setHeaderColor('#2B7FFF');
      webApp.setBackgroundColor('#F0F7FF');
      webApp.BackButton.hide();
      webApp.expand();
    } catch {}
  }, [webApp]);

  const fetchProfile = useCallback(async (silent = false) => {
    if (!initData) {
      if (!silent) setError('Откройте профиль через Telegram');
      if (!silent) setLoading(false);
      return;
    }
    if (!silent) setError(null);
    if (silent) setRefreshing(true); else setLoading(true);

    try {
      const { data: res, error: err } = await supabase.functions.invoke('get-my-data', {
        body: { initData, action: 'platform-profile' },
      });
      if (err) throw err;
      if (res?.error) throw new Error(res.error);
      if (res?.user && !res.user.photo_url && tgUser?.photoUrl) {
        res.user.photo_url = tgUser.photoUrl;
      }
      setData(res);
    } catch (e: any) {
      if (!silent) setError(e.message || 'Ошибка загрузки');
    } finally {
      if (silent) setRefreshing(false); else setLoading(false);
    }
  }, [initData, tgUser?.photoUrl]);

  useEffect(() => {
    if (!isReady) return;
    fetchProfile();
  }, [isReady, fetchProfile]);

  // Cleanup subscription polling
  useEffect(() => {
    return () => {
      if (subPollRef.current) clearInterval(subPollRef.current);
    };
  }, []);

  const handleSubscriptionPay = async (useBalance: boolean, promoCode?: string, months?: number) => {
    if (!isInTelegram || !initData) {
      toast.info('Откройте платформу через Telegram');
      return;
    }
    setSubLoading(true);
    try {
      const { data: res, error: err } = await supabase.functions.invoke('create-subscription-invoice', {
        body: { initData, useBalance, promoCode, months: months || 1 },
      });
      if (err) throw err;
      if (res?.error) throw new Error(res.error);

      if (res?.status === 'paid') {
        toast.success('Подписка активирована!');
        setSubSheetOpen(false);
        fetchProfile(true);
        return;
      }

      if (res?.payUrl) {
        openTelegramLink(res.payUrl);
        if (subPollRef.current) clearInterval(subPollRef.current);
        subPollCountRef.current = 0;
        subPollRef.current = window.setInterval(async () => {
          subPollCountRef.current++;
          if (subPollCountRef.current >= 60) {
            if (subPollRef.current) clearInterval(subPollRef.current);
            subPollRef.current = null;
            return;
          }
          try {
            const { data: checkRes } = await supabase.functions.invoke('check-payment', {
              body: { invoiceId: res.invoiceId, initData, platform: true, type: 'subscription' },
            });
            if (checkRes?.paymentStatus === 'paid' || checkRes?.subscriptionStatus === 'paid') {
              if (subPollRef.current) clearInterval(subPollRef.current);
              subPollRef.current = null;
              toast.success('Подписка активирована!');
              setSubSheetOpen(false);
              fetchProfile(true);
            }
          } catch {}
        }, 5000);
        toast.success('Счёт создан. Перенаправляем к оплате...');
        setSubSheetOpen(false);
      }
    } catch (e: any) {
      toast.error(e.message || 'Ошибка создания счёта');
    } finally {
      setSubLoading(false);
    }
  };

  if (error || (!loading && !data)) {
    const isNotInTelegram = error === 'Откройте профиль через Telegram';
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#F0F7FF] to-white flex items-center justify-center p-6">
        <Card className="max-w-md w-full border border-red-100 bg-white shadow-lg">
          <CardContent className="p-8 text-center space-y-4">
            <AlertTriangle className={`w-10 h-10 mx-auto ${isNotInTelegram ? 'text-blue-400' : 'text-red-400'}`} />
            <p className="text-gray-700 font-medium">
              {isNotInTelegram ? 'Профиль доступен только в Telegram' : 'Не удалось загрузить профиль'}
            </p>
            <p className="text-gray-400 text-sm">
              {isNotInTelegram ? 'Откройте эту страницу через кнопку в платформенном боте.' : error}
            </p>
            {!isNotInTelegram && (
              <button
                onClick={() => { setError(null); fetchProfile(); }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-blue-500 text-white text-sm font-medium hover:bg-blue-600 transition-colors"
              >
                <RefreshCw className="w-4 h-4" /> Попробовать снова
              </button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#F0F7FF] to-white flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const { user, subscription, shops } = data;
  const subCfg = statusConfig[subscription.status] || statusConfig.expired;
  const daysLeft = daysUntil(subscription.expires_at);
  const initials = (user.first_name?.[0] || '') + (user.last_name?.[0] || '');

  return (
    <div className="min-h-screen bg-gradient-to-b from-[#F0F7FF] to-white" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="max-w-lg mx-auto p-4 space-y-4" style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}>

        {/* Block 1: Profile Header */}
        <Card className="border border-blue-100 bg-white shadow-sm overflow-hidden">
          <div className="h-20 bg-gradient-to-r from-[#2B7FFF] to-[#60A5FA] relative">
            <button
              onClick={() => { haptic.impact('light'); fetchProfile(true); }}
              className="absolute top-3 right-3 p-1.5 rounded-full bg-white/20 hover:bg-white/30 transition-colors"
              disabled={refreshing}
            >
              <RefreshCw className={`w-4 h-4 text-white ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </div>
          <CardContent className="p-5 -mt-10">
            <div className="flex items-end gap-4">
              <Avatar className="w-16 h-16 border-[3px] border-white shadow-md">
                {user.photo_url ? (
                  <AvatarImage src={user.photo_url} alt={user.first_name} />
                ) : null}
                <AvatarFallback className="bg-blue-500 text-white text-lg font-semibold">
                  {initials || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 pb-1">
                <div className="flex items-center gap-2">
                  <h1 className="text-lg font-bold text-gray-900 truncate">
                    {user.first_name} {user.last_name || ''}
                  </h1>
                  {user.is_premium && (
                    <Badge className="bg-gradient-to-r from-amber-400 to-yellow-500 text-white border-0 text-[10px] px-1.5 py-0 gap-0.5">
                      <Sparkles className="w-2.5 h-2.5" /> Premium
                    </Badge>
                  )}
                </div>
                {user.username && (
                  <p className="text-sm text-gray-400">@{user.username}</p>
                )}
              </div>
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs text-gray-400">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Подключён через Telegram
              <span className="ml-auto text-gray-300">ID {user.telegram_id}</span>
            </div>
          </CardContent>
        </Card>

        {/* Block 2: Balance — clickable */}
        <Card
          className="border border-blue-100 bg-white shadow-sm cursor-pointer hover:shadow-md transition-shadow active:scale-[0.99]"
          onClick={() => { haptic.impact('light'); setBalanceSheetOpen(true); }}
        >
          <CardContent className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 flex items-center justify-center">
                  <Wallet className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-xs text-gray-400 font-medium">Баланс</p>
                  <p className="text-2xl font-bold text-gray-900">${data.balance.toFixed(2)}</p>
                </div>
              </div>
              <div className="flex items-center gap-1 text-blue-500">
                <span className="text-xs font-medium">Пополнить</span>
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Block 3: Subscription — dominant, clickable */}
        <Card
          className={`border shadow-sm overflow-hidden cursor-pointer hover:shadow-md transition-shadow active:scale-[0.99] ${subCfg.bg}`}
          onClick={() => { haptic.impact('light'); setSubSheetOpen(true); }}
        >
          <CardContent className="p-5 space-y-4">
            <div className="flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-11 h-11 rounded-xl bg-white/80 flex items-center justify-center shadow-sm">
                  {subCfg.icon}
                </div>
                <div>
                  <p className="text-xs text-gray-500 font-medium">Подписка</p>
                  <p className={`text-lg font-bold ${subCfg.color}`}>{subCfg.label}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {subscription.billing_price_usd != null && (
                  <div className="text-right">
                    <p className="text-2xl font-extrabold text-gray-900">${subscription.billing_price_usd}</p>
                    <p className="text-[10px] text-gray-400 font-medium">/ мес</p>
                  </div>
                )}
                <ChevronRight className="w-5 h-5 text-gray-300" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {subscription.expires_at && (
                <div className="bg-white/60 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium mb-0.5 flex items-center gap-1">
                    <Calendar className="w-3 h-3" /> Действует до
                  </p>
                  <p className="text-sm font-semibold text-gray-800">{formatDate(subscription.expires_at)}</p>
                </div>
              )}
              {daysLeft !== null && (
                <div className="bg-white/60 rounded-xl p-3">
                  <p className="text-[10px] text-gray-400 font-medium mb-0.5 flex items-center gap-1">
                    <Clock className="w-3 h-3" /> Осталось
                  </p>
                  <p className={`text-sm font-semibold ${daysLeft <= 3 ? 'text-red-600' : daysLeft <= 7 ? 'text-amber-600' : 'text-gray-800'}`}>
                    {daysLeft > 0 ? `${daysLeft} дн.` : 'Истекает сегодня'}
                  </p>
                </div>
              )}
            </div>

            {subscription.pricing_tier && (
              <div className="flex items-center gap-2 text-xs text-gray-500">
                <Crown className="w-3.5 h-3.5 text-amber-500" />
                Тариф: <span className="font-medium text-gray-700 capitalize">{subscription.pricing_tier === 'early_3' ? 'Early Bird' : subscription.pricing_tier}</span>
              </div>
            )}

            {subscription.status === 'active' && (
              <div className="bg-emerald-100/50 rounded-xl p-3 text-center">
                <p className="text-xs text-emerald-700 font-medium">
                  ✅ Подписка активна. Нажмите, чтобы продлить заранее.
                </p>
              </div>
            )}
            {subscription.status === 'trial' && (
              <div className="bg-blue-100/50 rounded-xl p-3 text-center">
                <p className="text-xs text-blue-700 font-medium">
                  ✅ Бесплатный период {daysLeft !== null ? `— осталось ${daysLeft > 0 ? `${daysLeft} дн.` : 'истекает сегодня'}` : ''}. Нажмите для оформления.
                </p>
              </div>
            )}
            {subscription.status === 'expired' && (
              <div className="bg-red-100/50 rounded-xl p-3 text-center">
                <p className="text-xs text-red-700 font-medium">
                  ⚠️ Подписка истекла. Нажмите для продления.
                </p>
              </div>
            )}
            {subscription.status === 'grace_period' && (
              <div className="bg-amber-100/50 rounded-xl p-3 text-center">
                <p className="text-xs text-amber-700 font-medium">
                  ⏰ Льготный период. Нажмите, чтобы продлить подписку.
                </p>
              </div>
            )}
            {subscription.status === 'none' && (
              <div className="bg-gray-100/50 rounded-xl p-3 text-center">
                <p className="text-xs text-gray-600 font-medium">
                  ⏳ Подписка не активна. Нажмите для оформления.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Block 4: Shops — clickable */}
        <Card className="border border-blue-100 bg-white shadow-sm">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Store className="w-4.5 h-4.5 text-blue-500" />
                <h3 className="font-semibold text-gray-900">Мои магазины</h3>
              </div>
              <Badge variant="secondary" className="bg-blue-50 text-blue-600 border-0 text-xs">
                {shops.length}
              </Badge>
            </div>

            {shops.length === 0 ? (
              <div className="text-center py-6">
                <div className="w-12 h-12 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-3">
                  <Store className="w-6 h-6 text-gray-300" />
                </div>
                <p className="text-sm text-gray-400">У вас пока нет магазинов</p>
              </div>
            ) : (
              <div className="space-y-2">
                {shops.map((shop) => (
                  <div
                    key={shop.id}
                    className="flex items-center gap-3 p-3 rounded-xl bg-gray-50/80 hover:bg-blue-50/50 transition-colors cursor-pointer active:scale-[0.99]"
                    onClick={() => { haptic.impact('light'); setSelectedShop(shop); setShopSheetOpen(true); }}
                  >
                    <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center text-blue-600 font-bold text-sm">
                      {shop.name[0]?.toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{shop.name}</p>
                      <div className="flex items-center gap-2 text-[10px] text-gray-400 mt-0.5">
                        <span className={`inline-flex items-center gap-0.5 ${shop.status === 'active' ? 'text-emerald-500' : shop.status === 'paused' ? 'text-amber-500' : 'text-gray-400'}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${shop.status === 'active' ? 'bg-emerald-400' : shop.status === 'paused' ? 'bg-amber-400' : 'bg-gray-300'}`} />
                          {shop.status === 'active' ? 'Активен' : shop.status === 'paused' ? 'Приостановлен' : shop.status}
                        </span>
                        {shop.bot_username && (
                          <span className="flex items-center gap-0.5">
                            <Bot className="w-2.5 h-2.5" /> @{shop.bot_username}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-gray-300 shrink-0" />
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Legal links */}
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 pt-2">
          <a href="/platform/terms" className="text-[10px] text-gray-300 hover:text-blue-400 transition-colors">Соглашение</a>
          <a href="/platform/rules" className="text-[10px] text-gray-300 hover:text-blue-400 transition-colors">Правила</a>
          <a href="/platform/privacy" className="text-[10px] text-gray-300 hover:text-blue-400 transition-colors">Конфиденциальность</a>
          <a href="/platform/subscription" className="text-[10px] text-gray-300 hover:text-blue-400 transition-colors">Подписка</a>
          <a href="/platform/consent" className="text-[10px] text-gray-300 hover:text-blue-400 transition-colors">Согласие на ПД</a>
        </div>
        <p className="text-center text-[10px] text-gray-300 pt-1">
          Платформа · {new Date().getFullYear()}
        </p>
      </div>

      {/* Sheets */}
      <SubscriptionSheet
        subscription={subscription}
        balance={data.balance}
        open={subSheetOpen}
        onOpenChange={setSubSheetOpen}
        onPayWithInvoice={handleSubscriptionPay}
        loading={subLoading}
      />
      <ShopInfoSheet
        shop={selectedShop}
        open={shopSheetOpen}
        onOpenChange={setShopSheetOpen}
        canUsePremium={!!(data as any)?.subscription?.entitlements?.ai_avatar}
        initData={initData}
        openTelegramLink={openTelegramLink}
        onAvatarUpdated={() => fetchProfile(true)}
      />
      <BalanceTopupSheet
        balance={data.balance}
        open={balanceSheetOpen}
        onOpenChange={setBalanceSheetOpen}
        onBalanceUpdated={() => fetchProfile(true)}
      />
    </div>
  );
};

export default PlatformProfile;
