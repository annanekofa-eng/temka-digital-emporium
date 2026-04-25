import { useState, useRef } from 'react';
import cryptobotLogo from '@/assets/cryptobot-logo.jpeg';
import sbpLogo from '@/assets/sbp-logo.png';
import starsLogo from '@/assets/telegram-stars-logo.jpg';
import xrocketLogo from '@/assets/xrocket-logo.jpg';
import tonLogo from '@/assets/ton-logo.png';
import { Link, useNavigate } from 'react-router-dom';
import { Shield, Zap, Lock, CheckCircle2, ArrowLeft, Wallet, AlertTriangle, Upload, Copy, Check, X, Star, Rocket } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useShop } from '@/contexts/ShopContext';
import { useTelegram } from '@/contexts/TelegramContext';
import { useStorefrontPath } from '@/contexts/StorefrontContext';
import { useUserProfile } from '@/hooks/useOrders';
import { supabase } from '@/integrations/supabase/client';
import { useExchangeRate, formatRub } from '@/hooks/useExchangeRate';
import { useQuery } from '@tanstack/react-query';
import TonPaymentSheet from '@/components/storefront/TonPaymentSheet';

type PaymentMethod = 'cryptobot' | 'sbp' | 'stars' | 'xrocket' | 'ton';

type SbpDetails = {
  bankName: string;
  cardNumber: string;
  recipientName: string;
  phone: string;
  comment?: string;
};

