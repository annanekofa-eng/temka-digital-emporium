import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronDown, Search, ArrowLeft, Loader2, AlertCircle, X, ExternalLink, Copy } from 'lucide-react';
import { useStore } from '@/contexts/StoreContext';
import { toast } from 'sonner';
import tonLogo from '@/assets/ton-logo.png';

const TonIcon = ({ className = 'w-3.5 h-3.5' }: { className?: string }) => (
  <img src={tonLogo} alt="TON" className={`inline-block ${className}`} />
);

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

interface FilterOption {
  value: string;
  count: number;
}

interface FiltersData {
  models: FilterOption[];
  backdrops: FilterOption[];
  symbols: FilterOption[];
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

/* ────────────────────────────────────────── Pickers ───────────────────────────────────────── */

interface CollectionPickerProps {
  open: boolean;
  onClose: () => void;
  collections: PortalsCollection[];
  loading: boolean;
  currentId: string;
  onSelect: (c: PortalsCollection | null) => void;
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
          <button
            onClick={() => {
              onSelect(null);
              onClose();
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/60 text-left ${
              !currentId ? 'bg-secondary/60' : ''
            }`}
          >
            <div className="w-10 h-10 rounded-lg bg-primary/15 flex items-center justify-center shrink-0 text-primary text-lg">★</div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold">Все подарки</div>
              <div className="text-[10px] text-muted-foreground">Витрина по всем коллекциям</div>
            </div>
          </button>

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
                        floor <span className="text-foreground/80 font-medium inline-flex items-center gap-1">{c.floorTon}<TonIcon className="w-3 h-3" /></span>
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

/* Multi-select sheet for model/backdrop/symbol */
interface MultiPickerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  options: FilterOption[];
  selected: string[];
  onChange: (next: string[]) => void;
}
function MultiPickerSheet({ open, onClose, title, options, selected, onChange }: MultiPickerProps) {
  const [q, setQ] = useState('');
  const [draft, setDraft] = useState<string[]>(selected);
  useEffect(() => {
    if (open) setDraft(selected);
  }, [open, selected]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    if (!term) return options;
    return options.filter((o) => o.value.toLowerCase().includes(term));
  }, [q, options]);

  const toggle = (v: string) =>
    setDraft((d) => (d.includes(v) ? d.filter((x) => x !== v) : [...d, v]));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-card border-border max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-lg">{title}</h3>
          {draft.length > 0 && (
            <button
              onClick={() => setDraft([])}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Сбросить
            </button>
          )}
        </div>
        <div className="px-4 py-3 border-b border-border">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Поиск…"
              className="w-full h-10 pl-9 pr-3 bg-secondary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto px-2 py-2">
          {filtered.length === 0 && (
            <div className="text-center py-6 text-xs text-muted-foreground">Нет вариантов</div>
          )}
          {filtered.map((o) => {
            const on = draft.includes(o.value);
            return (
              <button
                key={o.value}
                onClick={() => toggle(o.value)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/60 text-left ${
                  on ? 'bg-secondary/60' : ''
                }`}
              >
                <div
                  className={`w-5 h-5 rounded border flex items-center justify-center shrink-0 ${
                    on ? 'bg-primary border-primary' : 'border-border'
                  }`}
                >
                  {on && <span className="text-[10px] text-primary-foreground">✓</span>}
                </div>
                <span className="text-sm font-medium flex-1 truncate">{o.value}</span>
                <span className="text-[10px] text-muted-foreground">{o.count}</span>
              </button>
            );
          })}
        </div>
        <div className="border-t border-border p-3 flex gap-2">
          <Button variant="outline" className="flex-1" onClick={onClose}>
            Отмена
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onChange(draft);
              onClose();
            }}
          >
            Применить{draft.length ? ` (${draft.length})` : ''}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* Price range picker */
