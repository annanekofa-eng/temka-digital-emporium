import { useState, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Search, SlidersHorizontal, X, LayoutGrid, List } from 'lucide-react';
import { Button } from '@/components/ui/button';
import ProductCard from '@/components/ProductCard';
import ProductCardSkeleton from '@/components/ProductCardSkeleton';
import ProjectCard from '@/components/ProjectCard';
import { useProducts, useCategories } from '@/hooks/useProducts';
import { useProjects } from '@/hooks/useShop';

const sortOptions = [
  { value: 'popular', label: 'По популярности' },
  { value: 'price-asc', label: 'Цена: по возрастанию' },
  { value: 'price-desc', label: 'Цена: по убыванию' },
  { value: 'newest', label: 'Новинки' },
];

const Catalog = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const categoryParam = searchParams.get('category') || '';
  const searchParam = searchParams.get('search') || '';
  const projectParam = searchParams.get('project') || '';

  const { data: products, isLoading, error } = useProducts();
  const { data: categories } = useCategories();
  const { data: projects } = useProjects();

  const [search, setSearch] = useState(searchParam);
  const [selectedCategory, setSelectedCategory] = useState(categoryParam);
  const [selectedProject, setSelectedProject] = useState(projectParam);
  const [sortBy, setSortBy] = useState('popular');
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 500]);
  const [deliveryType, setDeliveryType] = useState<string>('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() => {
    if (typeof window === 'undefined') return 'grid';
    return (localStorage.getItem('catalog-view') as 'grid' | 'list') || 'grid';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('catalog-view', viewMode);
  }, [viewMode]);

  useEffect(() => {
    setSearch(searchParam);
  }, [searchParam]);

  useEffect(() => {
    setSelectedCategory(categoryParam);
  }, [categoryParam]);

  useEffect(() => {
    setSelectedProject(projectParam);
  }, [projectParam]);

  const filtered = useMemo(() => {
    if (!products) return [];
    let result = [...products];
    if (search) result = result.filter(p => p.title.toLowerCase().includes(search.toLowerCase()) || p.subtitle.toLowerCase().includes(search.toLowerCase()));
    if (selectedCategory) result = result.filter(p => p.category_id === selectedCategory);
    if (selectedProject) result = result.filter(p => (p as any).project_id === selectedProject);
    if (deliveryType) result = result.filter(p => p.delivery_type === deliveryType);
    result = result.filter(p => Number(p.price) >= priceRange[0] && Number(p.price) <= priceRange[1]);

    switch (sortBy) {
      case 'price-asc': result.sort((a, b) => Number(a.price) - Number(b.price)); break;
      case 'price-desc': result.sort((a, b) => Number(b.price) - Number(a.price)); break;
      case 'newest': result.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()); break;
      default: result.sort((a, b) => b.stock - a.stock);
    }
    return result;
  }, [products, search, selectedCategory, selectedProject, sortBy, priceRange, deliveryType]);

  // Group products by project for the default view
  const groupedByProject = useMemo(() => {
    if (!projects) return [] as { project: typeof projects[number]; items: typeof filtered }[];
    return projects
      .map(pr => ({ project: pr, items: filtered.filter(p => (p as any).project_id === pr.id) }))
      .filter(g => g.items.length > 0);
  }, [projects, filtered]);

  const ungroupedItems = useMemo(
    () => filtered.filter(p => !(p as any).project_id),
    [filtered]
  );

  const showGrouped = !selectedProject && !selectedCategory && !search;

  const clearFilters = () => {
    setSearch('');
    setSelectedCategory('');
    setSelectedProject('');
    setSortBy('popular');
    setPriceRange([0, 500]);
    setDeliveryType('');
    setSearchParams({});
  };

  const projectProductCounts = useMemo(() => {
    if (!products) return {} as Record<string, number>;
    const counts: Record<string, number> = {};
    products.forEach(p => {
      const pid = (p as any).project_id;
      if (pid) counts[pid] = (counts[pid] || 0) + 1;
    });
    return counts;
  }, [products]);

  const activeCat = categories?.find(c => c.id === selectedCategory);

  // Category product counts from real data
  const categoryCounts = useMemo(() => {
    if (!products) return {};
    const counts: Record<string, number> = {};
    products.forEach(p => {
      if (p.category_id) counts[p.category_id] = (counts[p.category_id] || 0) + 1;
    });
    return counts;
  }, [products]);

  if (error) {
    return (
      <div className="container-main mx-auto px-4 py-16 text-center">
        <div className="text-5xl mb-4">⚠️</div>
        <h2 className="font-display text-xl font-bold">Ошибка загрузки</h2>
        <p className="text-muted-foreground text-sm mt-2">Не удалось загрузить каталог. Попробуйте позже.</p>
      </div>
    );
  }

  return (
    <div className="container-main mx-auto px-4 py-6 sm:py-8">
      <div className="mb-6 sm:mb-8">
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-bold">
          {activeCat ? `${activeCat.icon || ''} ${activeCat.name}` : 'Все товары'}
        </h1>
        <p className="text-muted-foreground text-xs sm:text-sm mt-2">
          {isLoading ? 'Загрузка...' : activeCat ? `${categoryCounts[activeCat.id] || 0} товаров в категории ${activeCat.name}` : `${products?.length || 0} цифровых товаров доступно`}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Поиск товаров..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full h-10 pl-10 pr-4 bg-card border border-border rounded-lg text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
        <div className="flex gap-2">
          <select value={sortBy} onChange={e => setSortBy(e.target.value)}
            className="h-10 px-3 bg-card border border-border rounded-lg text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-primary/50 appearance-none cursor-pointer flex-1 sm:flex-none">
            {sortOptions.map(opt => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
          </select>
          <div className="hidden sm:flex h-10 bg-card border border-border rounded-lg overflow-hidden">
            <button
              type="button"
              aria-label="Сетка"
              aria-pressed={viewMode === 'grid'}
              onClick={() => setViewMode('grid')}
              className={`px-3 flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <LayoutGrid className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Список"
              aria-pressed={viewMode === 'list'}
              onClick={() => setViewMode('list')}
              className={`px-3 flex items-center justify-center border-l border-border transition-colors ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <List className="w-4 h-4" />
            </button>
          </div>
          <Button variant="outline" className="lg:hidden shrink-0" onClick={() => setFiltersOpen(!filtersOpen)}>
            <SlidersHorizontal className="w-4 h-4 mr-1" /> Фильтры
          </Button>
        </div>
      </div>

      {/* Project chips */}
      {projects && projects.length > 0 && (
        <div className="-mx-4 px-4 mb-3">
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            <button
              onClick={() => {
                setSelectedProject('');
                const next = new URLSearchParams(searchParams);
                next.delete('project');
                setSearchParams(next);
              }}
              className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-colors ${
                !selectedProject
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40'
              }`}
            >
              Все проекты
            </button>
            {projects.map(pr => {
              const active = selectedProject === pr.id;
              return (
                <button
                  key={pr.id}
                  onClick={() => {
                    setSelectedProject(pr.id);
                    const next = new URLSearchParams(searchParams);
                    next.set('project', pr.id);
                    setSearchParams(next);
                  }}
                  className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground border-primary'
                      : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40'
                  }`}
                >
                  <span>{pr.icon}</span>
                  <span>{pr.title}</span>
                  <span className={`text-[10px] ${active ? 'opacity-80' : 'opacity-60'}`}>
                    {projectProductCounts[pr.id] || 0}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Category chips (horizontal scroll) */}
      <div className="-mx-4 px-4 mb-5 sm:mb-6">
        <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
          <button
            onClick={() => {
              setSelectedCategory('');
              const next = new URLSearchParams(searchParams);
              next.delete('category');
              setSearchParams(next);
            }}
            className={`shrink-0 px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-colors ${
              !selectedCategory
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40'
            }`}
          >
            Все
          </button>
          {categories?.map(cat => {
            const active = selectedCategory === cat.id;
            return (
              <button
                key={cat.id}
                onClick={() => {
                  setSelectedCategory(cat.id);
                  const next = new URLSearchParams(searchParams);
                  next.set('category', cat.id);
                  setSearchParams(next);
                }}
                className={`shrink-0 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs sm:text-sm font-medium border transition-colors ${
                  active
                    ? 'bg-primary text-primary-foreground border-primary'
                    : 'bg-card text-muted-foreground border-border hover:text-foreground hover:border-primary/40'
                }`}
              >
                <span>{cat.icon}</span>
                <span>{cat.name}</span>
                <span className={`text-[10px] ${active ? 'opacity-80' : 'opacity-60'}`}>
                  {categoryCounts[cat.id] || 0}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-6">
        <aside className={`${filtersOpen ? 'fixed inset-0 z-50 bg-background/95 backdrop-blur-sm flex flex-col' : 'hidden'} lg:block lg:relative lg:bg-transparent lg:p-0 w-full lg:w-64 shrink-0`}>
          <div className="flex items-center justify-between p-4 sm:p-6 pb-0 lg:hidden">
            <h3 className="font-display font-bold text-lg">Фильтры</h3>
            <Button variant="ghost" size="icon" onClick={() => setFiltersOpen(false)}><X className="w-5 h-5" /></Button>
          </div>
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-6 lg:p-0">
            <div>
              <h4 className="font-display font-semibold text-sm mb-3">Категория</h4>
              <div className="space-y-1">
                <button onClick={() => { setSelectedCategory(''); setSearchParams({}); }}
                  className={`block w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${!selectedCategory ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
                  Все категории
                </button>
                {categories?.map(cat => (
                  <button key={cat.id} onClick={() => { setSelectedCategory(cat.id); setSearchParams({ category: cat.id }); }}
                    className={`block w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${selectedCategory === cat.id ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
                    {cat.icon} {cat.name} <span className="text-xs opacity-60">({categoryCounts[cat.id] || 0})</span>
                  </button>
                ))}
              </div>
            </div>
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
            <div>
              <h4 className="font-display font-semibold text-sm mb-3">Доставка</h4>
              <div className="space-y-1">
                {['', 'instant', 'manual'].map(type => (
                  <button key={type} onClick={() => setDeliveryType(type)}
                    className={`block w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${deliveryType === type ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:text-foreground hover:bg-secondary'}`}>
                    {type === '' ? 'Все' : type === 'instant' ? '⚡ Мгновенная' : '🕐 Ручная'}
                  </button>
                ))}
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={() => { clearFilters(); setFiltersOpen(false); }} className="w-full lg:block hidden">Сбросить фильтры</Button>
          </div>
          <div className="p-4 sm:p-6 pt-2 border-t border-border lg:hidden">
            <Button variant="outline" size="sm" onClick={() => { clearFilters(); setFiltersOpen(false); }} className="w-full">Сбросить фильтры</Button>
          </div>
        </aside>

        <div className="flex-1">
          {isLoading ? (
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
              <div className="flex items-center justify-between mb-4 gap-2">
                <p className="text-xs sm:text-sm text-muted-foreground">Найдено товаров: {filtered.length}</p>
                <div className="flex sm:hidden h-8 bg-card border border-border rounded-lg overflow-hidden">
                  <button
                    type="button"
                    aria-label="Сетка"
                    onClick={() => setViewMode('grid')}
                    className={`px-2.5 flex items-center justify-center transition-colors ${viewMode === 'grid' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                  >
                    <LayoutGrid className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    aria-label="Список"
                    onClick={() => setViewMode('list')}
                    className={`px-2.5 flex items-center justify-center border-l border-border transition-colors ${viewMode === 'list' ? 'bg-primary/10 text-primary' : 'text-muted-foreground'}`}
                  >
                    <List className="w-4 h-4" />
                  </button>
                </div>
              </div>
              {viewMode === 'list' ? (
                <div className="flex flex-col gap-3">
                  {filtered.map(product => <ProductCard key={product.id} product={product} view="list" />)}
                </div>
              ) : (
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-3 sm:gap-4">
                  {filtered.map(product => <ProductCard key={product.id} product={product} />)}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default Catalog;
