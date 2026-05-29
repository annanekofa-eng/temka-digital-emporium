import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Flame, HelpCircle, X, Sparkles, Zap } from 'lucide-react';
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog';
import { useSiteSettings } from '@/hooks/useShop';
import casePencil from '@/assets/case-pencil.jpg';
import casePalette from '@/assets/case-palette.jpg';
import caseOrganizer from '@/assets/case-organizer.jpg';
import caseBusiness from '@/assets/case-business.png';

interface Case {
  id: string;
  title: string;
  short: string;
  full: string;
  price: number;
  oldPrice: number;
  image: string;
  hit?: boolean;
  featured?: boolean;
  spotsLeft?: number;
}

const CASES: Case[] = [
  {
    id: 'standard',
    title: 'Стандарт',
    short: 'В кейс входит базовая упаковка и стартовое продвижение',
    full: 'При покупке кейса студия дизайна делает вам Фирменный логотип (3D и 2D), 3 статичных баннера. Накручиваем до 1000 реакций / просмотров / подписчиков.',
    price: 2589,
    oldPrice: 3100,
    image: casePencil,
  },
  {
    id: 'business',
    title: 'Бизнес под ключ',
    short: 'Коллаборация TeleStore × Hustlify — антикризисный пакет для предпринимателей',
    full: 'Коллаборация TeleStore × Hustlify — антикризисный пакет для предпринимателей, чей бизнес не приносит денег или встал на месте.\n\nЧто вы получаете:\n· Готовый бот-магазин с Mini App в TeleStore на 2 месяца — 0 ₽\n· Личного куратора по трафику, продажам и ведению\n· Полное оформление проекта (аватарка, логотип, баннеры)\n· Контент-план для канала и витрины\n· Бесплатные товары на реализацию + база поставщиков\n\nКак это работает:\nВами занимаются профессионалы. Вы просто наблюдаете за ростом бизнеса и перестаёте тратить нервы на вопрос «почему нет продаж?».',
    price: 3490,
    oldPrice: 14900,
    image: caseBusiness,
    featured: true,
    spotsLeft: 7,
  },
  {
    id: 'extended',
    title: 'Расширенный',
    short: 'В кейс входит полное оформление и помощь в продвижении',
    full: 'При покупке кейса студия дизайна делает вам Фирменный логотип, 3 статичных баннера, мини-лендинг. Накручиваем до 5000 реакций / просмотров / подписчиков. Выдаём план продвижения с выходом на доход в конце месяца.',
    price: 3289,
    oldPrice: 4000,
    image: casePalette,
    hit: true,
  },
  {
    id: 'premium',
    title: 'Премиум',
    short: 'Полностью выстраиваем систему. Выходим на крупные платформы. Полное оформление',
    full: 'При покупке кейса студия дизайна делает вам Фирменный логотип, 4 статичных баннера, лендинг, 5 уникальных постов. Накручиваем до 10000 реакций / просмотров / подписчиков.',
    price: 4289,
    oldPrice: 5500,
    image: caseOrganizer,
  },
];

