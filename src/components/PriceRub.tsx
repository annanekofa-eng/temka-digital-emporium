import { useExchangeRate, formatRub } from '@/hooks/useExchangeRate';

interface PriceRubProps {
  usd: number;
  className?: string;
}

/** Displays "~X ₽" conversion below a USD price */
const PriceRub = ({ usd, className = '' }: PriceRubProps) => {
  const { data: rate } = useExchangeRate();
  if (!rate || usd <= 0) return null;
  return (
    <span className={`text-[10px] text-muted-foreground ${className}`}>
      ≈ {formatRub(usd, rate)}
    </span>
  );
};

export default PriceRub;
