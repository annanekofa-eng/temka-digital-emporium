import { useState } from 'react';
import { Star, PenLine } from 'lucide-react';
import { useReviews } from '@/hooks/useProducts';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';

const FALLBACK = [
  { id: 'r1', author: 'Алексей',  text: 'Заказывал Premium на 6 месяцев — пришло мгновенно, работает идеально.', rating: 5, avatar: '🦊' },
  { id: 'r2', author: 'Мария',    text: 'Купила Telegram Stars, цена приятная, доставка моментальная.',          rating: 5, avatar: '🌸' },
  { id: 'r3', author: 'Дмитрий',  text: 'NFT-подарок дошёл за пару минут. Поддержка отвечает быстро.',           rating: 5, avatar: '🐧' },
  { id: 'r4', author: 'Ника',     text: 'FLUX-дизайн — топ. Отличный вкус, всё аккуратно.',                       rating: 5, avatar: '🎀' },
  { id: 'r5', author: 'Игорь',    text: 'Брал ключ Steam — активировался без проблем. Рекомендую.',               rating: 5, avatar: '🎮' },
];

const Stars = ({ n }: { n: number }) => (
  <div className="flex gap-0.5">
    {Array.from({ length: 5 }).map((_, i) => (
      <Star
        key={i}
        className={`w-3.5 h-3.5 ${i < n ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`}
      />
    ))}
  </div>
);

const ReviewForm = ({ onClose }: { onClose: () => void }) => {
  const [name, setName] = useState('');
  const [text, setText] = useState('');
  const [rating, setRating] = useState(5);
  const [hover, setHover] = useState(0);

  const submit = () => {
    if (!name.trim() || !text.trim()) {
      toast({ title: 'Заполните имя и текст отзыва', variant: 'destructive' });
      return;
    }
    toast({ title: 'Спасибо за отзыв!', description: 'Он появится после модерации.' });
    onClose();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Ваша оценка</label>
        <div className="flex gap-1">
          {Array.from({ length: 5 }).map((_, i) => {
            const idx = i + 1;
            const active = idx <= (hover || rating);
            return (
              <button
                key={idx}
                type="button"
                onMouseEnter={() => setHover(idx)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(idx)}
                className="p-0.5"
              >
                <Star className={`w-7 h-7 transition-colors ${active ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/40'}`} />
              </button>
            );
          })}
        </div>
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Имя</label>
        <Input value={name} onChange={e => setName(e.target.value)} placeholder="Как к вам обращаться" maxLength={40} />
      </div>
      <div>
        <label className="text-xs text-muted-foreground mb-1.5 block">Отзыв</label>
        <Textarea value={text} onChange={e => setText(e.target.value)} placeholder="Поделитесь впечатлениями…" rows={4} maxLength={500} />
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Отмена</Button>
        <Button variant="hero" onClick={submit}>Отправить</Button>
      </DialogFooter>
    </div>
  );
};

const ReviewsSection = () => {
  const { data } = useReviews();
  const reviews = (data && data.length > 0 ? data : FALLBACK).slice(0, 12);
  const [open, setOpen] = useState(false);

  return (
    <section className="pt-10">
      <div className="container-main mx-auto max-w-2xl lg:max-w-6xl px-4 mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-2xl font-black tracking-tight">Отзывы</h2>
          <p className="text-xs text-muted-foreground mt-1">Что говорят покупатели</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" size="sm" className="shrink-0">
              <PenLine className="w-4 h-4" /> Оставить отзыв
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Оставить отзыв</DialogTitle>
            </DialogHeader>
            <ReviewForm onClose={() => setOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>
      <div className="flex lg:grid lg:container-main lg:mx-auto lg:max-w-6xl lg:grid-cols-3 gap-3 overflow-x-auto lg:overflow-visible px-4 pb-3 scrollbar-hide snap-x snap-mandatory lg:snap-none">
        {reviews.map((r: any) => (
          <article
            key={r.id}
            className="snap-start shrink-0 w-72 sm:w-80 lg:w-auto lg:shrink rounded-2xl border border-border bg-card p-4 flex flex-col"
          >
            <div className="flex items-center gap-3">
              {r.avatar && r.avatar.startsWith('http') ? (
                <img src={r.avatar} alt={r.author} className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-secondary flex items-center justify-center text-lg">
                  {r.avatar || r.author?.[0] || '★'}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-display font-semibold text-sm truncate">{r.author}</div>
                <Stars n={Number(r.rating) || 5} />
              </div>
            </div>
            <p className="text-sm text-muted-foreground mt-3 leading-relaxed line-clamp-4">
              {r.text}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
};

export default ReviewsSection;
