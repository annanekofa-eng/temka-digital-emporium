import { useState } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Store, Bot, Wifi, Package, ShoppingCart, Users, DollarSign, Calendar, Sparkles, Palette, Loader2, ImageIcon, ExternalLink } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface ShopData {
  id: string;
  name: string;
  slug: string;
  status: string;
  bot_username: string | null;
  webhook_status: string;
  created_at: string;
  bot_avatar_url?: string | null;
  stats?: {
    products: number;
    orders: number;
    customers: number;
    revenue: number;
  };
}

interface Props {
  shop: ShopData | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Premium-фичи доступны (на основе has_entitlement('ai_avatar')) */
  canUsePremium?: boolean;
  /** initData TMA — нужен серверу для проверки владельца */
  initData?: string | null;
  /** Открыть Telegram-ссылку (например, на поддержку) */
  openTelegramLink?: (url: string) => void;
  /** Callback после успешного обновления аватарки */
  onAvatarUpdated?: (newUrl: string) => void;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const SUPPORT_USERNAME = 'telestorehelp';

const ShopInfoSheet = ({ shop, open, onOpenChange, canUsePremium = false, initData, openTelegramLink, onAvatarUpdated }: Props) => {
  const [showAi, setShowAi] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  if (!shop) return null;

  const handleGenerate = async () => {
    if (!initData) { toast.error('Откройте через Telegram'); return; }
    const text = prompt.trim();
    if (text.length < 3) { toast.error('Опишите магазин (хотя бы 3 символа)'); return; }
    if (text.length > 300) { toast.error('Описание слишком длинное (макс. 300)'); return; }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-shop-avatar', {
        body: { initData, shopId: shop.id, prompt: text },
      });
      if (error || (data as any)?.error) {
        const msg = (data as any)?.error || error?.message || 'Не удалось сгенерировать';
        toast.error(msg);
        return;
      }
      const url = (data as any)?.avatarUrl;
      if (url) {
        setPreviewUrl(url);
        onAvatarUpdated?.(url);
        toast.success('Аватарка обновлена ✨');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка генерации');
    } finally {
      setGenerating(false);
    }
  };

  const openSupport = () => {
    const link = `https://t.me/${SUPPORT_USERNAME}`;
    if (openTelegramLink) openTelegramLink(link);
    else window.open(link, '_blank');
  };

  const currentAvatar = previewUrl || shop.bot_avatar_url || null;

  const stats = shop.stats;

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader className="pb-2">
          <DrawerTitle className="flex items-center gap-2 text-base">
            <Store className="w-4 h-4 text-blue-500" />
            {shop.name}
          </DrawerTitle>
        </DrawerHeader>

        <div className="px-4 pb-4 space-y-4">
          {/* Avatar preview */}
          {currentAvatar && (
            <div className="flex justify-center">
              <img
                src={currentAvatar}
                alt="Аватарка магазина"
                className="w-20 h-20 rounded-2xl object-cover ring-2 ring-blue-100"
              />
            </div>
          )}

          {/* Status */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">Статус</span>
            <Badge variant={shop.status === 'active' ? 'default' : 'secondary'} className="text-xs">
              {shop.status === 'active' ? '✅ Активен' : shop.status === 'paused' ? '⏸ Приостановлен' : shop.status}
            </Badge>
          </div>

          {/* Bot */}
          {shop.bot_username && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-500 flex items-center gap-1">
                <Bot className="w-3.5 h-3.5" /> Бот
              </span>
              <span className="text-sm font-medium text-gray-700">@{shop.bot_username}</span>
            </div>
          )}

          {/* Webhook */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 flex items-center gap-1">
              <Wifi className="w-3.5 h-3.5" /> Webhook
            </span>
            <Badge variant={shop.webhook_status === 'active' ? 'default' : 'secondary'} className="text-xs">
              {shop.webhook_status === 'active' ? '✅ Активен' : '❌ Неактивен'}
            </Badge>
          </div>

          {/* Created */}
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 flex items-center gap-1">
              <Calendar className="w-3.5 h-3.5" /> Создан
            </span>
            <span className="text-xs text-gray-400">{formatDate(shop.created_at)}</span>
          </div>

          {/* Stats */}
          {stats && (
            <>
              <Separator />
              <p className="text-xs text-gray-400 font-medium">Статистика</p>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <Package className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{stats.products}</p>
                  <p className="text-[10px] text-gray-400">Товаров</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <ShoppingCart className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{stats.orders}</p>
                  <p className="text-[10px] text-gray-400">Заказов</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <Users className="w-4 h-4 text-blue-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">{stats.customers}</p>
                  <p className="text-[10px] text-gray-400">Клиентов</p>
                </div>
                <div className="bg-gray-50 rounded-xl p-3 text-center">
                  <DollarSign className="w-4 h-4 text-emerald-400 mx-auto mb-1" />
                  <p className="text-lg font-bold text-gray-900">${stats.revenue.toFixed(2)}</p>
                  <p className="text-[10px] text-gray-400">Выручка</p>
                </div>
              </div>
            </>
          )}

          <Separator />

          {/* Premium tools */}
          <div className="space-y-2">
            <p className="text-xs text-gray-400 font-medium flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-purple-400" /> Премиум-инструменты
            </p>

            {!showAi ? (
              <button
                type="button"
                onClick={() => { if (!canUsePremium) { toast.info('Доступно на тарифе Премиум'); return; } setShowAi(true); }}
                className={`w-full flex items-center justify-between gap-2 rounded-xl border p-3 text-left transition ${canUsePremium ? 'border-purple-200 bg-gradient-to-r from-purple-50 to-blue-50 hover:from-purple-100' : 'border-gray-200 bg-gray-50 opacity-70'}`}
              >
                <div className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4 text-purple-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">AI-аватарка магазина</p>
                    <p className="text-[11px] text-gray-500">{canUsePremium ? 'Сгенерировать новую аватарку нейросетью' : 'Только для Премиум'}</p>
                  </div>
                </div>
                {!canUsePremium && <Badge variant="secondary" className="text-[10px]">Premium</Badge>}
              </button>
            ) : (
              <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-3 space-y-2">
                <p className="text-xs text-gray-600">Опишите ваш магазин — что продаёте, какой стиль и настроение:</p>
                <Textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Например: магазин аккаунтов и подписок Telegram, минимализм, синий градиент"
                  rows={3}
                  maxLength={300}
                  disabled={generating}
                  className="text-sm resize-none"
                />
                <div className="flex items-center justify-between text-[10px] text-gray-400">
                  <span>{prompt.length}/300</span>
                  <span>Используется AI Lovable</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 bg-gradient-to-r from-purple-500 to-blue-500 hover:from-purple-600 hover:to-blue-600 text-white"
                    onClick={handleGenerate}
                    disabled={generating || prompt.trim().length < 3}
                  >
                    {generating ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Генерация…</>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5 mr-1" /> Сгенерировать</>
                    )}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowAi(false); setPrompt(''); }} disabled={generating}>
                    Отмена
                  </Button>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={openSupport}
              className="w-full flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3 text-left hover:bg-blue-100 transition"
            >
              <div className="flex items-center gap-2">
                <Palette className="w-4 h-4 text-blue-500" />
                <div>
                  <p className="text-sm font-medium text-gray-900">Кастомизация магазина</p>
                  <p className="text-[11px] text-gray-500">Напишите в поддержку @{SUPPORT_USERNAME}</p>
                </div>
              </div>
              <ExternalLink className="w-4 h-4 text-blue-400" />
            </button>
          </div>
        </div>

        <div className="p-4 pt-2">
          <DrawerClose asChild>
            <Button variant="outline" size="sm" className="w-full">Закрыть</Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default ShopInfoSheet;
