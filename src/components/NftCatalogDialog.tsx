import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronDown, X, Search, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { useStore } from '@/contexts/StoreContext';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export type CatalogMode = 'gift' | 'nft_rent' | 'username_rent';

// Known TON collection addresses we can fetch from tonapi.io.
// Add real NFT-gift collection addresses here later (Plush Pepe, etc.).
const COLLECTION_PRESETS: Record<
  CatalogMode,
  { label: string; address: string }[]
> = {
  username_rent: [
    { label: 'Telegram Usernames', address: 'EQCA14o1-VWhS2efqoh_9M1b_A9DtKTuoqfmkn83AbJzwnPi' },
  ],
  gift: [
    { label: 'Anonymous Numbers', address: 'EQAOQdwdw8kGftJCSFgOErM1mBjYPe4DBPq8-AhF6vTfOFyA' },
    { label: 'Telegram Usernames', address: 'EQCA14o1-VWhS2efqoh_9M1b_A9DtKTuoqfmkn83AbJzwnPi' },
  ],
  nft_rent: [
    { label: 'Anonymous Numbers', address: 'EQAOQdwdw8kGftJCSFgOErM1mBjYPe4DBPq8-AhF6vTfOFyA' },
    { label: 'Telegram Usernames', address: 'EQCA14o1-VWhS2efqoh_9M1b_A9DtKTuoqfmkn83AbJzwnPi' },
  ],
};

interface ApiNftItem {
  id: string;
  number: string;
  name: string;
  image: string;
  collection: string;
  collectionAddress: string;
  priceTon: number;
  marketName: string | null;
  ownerAddress: string | null;
  attributes: Record<string, string>;
}

const SORTS: { value: string; label: string }[] = [
  { value: 'price_asc', label: 'По цене ↑' },
  { value: 'price_desc', label: 'По цене ↓' },
  { value: '', label: 'По умолчанию' },
];

interface PickerProps<T extends string> {
  open: boolean;
  onClose: () => void;
  title: string;
  options: { value: T; label: string }[];
  value: T;
  onSelect: (v: T) => void;
  searchable?: boolean;
}

