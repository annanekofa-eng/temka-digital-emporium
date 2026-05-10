import { useMemo, useState } from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { ChevronDown, X, Search, Check } from 'lucide-react';
import { useStore } from '@/contexts/StoreContext';
import { toast } from 'sonner';

export type CatalogMode = 'gift' | 'nft_rent' | 'username_rent';

interface NftItem {
  id: string;
  number: string;
  name: string;
  collection: string;
  background: string;
  symbol: string;
  model: string;
  price: number;
  priceRub: number;
  emoji: string;
}

const COLLECTIONS = [
  { name: 'Mood Pack', floor: 2.8, emoji: '😎' },
  { name: 'Pool Float', floor: 2.44, emoji: '🦩' },
  { name: 'Timeless Book', floor: 3, emoji: '📖' },
  { name: 'Chill Flame', floor: 2.17, emoji: '🔥' },
  { name: 'Vice Cream', floor: 2.18, emoji: '🍦' },
  { name: 'Astral Shard', floor: 105.84, emoji: '💎' },
  { name: 'B-Day Candle', floor: 3.12, emoji: '🕯️' },
];

const BACKGROUNDS = [
  { name: 'Amber', color: '#f59e0b' },
  { name: 'Aquamarine', color: '#5eead4' },
  { name: 'Azure Blue', color: '#3b82f6' },
  { name: 'Battleship Grey', color: '#64748b' },
  { name: 'Black', color: '#0a0a0a' },
  { name: 'Burgundy', color: '#9f1239' },
  { name: 'Burnt Sienna', color: '#ea580c' },
  { name: 'Camo Green', color: '#65a30d' },
  { name: 'Cappuccino', color: '#a78bfa' },
  { name: 'Caramel', color: '#d97706' },
  { name: 'Carmine', color: '#dc2626' },
];

const SYMBOLS = ['Все', 'Огонь', 'Лёд', 'Молния', 'Звезда', 'Сердце'];
const MODELS = ['Все', 'Common', 'Rare', 'Epic', 'Legendary'];
const SORTS = ['По цене ↑', 'По цене ↓', 'По номеру', 'Новые'];

const USERNAME_ITEMS: NftItem[] = [
  { id: 'u1', number: '@alpha', name: 'alpha', collection: 'Premium', background: 'Azure Blue', symbol: '—', model: 'Legendary', price: 12.5, priceRub: 1280, emoji: '🅰️' },
  { id: 'u2', number: '@nova', name: 'nova', collection: 'Premium', background: 'Burgundy', symbol: '—', model: 'Epic', price: 8.2, priceRub: 840, emoji: '✨' },
  { id: 'u3', number: '@core', name: 'core', collection: 'Standard', background: 'Black', symbol: '—', model: 'Rare', price: 4.1, priceRub: 420, emoji: '⚙️' },
  { id: 'u4', number: '@flux', name: 'flux', collection: 'Standard', background: 'Camo Green', symbol: '—', model: 'Rare', price: 3.6, priceRub: 369, emoji: '🌊' },
  { id: 'u5', number: '@orbit', name: 'orbit', collection: 'Premium', background: 'Caramel', symbol: '—', model: 'Epic', price: 9.0, priceRub: 922, emoji: '🪐' },
  { id: 'u6', number: '@pixel', name: 'pixel', collection: 'Standard', background: 'Aquamarine', symbol: '—', model: 'Common', price: 1.8, priceRub: 184, emoji: '🟦' },
];

const GIFT_ITEMS: NftItem[] = [
  { id: 'g1', number: '#40876', name: 'Dungeon', collection: 'Chill Flame', background: 'Burgundy', symbol: 'Огонь', model: 'Epic', price: 2.55, priceRub: 458, emoji: '🔥' },
  { id: 'g2', number: '#45032', name: 'Los Angeles', collection: 'Chill Flame', background: 'Cappuccino', symbol: 'Огонь', model: 'Rare', price: 2.55, priceRub: 458, emoji: '🌆' },
  { id: 'g3', number: '#36995', name: 'Spark', collection: 'Chill Flame', background: 'Camo Green', symbol: 'Молния', model: 'Common', price: 2.17, priceRub: 390, emoji: '⚡' },
  { id: 'g4', number: '#298975', name: 'Torch', collection: 'Chill Flame', background: 'Battleship Grey', symbol: 'Огонь', model: 'Rare', price: 2.55, priceRub: 458, emoji: '🔦' },
  { id: 'g5', number: '#10221', name: 'Mood', collection: 'Mood Pack', background: 'Amber', symbol: 'Звезда', model: 'Common', price: 2.8, priceRub: 503, emoji: '😎' },
  { id: 'g6', number: '#88412', name: 'Float', collection: 'Pool Float', background: 'Aquamarine', symbol: 'Сердце', model: 'Common', price: 2.44, priceRub: 438, emoji: '🦩' },
  { id: 'g7', number: '#55001', name: 'Astral', collection: 'Astral Shard', background: 'Black', symbol: 'Звезда', model: 'Legendary', price: 105.84, priceRub: 19010, emoji: '💎' },
  { id: 'g8', number: '#77123', name: 'Book', collection: 'Timeless Book', background: 'Caramel', symbol: 'Звезда', model: 'Rare', price: 3, priceRub: 539, emoji: '📖' },
];