interface PriceRange {
  min: string;
  max: string;
}
interface PricePickerProps {
  open: boolean;
  onClose: () => void;
  value: PriceRange;
  onChange: (v: PriceRange) => void;
}
function PricePickerSheet({ open, onClose, value, onChange }: PricePickerProps) {
  const [min, setMin] = useState(value.min);
  const [max, setMax] = useState(value.max);
  useEffect(() => {
    if (open) {
      setMin(value.min);
      setMax(value.max);
    }
  }, [open, value]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md p-0 overflow-hidden bg-card border-border">
        <div className="px-5 py-4 border-b border-border">
          <h3 className="font-display font-bold text-lg">Цена, TON</h3>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="text-[11px] text-muted-foreground">От</label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={min}
                onChange={(e) => setMin(e.target.value)}
                placeholder="0"
                className="w-full h-10 px-3 bg-secondary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
            <div className="flex-1">
              <label className="text-[11px] text-muted-foreground">До</label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={max}
                onChange={(e) => setMax(e.target.value)}
                placeholder="∞"
                className="w-full h-10 px-3 bg-secondary rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
              />
            </div>
          </div>
        </div>
        <div className="border-t border-border p-3 flex gap-2">
          <Button
            variant="outline"
            className="flex-1"
            onClick={() => {
              onChange({ min: '', max: '' });
              onClose();
            }}
          >
            Сбросить
          </Button>
          <Button
            className="flex-1"
            onClick={() => {
              onChange({ min: min.trim(), max: max.trim() });
              onClose();
            }}
          >
            Применить
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ────────────────────────────────────────── Chip ───────────────────────────────────────── */

interface FilterChipProps {
  label: string;
  value: string;
  active?: boolean;
  onClick: () => void;
  onClear?: () => void;
  disabled?: boolean;
}
const FilterChip = ({ label, value, active, onClick, onClear, disabled }: FilterChipProps) => (
  <button
    onClick={disabled ? undefined : onClick}
    className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-full border transition-colors text-left shrink-0 h-9 ${
      disabled
        ? 'border-border/40 bg-card/40 text-muted-foreground/50 cursor-not-allowed'
        : active
        ? 'border-primary/60 bg-primary/10'
        : 'border-border bg-card hover:border-primary/40'
    }`}
  >
    <span className="text-[11px] text-muted-foreground leading-none">{label}:</span>
    <span className="text-xs font-semibold leading-none max-w-[140px] truncate">{value}</span>
    {active && onClear ? (
      <span
        role="button"
        tabIndex={0}
        onClick={(e) => {
          e.stopPropagation();
          onClear();
        }}
        className="w-3.5 h-3.5 inline-flex items-center justify-center rounded-full hover:bg-foreground/10"
      >
        <X className="w-3 h-3 text-muted-foreground" />
      </span>
    ) : (
      <ChevronDown className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
    )}
  </button>
);

/* ────────────────────────────────────────── Detail Dialog ───────────────────────────────────────── */

interface NftDetailProps {
  open: boolean;
  onClose: () => void;
  nft: PortalsNft | null;
  ctaLabel: string;
  onBuy: (nft: PortalsNft) => void;
}

function NftDetailDialog({ open, onClose, nft, ctaLabel, onBuy }: NftDetailProps) {
  const [raw, setRaw] = useState<any>(null);
  const [normalized, setNormalized] = useState<PortalsNft | null>(null);
  const [loading, setLoading] = useState(false);
  const [showRaw, setShowRaw] = useState(false);

  useEffect(() => {
    if (!open || !nft) return;
    setRaw(null);
    setNormalized(null);
    setShowRaw(false);
    setLoading(true);
    fetch(projectFnUrl(`portals-gifts?action=detail&id=${encodeURIComponent(nft.id)}`), {
      headers: fnHeaders(),
    })
      .then(async (r) => {
        const j = await r.json();
        if (!r.ok) throw new Error(j?.message || j?.error || `HTTP ${r.status}`);
        return j;
      })
      .then((d) => {
        setRaw(d?.raw ?? null);
        setNormalized(d?.normalized ?? null);
      })
      .catch(() => {
        // Fall back to passed item silently
      })
      .finally(() => setLoading(false));
  }, [open, nft?.id]);

  const view = normalized ?? nft;
  if (!view) return null;

  const portalsUrl = `https://portal-market.com/nfts/${view.id}`;
  const tonscanUrl = raw?.contract_address
    ? `https://tonviewer.com/${raw.contract_address}`
    : null;

  const copy = (text: string) => {
    navigator.clipboard.writeText(text).then(
      () => toast.success('Скопировано'),
      () => toast.error('Не удалось скопировать'),
    );
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden bg-card border-border max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <div className="min-w-0">
            <h3 className="font-display font-bold text-base truncate">{view.name}</h3>
            <div className="text-[11px] text-muted-foreground">
              {view.number}
              {loading && <span className="ml-2 inline-flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> данные…</span>}
            </div>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-full hover:bg-secondary"
            aria-label="Закрыть"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="aspect-square w-full bg-secondary relative">
            {view.animationUrl ? (
              <video
                src={view.animationUrl}
                poster={view.image || undefined}
                autoPlay
                loop
                muted
                playsInline
                className="absolute inset-0 w-full h-full object-cover"
              />
            ) : view.image ? (
              <img src={view.image} alt={view.name} className="absolute inset-0 w-full h-full object-cover" />
            ) : null}
          </div>

          <div className="p-4 space-y-4">
            {/* Price */}
            <div className="flex items-end justify-between gap-3">
              <div>
                <div className="text-[11px] text-muted-foreground">Цена</div>
                <div className="font-display font-black text-2xl leading-tight">
                  <span className="inline-flex items-center gap-1.5">{view.priceTon.toFixed(2)} <TonIcon className="w-5 h-5" /></span>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  ~{Math.round(view.priceTon * TON_TO_RUB_FALLBACK).toLocaleString('ru-RU')} ₽
                </div>
              </div>
              <Button onClick={() => onBuy(view)} className="shrink-0">
                {ctaLabel}
              </Button>
            </div>

            {/* Attributes */}
            {view.attributes.length > 0 && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Атрибуты</div>
                <div className="grid grid-cols-2 gap-2">
                  {view.attributes.map((a, i) => (
                    <div key={`${a.type}-${a.value}-${i}`} className="rounded-lg border border-border bg-secondary/40 px-3 py-2">
                      <div className="text-[10px] text-muted-foreground uppercase">{a.type}</div>
                      <div className="text-sm font-semibold truncate">{a.value}</div>
                      {a.rarity != null && (
                        <div className="text-[10px] text-primary mt-0.5">
                          {(a.rarity / 10).toFixed(1)}% редкость
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Meta from raw */}
            {raw && (
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">Информация</div>
                <div className="rounded-lg border border-border divide-y divide-border bg-secondary/20 text-xs">
                  <Row label="ID" value={String(raw.id ?? view.id)} onCopy={() => copy(String(raw.id ?? view.id))} />
                  {raw.tg_id && <Row label="Telegram ID" value={raw.tg_id} onCopy={() => copy(raw.tg_id)} />}
                  {raw.external_collection_number != null && <Row label="Номер" value={`#${raw.external_collection_number}`} />}
                  {raw.collection_name && <Row label="Коллекция" value={raw.collection_name} />}
                  {raw.owner && <Row label="Владелец" value={String(raw.owner).slice(0, 6) + '…' + String(raw.owner).slice(-4)} onCopy={() => copy(String(raw.owner))} />}
                  {raw.contract_address && (
                    <Row label="Контракт" value={String(raw.contract_address).slice(0, 6) + '…' + String(raw.contract_address).slice(-4)} onCopy={() => copy(String(raw.contract_address))} />
                  )}
                  {raw.status && <Row label="Статус" value={String(raw.status)} />}
                  {raw.listed_at && <Row label="В продаже с" value={new Date(raw.listed_at).toLocaleString('ru-RU')} />}
                  {raw.currency && <Row label="Валюта" value={String(raw.currency).toUpperCase()} />}
                  {raw.floor_price != null && <Row label="Floor коллекции" value={`${raw.floor_price} TON`} />}
                </div>
              </div>
            )}

            {/* External links */}
            <div className="flex flex-wrap gap-2">
              <a
                href={portalsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:border-primary/40 text-xs"
              >
                Portals <ExternalLink className="w-3 h-3" />
              </a>
              {tonscanUrl && (
                <a
                  href={tonscanUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-border hover:border-primary/40 text-xs"
                >
                  Tonviewer <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>

            {/* Raw JSON */}
            {raw && (
              <div>
                <button
                  onClick={() => setShowRaw((v) => !v)}
                  className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
                >
                  <ChevronDown className={`w-3 h-3 transition-transform ${showRaw ? 'rotate-180' : ''}`} />
                  {showRaw ? 'Скрыть' : 'Показать'} полный ответ API
                </button>
                {showRaw && (
                  <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-secondary/50 p-3 text-[10px] leading-snug whitespace-pre-wrap break-all">
{JSON.stringify(raw, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, onCopy }: { label: string; value: string; onCopy?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-2 px-3 py-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="flex items-center gap-1.5 font-medium text-right truncate max-w-[60%]">
        <span className="truncate">{value}</span>
        {onCopy && (
          <button onClick={onCopy} className="text-muted-foreground hover:text-foreground shrink-0" aria-label="Копировать">
            <Copy className="w-3 h-3" />
          </button>
        )}
      </span>
    </div>
  );
}

/* ────────────────────────────────────────── Main ───────────────────────────────────────── */

interface Props {
  open: boolean;
  onClose: () => void;
  mode: CatalogMode;
}

type PickerKind = 'collection' | 'sort' | 'model' | 'backdrop' | 'symbol' | 'price';

const NftCatalogDialog = ({ open, onClose, mode }: Props) => {
  const { addToCart } = useStore();

  const isRent = mode === 'nft_rent' || mode === 'username_rent';
  const title =
    mode === 'username_rent' ? 'Аренда username' : mode === 'nft_rent' ? 'Аренда NFT' : 'NFT подарки';
  const ctaLabel = isRent ? 'Арендовать' : 'Купить';

  const [collections, setCollections] = useState<PortalsCollection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [collection, setCollection] = useState<PortalsCollection | null>(null);

  const [filters, setFilters] = useState<FiltersData>({ models: [], backdrops: [], symbols: [] });
  const [filtersLoading, setFiltersLoading] = useState(false);

  const [models, setModels] = useState<string[]>([]);
  const [backdrops, setBackdrops] = useState<string[]>([]);
  const [symbols, setSymbols] = useState<string[]>([]);
  const [price, setPrice] = useState<PriceRange>({ min: '', max: '' });

  const [items, setItems] = useState<PortalsNft[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [sort, setSort] = useState<string>('price_asc');
  const [openPicker, setOpenPicker] = useState<null | PickerKind>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [detailNft, setDetailNft] = useState<PortalsNft | null>(null);

  const handleBuy = (it: PortalsNft) => {
    addToCart({
      id: it.id,
      title: `${title} · ${it.name} ${it.number}`,
      price: it.priceTon,
      product_type: 'simple',
    } as any);
    toast.success(`${ctaLabel}: ${it.name} ${it.number}`);
  };

  // Load collections once when dialog opens; don't auto-pick one
  useEffect(() => {
    if (!open || collections.length > 0) return;
    setCollectionsLoading(true);
    fetch(projectFnUrl('portals-gifts?action=collections'), { headers: fnHeaders() })
      .then((r) => r.json())
      .then((d) => {
        const list: PortalsCollection[] = Array.isArray(d?.collections) ? d.collections : [];
        setCollections(list);
      })
      .catch(() => setCollections([]))
      .finally(() => setCollectionsLoading(false));
  }, [open]);

  // Reset attribute filters when collection changes; reload filter options
  useEffect(() => {
    setModels([]);
    setBackdrops([]);
    setSymbols([]);
    if (!collection) {
      setFilters({ models: [], backdrops: [], symbols: [] });
      return;
    }
    let cancelled = false;
    setFiltersLoading(true);
    fetch(
      projectFnUrl(`portals-gifts?action=filters&collection=${encodeURIComponent(collection.id)}`),
      { headers: fnHeaders() },
    )
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        setFilters({
          models: Array.isArray(d?.models) ? d.models : [],
          backdrops: Array.isArray(d?.backdrops) ? d.backdrops : [],
          symbols: Array.isArray(d?.symbols) ? d.symbols : [],
        });
      })
      .catch(() => {
        if (!cancelled) setFilters({ models: [], backdrops: [], symbols: [] });
      })
      .finally(() => {
        if (!cancelled) setFiltersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [collection]);

  // Fetch items
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({
      limit: '40',
      offset: '0',
      sort,
    });
    if (collection) params.set('collection', collection.id);
    if (models.length) params.set('models', models.join(','));
    if (backdrops.length) params.set('backdrops', backdrops.join(','));
    if (symbols.length) params.set('symbols', symbols.join(','));
    if (price.min) params.set('min_price', price.min);
    if (price.max) params.set('max_price', price.max);

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
  }, [open, collection, sort, models, backdrops, symbols, price, reloadKey]);

  const collectionLabel = collection?.name ?? 'Все подарки';
  const sortLabel = SORTS.find((s) => s.value === sort)?.label ?? 'По умолчанию';

  const summarize = (arr: string[]) =>
    arr.length === 0 ? 'Все' : arr.length === 1 ? arr[0] : `${arr.length} выбрано`;
  const priceLabel =
    price.min || price.max
      ? `${price.min || '0'} – ${price.max || '∞'}`
      : 'Любая';

  const attrDisabled = !collection;

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

            <div className="px-3 py-3 border-b border-border space-y-2">
              <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
                <FilterChip
                  label="Подарок"
                  value={collectionLabel}
                  active={!!collection}
                  onClick={() => setOpenPicker('collection')}
                  onClear={collection ? () => setCollection(null) : undefined}
                />
                <FilterChip
                  label="Модель"
                  value={attrDisabled ? '—' : summarize(models)}
                  active={models.length > 0}
                  disabled={attrDisabled}
                  onClick={() => setOpenPicker('model')}
                  onClear={models.length ? () => setModels([]) : undefined}
                />
                <FilterChip
                  label="Фон"
                  value={attrDisabled ? '—' : summarize(backdrops)}
                  active={backdrops.length > 0}
                  disabled={attrDisabled}
                  onClick={() => setOpenPicker('backdrop')}
                  onClear={backdrops.length ? () => setBackdrops([]) : undefined}
                />
                <FilterChip
                  label="Символ"
                  value={attrDisabled ? '—' : summarize(symbols)}
                  active={symbols.length > 0}
                  disabled={attrDisabled}
                  onClick={() => setOpenPicker('symbol')}
                  onClear={symbols.length ? () => setSymbols([]) : undefined}
                />
                <FilterChip
                  label="Цена"
                  value={priceLabel}
                  active={!!(price.min || price.max)}
                  onClick={() => setOpenPicker('price')}
                  onClear={price.min || price.max ? () => setPrice({ min: '', max: '' }) : undefined}
                />
                <FilterChip
                  label="Сорт."
                  value={sortLabel}
                  onClick={() => setOpenPicker('sort')}
                />
              </div>
              {collection?.floorTon != null && (
                <div className="text-[11px] text-muted-foreground">
                  Floor:{' '}
                  <span className="text-foreground font-semibold inline-flex items-center gap-1">{collection.floorTon}<TonIcon className="w-3 h-3" /></span>
                  {collection.listedCount != null && <> · {collection.listedCount} в продаже</>}
                  {filtersLoading && (
                    <span className="ml-2 inline-flex items-center gap-1">
                      <Loader2 className="w-3 h-3 animate-spin" /> фильтры…
                    </span>
                  )}
                </div>
              )}
              {!collection && (
                <div className="text-[11px] text-muted-foreground">
                  Показаны лоты по всем коллекциям. Выберите коллекцию, чтобы открыть фильтры по моделям/фонам.
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
                  Под выбранные фильтры ничего не найдено
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {items.map((it) => {
                    const model = it.attributes.find((a) => a.type === 'model')?.value;
                    const backdrop = it.attributes.find((a) => a.type === 'backdrop')?.value;
                    return (
                      <div
                        key={it.id}
                        className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col group cursor-pointer"
                        onClick={() => setDetailNft(it)}
                      >
                        <div className="aspect-square relative bg-secondary">
                          {it.image && (
                            <img
                              src={it.image}
                              alt={it.name}
                              loading="lazy"
                              className="absolute inset-0 w-full h-full object-cover transition-transform group-hover:scale-105"
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
                            onClick={(e) => {
                              e.stopPropagation();
                              handleBuy(it);
                            }}
                            className="w-full rounded-lg bg-secondary hover:bg-secondary/80 transition-colors py-1.5 px-2 text-xs font-semibold flex items-center justify-center gap-1 mt-1"
                          >
                            <TonIcon className="w-3.5 h-3.5" />
                            <span>{it.priceTon.toFixed(2)}</span>
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
      <MultiPickerSheet
        open={openPicker === 'model'}
        onClose={() => setOpenPicker(null)}
        title="Модель"
        options={filters.models}
        selected={models}
        onChange={setModels}
      />
      <MultiPickerSheet
        open={openPicker === 'backdrop'}
        onClose={() => setOpenPicker(null)}
        title="Фон"
        options={filters.backdrops}
        selected={backdrops}
        onChange={setBackdrops}
      />
      <MultiPickerSheet
        open={openPicker === 'symbol'}
        onClose={() => setOpenPicker(null)}
        title="Символ"
        options={filters.symbols}
        selected={symbols}
        onChange={setSymbols}
      />
      <PricePickerSheet
        open={openPicker === 'price'}
        onClose={() => setOpenPicker(null)}
        value={price}
        onChange={setPrice}
      />
      <NftDetailDialog
        open={!!detailNft}
        onClose={() => setDetailNft(null)}
        nft={detailNft}
        ctaLabel={ctaLabel}
        onBuy={(it) => {
          handleBuy(it);
          setDetailNft(null);
        }}
      />
    </>
  );
};

export default NftCatalogDialog;
