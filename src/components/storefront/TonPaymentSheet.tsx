import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import tonLogo from '@/assets/ton-logo.png';

interface TonPaymentSheetProps {
  walletAddress: string;
  tonAmount: number;
  payUrl: string;
  memo: string;
  toPayUsd: number;
  usdPerTon: number;
  /** Sub-currency selected for Tonkeeper: native TON or USDT (jUSDT jetton). */
  currency?: 'TON' | 'USDT';
  /** Human-readable USDT amount when currency='USDT' (≈ toPayUsd, rounded up to 2 dp). */
  usdtAmount?: number;
  onBack: () => void;
  onContinue: () => void;
}

const Field = ({ label, value, field, copied, onCopy }: {
  label: string; value: string; field: string;
  copied: string | null; onCopy: (v: string, f: string) => void;
}) => (
  <div className="rounded-lg border border-border/30 bg-secondary/40 p-2.5">
    <div className="flex items-center justify-between gap-2">
      <div className="min-w-0 flex-1">
        <div className="text-[10px] text-muted-foreground">{label}</div>
        <div className="text-xs font-mono truncate">{value}</div>
      </div>
      <button
        onClick={() => onCopy(value, field)}
        className="shrink-0 w-7 h-7 rounded-md bg-primary/10 text-primary flex items-center justify-center hover:bg-primary/20 transition"
        aria-label={`Скопировать ${label.toLowerCase()}`}
      >
        {copied === field ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
    </div>
  </div>
);

const TonPaymentSheet = ({
  walletAddress, tonAmount, payUrl, memo, toPayUsd, usdPerTon,
  currency = 'TON', usdtAmount = 0,
  onBack, onContinue,
}: TonPaymentSheetProps) => {
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    QRCode.toDataURL(payUrl, { width: 220, margin: 1, errorCorrectionLevel: 'M' })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [payUrl]);

  const handleCopy = (text: string, field: string) => {
    navigator.clipboard.writeText(text);
    setCopied(field);
    setTimeout(() => setCopied(null), 2000);
  };

  const isUsdt = currency === 'USDT';
  const primaryAmountLabel = isUsdt
    ? `${(usdtAmount || toPayUsd).toFixed(2)} USDT`
    : `${tonAmount.toFixed(3)} TON`;
  const fieldAmountValue = isUsdt
    ? (usdtAmount || toPayUsd).toFixed(2)
    : tonAmount.toFixed(3);
  const fieldAmountLabel = isUsdt ? 'Сумма (USDT)' : 'Сумма (TON)';

  return (
    <div className="space-y-3">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-3 h-3" /> Выбрать другой способ
      </button>

      <div className="bg-card border border-primary/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2 mb-1">
          <img src={tonLogo} alt="TON" className="w-5 h-5 rounded" loading="lazy" width={20} height={20} />
          <h3 className="font-display font-semibold text-sm">
            Оплата через Tonkeeper {isUsdt ? '(USDT)' : '(TON)'}
          </h3>
        </div>

        {/* Сумма */}
        <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 text-center">
          <div className="text-xs text-muted-foreground mb-1">К переводу</div>
          <div className="text-xl font-bold text-primary">{primaryAmountLabel}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5">
            {isUsdt
              ? `≈ $${toPayUsd.toFixed(2)} · сеть TON (jUSDT)`
              : `≈ $${toPayUsd.toFixed(2)} · курс ${usdPerTon.toFixed(2)} $/TON`}
          </div>
        </div>

        {/* QR-код */}
        {qrDataUrl ? (
          <div className="flex justify-center">
            <div className="bg-background p-2 rounded-lg border border-border/30">
              <img src={qrDataUrl} alt="TON QR" className="w-44 h-44" width={220} height={220} />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-44">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        )}

        <div className="text-[10px] text-muted-foreground text-center">
          Отсканируйте QR в Tonkeeper или нажмите кнопку ниже
        </div>

        {/* Реквизиты */}
        <div className="space-y-2">
          <Field label="Кошелёк получателя" value={walletAddress} field="wallet" copied={copied} onCopy={handleCopy} />
          <Field label={fieldAmountLabel} value={fieldAmountValue} field="amount" copied={copied} onCopy={handleCopy} />
          <Field label="Комментарий (обязательно!)" value={memo} field="memo" copied={copied} onCopy={handleCopy} />
        </div>

        <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5 text-[10px] text-amber-700 dark:text-amber-400">
          ⚠️ Обязательно укажите <b>точную сумму</b> и <b>комментарий</b>, иначе платёж не будет распознан.
          {isUsdt && <> Перевод <b>USDT в сети TON</b> (jUSDT). Не путайте с TRC-20/ERC-20.</>}
        </div>

        <Button variant="outline" size="lg" className="w-full" onClick={onContinue}>
          Я оплатил — проверить статус
        </Button>
      </div>
    </div>
  );
};

export default TonPaymentSheet;