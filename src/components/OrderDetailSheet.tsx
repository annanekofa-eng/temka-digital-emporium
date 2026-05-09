import { Package, Copy, CheckCircle2, Clock, XCircle, AlertCircle, KeyRound } from 'lucide-react';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerClose } from '@/components/ui/drawer';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { useOrderItems, useOrderInventoryItems } from '@/hooks/useOrders';
import { ORDER_STATUS_LABELS, PAYMENT_STATUS_LABELS } from '@/types/database';
import type { DbOrder } from '@/types/database';
import { toast } from 'sonner';
import { useState } from 'react';

interface Props {
  order: DbOrder | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId?: string; // ignored, kept for API compatibility
}

const statusBadgeVariant = (status: DbOrder['status']): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status) {
    case 'completed': case 'delivered': case 'paid': return 'default';
    case 'cancelled': return 'outline';
    case 'error': return 'destructive';
    default: return 'secondary';
  }
};

const paymentBadgeVariant = (status: DbOrder['payment_status']): 'default' | 'secondary' | 'destructive' | 'outline' => {
  switch (status) {
    case 'paid': return 'default';
    case 'failed': return 'destructive';
    case 'refunded': return 'outline';
    default: return 'secondary';
  }
};

const copyToClipboard = (text: string) => {
  navigator.clipboard.writeText(text);
  toast.success('Скопировано');
};

