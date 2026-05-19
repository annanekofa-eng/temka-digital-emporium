import { useParams, Link, useNavigate } from 'react-router-dom';
import { useState } from 'react';
import { motion } from 'framer-motion';
import { ArrowLeft, ShoppingCart, Plus, Star, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { renderSpecialProduct } from '@/components/SpecialProductCards';
import logoFlux from '@/assets/logo-flux.jpg';
import logoCursor from '@/assets/logo-cursor.jpg';
import cursorNftGifts from '@/assets/cursor-nft-gifts.jpg';
import logoVieto from '@/assets/logo-vieto.jpg';

import { useProject, useProjectProducts, useProjectCategories, type ExtendedProduct } from '@/hooks/useShop';
import { useStore } from '@/contexts/StoreContext';
import { toast } from 'sonner';

const PROJECT_PHOTOS: Record<string, string> = {
  flux: logoFlux,
  cursor: logoCursor,
  vieto: logoVieto,
};

const SimpleProductCard = ({ product }: { product: ExtendedProduct }) => {
  const { addToCart } = useStore();
  return (
    <div className="rounded-2xl border border-border bg-card overflow-hidden flex flex-col">
      <div className="aspect-square bg-secondary flex items-center justify-center text-5xl">
        {product.image ? (
          <img src={product.image} alt={product.title} className="w-full h-full object-cover" loading="lazy" />
        ) : (
          <span>📦</span>
        )}
      </div>
      <div className="p-3 flex-1 flex flex-col">
        <h3 className="font-display font-semibold text-sm leading-tight line-clamp-2">{product.title}</h3>
        {product.subtitle && <p className="text-xs text-muted-foreground mt-1 line-clamp-1">{product.subtitle}</p>}
        <div className="mt-auto pt-3 flex items-center justify-between gap-2">
          <span className="font-display font-bold text-base">${Number(product.price).toFixed(2)}</span>
          <Button
            size="sm"
            onClick={() => {
              addToCart(product as any);
              toast.success('Добавлено в корзину');
            }}
          >
            <Plus className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};

// FLUX-style: list row, no image, title + price button
const FluxItemCard = ({ product }: { product: ExtendedProduct }) => {
  const { addToCart } = useStore();
  const navigate = useNavigate();
  return (
    <div className="rounded-2xl border border-border bg-card p-4 flex items-center gap-3">
      <button
        onClick={() => navigate(`/product/${product.id}`)}
        className="flex-1 min-w-0 text-left"
      >
        <h3 className="font-display font-semibold text-base leading-tight line-clamp-1">
          {product.title}
        </h3>
        {product.subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{product.subtitle}</p>
        )}
      </button>
      <Button
        size="sm"
        onClick={(e) => {
          e.stopPropagation();
          addToCart(product as any);
          toast.success('Добавлено в корзину');
        }}
        className="shrink-0 font-display font-bold"
      >
        ${Number(product.price).toFixed(0)}
      </Button>
    </div>
  );
};


// VIETO: no image on listing, click opens dialog with image/title/desc/price
const VietoItemCard = ({ product }: { product: ExtendedProduct }) => {
  const { addToCart } = useStore();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="rounded-2xl border border-border bg-card p-4 text-left hover:border-primary/50 transition-colors flex items-center gap-3"
      >
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-semibold text-base leading-tight line-clamp-1">{product.title}</h3>
          {product.subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{product.subtitle}</p>
          )}
        </div>
        <span className="shrink-0 font-display font-bold text-base">${Number(product.price).toFixed(0)}</span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm p-0 overflow-hidden">
          <div className="aspect-square bg-secondary flex items-center justify-center text-6xl">
            {product.image ? (
              <img src={product.image} alt={product.title} className="w-full h-full object-cover" />
            ) : (
              <span>👕</span>
            )}
          </div>
          <div className="p-4">
            <DialogHeader className="text-left space-y-1">
              <DialogTitle className="font-display text-xl">{product.title}</DialogTitle>
              {product.subtitle && (
                <DialogDescription className="text-sm">{product.subtitle}</DialogDescription>
              )}
            </DialogHeader>
            {product.description && (
              <p className="text-sm text-muted-foreground mt-3">{product.description}</p>
            )}
            <div className="mt-4 flex items-center justify-between gap-3">
              <span className="font-display font-black text-2xl">${Number(product.price).toFixed(2)}</span>
              <Button
                onClick={() => {
                  addToCart(product as any);
                  toast.success('Добавлено в корзину');
                  setOpen(false);
                }}
              >
                <ShoppingCart className="w-4 h-4 mr-2" /> В корзину
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
};

