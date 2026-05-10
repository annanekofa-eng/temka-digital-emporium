import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronDown, Search, ArrowLeft, Loader2, AlertCircle } from 'lucide-react';
import { useStore } from '@/contexts/StoreContext';
import { toast } from 'sonner';

export type CatalogMode = 'gift' | 'nft_rent' | 'username_rent';

interface PortalsCollection {
  id: string;
  name: string;
  shortName: string;
  image: string;
  floorTon: number | null;
  supply: number | null;
  listedCount: number | null;
  dayVolumeTon: number | null;
}

interface PortalsNft {
  id: string;
  name: string;
  number: string;
  image: string;
  animationUrl: string | null;
  priceTon: number;
  collectionId: string;
  attributes: { type: string; value: string; rarity?: number }[];
}

const SORTS: { value: string; label: string }[] = [
  { value: 'price_asc', label: 'По цене ↑' },
  { value: 'price_desc', label: 'По цене ↓' },
  { value: 'newest', label: 'Сначала новые' },
  { value: 'rarity', label: 'По редкости' },
];

const TON_TO_RUB_FALLBACK = 350;

function projectFnUrl(path: string) {
  const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
  return `https://${projectId}.supabase.co/functions/v1/${path}`;
}

function fnHeaders() {
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  return { Authorization: `Bearer ${key}`, apikey: key } as Record<string, string>;
}

interface CollectionPickerProps {
  open: boolean;
  onClose: () => void;
  collections: PortalsCollection[];
  loading: boolean;
  currentId: string;
  onSelect: (c: PortalsCollection) => void;
}

function CollectionPickerSheet({
  open,
  onClose,
  collections,
  loading,
  currentId,
  onSelect,
}: CollectionPickerProps) {
  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return collections;
    return collections.filter((c) => c.name.toLowerCase().includes(term));
  }, [q, collections]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-card border-border max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-lg">Выбор подарка</h3>
        </div>
        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Plush Pepe, Heart Locket…"
              className="w-full h-10 pl-9 pr-3 bg-secondary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {loading && (
            <div className="flex items-center justify-center py-6 text-xs text-muted-foreground gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" /> Загружаем коллекции…
            </div>
          )}
          {!loading && filtered.length === 0 && (
            <div className="text-center py-6 text-xs text-muted-foreground">Ничего не найдено</div>
          )}
          {!loading &&
            filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  onSelect(c);
                  onClose();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/60 text-left ${
                  currentId === c.id ? 'bg-secondary/60' : ''
                }`}
              >
                <div className="w-10 h-10 rounded-lg bg-secondary overflow-hidden shrink-0 flex items-center justify-center">
                  {c.image ? (
                    <img src={c.image} alt="" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-xs text-muted-foreground">?</span>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold truncate">{c.name}</div>
                  <div className="text-[10px] text-muted-foreground">
                    {c.floorTon != null && (
                      <>
                        floor <span className="text-foreground/80 font-medium">{c.floorTon} TON</span>
                      </>
                    )}
                    {c.listedCount != null && <> · {c.listedCount} в продаже</>}
                  </div>
                </div>
              </button>
            ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface SortPickerProps {
  open: boolean;
  onClose: () => void;
  value: string;
  onSelect: (v: string) => void;
}
function SortPickerSheet({ open, onClose, value, onSelect }: SortPickerProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-card border-border">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-lg">Сортировка</h3>
        </div>
        <div className="px-2 py-2">
          {SORTS.map((s) => (
            <button
              key={s.value}
              onClick={() => {
                onSelect(s.value);
                onClose();
              }}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/60 ${
                value === s.value ? 'bg-secondary/60' : ''
              }`}
            >
              <div className="w-5 h-5 rounded-full border border-border flex items-center justify-center shrink-0">
                {value === s.value && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
              </div>
              <span className="text-sm font-medium flex-1 text-left">{s.label}</span>
            </button>
          ))}
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
    <span className="text-xs font-semibold leading-none max-w-[140px] truncate">{value}</span>
    <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
  </button>
);

interface Props {
  open: boolean;
  onClose: () => void;
  mode: CatalogMode;
}

