import { useState, useMemo, useEffect, useCallback } from 'react';
import cryptobotLogo from '@/assets/cryptobot-logo.jpeg';
import { Package, CheckCircle2, Clock, MessageCircle, ChevronRight, AlertCircle, XCircle, Wallet, ArrowDownCircle, ArrowUpCircle, Plus, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { useStorefront, useStorefrontPath } from '@/contexts/StorefrontContext';
import { useTelegram } from '@/contexts/TelegramContext';
import { useOrders, useUserStats, useUserProfile, useBalanceHistory } from '@/hooks/useOrders';
import { useSupportUsername } from '@/hooks/useSupportUsername';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { ORDER_STATUS_LABELS } from '@/types/database';
import type { DbOrder, DbBalanceHistory } from '@/types/database';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from '@/components/ui/drawer';
import { Input } from '@/components/ui/input';
import OrderDetailSheet from '@/components/OrderDetailSheet';
import BalanceDetailSheet from '@/components/BalanceDetailSheet';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';

type TimelineItem =
  | { type: 'order'; data: DbOrder; date: string }
  | { type: 'balance'; data: DbBalanceHistory; date: string };

const statusIcon = (status: DbOrder['status']) => {
  switch (status) {
    case 'completed': case 'delivered': case 'paid':
      return <CheckCircle2 className="w-3.5 h-3.5 text-primary" />;
    case 'processing': case 'awaiting_payment': case 'pending':
      return <Clock className="w-3.5 h-3.5 text-warning" />;
    case 'cancelled':
      return <XCircle className="w-3.5 h-3.5 text-muted-foreground" />;
    case 'error':
      return <AlertCircle className="w-3.5 h-3.5 text-destructive" />;
    default:
      return <Clock className="w-3.5 h-3.5" />;
  }
};

const statusColor = (status: DbOrder['status']) => {
  switch (status) {
    case 'completed': case 'delivered': case 'paid': return 'text-primary';
    case 'processing': case 'awaiting_payment': case 'pending': return 'text-warning';
    case 'cancelled': return 'text-muted-foreground';
    case 'error': return 'text-destructive';
    default: return 'text-muted-foreground';
  }
};

const PREVIEW_COUNT = 5;

const Account = () => {
  const { supportLink, basePath } = useStorefront();
  const buildPath = useStorefrontPath();
  const { user, isInTelegram, openTelegramLink, haptic, initData } = useTelegram();

  const { data: orders, isLoading: ordersLoading } = useOrders();
  const { data: balanceHistory, isLoading: balanceLoading } = useBalanceHistory();
  const { data: stats, isLoading: statsLoading } = useUserStats();
  const { data: profile, isLoading: profileLoading } = useUserProfile();
  const queryClient = useQueryClient();
  const { data: supportUsername } = useSupportUsername();

  const [showAll, setShowAll] = useState(false);
  const [selectedOrder, setSelectedOrder] = useState<DbOrder | null>(null);
  const [selectedBalance, setSelectedBalance] = useState<DbBalanceHistory | null>(null);
  const [showTopup, setShowTopup] = useState(false);
  const [topupAmount, setTopupAmount] = useState('');
  const [topupProcessing, setTopupProcessing] = useState(false);
  const [pendingTopupInvoiceId, setPendingTopupInvoiceId] = useState<string | null>(null);

  const TOPUP_PRESETS = [1, 5, 10, 25];

  const displayName = user
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}`
    : 'Telegram User';
  const username = user?.username ? `@${user.username}` : '';
  const avatar = user?.firstName?.[0]?.toUpperCase() || 'T';

  const MIN_TOPUP = 0.1;
  const MAX_TOPUP = 1000;
  const pendingTopupStorageKey = useMemo(
    () => `pending-topup-${shopId || 'platform'}-${user?.id || 'anon'}`,
    [shopId, user?.id],
  );

  useEffect(() => {
    try {
      const pendingId = localStorage.getItem(pendingTopupStorageKey);
      if (pendingId) setPendingTopupInvoiceId(pendingId);
    } catch {
      // ignore storage errors
    }
  }, [pendingTopupStorageKey]);

  const clearPendingTopup = useCallback(() => {
    setPendingTopupInvoiceId(null);
    try {
      localStorage.removeItem(pendingTopupStorageKey);
    } catch {
      // ignore storage errors
    }
  }, [pendingTopupStorageKey]);

  const checkTopupPayment = useCallback(async () => {
    if (!pendingTopupInvoiceId || !initData) return;

    try {
      const { data, error } = await supabase.functions.invoke('check-payment', {
        body: { invoiceId: pendingTopupInvoiceId, initData, shopId },
      });

      if (error || data?.error) return;

      if (data?.paymentStatus === 'paid' || data?.topupStatus === 'paid') {
        clearPendingTopup();
        queryClient.invalidateQueries({ queryKey: ['user-profile'] });
        queryClient.invalidateQueries({ queryKey: ['balance-history'] });
        queryClient.invalidateQueries({ queryKey: ['user-stats'] });
        toast.success('Баланс успешно пополнен');
        haptic.notification('success');
        return;
      }

      if (data?.paymentStatus === 'expired' || data?.topupStatus === 'expired') {
        clearPendingTopup();
        toast.error('Инвойс пополнения истёк');
      }
    } catch {
      // ignore polling errors
    }
  }, [pendingTopupInvoiceId, initData, shopId, clearPendingTopup, queryClient, haptic]);

  useEffect(() => {
    if (!pendingTopupInvoiceId || !initData) return;

    checkTopupPayment();
    const interval = setInterval(checkTopupPayment, 5000);
    return () => clearInterval(interval);
  }, [pendingTopupInvoiceId, initData, checkTopupPayment]);

  const handleTopup = async () => {
    const amount = Number(topupAmount);
    if (!amount || amount <= 0 || !user?.id) return;
    if (amount < MIN_TOPUP) {
      toast.error(`Минимальная сумма пополнения — $${MIN_TOPUP}`);
      haptic.notification('error');
      return;
    }
    if (amount > MAX_TOPUP) {
      toast.error(`Максимальная сумма пополнения — $${MAX_TOPUP}`);
      haptic.notification('error');
      return;
    }
    setTopupProcessing(true);
    try {
      const { data, error } = await supabase.functions.invoke('create-topup-invoice', {
        body: { initData, amount, shopId },
      });
      // Edge function non-2xx: error is set, but data may also contain the parsed JSON body
      if (error) {
        const msg = data?.error || 'Ошибка пополнения. Попробуйте позже.';
        throw new Error(msg);
      }
      if (data?.error) throw new Error(data.error);

      if (data?.invoiceId) {
        const invoiceId = String(data.invoiceId);
        setPendingTopupInvoiceId(invoiceId);
        try {
          localStorage.setItem(pendingTopupStorageKey, invoiceId);
        } catch {
          // ignore storage errors
        }
      }

      if (isInTelegram && data?.payUrl) {
        openTelegramLink(data.payUrl);
        toast.info('Откройте CryptoBot для оплаты');
        setShowTopup(false);
        setTopupAmount('');
      } else if (data?.payUrl) {
        window.open(data.payUrl, '_blank');
        toast.info('Откройте ссылку для оплаты');
        setShowTopup(false);
        setTopupAmount('');
      }
    } catch (err) {
      console.error('Topup error:', err);
      toast.error(err instanceof Error ? err.message : 'Ошибка пополнения');
      haptic.notification('error');
    } finally {
      setTopupProcessing(false);
    }
  };

  const timeline = useMemo<TimelineItem[]>(() => {
    const items: TimelineItem[] = [];
    if (orders) {
      orders.forEach(o => items.push({ type: 'order', data: o, date: o.created_at }));
    }
    if (balanceHistory) {
      balanceHistory.forEach(b => items.push({ type: 'balance', data: b, date: b.created_at }));
    }
    items.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    return items;
  }, [orders, balanceHistory]);

  const previewItems = timeline.slice(0, PREVIEW_COUNT);
  const isLoading = ordersLoading || balanceLoading;
  const hasMore = timeline.length > PREVIEW_COUNT;

  const renderCard = (item: TimelineItem, onClick: () => void) => {
    if (item.type === 'order') {
      const order = item.data;
      const finalAmount = Math.max(0, Number(order.total_amount) - Number(order.discount_amount || 0));
      return (
        <button
          key={`o-${order.id}`}
          onClick={onClick}
          className="w-full bg-card border border-border/50 rounded-xl p-3 flex items-center justify-between gap-2 text-left hover:bg-secondary/30 transition-colors"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Package className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-medium truncate">Заказ {order.order_number}</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">
                {new Date(order.created_at).toLocaleDateString('ru-RU')}
              </div>
            </div>
          </div>
          <div className="text-right shrink-0">
            <div className="text-xs font-bold">${finalAmount.toFixed(2)}</div>
            <div className={`text-[10px] flex items-center gap-1 mt-0.5 justify-end ${statusColor(order.status)}`}>
              {statusIcon(order.status)}
              {ORDER_STATUS_LABELS[order.status]}
            </div>
          </div>
        </button>
      );
    }

    const entry = item.data;
    const isCredit = entry.type === 'credit';
    const amount = Number(entry.amount);
    return (
      <button
        key={`b-${entry.id}`}
        onClick={onClick}
        className="w-full bg-card border border-border/50 rounded-xl p-3 flex items-center justify-between gap-2 text-left hover:bg-secondary/30 transition-colors"
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isCredit ? 'bg-primary/10' : 'bg-destructive/10'}`}>
            {isCredit ? (
              <ArrowDownCircle className="w-4 h-4 text-primary" />
            ) : (
              <ArrowUpCircle className="w-4 h-4 text-destructive" />
            )}
          </div>
          <div className="min-w-0">
            <div className="text-xs font-medium truncate">{isCredit ? 'Пополнение' : 'Списание'}</div>
            <div className="text-[10px] text-muted-foreground mt-0.5">
              {new Date(entry.created_at).toLocaleDateString('ru-RU')}
            </div>
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className={`text-xs font-bold ${isCredit ? 'text-primary' : 'text-destructive'}`}>
            {isCredit ? '+' : '−'}${Math.abs(amount).toFixed(2)}
          </div>
        </div>
      </button>
    );
  };

  const handleItemClick = (item: TimelineItem) => {
    if (item.type === 'order') {
      setSelectedOrder(item.data);
    } else {
      setSelectedBalance(item.data);
    }
  };

  return (
    <div className="container-main mx-auto px-4 py-4 sm:py-6">
      {/* Telegram Profile */}
      <div className="bg-card border border-border/50 rounded-xl p-4">
        <div className="flex items-center gap-3">
          {user?.photoUrl ? (
            <img src={user.photoUrl} alt={displayName} className="w-12 h-12 rounded-full object-cover" />
          ) : (
            <div className="w-12 h-12 rounded-full bg-primary/20 text-primary flex items-center justify-center text-lg font-bold font-display">{avatar}</div>
          )}
          <div className="flex-1 min-w-0">
            <h2 className="font-display font-semibold text-base truncate">{displayName}</h2>
            {username && <p className="text-xs text-muted-foreground">{username}</p>}
            {user?.id && <p className="text-[10px] text-muted-foreground/60">ID: {user.id}</p>}
          </div>
          {user?.isPremium && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full border border-gold/30 bg-gold/10 text-gold">⭐ Premium</span>
          )}
        </div>
        <div className="mt-3 px-3 py-1.5 bg-primary/5 border border-primary/20 rounded-lg">
          <p className="text-[10px] text-primary flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> {isInTelegram ? 'Аккаунт подключён через Telegram' : 'Откройте в Telegram для полного доступа'}
          </p>
        </div>
      </div>

      {/* Balance */}
      <div className="mt-4 bg-card border border-border/50 rounded-xl p-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Wallet className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Баланс</div>
            {profileLoading ? (
              <Skeleton className="h-6 w-20 mt-0.5" />
            ) : (
              <div className="font-display font-bold text-xl text-primary">
                ${Number(profile?.balance || 0).toFixed(2)}
              </div>
            )}
          </div>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5 text-xs border-primary/30 text-primary hover:bg-primary/10"
            onClick={() => setShowTopup(true)}
          >
            <Plus className="w-3.5 h-3.5" />
            Пополнить
          </Button>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 gap-2 mt-4">
        {statsLoading ? (
          <>
            <Skeleton className="h-20 rounded-xl" />
            <Skeleton className="h-20 rounded-xl" />
          </>
        ) : (
          <>
            <div className="bg-card border border-border/50 rounded-xl p-3 text-center">
              <Package className="w-4 h-4 text-primary mx-auto mb-1.5" />
              <div className="font-display font-bold text-lg">{stats?.orderCount || 0}</div>
              <div className="text-[10px] text-muted-foreground">Заказов</div>
            </div>
            <div className="bg-card border border-border/50 rounded-xl p-3 text-center">
              <CheckCircle2 className="w-4 h-4 text-primary mx-auto mb-1.5" />
              <div className="font-display font-bold text-lg">${stats?.totalSpent?.toFixed(2) || '0.00'}</div>
              <div className="text-[10px] text-muted-foreground">Потрачено</div>
            </div>
          </>
        )}
      </div>

      {/* Timeline: Orders + Balance History */}
      <div className="mt-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-display font-semibold text-sm">История</h3>
          {hasMore && (
            <Button variant="ghost" size="sm" className="text-xs h-7 px-2 text-primary" onClick={() => setShowAll(true)}>
              Все
              <ChevronRight className="w-3 h-3 ml-0.5" />
            </Button>
          )}
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 rounded-xl" />)}
          </div>
        ) : timeline.length === 0 ? (
          <div className="text-center py-8">
            <Package className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Пока нет записей</p>
            <Link to={buildPath('/catalog')}><Button variant="outline" size="sm" className="mt-3">Перейти в каталог</Button></Link>
          </div>
        ) : (
          <div className="space-y-2">
            {previewItems.map(item => renderCard(item, () => handleItemClick(item)))}
          </div>
        )}
      </div>

      {/* Support */}
      <a href={supportLink || `https://t.me/${supportUsername}`} target="_blank" rel="noopener noreferrer" className="mt-4 block">
        <div className="bg-card border border-border/50 rounded-xl p-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-primary" />
            <span className="text-sm font-medium">Поддержка в Telegram</span>
          </div>
          <ChevronRight className="w-4 h-4 text-muted-foreground" />
        </div>
      </a>

      {/* Referral System */}
      <ReferralCard shopId={shopId} />

      {/* "All" Drawer */}
      <Drawer open={showAll} onOpenChange={setShowAll}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle className="text-base">Вся история</DrawerTitle>
          </DrawerHeader>
          <ScrollArea className="px-4 pb-4 max-h-[65vh]">
            <div className="space-y-2">
              {timeline.map(item => renderCard(item, () => {
                setShowAll(false);
                setTimeout(() => handleItemClick(item), 300);
              }))}
            </div>
          </ScrollArea>
          <div className="p-4 pt-2">
            <DrawerClose asChild>
              <Button variant="outline" size="sm" className="w-full">Закрыть</Button>
            </DrawerClose>
          </div>
        </DrawerContent>
      </Drawer>

      {/* Detail Drawers */}
      <OrderDetailSheet
        order={selectedOrder}
        open={!!selectedOrder}
        onOpenChange={open => { if (!open) setSelectedOrder(null); }}
        shopId={shopId}
      />
      <BalanceDetailSheet
        entry={selectedBalance}
        open={!!selectedBalance}
        onOpenChange={open => { if (!open) setSelectedBalance(null); }}
      />

      {/* Top-up Drawer */}
      <Drawer open={showTopup} onOpenChange={setShowTopup}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader className="pb-2">
            <DrawerTitle className="flex items-center gap-2 text-base">
              <Wallet className="w-4 h-4 text-primary" />
              Пополнение баланса
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-4">
            <div className="grid grid-cols-4 gap-2">
              {TOPUP_PRESETS.map(preset => (
                <button
                  key={preset}
                  onClick={() => setTopupAmount(String(preset))}
                  className={`py-2.5 rounded-lg text-sm font-medium border transition-colors ${
                    topupAmount === String(preset)
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-secondary/50 border-border/50 hover:bg-secondary'
                  }`}
                >
                  ${preset}
                </button>
              ))}
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1.5 block">Или введите сумму</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
              <Input
                  type="number"
                  min={MIN_TOPUP}
                  max={MAX_TOPUP}
                  step="0.01"
                  placeholder={`от $${MIN_TOPUP}`}
                  value={topupAmount}
                  onChange={e => setTopupAmount(e.target.value)}
                  className="pl-7"
                />
              </div>
            </div>
            <Button
              variant="default"
              size="lg"
              className="w-full gap-2"
              onClick={handleTopup}
              disabled={!topupAmount || Number(topupAmount) < MIN_TOPUP || Number(topupAmount) > MAX_TOPUP || topupProcessing}
            >
              {topupProcessing ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Создание инвойса...</>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Пополнить {topupAmount && Number(topupAmount) > 0 ? `$${Number(topupAmount).toFixed(2)}` : ''}
                </>
              )}
            </Button>
            <p className="text-[10px] text-muted-foreground text-center">
              <img src={cryptobotLogo} alt="CryptoBot" className="w-4 h-4 rounded-sm inline-block mr-1 align-middle" />
              Оплата через CryptoBot · Криптовалюта
            </p>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
};

export default Account;
