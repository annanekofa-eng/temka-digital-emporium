import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Copy, Check, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import sbpLogo from '@/assets/sbp-logo.png';
import cryptobotLogo from '@/assets/cryptobot-logo.jpeg';
import { useTelegram } from '@/contexts/TelegramContext';
import { useStorefrontPath } from '@/contexts/StorefrontContext';
import { useStore } from '@/contexts/StoreContext';
import { supabase } from '@/integrations/supabase/client';
import { formatRub } from '@/lib/sbp';

interface SbpData {
  orderId: string;
  orderNumber: string;
  paymentId: string;
  amountUsd: number;
  amountRub: number;
  rate: number;
  requisites: { bank: string; card: string; holderName: string; phone: string };
}

const CopyRow = ({ label, value }: { label: string; value: string }) => {
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-secondary/40 border border-border/30 rounded-xl p-3 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">{label}</div>
        <div className="text-sm font-medium truncate">{value || '—'}</div>
      </div>
      <button
        onClick={() => {
          if (!value) return;
          navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success('Скопировано');
          setTimeout(() => setCopied(false), 1200);
        }}
        className="shrink-0 w-9 h-9 rounded-lg bg-secondary hover:bg-secondary/80 flex items-center justify-center text-muted-foreground"
      >
        {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
      </button>
    </div>
  );
};

const SbpPayment = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const buildPath = useStorefrontPath();
  const { initData, haptic } = useTelegram();
  const { clearCart } = useStore();

  const sbp = (location.state as { sbp?: SbpData } | null)?.sbp || null;
  const [step, setStep] = useState<'requisites' | 'upload'>('requisites');
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!sbp) navigate(buildPath('/cart'));
  }, [sbp, navigate, buildPath]);

  if (!sbp) return null;

  const handleSubmit = async () => {
    if (!file) { toast.error('Загрузите чек'); return; }
    if (file.size > 10 * 1024 * 1024) { toast.error('Файл больше 10 МБ'); return; }
    setUploading(true);
    haptic.impact('medium');
    try {
      const buf = await file.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
      }
      const fileBase64 = btoa(bin);

      const { data, error } = await supabase.functions.invoke('submit-sbp-receipt', {
        body: { initData, paymentId: sbp.paymentId, fileBase64, contentType: file.type, fileName: file.name },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      haptic.notification('success');
      clearCart();
      toast.success('Чек отправлен на проверку');
      navigate(`${buildPath('/order-status')}?order=${sbp.orderNumber}`);
    } catch (e: any) {
      toast.error(e.message || 'Не удалось отправить чек');
      haptic.notification('error');
    } finally {
      setUploading(false);
    }
  };

  if (step === 'upload') {
    return (
      <div className="container-main mx-auto px-4 py-4 pb-32">
        <button onClick={() => setStep('requisites')} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mb-3">
          <ArrowLeft className="w-3 h-3" /> Назад к реквизитам
        </button>
        <div className="bg-card border border-border/50 rounded-2xl p-5 space-y-4">
          <div>
            <h2 className="font-display font-bold text-lg">Подтверждение оплаты</h2>
            <p className="text-xs text-muted-foreground mt-1">
              Загрузите скриншот или фото чека об оплате для подтверждения перевода.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="w-full border-2 border-dashed border-border/60 rounded-xl p-8 flex flex-col items-center justify-center gap-2 hover:border-primary hover:bg-primary/5 transition-colors"
          >
            {file ? (
              <>
                <CheckCircle2 className="w-8 h-8 text-primary" />
                <div className="text-sm font-medium">{file.name}</div>
                <div className="text-[10px] text-muted-foreground">{(file.size / 1024).toFixed(0)} КБ — нажмите, чтобы заменить</div>
              </>
            ) : (
              <>
                <Upload className="w-8 h-8 text-muted-foreground" />
                <div className="text-sm font-medium">Нажмите для загрузки чека</div>
                <div className="text-[10px] text-muted-foreground">JPG, PNG или PDF до 10 МБ</div>
              </>
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,application/pdf"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] || null)}
          />
          <Button variant="hero" size="lg" className="w-full" disabled={uploading || !file} onClick={handleSubmit}>
            {uploading ? 'Отправка…' : 'Отправить чек на проверку'}
          </Button>
          <p className="text-[10px] text-muted-foreground text-center">
            Столкнулись с проблемой или перевели не ту сумму?{' '}
            <Link to={buildPath('/about')} className="text-primary hover:underline">Обратитесь в поддержку</Link>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="container-main mx-auto px-4 py-4 pb-32 space-y-3">
      <Link to={buildPath('/cart')} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="w-3 h-3" /> Назад в корзину
      </Link>

      <div className="grid grid-cols-2 gap-2">
        <div className="p-3 rounded-xl border border-border/40 bg-card opacity-50">
          <img src={cryptobotLogo} alt="CryptoBot" className="w-8 h-8 rounded-lg mx-auto mb-1" />
          <div className="text-xs font-medium text-center">CryptoBot</div>
          <div className="text-[10px] text-muted-foreground text-center">Криптовалюта</div>
        </div>
        <div className="p-3 rounded-xl border border-primary bg-primary/5">
          <img src={sbpLogo} alt="СБП" className="w-8 h-8 rounded-lg mx-auto mb-1" />
          <div className="text-xs font-medium text-center text-primary">СБП</div>
          <div className="text-[10px] text-muted-foreground text-center">Перевод по карте</div>
        </div>
      </div>

      <div className="bg-card border border-border/50 rounded-2xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <img src={sbpLogo} alt="СБП" className="w-7 h-7 rounded-lg" />
          <h3 className="font-display font-semibold text-sm">Реквизиты для перевода</h3>
        </div>

        <div className="bg-secondary/40 border border-border/30 rounded-xl p-4 text-center">
          <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Сумма к переводу</div>
          <div className="font-display font-black text-3xl text-primary mt-1">{formatRub(sbp.amountRub)}</div>
          <div className="text-[10px] text-muted-foreground mt-1">
            ${sbp.amountUsd.toFixed(2)} по курсу {sbp.rate} ₽/$
          </div>
        </div>

        <CopyRow label="Банк" value={sbp.requisites.bank} />
        <CopyRow label="Номер карты" value={sbp.requisites.card} />
        <CopyRow label="Получатель" value={sbp.requisites.holderName} />
        <CopyRow label="Телефон" value={sbp.requisites.phone} />

        <div className="flex items-start gap-2 bg-amber-500/10 border border-amber-500/30 rounded-xl p-3 text-xs">
          <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
          <div>Переведите точную сумму. После перевода нажмите «Я оплатил» и загрузите чек.</div>
        </div>

        <Button variant="hero" size="lg" className="w-full" onClick={() => setStep('upload')}>
          <CheckCircle2 className="w-4 h-4 mr-1" /> Я оплатил — {formatRub(sbp.amountRub)}
        </Button>
      </div>
    </div>
  );
};

export default SbpPayment;