const NftCatalogDialog = ({ open, onClose, mode }: Props) => {
  const { addToCart } = useStore();

  const isRent = mode === 'nft_rent' || mode === 'username_rent';
  const title =
    mode === 'username_rent' ? 'Аренда username' : mode === 'nft_rent' ? 'Аренда NFT' : 'NFT подарки';
  const ctaLabel = isRent ? 'Арендовать' : 'Купить';

  const [collections, setCollections] = useState<PortalsCollection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collection, setCollection] = useState<PortalsCollection | null>(null);

  const [items, setItems] = useState<PortalsNft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<string>('price_asc');
  const [openPicker, setOpenPicker] = useState<null | 'collection' | 'sort'>(null);
  const [reloadKey, setReloadKey] = useState(0);

  // Load collections once when dialog opens
  useEffect(() => {
    if (!open || collections.length > 0) return;
    setCollectionsLoading(true);
    fetch(projectFnUrl('portals-gifts?action=collections'), { headers: fnHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const list: PortalsCollection[] = Array.isArray(d?.collections) ? d.collections : [];
        setCollections(list);
        if (!collection && list.length) setCollection(list[0]);
      })
      .catch(() => setCollections([]))
      .finally(() => setCollectionsLoading(false));
  }, [open]);

  // Fetch items
  useEffect(() => {
    if (!open || !collection) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      collection: collection.id,
      limit: '40',
      offset: '0',
      sort,
    });
    fetch(projectFnUrl(`portals-gifts?${params.toString()}`), { headers: fnHeaders() })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.message || j?.error || `HTTP ${r.status}`);
        return j;
      })
      .then((d) => {
        if (cancelled) return;
        setItems(Array.isArray(d?.items) ? d.items : []);
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
  }, [open, collection, sort, reloadKey]);

  const collectionLabel = collection?.name ?? 'Все подарки';
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
              <span className="ml-auto text-[10px] text-muted-foreground">live · Portals</span>
            </div>

            <div className="px-3 py-3 border-b border-border">
              <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
                <FilterChip
                  label="Подарок"
                  value={collectionLabel}
                  onClick={() => setOpenPicker('collection')}
                />
                <FilterChip label="Сорт." value={sortLabel} onClick={() => setOpenPicker('sort')} />
              </div>
              {collection?.floorTon != null && (
                <div className="mt-2 text-[11px] text-muted-foreground">
                  Floor:{' '}
                  <span className="text-foreground font-semibold">{collection.floorTon} TON</span>
                  {collection.listedCount != null && (
                    <> · {collection.listedCount} в продаже</>
                  )}
                </div>
              )}
            </div>

            <div className="p-3">
              {loading ? (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {Array.from({ length: 10 }).map((_, i) => (
                    <div key={i} className="rounded-2xl border border-border bg-card overflow-hidden">
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
                  <Button variant="outline" size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                    Повторить
                  </Button>
                </div>
              ) : items.length === 0 ? (
                <div className="text-center py-16 text-sm text-muted-foreground">
                  В этой коллекции сейчас нет лотов на продаже
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {items.map((it) => {
                    const model = it.attributes.find((a) => a.type === 'model')?.value;
                    const backdrop = it.attributes.find((a) => a.type === 'backdrop')?.value;
                    return (
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
                        <div className="p-3 flex flex-col gap-1.5">
                          <div className="font-display font-bold text-sm leading-tight truncate">
                            {it.name}
                          </div>
                          {(model || backdrop) && (
                            <div className="text-[10px] text-muted-foreground truncate">
                              {model}
                              {model && backdrop && ' · '}
                              {backdrop}
                            </div>
                          )}
                          <button
                            onClick={() => {
                              addToCart({
                                id: it.id,
                                title: `${title} · ${it.name} ${it.number}`,
                                price: it.priceTon,
                                product_type: 'simple',
                              } as any);
                              toast.success(`${ctaLabel}: ${it.name} ${it.number}`);
                            }}
                            className="w-full rounded-lg bg-secondary hover:bg-secondary/80 transition-colors py-1.5 px-2 text-xs font-semibold flex items-center justify-center gap-1 mt-1"
                          >
                            <span className="text-primary">▼</span>
                            <span>{it.priceTon.toFixed(2)} TON</span>
                          </button>
                          <div className="text-[10px] text-muted-foreground text-center -mt-0.5">
                            ~{Math.round(it.priceTon * TON_TO_RUB_FALLBACK).toLocaleString('ru-RU')} ₽
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <CollectionPickerSheet
        open={openPicker === 'collection'}
        onClose={() => setOpenPicker(null)}
        collections={collections}
        loading={collectionsLoading}
        currentId={collection?.id ?? ''}
        onSelect={(c) => setCollection(c)}
      />
      <SortPickerSheet
        open={openPicker === 'sort'}
        onClose={() => setOpenPicker(null)}
        value={sort}
        onSelect={setSort}
      />
    </>
  );
};

export default NftCatalogDialog;
