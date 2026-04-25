import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ChevronDown, Copy, Check, Users, Coins, Send, Gift, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useTelegram } from '@/contexts/TelegramContext';
import { toast } from 'sonner';

interface ReferralStats {
  isEnabled: boolean;
  rewardPercent: number;
  referredCount: number;
  totalEarned: number;
  pendingPayout: number;
  referralLink: string;
  supportLink: string;
}

interface ReferralCardProps {
  shopId?: string;
}

const ReferralCard = ({ shopId }: ReferralCardProps) => {
  const { initData, user, openTelegramLink, isInTelegram, haptic } = useTelegram();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const { data: stats, isLoading } = useQuery<ReferralStats | null>({
    queryKey: ['referral-stats', user?.id, shopId],
    queryFn: async () => {
      if (!initData || !shopId) return null;
      const { data, error } = await supabase.functions.invoke('get-my-data', {
        body: { initData, action: 'referral-stats', shopId },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      return data.stats as ReferralStats;
    },
    enabled: !!initData && !!shopId && open,
  });

  if (!shopId) return null;

  const handleCopy = async () => {
    if (!stats?.referralLink) return;
    try {
      await navigator.clipboard.writeText(stats.referralLink);
      setCopied(true);
      haptic.notification('success');
      toast.success('Ссылка скопирована');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Не удалось скопировать');
    }
  };

  const handlePayout = () => {
    if (!stats) return;
    const supportRaw = stats.supportLink || '';
    // Extract username from any t.me/ url or @username form
    let username = '';
    const m = supportRaw.match(/(?:t\.me\/|@)([A-Za-z0-9_]+)/);
    if (m) username = m[1];
    if (!username) {
      toast.error('Контакт поддержки не настроен');
      return;
    }
    const text = `Здравствуйте, у меня ${stats.referredCount} рефералов, сумма к выплате ${stats.pendingPayout.toFixed(2)}$`;
    const url = `https://t.me/${username}?text=${encodeURIComponent(text)}`;
    if (isInTelegram) openTelegramLink(url);
    else window.open(url, '_blank');
  };

  return (
    <div className="mt-4 bg-card border border-border/50 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full p-4 flex items-center justify-between gap-3 hover:bg-secondary/30 transition-colors text-left"
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
            <Gift className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <div className="font-display font-semibold text-sm">Реферальная система</div>
            <div className="text-[11px] text-muted-foreground">Приглашайте друзей и получайте вознаграждение</div>
          </div>
        </div>
        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform shrink-0 ${open ? 'rotate-180' : ''}`} />
      </button>

      {open && (
        <div className="px-4 pb-4 border-t border-border/50">
          {isLoading || !stats ? (
            <div className="space-y-3 pt-4">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-9 rounded-lg" />
            </div>
          ) : !stats.isEnabled ? (
            <div className="pt-4 text-center text-xs text-muted-foreground">
              Реферальная программа этого магазина временно отключена.
            </div>
          ) : (
            <div className="pt-4 space-y-3">
              {/* Stats */}
              <div className="grid grid-cols-2 gap-2">
                <div className="bg-secondary/40 rounded-lg p-3 text-center">
                  <Users className="w-4 h-4 text-primary mx-auto mb-1" />
                  <div className="font-display font-bold text-base">{stats.referredCount}</div>
                  <div className="text-[10px] text-muted-foreground">Приглашено</div>
                </div>
                <div className="bg-secondary/40 rounded-lg p-3 text-center">
                  <Coins className="w-4 h-4 text-primary mx-auto mb-1" />
                  <div className="font-display font-bold text-base text-primary">${stats.totalEarned.toFixed(2)}</div>
                  <div className="text-[10px] text-muted-foreground">Заработано</div>
                </div>
              </div>

              {/* Reward percent */}
              <div className="text-[11px] text-muted-foreground text-center">
                Вы получаете <span className="font-semibold text-foreground">{stats.rewardPercent}%</span> с каждой
                покупки приглашённых
              </div>

              {/* Pending payout */}
              {stats.pendingPayout > 0 && (
                <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 flex items-center justify-between">
                  <div>
                    <div className="text-[10px] text-muted-foreground">К выплате</div>
                    <div className="font-display font-bold text-base text-primary">${stats.pendingPayout.toFixed(2)}</div>
                  </div>
                  <Button size="sm" onClick={handlePayout} className="h-8 gap-1.5 text-xs">
                    <Send className="w-3.5 h-3.5" />
                    Выплата
                  </Button>
                </div>
              )}

              {/* Referral link */}
              {stats.referralLink ? (
                <div>
                  <div className="text-[10px] text-muted-foreground mb-1.5">Ваша реферальная ссылка</div>
                  <div className="flex items-center gap-2 bg-secondary/40 rounded-lg p-2">
                    <div className="flex-1 text-xs truncate font-mono text-muted-foreground">{stats.referralLink}</div>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 px-2 shrink-0"
                      onClick={handleCopy}
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-primary" /> : <Copy className="w-3.5 h-3.5" />}
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-[11px] text-muted-foreground text-center">
                  Ссылка будет доступна после подключения бота магазина
                </div>
              )}

              {/* Payout button when 0 */}
              {stats.pendingPayout === 0 && stats.totalEarned === 0 && (
                <div className="text-[11px] text-muted-foreground text-center pt-1">
                  Поделитесь ссылкой — после первой покупки приглашённого здесь появится сумма к выплате.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ReferralCard;