import { useState } from 'react';
import { motion } from 'framer-motion';
import { Flame, HelpCircle, X } from 'lucide-react';
import { Dialog, DialogContent, DialogClose } from '@/components/ui/dialog';
import { useSiteSettings } from '@/hooks/useShop';
import casePencil from '@/assets/case-pencil.jpg';
import casePalette from '@/assets/case-palette.jpg';
import caseOrganizer from '@/assets/case-organizer.jpg';
import caseBusiness from '@/assets/case-business.jpg';

interface Case {
  id: string;
  title: string;
  short: string;
  full: string;
  price: number;
  oldPrice: number;
  image: string;
  hit?: boolean;
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

const CaseCard = ({ c, i, onOpen }: { c: Case; i: number; onOpen: () => void }) => (
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

const CasesSection = () => {
  const [openCase, setOpenCase] = useState<Case | null>(null);
  const { data: settings } = useSiteSettings();
  const supportUser = (settings?.support_username || 'TeleStoreHelp').replace('@', '');
  const supportUrl = `https://t.me/${supportUser}`;

  return (
    <section className="pt-8">
      <div className="container-main mx-auto max-w-2xl lg:max-w-6xl px-4">
        <h2 className="font-display text-2xl font-black tracking-tight mb-5 px-1">Наши кейсы</h2>
      </div>
      {/* Mobile/Tablet: horizontal snap scroll */}
      <div className="lg:hidden flex gap-4 overflow-x-auto px-4 pb-4 scrollbar-hide snap-x snap-mandatory">
        {CASES.map((c, i) => (
          <div key={c.id} className="w-[75%] sm:w-[320px] shrink-0 snap-center">
            <CaseCard c={c} i={i} onOpen={() => setOpenCase(c)} />
          </div>
        ))}
      </div>
      {/* Desktop: 3-col grid */}
      <div className="hidden lg:grid container-main mx-auto max-w-6xl px-4 grid-cols-3 gap-5">
        {CASES.map((c, i) => (
          <CaseCard key={c.id} c={c} i={i} onOpen={() => setOpenCase(c)} />
        ))}
      </div>

      <Dialog open={!!openCase} onOpenChange={(o) => !o && setOpenCase(null)}>
        <DialogContent className="p-0 border-border bg-card overflow-hidden w-[calc(100vw-1rem)] sm:w-full max-w-3xl max-h-[92svh] sm:max-h-[88vh] [&>button]:hidden flex flex-col rounded-2xl">
          {openCase && (
            <>
              {/* Custom larger close button */}
              <DialogClose
                aria-label="Закрыть"
                className="absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-background/80 backdrop-blur border border-border text-foreground hover:bg-background transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <X className="h-5 w-5" />
              </DialogClose>

              <div className="grid grid-cols-1 md:grid-cols-2 overflow-y-auto">
                <div className="aspect-[4/3] md:aspect-square bg-black flex items-center justify-center shrink-0 overflow-hidden">
                  <img src={openCase.image} alt={openCase.title} className="w-full h-full object-cover" />
                </div>

                <div className="p-5 sm:p-8 flex flex-col gap-4">
                  <h3 className="font-display text-2xl font-black pr-10">{openCase.title}</h3>
                  <div className="flex items-baseline gap-3">
                    <span className="text-xl font-bold">{openCase.price} ₽</span>
                    <span className="text-sm text-muted-foreground line-through">{openCase.oldPrice} ₽</span>
                  </div>
                  <a
                    href={`${supportUrl}?text=${encodeURIComponent(
                      `Здравствуйте! Хочу оформить кейс «${openCase.title}» за ${openCase.price} ₽. Подскажите, как оплатить?`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="self-start px-5 py-2.5 rounded-lg bg-foreground text-background text-sm font-semibold hover:opacity-90 transition-opacity"
                  >
                    Приобрести сейчас
                  </a>
                  <p className="text-sm text-muted-foreground leading-relaxed">{openCase.full}</p>
                  <div className="mt-auto pt-3 border-t border-border/60">
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
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default CasesSection;
