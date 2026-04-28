import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { ShieldCheck, Clock, AlertTriangle, Crown, Calendar, CreditCard, Sparkles, Wallet, Loader2, Tag, X, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTelegram } from '@/contexts/TelegramContext';
import { toast } from 'sonner';

interface SubscriptionData {
  status: string;
  expires_at: string | null;
  trial_started_at: string | null;
  has_used_trial: boolean;
  pricing_tier: string | null;
  billing_price_usd: number | null;
  first_paid_at: string | null;
  plan?: string | null;
}

interface TariffRow { plan: string; price_usd: number; is_enabled: boolean }

interface Props {
  subscription: SubscriptionData;
  balance: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPayWithInvoice: (useBalance: boolean, promoCode?: string, months?: number, plan?: string) => Promise<void>;
  loading?: boolean;
  tariffs?: TariffRow[];
}

const statusConfig: Record<string, { label: string; badgeVariant: 'default' | 'secondary' | 'destructive' }> = {
  active: { label: 'Активна', badgeVariant: 'default' },
  trial: { label: 'Активна', badgeVariant: 'secondary' },
  expired: { label: 'Истекла', badgeVariant: 'destructive' },
  grace_period: { label: 'Льготный период', badgeVariant: 'secondary' },
  cancelled: { label: 'Отменена', badgeVariant: 'secondary' },
  blocked: { label: 'Заблокирована', badgeVariant: 'destructive' },
  none: { label: 'Не активна', badgeVariant: 'secondary' },
};

const MONTH_OPTIONS = [
  { value: 1, label: '1 мес' },
  { value: 3, label: '3 мес' },
  { value: 6, label: '6 мес' },
  { value: 12, label: '12 мес' },
];

const PLAN_META: Record<string, { label: string; emoji: string; desc: string }> = {
  start:   { label: 'Старт',    emoji: '🚀', desc: 'Магазин + поддержка + помощь куратора при запуске' },
  basic:   { label: 'Базовый',  emoji: '⭐', desc: '+ кураторство, закрытый чат, поставщики, бесплатные товары' },
  premium: { label: 'Премиум',  emoji: '💎', desc: '+ Stars/Premium, AI-аватарка, кастомизация, премиум-контент' },
};

