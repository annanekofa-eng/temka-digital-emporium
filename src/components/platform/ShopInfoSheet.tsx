import { useState, useEffect, useCallback } from 'react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Textarea } from '@/components/ui/textarea';
import { Store, Bot, Wifi, Package, ShoppingCart, Users, DollarSign, Calendar, Sparkles, Palette, Loader2, ImageIcon, ExternalLink, RefreshCw, Check, Wand2 } from 'lucide-react';
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
  /** Автоматически раскрыть AI-панель при открытии */
  autoOpenAi?: boolean;
}

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
}

const SUPPORT_USERNAME = 'telestorehelp';

const ShopInfoSheet = ({ shop, open, onOpenChange, canUsePremium = false, initData, openTelegramLink, onAvatarUpdated, autoOpenAi = false }: Props) => {
  const [showAi, setShowAi] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [quota, setQuota] = useState<{ limit: number; used: number; remaining: number } | null>(null);
  const [editPrompt, setEditPrompt] = useState('');

  if (!shop) return null;

  const loadQuota = useCallback(async () => {
    if (!initData || !shop?.id) return;
    try {
      const { data } = await supabase.functions.invoke('generate-shop-avatar', {
        body: { initData, shopId: shop.id, action: 'quota' },
      });
      if ((data as any)?.quota) setQuota((data as any).quota);
    } catch { /* ignore */ }
  }, [initData, shop?.id]);

  useEffect(() => {
    if (open && showAi) loadQuota();
  }, [open, showAi, loadQuota]);

  useEffect(() => {
    if (open && autoOpenAi) setShowAi(true);
    if (!open) {
      // Reset on close so next open with different shop is clean
      setShowAi(false);
      setPreviewUrl(null);
      setPreviewId(null);
      setPrompt('');
      setEditPrompt('');
    }
  }, [open, autoOpenAi]);

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
        if ((data as any)?.quota) setQuota((data as any).quota);
        return;
      }
      const url = (data as any)?.avatarUrl;
      if (url) {
        setPreviewUrl(url);
        setPreviewId((data as any)?.generationId || null);
        if ((data as any)?.quota) setQuota((data as any).quota);
        toast.success('Картинка готова — посмотрите превью');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка генерации');
    } finally {
      setGenerating(false);
    }
  };

  const handleEdit = async () => {
    if (!initData) { toast.error('Откройте через Telegram'); return; }
    const text = editPrompt.trim();
    if (text.length < 3) { toast.error('Опишите изменения (хотя бы 3 символа)'); return; }
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-shop-avatar', {
        body: { initData, shopId: shop.id, prompt: text, parentId: previewId },
      });
      if (error || (data as any)?.error) {
        const msg = (data as any)?.error || error?.message || 'Не удалось сгенерировать';
        toast.error(msg);
        if ((data as any)?.quota) setQuota((data as any).quota);
        return;
      }
      const url = (data as any)?.avatarUrl;
      if (url) {
        setPreviewUrl(url);
        setPreviewId((data as any)?.generationId || null);
        if ((data as any)?.quota) setQuota((data as any).quota);
        setEditPrompt('');
        toast.success('Обновлено ✨');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка генерации');
    } finally {
      setGenerating(false);
    }
  };

  const handleApply = async () => {
    if (!initData || !previewUrl) return;
    setApplying(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-shop-avatar', {
        body: { initData, shopId: shop.id, action: 'apply', applyImageUrl: previewUrl },
      });
      if (error || (data as any)?.error) {
        toast.error((data as any)?.error || error?.message || 'Не удалось применить');
        return;
      }
      onAvatarUpdated?.(previewUrl);
      toast.success('Аватарка установлена ✅');
      setShowAi(false); setPreviewUrl(null); setPreviewId(null); setPrompt(''); setEditPrompt('');
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка');
    } finally {
      setApplying(false);
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
          <div className="flex flex-col items-center gap-3 rounded-xl border border-blue-100 bg-blue-50/50 p-3">
            {currentAvatar ? (
              <img
                src={currentAvatar}
                alt="Аватарка магазина"
                className="w-20 h-20 rounded-2xl object-cover ring-2 ring-blue-100"
              />
            ) : (
              <div className="w-20 h-20 rounded-2xl bg-white flex items-center justify-center ring-2 ring-blue-100">
                <ImageIcon className="w-8 h-8 text-blue-300" />
              </div>
            )}
            <Button
              type="button"
              size="sm"
              onClick={() => setShowAi(true)}
              className="w-full bg-blue-500 hover:bg-blue-600 text-white"
            >
              <Wand2 className="w-4 h-4 mr-2" />
              Сгенерировать аватарку магазина
            </Button>
          </div>

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
              <Sparkles className="w-3 h-3 text-blue-400" /> AI-инструменты
            </p>

            {!showAi ? (
              <button
                type="button"
                onClick={() => setShowAi(true)}
                className="w-full flex items-center justify-between gap-2 rounded-xl border border-blue-200 bg-gradient-to-r from-blue-50 to-sky-50 hover:from-blue-100 p-3 text-left transition"
              >
                <div className="flex items-center gap-2">
                  <Wand2 className="w-4 h-4 text-blue-500" />
                  <div>
                    <p className="text-sm font-medium text-gray-900">🪄 AI-генерация аватарки магазина</p>
                    <p className="text-[11px] text-gray-500">3 генерации на цикл подписки</p>
                  </div>
                </div>
                <Badge className="bg-blue-500 hover:bg-blue-500 text-white text-[10px]">AI</Badge>
              </button>
            ) : (
              <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-3 space-y-2">
                {quota && (
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-gray-600">Осталось генераций в этом цикле:</span>
                    <Badge variant={quota.remaining > 0 ? 'default' : 'secondary'} className={quota.remaining > 0 ? 'bg-purple-500 hover:bg-purple-500 text-white' : ''}>
                      {quota.remaining}/{quota.limit}
                    </Badge>
                  </div>
                )}
                {previewUrl ? (
                  <div className="space-y-2">
                    <div className="flex justify-center">
                      <img src={previewUrl} alt="Превью" className="w-40 h-40 rounded-2xl object-cover border-2 border-purple-200 shadow-md" />
                    </div>
                    <Textarea
                      value={editPrompt}
                      onChange={(e) => setEditPrompt(e.target.value)}
                      placeholder="Что изменить? Например: сделай фон темнее, добавь иконку звезды"
                      rows={2}
                      maxLength={300}
                      disabled={generating || applying}
                      className="text-sm resize-none"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={handleEdit}
                        disabled={generating || applying || editPrompt.trim().length < 3 || (quota?.remaining ?? 0) <= 0}
                      >
                        {generating ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
                        Внести правки
                      </Button>
                      <Button
                        size="sm"
                        className="flex-1 bg-emerald-500 hover:bg-emerald-600 text-white"
                        onClick={handleApply}
                        disabled={generating || applying}
                      >
                        {applying ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Check className="w-3.5 h-3.5 mr-1" />}
                        Применить
                      </Button>
                    </div>
                    <Button size="sm" variant="ghost" className="w-full text-xs" onClick={() => { setPreviewUrl(null); setPreviewId(null); setEditPrompt(''); }} disabled={generating || applying}>
                      Начать заново
                    </Button>
                  </div>
                ) : (
                  <>
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
                    disabled={generating || prompt.trim().length < 3 || (quota?.remaining ?? 1) <= 0}
                  >
                    {generating ? (
                      <><Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> Генерация…</>
                    ) : (
                      <><Sparkles className="w-3.5 h-3.5 mr-1" /> Сгенерировать</>
                    )}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowAi(false); setPrompt(''); setPreviewUrl(null); setPreviewId(null); }} disabled={generating}>
                    Отмена
                  </Button>
                </div>
                  </>
                )}
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
