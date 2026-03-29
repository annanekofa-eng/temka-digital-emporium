import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X } from 'lucide-react';
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
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 500]);
  const [filtersOpen, setFiltersOpen] = useState(false);

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
    result = result.filter(p => Number(p.price) >= priceRange[0] && Number(p.price) <= priceRange[1]);

    switch (sortBy) {
      case 'price-asc': result.sort((a, b) => Number(a.price) - Number(b.price)); break;
      case 'price-desc': result.sort((a, b) => Number(b.price) - Number(a.price)); break;
      case 'newest': result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); break;
      default: result.sort((a, b) => a.sort_order - b.sort_order);
    }
    return result;
  }, [products, q, sortBy, priceRange, selectedCategory]);

  const clearFilters = () => {
    setLocalSearch('');
    setSearchQuery('');
    setSelectedCategory('');
    setSortBy('default');
    setPriceRange([0, 500]);
    setSearchParams({});
  };

  const activeCat = categories?.find(c => c.id === selectedCategory);

  return (
    <div className="container-main mx-auto px-4 py-6 sm:py-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-bold">Все товары</h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-2">
          {productsLoading ? 'Загрузка...' : `${products.length} товаров доступно`}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Поиск товаров..." value={localSearch} onChange={e => setLocalSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div className="flex gap-2">
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="h-10 px-3 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none cursor-pointer flex-1 sm:flex-none">
            {sortOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <Button variant="outline" className="lg:hidden shrink-0" onClick={() => setFiltersOpen(!filtersOpen)}>
            <SlidersHorizontal className="w-4 h-4 mr-1" /> Фильтры
          </Button>
        </div>
      </div>

      <div className="flex gap-6">
        {/* Filters sidebar */}
        <aside className={`${filtersOpen ? 'fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col' : 'hidden'} lg:block lg:relative lg:bg-transparent lg:p-0 w-full lg:w-64 shrink-0`}>
          <div className="flex items-center justify-between p-4 sm:p-6 pb-0 lg:hidden">
            <h3 className="font-display font-bold text-lg">Фильтры</h3>
            <Button variant="ghost" size="icon" onClick={() => setFiltersOpen(false)}><X className="w-5 h-5" /></Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 lg:p-0">
            <div>
              <h4 className="font-display font-semibold text-sm mb-3">Цена</h4>
              <div className="flex items-center gap-2">
                <input type="number" value={priceRange[0]} onChange={e => setPriceRange([Number(e.target.value), priceRange[1]])}
                  className="w-20 h-8 px-2 bg-secondary border border-border rounded text-sm text-foreground" placeholder="Мин" />
                <span className="text-muted-foreground text-sm">—</span>
                <input type="number" value={priceRange[1]} onChange={e => setPriceRange([priceRange[0], Number(e.target.value)])}
                  className="w-20 h-8 px-2 bg-secondary border border-border rounded text-sm text-foreground" placeholder="Макс" />
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => { clearFilters(); setFiltersOpen(false); }} className="w-full">Сбросить фильтры</Button>
          </div>
          <div className="p-4 sm:p-6 pt-2 border-t border-border lg:hidden">
            <Button variant="outline" size="sm" onClick={() => { clearFilters(); setFiltersOpen(false); }} className="w-full">Сбросить фильтры</Button>
          </div>
        </aside>

        {/* Products grid */}
        <div className="flex-1">
          {productsLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
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
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                {filtered.map(product => (
                  <ShopProductCard key={product.id} product={product} shopId={shopId} />
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