const OrderDetailSheet = ({ order, open, onOpenChange }: Props) => {
  const { data: items, isLoading: itemsLoading } = useOrderItems(order?.id || '');
  const { data: inventoryItems, isLoading: inventoryLoading } = useOrderInventoryItems(order?.id || '');
  const [revealedItems, setRevealedItems] = useState<Set<string>>(new Set());

  if (!order) return null;

  const grossAmount = Number(order.total_amount) || 0;
  const subtotal = (items?.reduce((s, i) => s + Number(i.product_price) * i.quantity, 0) || 0) || grossAmount;
  const discountAmount = Number(order.discount_amount) || 0;
  const balanceUsed = Number(order.balance_used) || 0;
  const totalAmount = Math.max(0, grossAmount - discountAmount);
  const cryptobotPaid = Math.max(0, totalAmount - balanceUsed);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="max-h-[85vh]">
        <DrawerHeader className="pb-2">
          <DrawerTitle className="flex items-center gap-2 text-base">
            <Package className="w-4 h-4 text-primary" />
            Заказ {order.order_number}
          </DrawerTitle>
        </DrawerHeader>

        <ScrollArea className="px-4 pb-4 max-h-[65vh]">
          <div className="space-y-3">
            {/* ID */}
            <button
              onClick={() => copyToClipboard(order.id)}
              className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
            >
              ID: {order.id.slice(0, 8)}…
              <Copy className="w-3 h-3" />
            </button>

            {/* Statuses */}
            <div className="flex flex-wrap gap-1.5">
              <Badge variant={statusBadgeVariant(order.status)} className="text-[10px]">
                {ORDER_STATUS_LABELS[order.status]}
              </Badge>
              <Badge variant={paymentBadgeVariant(order.payment_status)} className="text-[10px]">
                {PAYMENT_STATUS_LABELS[order.payment_status]}
              </Badge>
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
              <div>
                <div className="text-[10px] opacity-60">Создан</div>
                {new Date(order.created_at).toLocaleString('ru-RU')}
              </div>
              <div>
                <div className="text-[10px] opacity-60">Обновлён</div>
                {new Date(order.updated_at).toLocaleString('ru-RU')}
              </div>
            </div>

            <Separator />

            {/* Items */}
            <div>
              <div className="text-xs font-semibold mb-2">Товары</div>
              {itemsLoading ? (
                <div className="space-y-2">
                  {[1, 2].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}
                </div>
              ) : !items || items.length === 0 ? (
                <p className="text-[11px] text-muted-foreground">Нет данных о товарах</p>
              ) : (
                <div className="space-y-1.5">
                  {items.map(item => (
                    <div key={item.id} className="bg-secondary/50 rounded-lg p-2.5 flex justify-between items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-medium truncate">{item.product_title}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {item.quantity} × ${Number(item.product_price).toFixed(2)}
                        </div>
                      </div>
                      <div className="text-xs font-bold shrink-0">
                        ${(Number(item.product_price) * item.quantity).toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Delivered / Inventory Items */}
            {(order.status === 'delivered' || order.status === 'completed') && (
              <>
                <Separator />
                <div>
                  <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-primary" />
                    Выданные товары
                  </div>
                  {inventoryLoading ? (
                    <div className="space-y-2">
                      {[1, 2].map(i => <Skeleton key={i} className="h-10 rounded-lg" />)}
                    </div>
                  ) : !inventoryItems || inventoryItems.length === 0 ? (
                    <p className="text-[11px] text-muted-foreground">Нет выданных товаров</p>
                  ) : (
                    <div className="space-y-1.5">
                      {inventoryItems.map(inv => {
                        const isRevealed = revealedItems.has(inv.id);
                        return (
                          <div key={inv.id} className="bg-secondary/50 rounded-lg p-2.5 space-y-1">
                            <div className="flex justify-between items-center gap-2">
                              <Badge variant="outline" className="text-[9px]">
                                {inv.status === 'sold' ? 'Выдан' : inv.status}
                              </Badge>
                              {inv.sold_at && (
                                <span className="text-[10px] text-muted-foreground">
                                  {new Date(inv.sold_at).toLocaleString('ru-RU')}
                                </span>
                              )}
                            </div>
                            <div className="flex items-start gap-1.5">
                              <div className="min-w-0 flex-1">
                                {isRevealed ? (
                                  <pre className="text-[11px] font-mono bg-background/60 rounded p-1.5 whitespace-pre-wrap break-all select-all">
                                    {inv.content}
                                  </pre>
                                ) : (
                                  <button
                                    onClick={() => setRevealedItems(prev => new Set(prev).add(inv.id))}
                                    className="text-[11px] text-primary hover:underline"
                                  >
                                    Показать содержимое
                                  </button>
                                )}
                              </div>
                              <button
                                onClick={() => copyToClipboard(inv.content)}
                                className="shrink-0 p-1 text-muted-foreground hover:text-foreground transition-colors"
                              >
                                <Copy className="w-3 h-3" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}

            <Separator />

            {/* Financial breakdown */}
            <div className="space-y-1 text-xs">
              {discountAmount > 0 && (
                <>
                  <div className="flex justify-between text-muted-foreground">
                    <span>Подытог</span>
                    <span>${subtotal.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between text-primary">
                    <span>Скидка{order.promo_code ? ` (${order.promo_code})` : ''}</span>
                    <span>−${discountAmount.toFixed(2)}</span>
                  </div>
                </>
              )}
              {balanceUsed > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Списано с баланса</span>
                  <span>−${balanceUsed.toFixed(2)}</span>
                </div>
              )}
              {cryptobotPaid > 0 && (
                <div className="flex justify-between text-muted-foreground">
                  <span>Оплата CryptoBot</span>
                  <span>${cryptobotPaid.toFixed(2)}</span>
                </div>
              )}
              <div className="flex justify-between font-bold text-sm pt-1">
                <span>Итого</span>
                <span>${totalAmount.toFixed(2)}</span>
              </div>
            </div>

            {/* Invoice / Meta */}
            {order.invoice_id && (
              <>
                <Separator />
                <button
                  onClick={() => copyToClipboard(order.invoice_id!)}
                  className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
                >
                  Invoice: {order.invoice_id}
                  <Copy className="w-3 h-3" />
                </button>
              </>
            )}

            {order.notes && (
              <>
                <Separator />
                <div className="text-[11px] text-muted-foreground">
                  <div className="text-[10px] opacity-60 mb-0.5">Комментарий</div>
                  {order.notes}
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <div className="p-4 pt-2">
          <DrawerClose asChild>
            <Button variant="outline" size="sm" className="w-full">Закрыть</Button>
          </DrawerClose>
        </div>
      </DrawerContent>
    </Drawer>
  );
};

export default OrderDetailSheet;