const ShopCheckout = () => {
  const { cart, clearCart, cartTotal, shop, discount, totalAfterDiscount, promoResult } = useShop();
  const { user, isInTelegram, openTelegramLink, openInvoice, haptic, initData } = useTelegram();
  const navigate = useNavigate();
  const buildPath = useStorefrontPath();
  const shopId = shop?.id;
  const { data: profile } = useUserProfile(shopId);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cryptobot');
  const [sbpStep, setSbpStep] = useState<'details' | 'confirm' | 'uploading' | 'submitted'>('details');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [submittedOrderNumber, setSubmittedOrderNumber] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { data: rubRate } = useExchangeRate();
  const [tonInvoice, setTonInvoice] = useState<{
    walletAddress: string;
    tonAmount: number;
    payUrl: string;
    memo: string;
    usdPerTon: number;
    orderNumber: string;
  } | null>(null);

  const displayName = user ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ''}` : 'Telegram User';
  const avatar = user?.firstName?.[0]?.toUpperCase() || 'T';
  const balance = Number(profile?.balance || 0);
  const balanceUsed = Math.min(balance, totalAfterDiscount);
  const toPay = Math.max(0, totalAfterDiscount - balanceUsed);

  // Available payment methods for this shop (from shop_payment_methods)
  const { data: paymentMethods } = useQuery({
    queryKey: ['shop-payment-methods', shopId],
    queryFn: async () => {
      if (!shopId) return [] as Array<{ method: string; enabled: boolean; config_masked: any }>;
      const { data, error } = await supabase
        .from('shop_payment_methods')
        .select('method, enabled, config_masked')
        .eq('shop_id', shopId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!shopId,
    staleTime: 60_000,
  });

  const starsMethod = paymentMethods?.find(m => m.method === 'stars' && m.enabled);
  const usdPerStar = Number((starsMethod?.config_masked as any)?.usd_per_star || 0);
  const starsAvailable = Boolean(starsMethod) && usdPerStar > 0;
  const starsAmount = starsAvailable && toPay > 0 ? Math.max(1, Math.ceil(toPay / usdPerStar)) : 0;

  const xrocketMethod = paymentMethods?.find(m => m.method === 'xrocket' && m.enabled);
  const xrocketAvailable = Boolean(xrocketMethod);
  const tonMethod = paymentMethods?.find(m => m.method === 'ton' && m.enabled);
  const tonAvailable = Boolean(tonMethod);

  // Live TON rate (only when TON selected)
  const { data: tonRate } = useQuery<{ usdPerTon: number }>({
    queryKey: ['ton-rate'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('ton-rate', { body: {} });
      if (error) throw new Error(error.message);
      return data;
    },
    enabled: tonAvailable && paymentMethod === 'ton' && toPay > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const usdPerTon = Number(tonRate?.usdPerTon || 0);
  const previewTonAmount = usdPerTon > 0 && toPay > 0 ? Math.ceil((toPay / usdPerTon) * 1000) / 1000 : 0;
  // xRocket принимает только USDT (выбор валюты отключён)
  const xrCurrency = 'USDT';

  const { data: xrRates } = useQuery<Record<string, number>>({
    queryKey: ['xrocket-rates'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('xrocket-rates', { body: {} });
      if (error) throw new Error(error.message);
      return (data?.rates || { USDT: 1 }) as Record<string, number>;
    },
    enabled: xrocketAvailable && paymentMethod === 'xrocket' && toPay > 0,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const xrUsdPerUnit = Number(xrRates?.[xrCurrency] || (xrCurrency === 'USDT' ? 1 : 0));
  const xrCryptoAmount = xrUsdPerUnit > 0 && toPay > 0 ? Number((toPay / xrUsdPerUnit).toFixed(6)) : 0;

  const { data: sbpDetails, isLoading: sbpDetailsLoading } = useQuery<SbpDetails | null>({
    queryKey: ['shop-sbp-details', shopId],
    queryFn: async () => {
      if (!shopId) return null;
      const { data, error } = await supabase.functions.invoke('get-shop-sbp-details', {
        body: { shopId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (!data?.enabled || !data?.details) return null;

      return {
        bankName: data.details.bankName || '—',
        cardNumber: data.details.cardNumber || '—',
        recipientName: data.details.recipientName || '—',
        phone: data.details.phone || '—',
        comment: data.details.comment || '',
      } as SbpDetails;
    },
    enabled: !!shopId && toPay > 0,
  });

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text.replace(/\s/g, ''));
    setCopiedField(field);
    haptic.impact('light');
    setTimeout(() => setCopiedField(null), 2000);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setError('Файл слишком большой (макс. 10 МБ)');
      return;
    }
    setReceiptFile(file);
    setError('');
    const reader = new FileReader();
    reader.onload = (ev) => setReceiptPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  };

  const handleRemoveReceipt = () => {
    setReceiptFile(null);
    setReceiptPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const fileToDataUrl = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });

  const handleSbpConfirm = async () => {
    if (!receiptFile) {
      setError('Пожалуйста, загрузите чек об оплате');
      return;
    }
    setSbpStep('uploading');
    haptic.impact('medium');

    try {
      if (!shopId) throw new Error('Shop not found');
      const orderNumber = `SBP-${Date.now().toString(36).toUpperCase()}`;
      const description = cart.map(item => `${item.product.name} ×${item.quantity}`).join(', ');
      const itemsPayload = cart.map(item => ({
        productId: item.product.id,
        productTitle: item.product.name,
        productPrice: Number(item.product.price),
        quantity: item.quantity,
      }));
      const receiptDataUrl = await fileToDataUrl(receiptFile);

      const { data, error: fnError } = await supabase.functions.invoke('create-sbp-request', {
        body: {
          initData,
          shopId,
          orderNumber,
          items: itemsPayload,
          promoCode: promoResult?.code || null,
          balanceUsed,
          amountUsd: toPay,
          amountRub: rubRate ? Number((toPay * rubRate).toFixed(2)) : null,
          receiptBase64: receiptDataUrl,
          receiptMime: receiptFile.type || 'image/jpeg',
          receiptFileName: receiptFile.name || 'receipt.jpg',
          description,
        },
      });
      if (fnError) throw new Error(fnError.message);
      if (data?.error) throw new Error(data.error);
      setSubmittedOrderNumber(data?.orderNumber || orderNumber);
      setSbpStep('submitted');
      clearCart();
      haptic.notification('success');
    } catch (err: any) {
      setError(err.message || 'Ошибка при отправке чека');
      setSbpStep('confirm');
      haptic.notification('error');
    }
  };

  if (cart.length === 0) {
    return (
      <div className="container-main mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-4">🛒</div>
        <h2 className="font-display text-xl font-bold">Нечего оформлять</h2>
        <Link to={buildPath('/catalog')}><Button variant="hero" className="mt-4">Перейти в каталог</Button></Link>
      </div>
    );
  }

  const handleCheckout = async () => {
    if (!shopId) { setError('Shop not found'); return; }

    // Если выбран СБП — переходим к показу реквизитов
    if (paymentMethod === 'sbp' && toPay > 0) {
      if (!sbpDetails) {
        setError('Оплата по СБП пока недоступна в этом магазине');
        return;
      }
      setSbpStep('details');
      return;
    }

    setProcessing(true);
    setError('');
    haptic.impact('medium');

    try {
      const orderNumber = `SH-${Date.now().toString(36).toUpperCase()}`;
      const description = cart.map(item => `${item.product.name} ×${item.quantity}`).join(', ');
      const itemsPayload = cart.map(item => ({
        productId: item.product.id,
        productTitle: item.product.name,
        productPrice: Number(item.product.price),
        quantity: item.quantity,
      }));

      if (toPay <= 0) {
        const { data, error: fnError } = await supabase.functions.invoke('pay-with-balance', {
          body: { initData, orderNumber, items: itemsPayload, shopId, promoCode: promoResult?.code || null },
        });
        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);
        haptic.notification('success');
        clearCart();
        navigate(`${buildPath('/order-success')}?order=${data?.orderNumber || orderNumber}`);
      } else if (paymentMethod === 'stars') {
        // ── Telegram Stars ─────────────────────────────────────
        if (!isInTelegram) {
          throw new Error('Оплата Stars доступна только в Telegram Mini App');
        }
        const starsOrderNumber = `ST-${Date.now().toString(36).toUpperCase()}`;
        const { data, error: fnError } = await supabase.functions.invoke('create-stars-invoice', {
          body: {
            initData,
            shopId,
            orderNumber: starsOrderNumber,
            items: itemsPayload,
            balanceUsed,
            promoCode: promoResult?.code || null,
          },
        });
        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);
        if (!data?.invoiceLink) throw new Error('Не удалось создать инвойс Stars');

        const finalOrderNumber = data.orderNumber || starsOrderNumber;
        // Open native Telegram Stars invoice
        openInvoice(data.invoiceLink, (status: string) => {
          if (status === 'paid') {
            haptic.notification('success');
            clearCart();
            navigate(`${buildPath('/order-success')}?order=${finalOrderNumber}`, { replace: true });
          } else if (status === 'cancelled' || status === 'failed') {
            haptic.notification('error');
            setError(status === 'failed' ? 'Оплата Stars не прошла' : 'Оплата отменена');
          } else {
            // pending — just go to status page
            navigate(`${buildPath('/order-status')}?order=${finalOrderNumber}`);
          }
        });
      } else if (paymentMethod === 'xrocket') {
        const xrOrderNumber = `XR-${Date.now().toString(36).toUpperCase()}`;
        const { data, error: fnError } = await supabase.functions.invoke('create-xrocket-invoice', {
          body: {
            initData, shopId, orderNumber: xrOrderNumber, items: itemsPayload,
            balanceUsed, promoCode: promoResult?.code || null,
            currency: xrCurrency, description,
          },
        });
        if (fnError) {
          // Try to surface server-provided error message (FunctionsHttpError hides body)
          let serverMsg = '';
          try {
            const ctx: any = (fnError as any)?.context;
            if (ctx && typeof ctx.json === 'function') {
              const body = await ctx.json();
              serverMsg = body?.error || body?.message || '';
            } else if (ctx && typeof ctx.text === 'function') {
              const txt = await ctx.text();
              try { const j = JSON.parse(txt); serverMsg = j?.error || j?.message || ''; } catch { serverMsg = txt; }
            }
          } catch { /* ignore */ }
          if (/too many requests/i.test(serverMsg)) {
            serverMsg = 'Слишком много попыток. Подождите немного и попробуйте снова.';
          }
          throw new Error(serverMsg || fnError.message || 'Не удалось создать инвойс xRocket');
        }
        if (data?.error) throw new Error(data.error);
        if (!data?.payUrl) throw new Error('Не удалось создать инвойс xRocket');
        const finalOrderNumber = data.orderNumber || xrOrderNumber;
        if (isInTelegram) {
          openTelegramLink(data.payUrl);
          navigate(`${buildPath('/order-status')}?order=${finalOrderNumber}`);
        } else {
          window.open(data.payUrl, '_blank');
          navigate(`${buildPath('/order-status')}?order=${finalOrderNumber}`);
        }
      } else if (paymentMethod === 'ton') {
        // ── TON / Tonkeeper ─────────────────────────────────────
        const tonOrderNumber = `TN-${Date.now().toString(36).toUpperCase()}`;
        const { data, error: fnError } = await supabase.functions.invoke('create-ton-invoice', {
          body: {
            initData, shopId, orderNumber: tonOrderNumber, items: itemsPayload,
            balanceUsed, promoCode: promoResult?.code || null, description,
          },
        });
        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);
        if (!data?.payUrl) throw new Error('Не удалось создать TON-счёт');
        setTonInvoice({
          walletAddress: data.walletAddress,
          tonAmount: Number(data.tonAmount),
          payUrl: data.payUrl,
          memo: data.memo,
          usdPerTon: Number(data.usdPerTon),
          orderNumber: data.orderNumber || tonOrderNumber,
        });
        clearCart();
      } else {
        const { data, error: fnError } = await supabase.functions.invoke('create-invoice', {
          body: { initData, amount: toPay.toFixed(2), currency: 'USD', description, orderNumber, items: itemsPayload, shopId, balanceUsed, promoCode: promoResult?.code || null },
        });
        if (fnError) throw new Error(fnError.message);
        if (data?.error) throw new Error(data.error);
        if (isInTelegram && data?.payUrl) {
          openTelegramLink(data.payUrl);
          navigate(`${buildPath('/order-status')}?order=${data.orderNumber || orderNumber}`);
        } else if (data?.payUrl) {
          window.open(data.payUrl, '_blank');
          navigate(`${buildPath('/order-status')}?order=${data.orderNumber || orderNumber}`);
        } else {
          throw new Error('Не удалось создать инвойс');
        }
      }
    } catch (err: any) {
      console.error('Checkout error:', err);
      setError(err.message || 'Ошибка при создании заказа');
      haptic.notification('error');
    } finally {
      setProcessing(false);
    }
  };

  // ── SBP: Экран после нажатия "Я оплатил" ──
  if (paymentMethod === 'sbp' && sbpStep === 'submitted') {
    return (
      <div className="container-main mx-auto px-4 py-4 sm:py-6">
        <div className="bg-card border border-border/50 rounded-xl p-6 text-center space-y-4">
          <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
            <CheckCircle2 className="w-8 h-8 text-primary" />
          </div>
          <h2 className="font-display text-lg font-bold">Чек отправлен на проверку</h2>
          <p className="text-sm text-muted-foreground">
            Мы проверим вашу оплату и подтвердим заказ. Обычно это занимает несколько минут.
          </p>
          <Button
            variant="hero"
            className="w-full"
            onClick={() => navigate(`${buildPath('/order-status')}?order=${submittedOrderNumber || ''}`)}
          >
            Перейти к заказу
          </Button>
        </div>
      </div>
    );
  }

  // ── SBP: Экран подтверждения (реквизиты + загрузка чека) ──
  if (paymentMethod === 'sbp' && (sbpStep === 'confirm' || sbpStep === 'uploading') && toPay > 0) {
    return (
      <div className="container-main mx-auto px-4 py-4 sm:py-6">
        <button
          onClick={() => setSbpStep('details')}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3"
        >
          <ArrowLeft className="w-3 h-3" /> Назад к реквизитам
        </button>

        <div className="space-y-3">
          <div className="bg-card border border-border/50 rounded-xl p-4 space-y-3">
            <h3 className="font-display font-semibold text-sm">Подтверждение оплаты</h3>
            <p className="text-xs text-muted-foreground">
              Загрузите скриншот или фото чека об оплате для подтверждения перевода.
            </p>

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              onChange={handleFileSelect}
              className="hidden"
            />

            {receiptPreview ? (
              <div className="relative">
                <img src={receiptPreview} alt="Чек" className="w-full max-h-64 object-contain rounded-lg border border-border/50" />
                <button
                  onClick={handleRemoveReceipt}
                  className="absolute top-2 right-2 w-6 h-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center"
                >
                  <X className="w-3 h-3" />
                </button>
                <div className="mt-2 text-xs text-muted-foreground text-center">{receiptFile?.name}</div>
              </div>
            ) : (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full border-2 border-dashed border-border/50 rounded-xl p-8 flex flex-col items-center gap-2 hover:border-primary/50 transition-colors"
              >
                <Upload className="w-8 h-8 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Нажмите для загрузки чека</span>
                <span className="text-[10px] text-muted-foreground">JPG, PNG или PDF до 10 МБ</span>
              </button>
            )}
          </div>

          {error && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-xs text-destructive">{error}</div>
          )}

          <Button
            variant="hero"
            size="lg"
            className="w-full"
            onClick={handleSbpConfirm}
            disabled={!receiptFile || sbpStep === 'uploading'}
          >
            {sbpStep === 'uploading' ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
                Отправка...
              </span>
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4 mr-1" /> Отправить чек на проверку
              </>
            )}
           </Button>
           {shop?.support_link && (
             <p className="text-[10px] text-muted-foreground text-center pt-1">
               Столкнулись с проблемой или перевели не ту сумму?{' '}
               <a href={shop.support_link.startsWith('http') ? shop.support_link : `https://${shop.support_link}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Обратитесь в поддержку</a>.
             </p>
           )}
         </div>
      </div>
    );
  }

  // ── SBP: Экран реквизитов ──
  const showSbpDetails = paymentMethod === 'sbp' && sbpStep === 'details' && toPay > 0;

  // ── TON: показ листа оплаты после создания инвойса ──
  if (tonInvoice) {
    return (
      <div className="container-main mx-auto px-4 py-4 sm:py-6">
        <h1 className="font-display text-xl sm:text-2xl font-bold mb-4">Оплата TON</h1>
        <TonPaymentSheet
          walletAddress={tonInvoice.walletAddress}
          tonAmount={tonInvoice.tonAmount}
          payUrl={tonInvoice.payUrl}
          memo={tonInvoice.memo}
          toPayUsd={toPay > 0 ? toPay : tonInvoice.tonAmount * tonInvoice.usdPerTon}
          usdPerTon={tonInvoice.usdPerTon}
          isInTelegram={isInTelegram}
          onOpenLink={openTelegramLink}
          onBack={() => setTonInvoice(null)}
          onContinue={() => navigate(`${buildPath('/order-status')}?order=${tonInvoice.orderNumber}`)}
        />
      </div>
    );
  }

  return (
    <div className="container-main mx-auto px-4 py-4 sm:py-6">
      <Link to={buildPath('/cart')} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3">
        <ArrowLeft className="w-3 h-3" /> Назад в корзину
      </Link>
      <h1 className="font-display text-xl sm:text-2xl font-bold mb-4">Оформление заказа</h1>

      <div className="space-y-3">
        {shop?.paymentsConfigured === false && (
          <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-xs text-amber-700 dark:text-amber-400">
              <span className="font-semibold">Платежи не настроены.</span> Владельцу магазина необходимо подключить CryptoBot токен в настройках для приёма оплаты.
            </div>
          </div>
        )}

        {/* Аккаунт */}
        <div className="bg-card border border-border/50 rounded-xl p-4">
          <h3 className="font-display font-semibold text-sm mb-2">Ваш аккаунт</h3>
          <div className="flex items-center gap-2">
            {user?.photoUrl ? (
              <img src={user.photoUrl} alt={displayName} className="w-8 h-8 rounded-full object-cover" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold">{avatar}</div>
            )}
            <div>
              <div className="text-sm font-medium">{displayName}</div>
              <div className="text-[10px] text-muted-foreground">Заказ привязан к вашему Telegram профилю</div>
            </div>
          </div>
        </div>

        {/* Способ оплаты */}
        <div className="bg-card border border-border/50 rounded-xl p-4">
          <h3 className="font-display font-semibold text-sm mb-3">Способ оплаты</h3>
          <div className="mb-3 flex items-center justify-between p-2.5 rounded-lg bg-secondary/50 border border-border/30">
            <div className="flex items-center gap-2">
              <Wallet className="w-4 h-4 text-primary" />
              <span className="text-xs text-muted-foreground">Ваш баланс</span>
            </div>
            <span className="text-sm font-bold text-primary">${balance.toFixed(2)}</span>
          </div>

          {toPay > 0 ? (
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3">
              {/* CryptoBot */}
              <button
                onClick={() => { setPaymentMethod('cryptobot'); setSbpStep('details'); }}
                className={`p-3 rounded-xl border text-center transition-all ${
                  paymentMethod === 'cryptobot'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border/30 bg-secondary/30 hover:border-primary/30'
                }`}
              >
                <img src={cryptobotLogo} alt="CryptoBot" className="w-8 h-8 rounded-lg mx-auto mb-1" loading="lazy" />
                <div className={`text-sm font-medium ${paymentMethod === 'cryptobot' ? 'text-primary' : 'text-foreground'}`}>CryptoBot</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Криптовалюта</div>
              </button>

              {/* СБП */}
              <button
                onClick={() => { setPaymentMethod('sbp'); setSbpStep('details'); }}
                className={`p-3 rounded-xl border text-center transition-all ${
                  paymentMethod === 'sbp'
                    ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                    : 'border-border/30 bg-secondary/30 hover:border-primary/30'
                }`}
              >
                <img src={sbpLogo} alt="СБП" className="w-8 h-8 rounded-lg mx-auto mb-1" loading="lazy" />
                <div className={`text-sm font-medium ${paymentMethod === 'sbp' ? 'text-primary' : 'text-foreground'}`}>СБП</div>
                <div className="text-[10px] text-muted-foreground mt-0.5">Перевод по карте</div>
              </button>

              {/* Telegram Stars */}
              {starsAvailable && (
                <button
                  onClick={() => { setPaymentMethod('stars'); setSbpStep('details'); }}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    paymentMethod === 'stars'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border/30 bg-secondary/30 hover:border-primary/30'
                  }`}
                >
                  <img src={starsLogo} alt="Telegram Stars" className="w-8 h-8 rounded-lg mx-auto mb-1 object-cover" loading="lazy" />
                  <div className={`text-sm font-medium ${paymentMethod === 'stars' ? 'text-primary' : 'text-foreground'}`}>Stars</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Telegram Stars</div>
                </button>
              )}

              {/* xRocket Pay */}
              {xrocketAvailable && (
                <button
                  onClick={() => { setPaymentMethod('xrocket'); setSbpStep('details'); }}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    paymentMethod === 'xrocket'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border/30 bg-secondary/30 hover:border-primary/30'
                  }`}
                >
                  <img src={xrocketLogo} alt="xRocket" className="w-8 h-8 rounded-lg mx-auto mb-1 object-contain" loading="lazy" />
                  <div className={`text-sm font-medium ${paymentMethod === 'xrocket' ? 'text-primary' : 'text-foreground'}`}>xRocket</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Криптовалюта</div>
                </button>
              )}

              {/* TON / Tonkeeper */}
              {tonAvailable && (
                <button
                  onClick={() => { setPaymentMethod('ton'); setSbpStep('details'); }}
                  className={`p-3 rounded-xl border text-center transition-all ${
                    paymentMethod === 'ton'
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/30'
                      : 'border-border/30 bg-secondary/30 hover:border-primary/30'
                  }`}
                >
                  <img src={tonLogo} alt="TON" className="w-8 h-8 rounded-lg mx-auto mb-1 object-contain" loading="lazy" />
                  <div className={`text-sm font-medium ${paymentMethod === 'ton' ? 'text-primary' : 'text-foreground'}`}>TON</div>
                  <div className="text-[10px] text-muted-foreground mt-0.5">Tonkeeper</div>
                </button>
              )}
            </div>
          ) : (
            <div className="p-3 rounded-xl border border-primary bg-primary/5 text-center">
              <Wallet className="w-6 h-6 text-primary mx-auto mb-1" />
              <div className="text-sm font-medium text-primary">Оплата балансом</div>
              <div className="text-[10px] text-muted-foreground mt-0.5">Полная оплата с вашего баланса</div>
            </div>
          )}

          {/* Подпись под выбранным методом */}
          {toPay > 0 && balanceUsed > 0 && (
            <div className="text-[10px] text-muted-foreground text-center mt-2">
              ${balanceUsed.toFixed(2)} с баланса + ${toPay.toFixed(2)} через {paymentMethod === 'cryptobot' ? 'CryptoBot' : paymentMethod === 'sbp' ? 'СБП' : `Stars (${starsAmount} ⭐)`}
            </div>
          )}

          {paymentMethod === 'stars' && toPay > 0 && (
            <div className="text-[10px] text-muted-foreground text-center mt-2">
              К оплате: <span className="text-primary font-semibold">{starsAmount} ⭐</span> · курс 1 ⭐ = ${usdPerStar.toFixed(4)}
            </div>
          )}

          {paymentMethod === 'xrocket' && toPay > 0 && (
            <div className="text-[10px] text-muted-foreground text-center mt-2">
              К оплате: <span className="text-primary font-semibold">{toPay.toFixed(2)} USDT</span>
            </div>
          )}

          {paymentMethod === 'ton' && toPay > 0 && (
            <div className="text-[10px] text-muted-foreground text-center mt-2">
              К оплате: <span className="text-primary font-semibold">
                {previewTonAmount > 0 ? `${previewTonAmount.toFixed(3)} TON` : '…'}
              </span>
              {usdPerTon > 0 && <> · курс {usdPerTon.toFixed(2)} $/TON</>}
            </div>
          )}
        </div>

        {/* Реквизиты СБП */}
        {showSbpDetails && (
          <div className="bg-card border border-primary/30 rounded-xl p-4 space-y-3">
            <div className="flex items-center gap-2 mb-1">
              <img src={sbpLogo} alt="СБП" className="w-5 h-5 rounded" loading="lazy" />
              <h3 className="font-display font-semibold text-sm">Реквизиты для перевода</h3>
            </div>

            <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-center">
              <div className="text-xs text-muted-foreground mb-1">Сумма к переводу</div>
              <div className="text-xl font-bold text-primary">
                {rubRate ? formatRub(toPay, rubRate) : `$${toPay.toFixed(2)}`}
              </div>
              {rubRate && <div className="text-[10px] text-muted-foreground mt-0.5">${toPay.toFixed(2)} по курсу {rubRate.toFixed(2)} ₽/$</div>}
            </div>

            {sbpDetailsLoading && (
              <div className="rounded-lg border border-border/30 bg-secondary/30 p-3 text-xs text-muted-foreground">
                Загружаем реквизиты...
              </div>
            )}

            {sbpDetails && (
              <div className="space-y-2">
                <SbpField label="Банк" value={sbpDetails.bankName} onCopy={handleCopy} field="bank" copiedField={copiedField} />
                <SbpField label="Номер карты" value={sbpDetails.cardNumber} onCopy={handleCopy} field="card" copiedField={copiedField} />
                <SbpField label="Получатель" value={sbpDetails.recipientName} onCopy={handleCopy} field="name" copiedField={copiedField} />
                <SbpField label="Телефон" value={sbpDetails.phone} onCopy={handleCopy} field="phone" copiedField={copiedField} />
                {sbpDetails.comment ? (
                  <div className="text-[10px] text-muted-foreground p-2 rounded-lg bg-secondary/40 border border-border/30">
                    {sbpDetails.comment}
                  </div>
                ) : null}
              </div>
            )}

            {!sbpDetailsLoading && !sbpDetails && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
                Не удалось загрузить реквизиты СБП.
              </div>
            )}

            <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 text-[10px] text-amber-700 dark:text-amber-400">
              ⚠️ Переведите точную сумму. После перевода нажмите «Я оплатил» и загрузите чек.
            </div>

            <Button
              variant="hero"
              size="lg"
              className="w-full"
              onClick={() => { setSbpStep('confirm'); setError(''); }}
              disabled={!sbpDetails || sbpDetailsLoading}
            >
              <CheckCircle2 className="w-4 h-4 mr-1" /> Я оплатил — {rubRate ? formatRub(toPay, rubRate) : `$${toPay.toFixed(2)}`}
             </Button>
             <p className="text-[10px] text-muted-foreground text-center pt-1">
               Нажимая «Я оплатил», вы соглашаетесь с{' '}
               <Link to={buildPath('/terms')} className="text-primary hover:underline">условиями сервиса</Link>.
             </p>
           </div>
        )}

        {error && (
          <div className="bg-destructive/10 border border-destructive/30 rounded-xl p-3 text-xs text-destructive">{error}</div>
        )}

        {/* Итого + кнопка (только для CryptoBot или баланса) */}
        {!showSbpDetails && (
          <div className="bg-card border border-border/50 rounded-xl p-4 space-y-3">
            <h3 className="font-display font-semibold text-sm">Итого заказа</h3>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {cart.map(item => (
                <div key={item.product.id} className="flex justify-between text-xs">
                  <span className="text-muted-foreground line-clamp-1 flex-1">{item.product.name} ×{item.quantity}</span>
                  <span className="font-medium ml-2">${(Number(item.product.price) * item.quantity).toFixed(2)}{rubRate ? ` ≈${formatRub(Number(item.product.price) * item.quantity, rubRate)}` : ''}</span>
                </div>
              ))}
            </div>

            {discount > 0 && (
              <div className="flex justify-between text-xs text-primary">
                <span>Промокод ({promoResult?.code})</span>
                <span>-${discount.toFixed(2)}</span>
              </div>
            )}

            {balanceUsed > 0 && (
              <div className="flex justify-between text-xs text-primary">
                <span>Списание с баланса</span>
                <span>-${balanceUsed.toFixed(2)}</span>
              </div>
            )}

            <div className="border-t border-border/30 pt-2 space-y-1">
              <div className="flex justify-between items-center text-sm text-muted-foreground">
                <span>Сумма заказа</span>
                <span>${totalAfterDiscount.toFixed(2)}{rubRate ? ` ≈${formatRub(totalAfterDiscount, rubRate)}` : ''}</span>
              </div>
              {toPay > 0 ? (
                <div className="flex justify-between items-center font-display font-bold text-base">
                  <span>К оплате</span>
                  <span>${toPay.toFixed(2)}{rubRate ? ` ≈${formatRub(toPay, rubRate)}` : ''}</span>
                </div>
              ) : (
                <div className="flex justify-between items-center font-display font-bold text-base">
                  <span>К оплате (баланс)</span>
                  <span>${totalAfterDiscount.toFixed(2)}{rubRate ? ` ≈${formatRub(totalAfterDiscount, rubRate)}` : ''}</span>
                </div>
              )}
            </div>

            <Button
              variant="hero"
              size="lg"
              className="w-full"
              onClick={handleCheckout}
              disabled={processing || (toPay > 0 && paymentMethod === 'cryptobot' && shop?.paymentsConfigured === false) || (toPay > 0 && paymentMethod === 'stars' && !starsAvailable)}
            >
              {processing ? (
                <span className="flex items-center gap-2"><span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" /> Создание заказа...</span>
              ) : toPay > 0 && paymentMethod === 'stars' ? (
                <><Star className="w-4 h-4 mr-1 fill-current" /> Оплатить — {starsAmount} ⭐</>
              ) : toPay > 0 ? (
                <><Lock className="w-4 h-4 mr-1" /> Оплатить — ${toPay.toFixed(2)} {rubRate && <span className="opacity-80 text-sm ml-1">≈{formatRub(toPay, rubRate)}</span>}</>
              ) : (
                <><Wallet className="w-4 h-4 mr-1" /> Оплатить балансом</>
              )}
            </Button>

            <p className="text-[10px] text-muted-foreground text-center pt-1">
              Нажимая «Оплатить», вы соглашаетесь с{' '}
              <Link to={buildPath('/terms')} className="text-primary hover:underline">условиями сервиса</Link>.
            </p>

            <div className="space-y-1.5 pt-1 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1.5"><Shield className="w-3 h-3 text-primary" /> Безопасная оплата</span>
              <span className="flex items-center gap-1.5"><Zap className="w-3 h-3 text-primary" /> Мгновенная доставка</span>
              <span className="flex items-center gap-1.5"><CheckCircle2 className="w-3 h-3 text-primary" /> Защита покупателя</span>
            </div>
          </div>
        )}

        {/* Итого для СБП (показывается рядом с реквизитами) */}
        {showSbpDetails && (
          <div className="bg-card border border-border/50 rounded-xl p-4 space-y-2">
            <h3 className="font-display font-semibold text-sm">Состав заказа</h3>
            <div className="space-y-1.5 max-h-36 overflow-y-auto">
              {cart.map(item => (
                <div key={item.product.id} className="flex justify-between text-xs">
                  <span className="text-muted-foreground line-clamp-1 flex-1">{item.product.name} ×{item.quantity}</span>
                  <span className="font-medium ml-2">${(Number(item.product.price) * item.quantity).toFixed(2)}{rubRate ? ` ≈${formatRub(Number(item.product.price) * item.quantity, rubRate)}` : ''}</span>
                </div>
              ))}
            </div>
            {discount > 0 && (
              <div className="flex justify-between text-xs text-primary">
                <span>Промокод ({promoResult?.code})</span>
                <span>-${discount.toFixed(2)}</span>
              </div>
            )}
            {balanceUsed > 0 && (
              <div className="flex justify-between text-xs text-primary">
                <span>Баланс</span>
                <span>-${balanceUsed.toFixed(2)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Компонент поля реквизитов ──
const SbpField = ({
  label,
  value,
  onCopy,
  field,
  copiedField,
}: {
  label: string;
  value: string;
  onCopy: (text: string, field: string) => void;
  field: string;
  copiedField: string | null;
}) => (
  <div className="flex items-center justify-between p-2.5 rounded-lg bg-secondary/50 border border-border/30">
    <div className="min-w-0 flex-1">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="text-sm font-medium truncate">{value}</div>
    </div>
    <button
      onClick={() => onCopy(value, field)}
      className="ml-2 p-1.5 rounded-md hover:bg-primary/10 transition-colors shrink-0"
    >
      {copiedField === field ? (
        <Check className="w-3.5 h-3.5 text-primary" />
      ) : (
        <Copy className="w-3.5 h-3.5 text-muted-foreground" />
      )}
    </button>
  </div>
);

export default ShopCheckout;
