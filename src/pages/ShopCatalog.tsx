import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import ShopProductCard from '@/components/ShopProductCard';
import ProductCardSkeleton from '@/components/ProductCardSkeleton';
import { useShop } from '@/contexts/ShopContext';

const sortOptions = [
  { value: 'default', label: 'По умолчанию' },
  { value: 'price-asc', label: 'Цена: по возрастанию' },
  { value: 'price-desc', label: 'Цена: по убыванию' },
  { value: 'newest', label: 'Новинки' },
];

const ShopCatalog = () => {
  const { products, productsLoading, searchQuery, setSearchQuery, shop, categories } = useShop();
  const shopId = shop?.id || '';
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('category') || '';
  
  const [localSearch, setLocalSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState(categoryParam);
  const [sortBy, setSortBy] = useState('default');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid';
    return (localStorage.getItem('shop-catalog-view') as 'grid' | 'list') || 'grid';
  });

  useEffect(() => {
    localStorage.setItem('shop-catalog-view', viewMode);
  }, [viewMode]);

  useEffect(() => {
    setSelectedCategory(categoryParam);
  }, [categoryParam]);

  const q = localSearch || searchQuery;

  const filtered = useMemo(() => {
    let result = [...products];
    if (q.trim()) {
      const lower = q.toLowerCase();
      result = result.filter(p =>
        p.name.toLowerCase().includes(lower) ||
        p.subtitle.toLowerCase().includes(lower) ||
        p.description.toLowerCase().includes(lower)
      );
    }
    if (selectedCategory) {
      result = result.filter(p => p.category_id === selectedCategory);
    }

    switch (sortBy) {
      case 'price-asc': result.sort((a, b) => Number(a.price) - Number(b.price)); break;
      case 'price-desc': result.sort((a, b) => Number(b.price) - Number(a.price)); break;
      case 'newest': result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); break;
      default: result.sort((a, b) => a.sort_order - b.sort_order);
    }
    return result;
  }, [products, q, sortBy, selectedCategory]);

  const clearFilters = () => {
    setLocalSearch('');
    setSearchQuery('');
    setSelectedCategory('');
    setSortBy('default');
    setSearchParams({});
  };

  const activeCat = categories?.find(c => c.id === selectedCategory);

  const categoryCount = (catId: string) => products.filter(p => p.category_id === catId).length;

  return (
    <div className="container-main mx-auto px-4 py-6 sm:py-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-bold">
          {activeCat ? `${activeCat.icon || ''} ${activeCat.name}` : 'Все товары'}
        </h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-2">
          {productsLoading ? 'Загрузка...' : `${filtered.length} товаров доступно`}
        </p>
      </div>

      {/* Category chips */}
      {categories && categories.length > 0 && (
        <div className="mb-4 -mx-4 px-4 overflow-x-auto scrollbar-hide">
          <div className="flex items-center gap-2 min-w-min pb-1">
            <button
              onClick={() => { setSelectedCategory(''); setSearchParams({}); }}
              className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full text-xs sm:text-sm font-medium border transition-colors ${
                !selectedCategory
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40'
              }`}
            >
              Все
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${!selectedCategory ? 'bg-primary-foreground/20' : 'bg-secondary'}`}>
                {products.length}
              </span>
            </button>
            {categories.map(cat => {
              const active = selectedCategory === cat.id;
              const count = categoryCount(cat.id);
              return (
                <button
                  key={cat.id}
                  onClick={() => { setSelectedCategory(cat.id); setSearchParams({ category: cat.id }); }}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full text-xs sm:text-sm font-medium border transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40'
                  }`}
                >
                  <span>{cat.icon}</span>
                  <span>{cat.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${active ? 'bg-primary-foreground/20' : 'bg-secondary'}`}>
                    {count}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Поиск товаров..." value={localSearch} onChange={e => setLocalSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div className="flex gap-2">
          {/* View mode toggle */}
          <div className="flex items-center bg-card border border-border rounded-lg p-0.5 h-10 shrink-0">
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              aria-label="Сетка"
              aria-pressed={viewMode === 'grid'}
              className={`h-9 w-9 inline-flex items-center justify-center rounded-md transition-colors ${
                viewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              aria-label="Список"
              aria-pressed={viewMode === 'list'}
              className={`h-9 w-9 inline-flex items-center justify-center rounded-md transition-colors ${
                viewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="h-10 px-3 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none cursor-pointer flex-1 sm:flex-none">
            {sortOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
        </div>
      </div>

      <div>
        {/* Products grid */}
        <div className="flex-1">
          {productsLoading ? (
            <div className={viewMode === 'list' ? 'flex flex-col gap-3' : 'grid grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4'}>
              {Array.from({ length: 6 }).map((_, i) => <ProductCardSkeleton key={i} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16 sm:py-20">
              <div className="text-5xl mb-4">🔍</div>
              <h3 className="font-display font-semibold text-lg">Товары не найдены</h3>
              <p className="text-muted-foreground text-sm mt-2">Попробуйте изменить фильтры или поисковый запрос</p>
              <Button variant="outline" className="mt-4" onClick={clearFilters}>Сбросить фильтры</Button>
            </div>
          ) : (
            <>
              <p className="text-xs sm:text-sm text-muted-foreground mb-4">Найдено товаров: {filtered.length}</p>
              <div className={viewMode === 'list' ? 'flex flex-col gap-3' : 'grid grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4'}>
                {filtered.map(product => (
                  <ShopProductCard key={product.id} product={product} shopId={shopId} view={viewMode} />
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default ShopCatalog;
