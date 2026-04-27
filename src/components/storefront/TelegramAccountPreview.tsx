import { useEffect, useState } from 'react';
import { Loader2, AlertCircle, CheckCircle2, User } from 'lucide-react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { supabase } from '@/integrations/supabase/client';
import { validateTelegramTarget } from '@/hooks/useShopAutoProducts';

interface Props {
  shopId?: string;
  query: string;
}

interface ResolvedUser {
  id: number;
  username: string | null;
  firstName: string | null;
  lastName: string | null;
  photoUrl: string | null;
}

const ERROR_TEXT: Record<string, string> = {
  invalid_format: 'Некорректный username или ID',
  not_found: 'Аккаунт не найден. Проверьте корректность ввода.',
  not_a_user: 'Это не личный аккаунт пользователя',
  bot_not_configured: 'Магазин не сконфигурирован',
  shop_unavailable: 'Магазин временно недоступен',
  unavailable: 'Не удалось проверить аккаунт',
  network: 'Ошибка сети',
  internal: 'Сервис временно недоступен',
  server_config: 'Сервис временно недоступен',
};

const TelegramAccountPreview = ({ shopId, query }: Props) => {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'loading' }
    | { kind: 'ok'; user: ResolvedUser }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  useEffect(() => {
    const trimmed = (query || '').trim();
    if (!trimmed || !shopId) {
      setState({ kind: 'idle' });
      return;
    }
    const valid = validateTelegramTarget(trimmed);
    if (!valid.ok) {
      setState({ kind: 'idle' }); // not enough chars yet — silent
      return;
    }

    let cancelled = false;
    setState({ kind: 'loading' });
    const t = window.setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke('resolve-telegram-user', {
          body: { shopId, query: valid.value },
        });
        if (cancelled) return;
        if (error) {
          setState({ kind: 'error', message: ERROR_TEXT.unavailable });
          return;
        }
        const res = data as any;
        if (res?.ok && res.user) {
          setState({ kind: 'ok', user: res.user });
        } else {
          setState({ kind: 'error', message: ERROR_TEXT[res?.error] || ERROR_TEXT.unavailable });
        }
      } catch {
        if (!cancelled) setState({ kind: 'error', message: ERROR_TEXT.unavailable });
      }
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [shopId, query]);

  if (state.kind === 'idle') return null;

  if (state.kind === 'loading') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-card border border-border/60">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
        <div className="text-sm text-muted-foreground">Проверяем аккаунт…</div>
      </div>
    );
  }

  if (state.kind === 'error') {
    return (
      <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/5 border border-destructive/30">
        <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
          <AlertCircle className="w-5 h-5 text-destructive" />
        </div>
        <div className="text-sm text-destructive">{state.message}</div>
      </div>
    );
  }

  const u = state.user;
  const fullName = [u.firstName, u.lastName].filter(Boolean).join(' ') || 'Пользователь Telegram';
  const initial = (u.firstName?.[0] || u.username?.[0] || '?').toUpperCase();

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-primary/5 border border-primary/30">
      <Avatar className="w-10 h-10 shrink-0">
        {u.photoUrl ? <AvatarImage src={u.photoUrl} alt={fullName} /> : null}
        <AvatarFallback className="bg-primary/15 text-primary font-semibold">
          {initial || <User className="w-5 h-5" />}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="font-medium text-sm truncate">{fullName}</span>
          <CheckCircle2 className="w-3.5 h-3.5 text-primary shrink-0" />
        </div>
        <div className="text-xs text-muted-foreground truncate">
          {u.username ? `@${u.username}` : `ID: ${u.id}`}
        </div>
      </div>
    </div>
  );
};

export default TelegramAccountPreview;