function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '—';
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const SubscriptionSheet = ({ subscription, balance, open, onOpenChange, onPayWithInvoice, loading, tariffs }: Props) => {
  const { initData } = useTelegram();
  const cfg = statusConfig[subscription.status] || statusConfig.expired;
  const daysLeft = daysUntil(subscription.expires_at);
  const isActive = subscription.status === 'active';
  const needsPayment = ['expired', 'trial', 'grace_period', 'cancelled', 'none'].includes(subscription.status);
  const canRenew = true; // Always allow renewal (active users can extend)
  const tierLabels: Record<string, string> = { early_3: '🎉 Early Bird', standard_5: 'Стандартный' };

  const [selectedMonths, setSelectedMonths] = useState(1);
  const [useBalance, setUseBalance] = useState(true);
  const [promoCode, setPromoCode] = useState('');
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoResult, setPromoResult] = useState<{ valid: boolean; code: string; discount_type: string; discount_value: number; discountAmount: number } | null>(null);
  const [promoError, setPromoError] = useState<string | null>(null);
  const initialPlan = (subscription.plan && ['start','basic','premium'].includes(subscription.plan))
    ? subscription.plan
    : 'start';
  const [selectedPlan, setSelectedPlan] = useState<string>(initialPlan);

  // Build plan→price map from tariffs (fallback to current billing_price_usd for selected plan)
  const tariffMap: Record<string, { price: number; enabled: boolean }> = {};
  for (const t of tariffs || []) tariffMap[t.plan] = { price: Number(t.price_usd), enabled: !!t.is_enabled };
  const monthlyPrice = tariffMap[selectedPlan]?.price ?? (subscription.billing_price_usd || 0);

  const totalPrice = Math.round(monthlyPrice * selectedMonths * 100) / 100;
  const discountAmount = promoResult?.discountAmount
    ? (promoResult.discount_type === 'percent'
        ? Math.round(totalPrice * promoResult.discount_value / 100 * 100) / 100
        : Math.min(promoResult.discount_value, totalPrice))
    : 0;
  const afterDiscount = Math.max(0, totalPrice - discountAmount);
  const balanceToUse = useBalance ? Math.min(balance, afterDiscount) : 0;
  const toPay = Math.max(0, afterDiscount - balanceToUse);
  const canPayFull = toPay === 0;

  const validatePromo = async () => {
    if (!promoCode.trim() || !initData) return;
    setPromoLoading(true);
    setPromoError(null);
    setPromoResult(null);
    try {
      const { data: res, error } = await supabase.functions.invoke('get-my-data', {
        body: { initData, action: 'validate-sub-promo', promoCode: promoCode.trim() },
      });
      if (error) {
        let errMsg = 'Ошибка проверки промокода';
        try {
          if (error && typeof error === 'object' && 'context' in error) {
            const resp = (error as any).context;
            if (resp && typeof resp.json === 'function') {
              const errBody = await resp.json();
              if (errBody?.error) errMsg = errBody.error;
            }
          } else if (error && typeof error === 'object' && 'message' in error) {
            const msg = (error as any).message;
            if (msg && !msg.includes('non-2xx')) errMsg = msg;
          }
        } catch {}
        setPromoError(errMsg);
        return;
      }
      if (res?.error || !res?.valid) {
        setPromoError(res?.error || 'Промокод не найден');
        return;
      }
      let da = 0;
      if (res.discount_type === 'percent') {
        da = Math.round(totalPrice * res.discount_value / 100 * 100) / 100;
      } else {
        da = Math.min(res.discount_value, totalPrice);
      }
      setPromoResult({ valid: true, code: res.code, discount_type: res.discount_type, discount_value: res.discount_value, discountAmount: da });
      toast.success(`Промокод применён: -$${da.toFixed(2)}`);
    } catch (e: any) {
      setPromoError(e.message || 'Ошибка проверки промокода');
    } finally {
      setPromoLoading(false);
    }
  };

  const clearPromo = () => {
    setPromoCode('');
    setPromoResult(null);
    setPromoError(null);
  };

  const handlePay = () => {
    onPayWithInvoice(useBalance, promoResult?.code || undefined, selectedMonths, selectedPlan);
  };

  const buttonLabel = isActive ? 'Продлить' : (subscription.status === 'trial' ? 'Оформить' : 'Продлить');

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle className="flex items-center gap-2 text-base">
            <CreditCard className="w-4 h-4 text-blue-500" />
            Подписка
          </DrawerTitle>
        </DrawerHeader>

        <div className="px-4 pb-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Статус</span>
            <Badge variant={cfg.badgeVariant} className="text-xs">{cfg.label}</Badge>
          </div>

          <Separator />

          {/* Price */}
          {monthlyPrice > 0 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Стоимость</span>
              <span className="text-lg font-bold">${monthlyPrice}/мес</span>
            </div>
          )}

          {/* Tier */}
          {subscription.pricing_tier && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Тариф</span>
              <span className="text-sm font-medium flex items-center gap-1">
                <Crown className="w-3.5 h-3.5 text-amber-500" />
                {tierLabels[subscription.pricing_tier] || subscription.pricing_tier}
              </span>
            </div>
          )}

          <Separator />

          {/* Expiration — hide for cancelled/blocked/none */}
          {subscription.expires_at && !['cancelled', 'blocked', 'none'].includes(subscription.status) && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5" /> Действует до
              </span>
              <span className="text-sm font-medium">{formatDate(subscription.expires_at)}</span>
            </div>
          )}

          {daysLeft !== null && !['cancelled', 'blocked', 'none'].includes(subscription.status) && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground flex items-center gap-1">
                <Clock className="w-3.5 h-3.5" /> Осталось
              </span>
              <span className={`text-sm font-bold ${daysLeft <= 3 ? 'text-red-600' : daysLeft <= 7 ? 'text-amber-600' : 'text-emerald-600'}`}>
                {daysLeft > 0 ? `${daysLeft} дн.` : 'Истекает сегодня'}
              </span>
            </div>
          )}

          {/* First paid */}
          {subscription.first_paid_at && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Первая оплата</span>
              <span className="text-xs text-muted-foreground">{formatDate(subscription.first_paid_at)}</span>
            </div>
          )}

          {/* Includes */}
          <Separator />
          <div>
            <p className="text-xs text-muted-foreground font-medium mb-2">Включено в подписку:</p>
            <div className="space-y-1.5">
              {['1 магазин', 'Полный функционал магазина', 'Помощь с запуском магазина от @TeleStoreHelp', 'Бесплатный креатив для оформления товаров', 'Личная настройка под вашу нишу'].map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Sparkles className="w-3 h-3 text-blue-400 shrink-0" />
                  {item}
                </div>
              ))}
            </div>
          </div>

          {/* Warning messages */}
          {subscription.status === 'trial' && (
            <div className="bg-blue-50 rounded-xl p-3 text-center">
              <p className="text-xs text-blue-700 font-medium">
                ✅ Подписка активна по бесплатному периоду. Продлите после окончания, чтобы не было паузы.
              </p>
            </div>
          )}
          {subscription.status === 'expired' && (
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <p className="text-xs text-red-700 font-medium">
                ⚠️ Подписка истекла. Магазины приостановлены. Продлите для возобновления.
              </p>
            </div>
          )}
          {subscription.status === 'cancelled' && (
            <div className="bg-orange-50 rounded-xl p-3 text-center">
              <p className="text-xs text-orange-700 font-medium">
                🚫 Подписка отменена. Магазины приостановлены. Оформите подписку заново.
              </p>
            </div>
          )}
          {subscription.status === 'none' && (
            <div className="bg-slate-50 rounded-xl p-3 text-center">
              <p className="text-xs text-slate-700 font-medium">
                ⏳ Подписка не активна. Оформите подписку для работы магазина.
              </p>
            </div>
          )}
          {subscription.status === 'grace_period' && (
            <div className="bg-amber-50 rounded-xl p-3 text-center">
              <p className="text-xs text-amber-700 font-medium">
                ⏰ Льготный период. Скоро магазины будут приостановлены.
              </p>
            </div>
          )}
          {subscription.status === 'active' && (
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <p className="text-xs text-emerald-700 font-medium">
                ✅ Подписка активна. Вы можете продлить её заранее — дни будут добавлены к текущему сроку.
              </p>
            </div>
          )}

          {/* Month selector */}
          {canRenew && monthlyPrice > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium">Срок продления:</p>
                <div className="grid grid-cols-4 gap-2">
                  {MONTH_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => {
                        setSelectedMonths(opt.value);
                        // Recalculate promo if applied
                        if (promoResult) {
                          const newTotal = Math.round(monthlyPrice * opt.value * 100) / 100;
                          let da = 0;
                          if (promoResult.discount_type === 'percent') {
                            da = Math.round(newTotal * promoResult.discount_value / 100 * 100) / 100;
                          } else {
                            da = Math.min(promoResult.discount_value, newTotal);
                          }
                          setPromoResult({ ...promoResult, discountAmount: da });
                        }
                      }}
                      className={`py-2 px-1 rounded-xl text-center text-sm font-medium transition-all ${
                        selectedMonths === opt.value
                          ? 'bg-blue-500 text-white shadow-sm'
                          : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                      }`}
                    >
                      <div>{opt.label}</div>
                      <div className={`text-[10px] mt-0.5 ${selectedMonths === opt.value ? 'text-blue-100' : 'text-gray-400'}`}>
                        ${(monthlyPrice * opt.value).toFixed(2)}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* Promo code section */}
          {canRenew && monthlyPrice > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
                  <Tag className="w-3 h-3" /> Промокод
                </p>
                {promoResult ? (
                  <div className="bg-emerald-50 rounded-xl p-3 flex items-center justify-between">
                    <div>
                      <p className="text-xs font-medium text-emerald-700 flex items-center gap-1">
                        <Check className="w-3 h-3" /> {promoResult.code}
                      </p>
                      <p className="text-xs text-emerald-600">
                        Скидка: -${discountAmount.toFixed(2)}
                      </p>
                    </div>
                    <button onClick={clearPromo} className="p-1 rounded-full hover:bg-emerald-100">
                      <X className="w-3.5 h-3.5 text-emerald-600" />
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <Input
                      value={promoCode}
                      onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                      placeholder="Введите код"
                      className="h-9 text-sm"
                      onKeyDown={(e) => e.key === 'Enter' && validatePromo()}
                    />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={validatePromo}
                      disabled={!promoCode.trim() || promoLoading}
                      className="h-9 px-3 shrink-0"
                    >
                      {promoLoading ? <Loader2 className="w-3 h-3 animate-spin" /> : 'OK'}
                    </Button>
                  </div>
                )}
                {promoError && (
                  <p className="text-xs text-red-500">{promoError}</p>
                )}
              </div>
            </>
          )}

          {/* Balance payment option */}
          {canRenew && monthlyPrice > 0 && balance > 0 && (
            <>
              <Separator />
              <div className="bg-blue-50 rounded-xl p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground flex items-center gap-1">
                    <Wallet className="w-3.5 h-3.5 text-blue-500" /> Оплатить с баланса
                  </span>
                  <Switch checked={useBalance} onCheckedChange={setUseBalance} />
                </div>
                {useBalance && (
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div className="flex justify-between">
                      <span>Баланс:</span>
                      <span className="font-medium">${balance.toFixed(2)}</span>
                    </div>
                    {discountAmount > 0 && (
                      <div className="flex justify-between">
                        <span>Скидка:</span>
                        <span className="font-medium text-emerald-600">-${discountAmount.toFixed(2)}</span>
                      </div>
                    )}
                    <div className="flex justify-between">
                      <span>Спишется:</span>
                      <span className="font-medium text-blue-600">-${balanceToUse.toFixed(2)}</span>
                    </div>
                    {toPay > 0 && (
                      <div className="flex justify-between">
                        <span>Доплатить:</span>
                        <span className="font-medium">${toPay.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Price summary when discount applied */}
          {canRenew && discountAmount > 0 && !useBalance && (
            <div className="bg-emerald-50 rounded-xl p-3">
              <div className="text-xs space-y-0.5">
                <div className="flex justify-between text-muted-foreground">
                  <span>Стоимость ({selectedMonths} мес):</span>
                  <span>${totalPrice.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-emerald-600">
                  <span>Скидка:</span>
                  <span>-${discountAmount.toFixed(2)}</span>
                </div>
                <div className="flex justify-between font-semibold">
                  <span>Итого:</span>
                  <span>${afterDiscount.toFixed(2)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 pt-2 space-y-2">
          {canRenew && monthlyPrice > 0 && (
            <Button
              onClick={handlePay}
              disabled={loading}
              className="w-full bg-[#2B7FFF] hover:bg-[#2070EE] text-white"
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin mr-1" /> Создание счёта...</>
              ) : canPayFull ? (
                `💳 ${buttonLabel}${useBalance && balanceToUse > 0 ? ' с баланса' : ''} — $${afterDiscount.toFixed(2)}`
              ) : (
                `💳 ${buttonLabel} (${selectedMonths} мес) — $${toPay.toFixed(2)}`
              )}
            </Button>
          )}
          <DrawerClose asChild>
            <Button variant="outline" size="sm" className="w-full">Закрыть</Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default SubscriptionSheet;
