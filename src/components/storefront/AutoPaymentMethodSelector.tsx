import { Wallet, CreditCard, Banknote } from 'lucide-react';

export type AutoPaymentMethod = 'balance' | 'cryptobot' | 'sbp';

interface Props {
  value: AutoPaymentMethod;
  onChange: (m: AutoPaymentMethod) => void;
  balance: number;
  totalPrice: number;
  cryptoAvailable: boolean;
  sbpAvailable?: boolean;
}

const AutoPaymentMethodSelector = ({ value, onChange, balance, totalPrice, cryptoAvailable, sbpAvailable = false }: Props) => {
  const balanceEnough = balance >= totalPrice && totalPrice > 0;

  return (
    <div className="space-y-2">
      <span className="text-sm font-medium">Способ оплаты</span>
      <div className={`grid ${sbpAvailable ? 'grid-cols-3' : 'grid-cols-2'} gap-2`}>
        <button
          type="button"
          onClick={() => balanceEnough && onChange('balance')}
          disabled={!balanceEnough}
          className={`p-3 rounded-xl border text-left transition-colors ${
            value === 'balance'
              ? 'bg-primary/10 border-primary text-foreground'
              : 'bg-card border-border hover:border-primary/40'
          } ${!balanceEnough ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="flex items-center gap-2">
            <Wallet className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs font-semibold">С баланса</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Доступно: ${balance.toFixed(2)}
          </div>
          {!balanceEnough && totalPrice > 0 && (
            <div className="text-[10px] text-destructive mt-0.5">Недостаточно</div>
          )}
        </button>

        <button
          type="button"
          onClick={() => cryptoAvailable && onChange('cryptobot')}
          disabled={!cryptoAvailable}
          className={`p-3 rounded-xl border text-left transition-colors ${
            value === 'cryptobot'
              ? 'bg-primary/10 border-primary text-foreground'
              : 'bg-card border-border hover:border-primary/40'
          } ${!cryptoAvailable ? 'opacity-50 cursor-not-allowed' : ''}`}
        >
          <div className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-primary shrink-0" />
            <span className="text-xs font-semibold">CryptoBot</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">
            Карта / крипта
          </div>
          {!cryptoAvailable && (
            <div className="text-[10px] text-muted-foreground mt-0.5">Не настроено</div>
          )}
        </button>

        {sbpAvailable && (
          <button
            type="button"
            onClick={() => onChange('sbp')}
            className={`p-3 rounded-xl border text-left transition-colors ${
              value === 'sbp'
                ? 'bg-primary/10 border-primary text-foreground'
                : 'bg-card border-border hover:border-primary/40'
            }`}
          >
            <div className="flex items-center gap-2">
              <Banknote className="w-4 h-4 text-primary shrink-0" />
              <span className="text-xs font-semibold">СБП</span>
            </div>
            <div className="text-[11px] text-muted-foreground mt-1">
              Перевод по реквизитам
            </div>
          </button>
        )}
      </div>
    </div>
  );
};

export default AutoPaymentMethodSelector;