const CaseCard = ({ c, i, onOpen }: { c: Case; i: number; onOpen: () => void }) => {
  if (c.featured) {
    return (
      <motion.button
        type="button"
        onClick={onOpen}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: i * 0.08, duration: 0.4 }}
        className="group relative w-full text-left cursor-pointer focus-visible:outline-none animate-[neon-pulse_2.2s_ease-in-out_infinite]"
        style={{ willChange: 'filter' }}
      >
        {/* Solid white neon border — glow stays OUTSIDE the card */}
        <div className="relative rounded-[1.25rem] p-[1.5px] bg-white shadow-[0_0_0_1px_rgba(255,255,255,0.9),0_0_18px_2px_rgba(255,255,255,0.55),0_0_42px_6px_rgba(255,255,255,0.25)]">
          <div className="relative flex flex-col rounded-[calc(1.25rem-1.5px)] bg-card overflow-hidden">
            <div className="relative aspect-square bg-black flex items-center justify-center overflow-hidden">
              <img
                src={c.image}
                alt={c.title}
                className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                loading="lazy"
              />
              {/* Top gradient veil for badge legibility */}
              <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-black/70 to-transparent" />
              {/* Bottom gradient veil */}
              <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black via-black/60 to-transparent" />

              {/* TOP-LEFT: spots left urgency badge */}
              {c.spotsLeft !== undefined && (
                <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-white text-black text-[10px] font-black uppercase tracking-wider rounded-full px-2.5 py-1 shadow-[0_0_14px_rgba(255,255,255,0.5)]">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full rounded-full bg-black opacity-60 animate-ping" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-black" />
                  </span>
                  Осталось {c.spotsLeft} мест
                </div>
              )}

              {/* TOP-RIGHT: collab badge */}
              <div className="absolute top-3 right-3 flex items-center gap-1 bg-white/10 backdrop-blur border border-white/30 text-white text-[10px] font-black uppercase tracking-wider rounded-full px-2.5 py-1">
                <Sparkles className="w-3 h-3" />
                Коллаборация
              </div>

              {/* Title overlay on image */}
              <div className="absolute inset-x-0 bottom-0 p-4 z-10">
                <div className="flex items-center gap-1.5 mb-1.5">
                  <Zap className="w-3.5 h-3.5 text-white fill-white" />
                  <span className="text-[10px] font-bold uppercase tracking-[0.15em] text-white/90">
                    <a
                      href="https://t.me/tele_store_robot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="hover:underline"
                      onClick={(e) => e.stopPropagation()}
                    >
                      TeleStore
                    </a>
                    {' × Hustlify'}
                  </span>
                </div>
                <h3 className="font-display text-2xl font-black tracking-tight text-white leading-tight">
                  {c.title}
                </h3>
              </div>
            </div>

            <div className="p-4 flex flex-col gap-3 bg-card">
              <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">{c.short}</p>
              <div className="flex items-baseline gap-2">
                <span className="text-xl font-black text-foreground">
                  {c.price.toLocaleString('ru')} ₽
                </span>
                <span className="text-xs text-muted-foreground line-through">
                  {c.oldPrice.toLocaleString('ru')} ₽
                </span>
                <span className="ml-auto text-[10px] font-black uppercase tracking-wider text-foreground/70">
                  −{Math.round((1 - c.price / c.oldPrice) * 100)}%
                </span>
              </div>
              <span className="self-stretch text-center px-4 py-2.5 rounded-lg bg-white text-black text-xs font-black uppercase tracking-wider transition-transform group-hover:scale-[1.02]">
                Забрать место →
              </span>
            </div>
          </div>
        </div>
      </motion.button>
    );
  }

  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: i * 0.08, duration: 0.4 }}
      className="relative flex flex-col rounded-2xl border border-border bg-card overflow-hidden text-left w-full hover:border-primary/40 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
    >
      <div className="relative aspect-square bg-black flex items-center justify-center overflow-hidden">
        <img src={c.image} alt={c.title} className="w-full h-full object-cover" loading="lazy" />

        {c.hit && (
          <div className="absolute top-3 right-3 flex items-center gap-1 bg-orange-500 text-white text-[10px] font-bold rounded-full px-2.5 py-1">
            <Flame className="w-3 h-3" />
            Хит продаж
          </div>
        )}
      </div>
      <div className="p-4 flex flex-col gap-2">
        <h3 className="font-display text-lg font-bold tracking-tight">{c.title}</h3>
        <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">{c.short}</p>
        <div className="flex items-baseline gap-2">
          <span className="text-base font-bold">{c.price} ₽</span>
          <span className="text-xs text-muted-foreground line-through">{c.oldPrice} ₽</span>
        </div>
        <span className="mt-2 self-start px-4 py-2 rounded-lg bg-foreground text-background text-xs font-semibold">
          Подробнее
        </span>
      </div>
    </motion.button>
  );
};