const renderProduct = renderSpecialProduct;


const CursorNftGiftsCard = () => {
  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-3 mb-3">
        <img
          src={cursorNftGifts}
          alt="NFT подарки"
          className="w-12 h-12 rounded-xl object-cover bg-black shrink-0"
          loading="lazy"
        />
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-base">NFT подарки</h3>
          <p className="text-xs text-muted-foreground line-clamp-1">
            Эксклюзивная коллекция в @CursorRobot
          </p>
        </div>
      </div>
      <a
        href="https://t.me/CursorRobot?start=ref_7912202824"
        target="_blank"
        rel="noopener noreferrer"
        className="block"
      >
        <Button className="w-full h-12 text-base">
          <Zap className="w-4 h-4 mr-2" />
          Открыть каталог
        </Button>
      </a>
    </div>
  );
};

const Project = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data: project, isLoading: pLoad } = useProject(id);
  const { data: products, isLoading: prLoad } = useProjectProducts(id);
  const { data: categories } = useProjectCategories(id);
  const [activeCat, setActiveCat] = useState<string | null>(null);

  const simple = (products || []).filter((p) => p.product_type === 'simple');
  const special = (products || []).filter((p) => p.product_type !== 'simple');

  const filteredSimple = activeCat ? simple.filter((p) => p.category_id === activeCat) : simple;

  if (pLoad) {
    return (
      <div className="px-4 py-6">
        <Skeleton className="h-10 w-40 mb-4" />
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="px-4 py-12 text-center">
        <p className="text-muted-foreground">Проект не найден</p>
        <Link to="/" className="text-primary text-sm">
          ← На главную
        </Link>
      </div>
    );
  }

  return (
    <div className="pb-8">
      {/* Header */}
      <section className="px-4 pt-4 pb-6">
        <div className="container-main mx-auto max-w-2xl">
          <button
            onClick={() => navigate('/')}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-4"
          >
            <ArrowLeft className="w-4 h-4" /> На главную
          </button>
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl overflow-hidden border border-border bg-card"
          >
            {(() => {
              const photo = project.banner || PROJECT_PHOTOS[project.id];
              return photo ? (
                <div className="bg-secondary">
                  <img src={photo} alt={project.title} className="w-full h-auto object-contain" />
                </div>
              ) : (
                <div className="aspect-square bg-gradient-to-br from-secondary to-muted flex items-center justify-center text-7xl">
                  {project.icon}
                </div>
              );
            })()}
            <div className="p-5">
              <div className="flex items-center gap-3">
                <span className="text-3xl">{project.icon}</span>
                <h1 className="font-display text-3xl font-black tracking-tight">{project.title}</h1>
              </div>
              {project.subtitle && (
                <p className="text-muted-foreground mt-2">{project.subtitle}</p>
              )}
              {project.description && (
                <p className="text-sm text-muted-foreground/80 mt-2">{project.description}</p>
              )}
            </div>
          </motion.div>
        </div>
      </section>

      <div className="container-main mx-auto max-w-2xl px-4 space-y-6">
        {/* Cursor: bespoke NFT gifts card */}
        {project.id === 'cursor' && <CursorNftGiftsCard />}

        {/* Special products (premium / stars) */}
        {special.length > 0 && (
          <section>
            <h2 className="font-display text-lg font-bold mb-3 px-1">Специальные товары</h2>
            <div className="grid gap-3">{special.map(renderProduct)}</div>
          </section>
        )}

        {/* Categories filter (hidden for vieto: uses sections) */}
        {project.id !== 'vieto' && categories && categories.length > 0 && (
          <div className="flex gap-2 overflow-x-auto scrollbar-hide -mx-1 px-1">
            <button
              onClick={() => setActiveCat(null)}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                !activeCat ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary border-border'
              }`}
            >
              Все
            </button>
            {categories.map((c: any) => (
              <button
                key={c.id}
                onClick={() => setActiveCat(c.id)}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                  activeCat === c.id ? 'bg-primary text-primary-foreground border-primary' : 'bg-secondary border-border'
                }`}
              >
                <span className="mr-1">{c.icon}</span>
                {c.name}
              </button>
            ))}
          </div>
        )}

        {/* Simple products */}
        {prLoad ? (
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-2xl" />
            ))}
          </div>
        ) : project.id === 'vieto' && categories && categories.length > 0 ? (
          activeCat ? (
            (() => {
              const cat = categories.find((c: any) => c.id === activeCat);
              const items = simple.filter((p) => p.category_id === activeCat);
              return (
                <section>
                  <button
                    onClick={() => setActiveCat(null)}
                    className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-primary mb-3"
                  >
                    <ArrowLeft className="w-4 h-4" /> Все категории
                  </button>
                  <div className="relative overflow-hidden rounded-2xl border border-border mb-3 h-24 sm:h-28 flex items-center px-4 bg-gradient-to-br from-primary/30 via-secondary to-card">
                    <div className="absolute inset-y-0 right-0 w-1/2 flex items-center justify-end pr-4 text-7xl opacity-40 select-none">
                      {cat?.icon}
                    </div>
                    <div className="relative z-10">
                      <h2 className="font-display text-xl font-black tracking-tight">{cat?.name}</h2>
                      {cat?.description && (
                        <p className="text-xs text-muted-foreground mt-0.5 max-w-[60%] line-clamp-2">{cat.description}</p>
                      )}
                      <span className="text-[10px] text-muted-foreground/80">{items.length} товаров</span>
                    </div>
                  </div>
                  <div className="grid gap-2">
                    {items.map((p) => (
                      <VietoItemCard key={p.id} product={p} />
                    ))}
                  </div>
                </section>
              );
            })()
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {categories.map((c: any) => {
                const count = simple.filter((p) => p.category_id === c.id).length;
                return (
                  <button
                    key={c.id}
                    onClick={() => setActiveCat(c.id)}
                    className="relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-primary/20 via-secondary to-card p-4 h-32 flex flex-col justify-between text-left hover:border-primary/50 transition-colors"
                  >
                    <span className="absolute -right-2 -bottom-2 text-6xl opacity-30 select-none">{c.icon}</span>
                    <div className="relative z-10">
                      <h2 className="font-display text-base font-black tracking-tight leading-tight">{c.name}</h2>
                      {c.description && (
                        <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{c.description}</p>
                      )}
                    </div>
                    <span className="relative z-10 text-[10px] text-muted-foreground/80">{count} товаров</span>
                  </button>
                );
              })}
            </div>
          )
        ) : filteredSimple.length > 0 ? (
          <section>
            <h2 className="font-display text-lg font-bold mb-3 px-1">Каталог</h2>
            {project.id === 'flux' ? (
              <div className="grid gap-2">
                {filteredSimple.map((p) => (
                  <FluxItemCard key={p.id} product={p} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {filteredSimple.map((p) => (
                  <SimpleProductCard key={p.id} product={p} />
                ))}
              </div>
            )}
          </section>
        ) : null}

        {special.length === 0 && simple.length === 0 && (
          <div className="text-center py-12 text-muted-foreground">
            <Star className="w-8 h-8 mx-auto mb-2 opacity-40" />
            <p>Товары скоро появятся</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default Project;
