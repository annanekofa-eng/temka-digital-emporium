import { useMemo } from 'react';
import { CheckCircle2, User, AlertCircle } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { validateTelegramTarget } from '@/hooks/useShopAutoProducts';

interface Props {
  query: string;
}

/**
 * Lightweight preview of the entered Telegram recipient.
 * We do NOT call the Telegram API here: bots can only resolve users that have
 * already interacted with them, which produces a misleading "not found" error
 * for valid usernames. Instead we just show how the recipient was parsed.
 */
const TelegramAccountPreview = ({ query }: Props) => {
  const trimmed = (query || '').trim();
  const valid = useMemo(() => validateTelegramTarget(trimmed), [trimmed]);

  if (!trimmed) return null;

  if (!valid.ok) {
    // Only show error once user has typed something substantial
    if (trimmed.replace(/^@/, '').length < 3) return null;
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/30">
        <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
          <AlertCircle className="w-5 h-5 text-destructive" />
        </div>
        <div className="text-sm text-destructive">{valid.error || 'Некорректный формат'}</div>
      </div>
    );
  }

  const value = valid.value!;
  const isNumericId = /^\d+$/.test(value);
  const display = isNumericId ? `ID ${value}` : value; // value already starts with @
  const initial = (isNumericId ? '#' : value.replace(/^@/, '')[0] || '?').toUpperCase();

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/30">
      <Avatar className="w-10 h-10 shrink-0">
        <AvatarFallback className="bg-primary/15 text-primary font-semibold">
          {initial || <User className="w-5 h-5" />}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm truncate">{display}</span>
          <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {isNumericId ? 'Числовой Telegram ID' : 'Telegram username'}
        </div>
      </div>
    </div>
  );
};

export default TelegramAccountPreview;
