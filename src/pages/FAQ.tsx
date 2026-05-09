import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Search, ChevronDown, ChevronUp, Headphones, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useStorefront, useStorefrontPath } from '@/contexts/StorefrontContext';
import { useProducts } from '@/hooks/useProducts';

const FAQ = () => {
  const { shopName, supportLink } = useStorefront();
  const buildPath = useStorefrontPath();
  const name = shopName || 'Магазин';
  const [search, setSearch] = useState('');
  const [openItems, setOpenItems] = useState<string[]>([]);
  const { data: allProducts } = useProducts();
  const featured = (allProducts || [])
    .filter(p => p.is_featured || p.is_popular || p.is_new)
    .slice(0, 8);
  const showcase = featured.length ? featured : (allProducts || []).slice(0, 8);

  const faqData = [
    {
      category: 'Общие вопросы',
      items: [
        { q: `Что такое ${name}?`, a: `${name} — это премиум маркетплейс цифровых товаров, работающий как Telegram Mini App. Здесь вы можете приобрести лицензионные ключи, подписки, аккаунты и другие цифровые продукты с мгновенной доставкой.` },
        { q: `Безопасно ли покупать на ${name}?`, a: 'Да. Все товары проходят проверку перед размещением. Оплата осуществляется через проверенный платёжный сервис CryptoBot. На каждый товар действует гарантия замены или возврата.' },
        { q: 'Нужна ли регистрация?', a: 'Нет. Авторизация происходит автоматически через ваш Telegram-аккаунт при открытии Mini App. Отдельная регистрация не требуется.' },
      ],
    },
    {
      category: 'Заказы и доставка',
      items: [
        { q: 'Как быстро доставка?', a: 'Товары с мгновенной доставкой передаются автоматически сразу после подтверждения оплаты. Товары с ручной доставкой обрабатываются в течение 1–24 часов.' },
        { q: 'Как я получу свой товар?', a: 'Данные доступа (ключи, логин/пароль, коды) отображаются в разделе «Мои заказы» в вашем профиле. Также вы получите уведомление через Telegram-бота.' },
        { q: 'Что означают статусы заказа?', a: '«Ожидание оплаты» — инвойс создан, ждём оплату. «Оплачен» — оплата подтверждена. «Завершён» — товар передан. «Отменён» — заказ отменён или инвойс истёк.' },
      ],
    },
    {
      category: 'Оплата',
      items: [
        { q: 'Как оплатить заказ?', a: 'Оплата производится через CryptoBot — платёжный сервис в Telegram, поддерживающий криптовалюту (BTC, ETH, USDT, TON и др.). Также можно оплатить частично или полностью с внутреннего баланса.' },
        { q: 'Что такое баланс и как его пополнить?', a: 'Баланс — это внутренний авансовый счёт. Его можно пополнить через CryptoBot в разделе «Профиль». Средства баланса используются для оплаты заказов.' },
        { q: 'Можно ли совмещать баланс и CryptoBot?', a: 'Да. Сначала применяется скидка по промокоду, затем списываются средства баланса, а оставшаяся сумма оплачивается через CryptoBot. Если баланса достаточно — инвойс не создаётся.' },
        { q: 'Что если я не оплатил инвойс?', a: 'Если инвойс CryptoBot не оплачен или истёк, заказ автоматически отменяется. Если были списаны средства с баланса — они возвращаются автоматически.' },
      ],
    },
    {
      category: 'Промокоды и скидки',
      items: [
        { q: 'Как использовать промокод?', a: 'Введите промокод на странице оформления заказа. Скидка применится автоматически к итоговой сумме. Промокоды могут иметь ограничения по сроку и количеству использований.' },
        { q: 'Можно ли совместить промокод со скидкой?', a: 'Промокод применяется к текущей цене товара (уже с учётом указанной скидки, если она есть).' },
      ],
    },
    {
      category: 'Возвраты и гарантия',
      items: [
        { q: 'Можно ли получить возврат?', a: 'Да, в рамках гарантийного периода, указанного на странице товара. Если товар не соответствует описанию или не работает — обратитесь в поддержку с номером заказа.' },
        { q: 'Как работает замена?', a: 'Приоритет имеет замена товара. Если подходящая замена доступна, она предоставляется бесплатно. Если замена невозможна — средства возвращаются на баланс.' },
        { q: 'Что не покрывается гарантией?', a: 'Гарантия не распространяется на товары, заблокированные по вине пользователя, использованные не по назначению или с нарушением инструкций, а также на обращения после истечения гарантийного периода.' },
      ],
    },
    {
      category: 'Отзывы',
      items: [
        { q: 'Как оставить отзыв?', a: 'Отзыв можно оставить на странице товара после покупки. Все отзывы проходят модерацию перед публикацией.' },
        { q: 'Почему мой отзыв не отображается?', a: 'Отзыв может быть на модерации. Если отзыв отклонён, это означает, что он нарушает правила (спам, недостоверная информация, нецензурная лексика).' },
      ],
    },
  ];

  const toggle = (key: string) => {
    setOpenItems(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);
  };

  const filtered = faqData.map(cat => ({
    ...cat,
    items: cat.items.filter(i => !search || i.q.toLowerCase().includes(search.toLowerCase()) || i.a.toLowerCase().includes(search.toLowerCase())),
  })).filter(cat => cat.items.length > 0);

  const resolvedSupportLink = supportLink;

  return (
    <div className="container-main mx-auto px-4 py-6 sm:py-8">
      <div className="text-center mb-8 sm:mb-10">
        <h1 className="font-display text-2xl sm:text-3xl md:text-4xl font-bold">Часто задаваемые вопросы</h1>
        <p className="text-muted-foreground text-sm mt-2">Ответы на популярные вопросы о {name}</p>
      </div>

      {showcase.length > 0 && (
        <section className="mb-10">
          <div className="flex items-end justify-between mb-4 max-w-5xl mx-auto">
            <div>
              <h2 className="font-display text-lg sm:text-xl font-bold">Подборка из каталога</h2>
              <p className="text-xs text-muted-foreground mt-0.5">Популярные товары прямо сейчас</p>
            </div>
            <Link to={buildPath('/catalog')} className="text-xs text-primary inline-flex items-center gap-1 hover:underline shrink-0">
              Весь каталог <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          <div className="flex gap-3 overflow-x-auto pb-3 scrollbar-hide snap-x snap-mandatory -mx-4 px-4">
            {showcase.map(p => {
              const discount = p.old_price ? Math.round((1 - Number(p.price) / Number(p.old_price)) * 100) : 0;
              return (
                <Link
                  key={p.id}
                  to={buildPath(`/product/${p.id}`)}
                  className="group w-40 sm:w-48 shrink-0 snap-start bg-card border border-border/50 rounded-xl overflow-hidden hover:border-primary/40 transition-colors"
                >
                  <div className="relative aspect-square bg-secondary/40 flex items-center justify-center overflow-hidden">
                    {p.image ? (
                      <img src={p.image} alt={p.title} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" />
                    ) : (
                      <span className="text-4xl">📦</span>
                    )}
                    {discount > 0 && (
                      <span className="absolute top-2 left-2 text-[10px] font-bold bg-destructive text-destructive-foreground px-1.5 py-0.5 rounded">
                        −{discount}%
                      </span>
                    )}
                  </div>
                  <div className="p-3">
                    <h3 className="text-xs sm:text-sm font-semibold line-clamp-2 min-h-[2.5rem]">{p.title}</h3>
                    <div className="mt-2 flex items-baseline gap-2">
                      <span className="text-sm font-bold">${Number(p.price).toFixed(2)}</span>
                      {p.old_price && (
                        <span className="text-[10px] text-muted-foreground line-through">${Number(p.old_price).toFixed(2)}</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      <div className="max-w-xl mx-auto mb-8 sm:mb-10">
        <div className="relative">
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input type="text" placeholder="Поиск по вопросам..." value={search} onChange={e => setSearch(e.target.value)}
            className="w-full h-11 sm:h-12 pl-11 pr-4 bg-card border border-border rounded-xl text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/50" />
        </div>
      </div>

      <div className="max-w-3xl mx-auto space-y-6 sm:space-y-8">
        {filtered.map(cat => (
          <div key={cat.category}>
            <h3 className="font-display font-semibold text-base sm:text-lg mb-3">{cat.category}</h3>
            <div className="space-y-2">
              {cat.items.map((item, i) => {
                const key = `${cat.category}-${i}`;
                const isOpen = openItems.includes(key);
                return (
                  <div key={key} className="bg-card border border-border/50 rounded-xl overflow-hidden">
                    <button onClick={() => toggle(key)}
                      className="w-full flex items-center justify-between px-4 sm:px-5 py-3 sm:py-4 text-left text-xs sm:text-sm font-medium hover:bg-secondary/30 transition-colors">
                      {item.q}
                      {isOpen ? <ChevronUp className="w-4 h-4 text-muted-foreground shrink-0 ml-2" /> : <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0 ml-2" />}
                    </button>
                    {isOpen && (
                      <div className="px-4 sm:px-5 pb-3 sm:pb-4 text-xs sm:text-sm text-muted-foreground border-t border-border/30 pt-3">
                        {item.a}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="text-center py-12">
            <div className="text-5xl mb-4">🔍</div>
            <h3 className="font-display font-semibold">Вопросы не найдены</h3>
            <p className="text-sm text-muted-foreground mt-1">Попробуйте другой поисковый запрос</p>
          </div>
        )}
      </div>

      {resolvedSupportLink && (
        <div className="text-center mt-10 sm:mt-12">
          <p className="text-muted-foreground text-sm">Не нашли ответ?</p>
          <a href={resolvedSupportLink} target="_blank" rel="noopener noreferrer"><Button variant="hero" className="mt-3"><Headphones className="w-4 h-4 mr-1" /> Связаться с поддержкой</Button></a>
        </div>
      )}
    </div>
  );
};

export default FAQ;