interface PickerProps<T extends string> {
  open: boolean;
  onClose: () => void;
  title: string;
  options: { value: T; label: string; meta?: string; emoji?: string; color?: string }[];
  value: T | 'Все';
  onSelect: (v: T | 'Все') => void;
  searchable?: boolean;
}

function PickerSheet<T extends string>({ open, onClose, title, options, value, onSelect, searchable }: PickerProps<T>) {
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
          <button
            onClick={() => {
              onSelect('Все' as any);
              onClose();
            }}
            className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-secondary/60 ${
              value === 'Все' ? 'bg-secondary/60' : ''
            }`}
          >
            <div className="w-5 h-5 rounded-full border border-border flex items-center justify-center">
              {value === 'Все' && <div className="w-2.5 h-2.5 rounded-full bg-primary" />}
            </div>
            <span className="text-sm font-medium">Все</span>
          </button>
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
              {o.color ? (
                <div className="w-5 h-5 rounded-full shrink-0" style={{ background: o.color }} />
              ) : o.emoji ? (
                <div className="w-8 h-8 rounded-lg bg-secondary flex items-center justify-center text-base shrink-0">
                  {o.emoji}
                </div>
              ) : null}
              <span className="text-sm font-medium flex-1 text-left">{o.label}</span>
              {o.meta && <span className="text-xs text-muted-foreground">{o.meta}</span>}
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
    <span className="text-xs font-semibold leading-none max-w-[90px] truncate">{value}</span>
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
  const [collection, setCollection] = useState<string>('Все');
  const [background, setBackground] = useState<string>('Все');
  const [symbol, setSymbol] = useState<string>('Все');
  const [model, setModel] = useState<string>('Все');
  const [sort, setSort] = useState<string>('По цене ↑');
  const [openPicker, setOpenPicker] = useState<null | 'collection' | 'background' | 'symbol' | 'model' | 'sort'>(null);

  const items = mode === 'username_rent' ? USERNAME_ITEMS : GIFT_ITEMS;
  const isRent = mode === 'nft_rent' || mode === 'username_rent';

  const title =
    mode === 'username_rent' ? 'Аренда username' : mode === 'nft_rent' ? 'Аренда NFT' : 'NFT подарки';
  const ctaLabel = isRent ? 'Арендовать' : 'Купить';

  const filtered = useMemo(() => {
    let list = items.filter((i) => {
      if (collection !== 'Все' && i.collection !== collection) return false;
      if (background !== 'Все' && i.background !== background) return false;
      if (symbol !== 'Все' && i.symbol !== symbol) return false;
      if (model !== 'Все' && i.model !== model) return false;
      return true;
    });
    if (sort === 'По цене ↑') list = [...list].sort((a, b) => a.price - b.price);
    if (sort === 'По цене ↓') list = [...list].sort((a, b) => b.price - a.price);
    if (sort === 'По номеру') list = [...list].sort((a, b) => a.number.localeCompare(b.number));
    return list;
  }, [items, collection, background, symbol, model, sort]);

  const activeChips = [
    collection !== 'Все' && { key: 'collection', label: collection, clear: () => setCollection('Все') },
    background !== 'Все' && { key: 'background', label: background, clear: () => setBackground('Все') },
    symbol !== 'Все' && { key: 'symbol', label: symbol, clear: () => setSymbol('Все') },
    model !== 'Все' && { key: 'model', label: model, clear: () => setModel('Все') },
  ].filter(Boolean) as { key: string; label: string; clear: () => void }[];

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
        <DialogContent className="max-w-none w-screen h-[100dvh] sm:rounded-none p-0 overflow-hidden bg-background border-0 flex flex-col">
          <div className="flex-1 overflow-y-auto">
            <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-md flex items-center justify-between px-4 py-3 border-b border-border">
              <h2 className="font-display font-black text-base">{title}</h2>
            </div>

            {/* Filters — compact, horizontal scroll */}
            <div className="px-3 py-2 border-b border-border">
              <div className="flex gap-1.5 overflow-x-auto scrollbar-hide -mx-1 px-1">
                <FilterChip
                  label="Коллекция"
                  value={collection === 'Все' ? 'Все' : collection}
                  onClick={() => setOpenPicker('collection')}
                />
                <FilterChip label="Фон" value={background} onClick={() => setOpenPicker('background')} />
                <FilterChip label="Символ" value={symbol} onClick={() => setOpenPicker('symbol')} />
                <FilterChip label="Модель" value={model} onClick={() => setOpenPicker('model')} />
                <FilterChip label="Сорт." value={sort} onClick={() => setOpenPicker('sort')} />
              </div>
              {activeChips.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-2">
                  {activeChips.map((c) => (
                    <button
                      key={c.key}
                      onClick={c.clear}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/15 border border-primary/30 text-[10px] font-medium"
                    >
                      {c.label}
                      <X className="w-2.5 h-2.5" />
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Grid */}
            <div className="p-3">
              {filtered.length === 0 ? (
                <div className="text-center py-12 text-sm text-muted-foreground">Ничего не найдено</div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                  {filtered.map((it) => (
                    <div key={it.id} className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
                      <div
                        className="aspect-square flex items-center justify-center relative"
                        style={{
                          background: BACKGROUNDS.find((b) => b.name === it.background)?.color || '#1f2937',
                        }}
                      >
                        <div className="absolute top-2 left-2 px-2 py-0.5 rounded-md bg-black/50 text-[10px] font-bold text-white">
                          {it.number}
                        </div>
                        <span className="text-6xl drop-shadow-lg">{it.emoji}</span>
                      </div>
                      <div className="p-3 flex flex-col gap-2">
                        <div className="font-display font-bold text-sm leading-tight truncate">{it.name}</div>
                        <button
                          onClick={() => {
                            addToCart({
                              id: it.id,
                              title: `${title} · ${it.name}`,
                              price: it.price,
                              product_type: 'simple',
                            } as any);
                            toast.success(`${ctaLabel}: ${it.name}`);
                          }}
                          className="w-full rounded-lg bg-secondary hover:bg-secondary/80 transition-colors py-1.5 px-2 text-xs font-semibold flex items-center justify-center gap-1"
                        >
                          <span className="text-primary">▼</span>
                          <span>{it.price.toFixed(2)} TON</span>
                        </button>
                        <div className="text-[10px] text-muted-foreground text-center -mt-1">
                          ~{it.priceRub.toLocaleString('ru-RU')} ₽
                        </div>
                      </div>
                    </div>
                  ))}
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
        options={COLLECTIONS.map((c) => ({ value: c.name, label: c.name, emoji: c.emoji, meta: `${c.floor} ▼ Floor` }))}
        value={collection as any}
        onSelect={(v) => setCollection(v as string)}
        searchable
      />
      <PickerSheet
        open={openPicker === 'background'}
        onClose={() => setOpenPicker(null)}
        title="Выбор фона"
        options={BACKGROUNDS.map((b) => ({ value: b.name, label: b.name, color: b.color }))}
        value={background as any}
        onSelect={(v) => setBackground(v as string)}
        searchable
      />
      <PickerSheet
        open={openPicker === 'symbol'}
        onClose={() => setOpenPicker(null)}
        title="Выбор символа"
        options={SYMBOLS.filter((s) => s !== 'Все').map((s) => ({ value: s, label: s }))}
        value={symbol as any}
        onSelect={(v) => setSymbol(v as string)}
      />
      <PickerSheet
        open={openPicker === 'model'}
        onClose={() => setOpenPicker(null)}
        title="Выбор модели"
        options={MODELS.filter((s) => s !== 'Все').map((s) => ({ value: s, label: s }))}
        value={model as any}
        onSelect={(v) => setModel(v as string)}
      />
      <PickerSheet
        open={openPicker === 'sort'}
        onClose={() => setOpenPicker(null)}
        title="Сортировка"
        options={SORTS.map((s) => ({ value: s, label: s }))}
        value={sort as any}
        onSelect={(v) => setSort(v as string)}
      />
    </>
  );
};

export default NftCatalogDialog;