const CasesSection = () => {
  const [openCase, setOpenCase] = useState<Case | null>(null);
  const { data: settings } = useSiteSettings();
  const supportUser = (settings?.support_username || 'TeleStoreHelp').replace('@', '');
  const supportUrl = `https://t.me/${supportUser}`;

  const renderWithTeleStoreLink = (text: string) => {
    const parts = text.split('TeleStore');
    if (parts.length === 1) return text;
    return parts.map((part, i) => (
      <span key={i}>
        {part}
        {i < parts.length - 1 && (
          <a
            href="https://t.me/tele_store_robot"
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary font-medium hover:underline"
          >
            TeleStore
          </a>
        )}
      </span>
    ));
  };

  return (
    <section className="pt-8">
      <div className="container-main mx-auto max-w-2xl lg:max-w-6xl px-4">
        <h2 className="font-display text-2xl font-black tracking-tight mb-5 px-1">Наши кейсы</h2>
      </div>
      {/* Mobile/Tablet: horizontal snap scroll */}
      <div className="lg:hidden flex gap-4 overflow-x-auto px-4 pt-4 pb-8 scrollbar-hide snap-x snap-mandatory">
        {CASES.map((c, i) => (
          <div
            key={c.id}
            className={`${c.featured ? 'w-[82%] sm:w-[340px]' : 'w-[75%] sm:w-[320px]'} shrink-0 snap-center`}
          >
            <CaseCard c={c} i={i} onOpen={() => setOpenCase(c)} />
          </div>
        ))}
      </div>
      {/* Desktop: 4-col grid */}
      <div className="hidden lg:grid container-main mx-auto max-w-6xl px-4 grid-cols-4 gap-6 pt-4 pb-4">
        {CASES.map((c, i) => (
          <CaseCard key={c.id} c={c} i={i} onOpen={() => setOpenCase(c)} />
        ))}
      </div>

      <Dialog open={!!openCase} onOpenChange={(o) => !o && setOpenCase(null)}>
        <DialogContent className="p-0 border-0 outline-none ring-0 shadow-none bg-card overflow-hidden w-[calc(100vw-1rem)] sm:w-full max-w-3xl max-h-[92svh] sm:max-h-[88vh] [&>button.absolute]:hidden flex flex-col rounded-2xl [-webkit-tap-highlight-color:transparent] focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0">
          {openCase && (
            <>
              <div className="absolute right-3 top-3 z-30">
                <DialogClose
                  aria-label="Закрыть"
                  className="flex h-10 w-10 items-center justify-center rounded-full bg-black/80 backdrop-blur border border-white/30 text-white hover:bg-black transition-colors focus:outline-none focus:ring-2 focus:ring-white shadow-lg"
                >
                  <X className="h-5 w-5" strokeWidth={2.5} />
                </DialogClose>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 flex-1 min-h-0 md:overflow-y-auto">
                {/* Image — compact hero on mobile, square on desktop */}
                <div className="relative aspect-[16/10] md:aspect-square bg-black shrink-0 overflow-hidden">
                  <img
                    src={openCase.image}
                    alt={openCase.title}
                    className="w-full h-full object-cover"
                  />
                  <div className="md:hidden absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-card via-card/70 to-transparent" />
                  {openCase.featured && openCase.spotsLeft !== undefined && (
                    <div className="md:hidden absolute top-3 left-3 flex items-center gap-1.5 bg-white text-black text-[10px] font-black uppercase tracking-wider rounded-full px-2.5 py-1">
                      <span className="relative flex h-1.5 w-1.5">
                        <span className="absolute inline-flex h-full w-full rounded-full bg-black opacity-60 animate-ping" />
                        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-black" />
                      </span>
                      Осталось {openCase.spotsLeft} мест
                    </div>
                  )}
                </div>

                {/* Content — solid bg-card, scrollable */}
                <div className="relative flex flex-col bg-card min-h-0">
                  <div className="flex-1 overflow-y-auto p-5 sm:p-8 flex flex-col gap-3 sm:gap-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] md:pb-8">
                    {openCase.featured && openCase.spotsLeft !== undefined && (
                      <div className="hidden md:flex self-start items-center gap-1.5 bg-white text-black text-[10px] font-black uppercase tracking-wider rounded-full px-2.5 py-1">
                        <span className="relative flex h-1.5 w-1.5">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-black opacity-60 animate-ping" />
                          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-black" />
                        </span>
                        Осталось {openCase.spotsLeft} мест
                      </div>
                    )}

                    <h3 className="font-display text-xl sm:text-2xl font-black leading-tight pr-10">
                      {openCase.title}
                    </h3>

                    <div className="flex items-baseline gap-2.5 flex-wrap">
                      <span className="text-2xl sm:text-xl font-black sm:font-bold">
                        {openCase.price.toLocaleString('ru')} ₽
                      </span>
                      <span className="text-sm text-muted-foreground line-through">
                        {openCase.oldPrice.toLocaleString('ru')} ₽
                      </span>
                      {openCase.featured && (
                        <span className="ml-auto text-[10px] font-black uppercase tracking-wider text-foreground/70">
                          −{Math.round((1 - openCase.price / openCase.oldPrice) * 100)}%
                        </span>
                      )}
                    </div>

                    <a
                      href="https://t.me/telestoretestbot"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="group relative flex items-center justify-center overflow-hidden rounded-xl border border-white/70 bg-white/5 hover:bg-white/10 px-4 pt-2 pb-3 min-h-[2.75rem] shadow-[0_0_18px_rgba(255,255,255,0.25)] transition-colors"
                    >
                      <div className="relative z-10 flex items-center justify-center gap-2 whitespace-nowrap leading-none">
                        <span className="relative flex h-2 w-2 shrink-0">
                          <span className="absolute inline-flex h-full w-full rounded-full bg-white opacity-70 animate-ping" />
                          <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
                        </span>
                        <span className="text-sm font-black uppercase tracking-wider text-white leading-none">
                          Пример магазина
                        </span>
                        <span className="text-sm font-bold text-white leading-none group-hover:translate-x-0.5 transition-transform">→</span>
                      </div>
                    </a>

                    <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">
                      {renderWithTeleStoreLink(openCase.full)}
                    </p>

                    <div className="mt-auto pt-4 border-t border-border/60">
                      <p className="text-xs text-muted-foreground flex items-start gap-2">
                        <HelpCircle className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                        <span>
                          Что-то непонятно по кейсу?{' '}
                          <a
                            href={supportUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-primary font-medium hover:underline"
                          >
                            Напишите в поддержку
                          </a>{' '}
                          — поможем разобраться.
                        </span>
                      </p>
                    </div>
                  </div>

                  {/* Mobile sticky CTA */}
                  <div className="md:hidden absolute inset-x-0 bottom-0 px-4 pt-3 bg-gradient-to-t from-card via-card to-card/95 border-t border-border/60 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
                    <a
                      href={`https://t.me/${openCase.id === 'business' ? 'HustlifyHelp' : supportUser}?text=${encodeURIComponent(
                        `Здравствуйте! Хочу оформить кейс «${openCase.title}» за ${openCase.price} ₽. Подскажите, как оплатить?`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={
                        openCase.featured
                          ? 'block w-full text-center px-5 py-3.5 rounded-xl bg-white text-black text-sm font-black uppercase tracking-wider active:scale-[0.98] transition-transform'
                          : 'block w-full text-center px-5 py-3.5 rounded-xl bg-foreground text-background text-sm font-bold active:scale-[0.98] transition-transform'
                      }
                    >
                      {openCase.featured ? 'Забрать место →' : 'Приобрести сейчас'}
                    </a>
                  </div>

                  {/* Desktop CTA */}
                  <div className="hidden md:block px-8 pb-8">
                    <a
                      href={`https://t.me/${openCase.id === 'business' ? 'HustlifyHelp' : supportUser}?text=${encodeURIComponent(
                        `Здравствуйте! Хочу оформить кейс «${openCase.title}» за ${openCase.price} ₽. Подскажите, как оплатить?`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={
                        openCase.featured
                          ? 'inline-block px-5 py-2.5 rounded-lg bg-white text-black text-sm font-black uppercase tracking-wider hover:opacity-90 transition-opacity'
                          : 'inline-block px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-opacity'
                      }
                    >
                      {openCase.featured ? 'Забрать место' : 'Приобрести сейчас'}
                    </a>
                  </div>
                </div>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default CasesSection;
