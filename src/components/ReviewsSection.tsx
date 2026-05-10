import { Star } from 'lucide-react';
import { useReviews } from '@/hooks/useProducts';

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
        className={`w-3.5 h-3.5 ${i < n ? 'fill-gold text-gold' : 'text-muted-foreground/40'}`}
      />
    ))}
  </div>
);

const ReviewsSection = () => {
  const { data } = useReviews();
  const reviews = (data && data.length > 0 ? data : FALLBACK).slice(0, 12);

  return (
    <section className="pt-10">
      <div className="container-main mx-auto max-w-2xl px-4 mb-4">
        <h2 className="font-display text-2xl font-black tracking-tight">Отзывы</h2>
        <p className="text-xs text-muted-foreground mt-1">Что говорят покупатели</p>
      </div>
      <div className="flex gap-3 overflow-x-auto px-4 pb-3 scrollbar-hide snap-x snap-mandatory">
        {reviews.map((r: any) => (
          <article
            key={r.id}
            className="snap-start shrink-0 w-72 sm:w-80 rounded-2xl border border-border bg-card p-4 flex flex-col"
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