function PickerSheet<T extends string>({
  open,
  onClose,
  title,
  options,
  value,
  onSelect,
  searchable,
}: PickerProps<T>) {
  const [q, setQ] = useState('');
  const filtered = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(q.toLowerCase())),
    [options, q]
  );
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-card border-border max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-lg">{title}</h3>
        </div>
        {searchable && (
          <div className="px-4 py-3 border-b border-border">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Поиск..."
                className="w-full h-10 pl-9 pr-3 bg-secondary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>
        )}
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {filtered.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onSelect(o.value);
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/60 ${
                value === o.value ? 'bg-secondary/60' : ''
              }`}
            >
              <div className="w-5 h-5 rounded-full border border-border flex items-center justify-center shrink-0">
                {value === o.value && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
              </div>
              <span className="text-sm font-medium flex-1 text-left">{o.label}</span>
            </button>
          ))}
        </div>
        <div className="p-4 border-t border-border">
          <Button className="w-full" onClick={onClose}>
            Применить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface FilterChipProps {
  label: string;
  value: string;
  onClick: () => void;
}
const FilterChip = ({ label, value, onClick }: FilterChipProps) => (
  <button
    onClick={onClick}
    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-full border border-border bg-card hover:border-primary/40 transition-colors text-left shrink-0 h-9"
  >
    <span className="text-[11px] text-muted-foreground leading-none">{label}:</span>
    <span className="text-xs font-semibold leading-none max-w-[120px] truncate">{value}</span>
    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
  </button>
);

interface Props {
  open: boolean;
  onClose: () => void;
  mode: CatalogMode;
}

const TON_TO_RUB_FALLBACK = 350; // rough display fallback when rate is unknown

const NftCatalogDialog = ({ open, onClose, mode }: Props) => {
  const { addToCart } = useStore();
  const presets = COLLECTION_PRESETS[mode];
  const [collectionAddr, setCollectionAddr] = useState<string>(presets[0].address);
  const [sort, setSort] = useState<string>('price_asc');
  const [openPicker, setOpenPicker] = useState<null | 'collection' | 'sort'>(null);

  const [items, setItems] = useState<ApiNftItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isRent = mode === 'nft_rent' || mode === 'username_rent';
  const title =
    mode === 'username_rent' ? 'Аренда username' : mode === 'nft_rent' ? 'Аренда NFT' : 'NFT подарки';
  const ctaLabel = isRent ? 'Арендовать' : 'Купить';

  // Reset collection when mode changes
  useEffect(() => {
    setCollectionAddr(COLLECTION_PRESETS[mode][0].address);
  }, [mode]);

  // Fetch live data when open or filters change
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams({
      collection: collectionAddr,
      limit: '40',
      offset: '0',
    });
    if (sort) params.set('sort', sort);

    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const url = `https://${projectId}.supabase.co/functions/v1/tonapi-nfts?${params.toString()}`;

    fetch(url, {
      headers: {
        Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
    })
      .then(async (r) => {
        const json = await r.json();
        if (!r.ok) throw new Error(json?.message || json?.error || `HTTP ${r.status}`);
        return json;
      })
      .then((data) => {
        if (cancelled) return;
        setItems(Array.isArray(data?.items) ? data.items : []);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Не удалось загрузить каталог');
        setItems([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, collectionAddr, sort]);

  const collectionLabel =
    presets.find((p) => p.address === collectionAddr)?.label ?? 'Коллекция';
  const sortLabel = SORTS.find((s) => s.value === sort)?.label ?? 'По умолчанию';

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-none w-screen h-[100dvh] sm:rounded-none p-0 overflow-hidden bg-background border-0 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-md flex items-center gap-2 px-4 py-3 border-b border-border">
              <button
                onClick={onClose}
                className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-secondary transition-colors"
                aria-label="Назад"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
              <h2 className="font-display font-black text-base">{title}</h2>
              <span className="ml-auto text-[10px] text-muted-foreground">
                live · TonAPI
              </span>
            </div>

            {/* Filters */}
            <div className="px-3 py-3 border-b border-border">
              <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
                <FilterChip
                  label="Коллекция"
                  value={collectionLabel}
                  onClick={() => setOpenPicker('collection')}
                />
                <FilterChip label="Сорт." value={sortLabel} onClick={() => setOpenPicker('sort')} />
              </div>
            </div>

            {/* Grid */}
            <div className="p-3">
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div
                      key={i}
                      className="rounded-2xl border border-border bg-card overflow-hidden"
                    >
                      <div className="aspect-square bg-secondary/40 animate-pulse" />
                      <div className="p-3 space-y-2">
                        <div className="h-4 bg-secondary/40 rounded animate-pulse" />
                        <div className="h-7 bg-secondary/40 rounded animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center py-16 px-4 text-center gap-3">
                  <AlertCircle className="w-10 h-10 text-destructive/70" />
                  <div className="text-sm font-medium">Не удалось загрузить каталог</div>
                  <div className="text-xs text-muted-foreground max-w-xs">{error}</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCollectionAddr((a) => a + '')}
                  >
                    Повторить
                  </Button>
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-16 text-sm text-muted-foreground">
                  В этой коллекции сейчас нет лотов на продаже
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {items.map((it) => (
                    <div
                      key={it.id}
                      className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col"
                    >
                      <div className="aspect-square relative bg-secondary">
                        {it.image && (
                          <img
                            src={it.image}
                            alt={it.name}
                            loading="lazy"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        )}
                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/60 text-[10px] font-bold text-white max-w-[80%] truncate">
                          {it.number}
                        </div>
                      </div>
                      <div className="p-3 flex flex-col gap-2">
                        <div className="font-display font-bold text-sm leading-tight truncate">
                          {it.name}
                        </div>
                        <button
                          onClick={() => {
                            addToCart({
                              id: it.id,
                              title: `${title} · ${it.name}`,
                              price: it.priceTon,
                              product_type: 'simple',
                            } as any);
                            toast.success(`${ctaLabel}: ${it.name}`);
                          }}
                          className="w-full rounded-lg bg-secondary hover:bg-secondary/80 transition-colors py-1.5 px-2 text-xs font-semibold flex items-center justify-center gap-1"
                        >
                          <span className="text-primary">▼</span>
                          <span>{it.priceTon.toFixed(2)} TON</span>
                        </button>
                        <div className="text-[10px] text-muted-foreground text-center -mt-1">
                          ~{Math.round(it.priceTon * TON_TO_RUB_FALLBACK).toLocaleString('ru-RU')} ₽
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {loading && items.length > 0 && (
                <div className="flex items-center justify-center py-4 text-xs text-muted-foreground gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Обновляем…
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <PickerSheet
        open={openPicker === 'collection'}
        onClose={() => setOpenPicker(null)}
        title="Выбор коллекции"
        options={presets.map((p) => ({ value: p.address, label: p.label }))}
        value={collectionAddr}
        onSelect={(v) => setCollectionAddr(v)}
      />
      <PickerSheet
        open={openPicker === 'sort'}
        onClose={() => setOpenPicker(null)}
        title="Сортировка"
        options={SORTS}
        value={sort}
        onSelect={(v) => setSort(v)}
      />
    </>
  );
};

export default NftCatalogDialog;
