import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, Copy, Check, Upload, X } from 'lucide-react';
import sbpLogo from '@/assets/sbp-logo.png';
import { Button } from '@/components/ui/button';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTelegram } from '@/contexts/TelegramContext';
import { useExchangeRate, formatRub } from '@/hooks/useExchangeRate';
import { useStorefrontPath } from '@/contexts/StorefrontContext';

type SbpDetails = {
  bankName: string;
  cardNumber: string;
  recipientName: string;
  phone: string;
  comment?: string;
};

type Step = 'details' | 'confirm' | 'uploading' | 'submitted';

interface Props {
  shopId: string;
  amountUsd: number;
  productType: 'telegram_premium' | 'telegram_stars';
  targetUser: string;
  premiumDuration?: '3m' | '6m' | '12m';
  starsAmount?: number;
  supportLink?: string;
  onBack: () => void;
}

const SbpField = ({
  label, value, field, copied, onCopy,
}: { label: string; value: string; field: string; copied: string | null; onCopy: (v: string, f: string) => void }) => (
  <button
    type="button"
    onClick={() => onCopy(value, field)}
    className="w-full flex items-center justify-between p-2.5 rounded-lg bg-secondary/40 border border-border/30 hover:border-primary/40 transition-colors"
  >
    <div className="text-left min-w-0">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm font-mono truncate">{value}</div>
    </div>
    {copied === field ? <Check className="w-4 h-4 text-primary shrink-0" /> : <Copy className="w-4 h-4 text-muted-foreground shrink-0" />}
  </button>
);

const AutoSbpPaymentSheet = ({
  shopId, amountUsd, productType, targetUser, premiumDuration, starsAmount, supportLink, onBack,
}: Props) => {
  const navigate = useNavigate();
  const buildPath = useStorefrontPath();
  const { initData, haptic } = useTelegram();
  const { data: rubRate } = useExchangeRate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>('details');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [receiptPreview, setReceiptPreview] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [submittedOrderNumber, setSubmittedOrderNumber] = useState<string | null>(null);

  const { data: sbpDetails, isLoading: sbpDetailsLoading } = useQuery<SbpDetails | null>({
    queryKey: ['shop-sbp-details', shopId],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('get-shop-sbp-details', { body: { shopId } });
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
    enabled: !!shopId && amountUsd > 0,
  });

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(String(text || '').replace(/\s/g, ''));
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

  const handleSubmit = async () => {
    if (!receiptFile) { setError('Пожалуйста, загрузите чек об оплате'); return; }
    setStep('uploading');
    setError('');
    haptic.impact('medium');
    try {
      const receiptDataUrl = await fileToDataUrl(receiptFile);
      const { data, error: fnError } = await supabase.functions.invoke('create-auto-sbp-request', {
        body: {
          initData,
          shopId,
          productType,
          targetUser,
          premiumDuration: premiumDuration || null,
          starsAmount: starsAmount || null,
          amountRub: rubRate ? Number((amountUsd * rubRate).toFixed(2)) : null,
          receiptBase64: receiptDataUrl,
          receiptMime: receiptFile.type || 'image/jpeg',
          receiptFileName: receiptFile.name || 'receipt.jpg',
        },
      });
      if (fnError) throw new Error(fnError.message);
      if ((data as any)?.error) throw new Error((data as any).error);
      setSubmittedOrderNumber((data as any)?.orderNumber || null);
      setStep('submitted');
      haptic.notification('success');
    } catch (err: any) {
      setError(err?.message || 'Ошибка при отправке чека');
      setStep('confirm');
      haptic.notification('error');
    }
  };

  if (step === 'submitted') {
    return (
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
    );
  }

  if (step === 'confirm' || step === 'uploading') {
    return (
      <div className="space-y-3">
        <button
          onClick={() => setStep('details')}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="w-3 h-3" /> Назад к реквизитам
        </button>

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
          onClick={handleSubmit}
          disabled={!receiptFile || step === 'uploading'}
        >
          {step === 'uploading' ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-primary-foreground/30 border-t-primary-foreground rounded-full animate-spin" />
              Отправка...
            </span>
          ) : (
            <><CheckCircle2 className="w-4 h-4 mr-1" /> Отправить чек на проверку</>
          )}
        </Button>
        {supportLink && (
          <p className="text-[10px] text-muted-foreground text-center pt-1">
            Столкнулись с проблемой или перевели не ту сумму?{' '}
            <a href={supportLink.startsWith('http') ? supportLink : `https://${supportLink}`} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">Обратитесь в поддержку</a>.
          </p>
        )}
      </div>
    );
  }

  // step === 'details'
  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-3 h-3" /> Назад
      </button>

      <div className="bg-card border border-primary/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <img src={sbpLogo} alt="СБП" className="w-5 h-5 rounded" loading="lazy" />
          <h3 className="font-display font-semibold text-sm">Реквизиты для перевода</h3>
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">Сумма к переводу</div>
          <div className="text-xl font-bold text-primary">
            {rubRate ? formatRub(amountUsd, rubRate) : `$${amountUsd.toFixed(2)}`}
          </div>
          {rubRate && <div className="text-[10px] text-muted-foreground mt-0.5">${amountUsd.toFixed(2)} по курсу {rubRate.toFixed(2)} ₽/$</div>}
        </div>

        {sbpDetailsLoading && (
          <div className="rounded-lg border border-border/30 bg-secondary/30 p-3 text-xs text-muted-foreground">
            Загружаем реквизиты...
          </div>
        )}

        {sbpDetails && (
          <div className="space-y-2">
            <SbpField label="Банк" value={sbpDetails.bankName} field="bank" copied={copiedField} onCopy={handleCopy} />
            <SbpField label="Номер карты" value={sbpDetails.cardNumber} field="card" copied={copiedField} onCopy={handleCopy} />
            <SbpField label="Получатель" value={sbpDetails.recipientName} field="name" copied={copiedField} onCopy={handleCopy} />
            <SbpField label="Телефон" value={sbpDetails.phone} field="phone" copied={copiedField} onCopy={handleCopy} />
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
          onClick={() => { setStep('confirm'); setError(''); }}
          disabled={!sbpDetails || sbpDetailsLoading}
        >
          <CheckCircle2 className="w-4 h-4 mr-1" /> Я оплатил — {rubRate ? formatRub(amountUsd, rubRate) : `$${amountUsd.toFixed(2)}`}
        </Button>
      </div>
    </div>
  );
};

export default AutoSbpPaymentSheet;