import { Shield, Zap, Star, Users, Package, CheckCircle2, MessageCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { useShopStats } from '@/hooks/useProducts';
import { Skeleton } from '@/components/ui/skeleton';
import { useStorefront, useStorefrontPath } from '@/contexts/StorefrontContext';
import cryptobotLogo from '@/assets/cryptobot-logo.jpeg';

const About = () => {
  const { shopName } = useStorefront();
  const buildPath = useStorefrontPath();
  const name = shopName || 'Магазин';

  const stats = useShopStats();

  return (
    <div className="container-main mx-auto px-4 py-8 sm:py-12">
      <div className="text-center mb-10 sm:mb-14">
        <h1 className="font-display text-3xl sm:text-4xl md:text-5xl font-bold">О {name}</h1>
        <p className="text-muted-foreground text-sm sm:text-base mt-4 max-w-2xl mx-auto leading-relaxed">
          Премиум маркетплейс цифровых товаров в Telegram. Мгновенная доставка, оплата криптовалютой через CryptoBot, гарантия качества на каждый товар.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 sm:gap-6 mb-12 sm:mb-16">
        {[
          { icon: Shield, title: 'Надёжная платформа', desc: 'Все товары проверяются перед размещением. Платежи защищены через CryptoBot — проверенный платёжный сервис в Telegram.' },
          { icon: Zap, title: 'Мгновенная доставка', desc: 'Цифровые товары доставляются автоматически сразу после подтверждения оплаты. Данные доступа — в личном кабинете.' },
          { icon: Star, title: 'Гарантия и поддержка', desc: 'На каждый товар действует гарантия. Поддержка через Telegram решает вопросы оперативно.' },
        ].map((item, i) => (
          <div key={i} className="bg-card border border-border/50 rounded-2xl p-6 sm:p-8 text-center">
            <item.icon className="w-8 h-8 sm:w-10 sm:h-10 text-primary mx-auto mb-4" />
            <h3 className="font-display font-semibold text-base sm:text-lg mb-2">{item.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>

      <div className="max-w-3xl mx-auto space-y-6">
        <h2 className="font-display text-2xl sm:text-3xl font-bold">Как это работает</h2>
        <div className="space-y-3">
          {[
            'Откройте магазин в Telegram как Mini App',
            'Выберите товары в каталоге и добавьте в корзину',
            'Примените промокод или используйте баланс для скидки',
            'Оплатите через CryptoBot (криптовалюта) или с баланса',
            'Получите данные доступа мгновенно в личном кабинете',
          ].map((step, i) => (
            <div key={i} className="flex items-start gap-3 p-3 bg-card border border-border/50 rounded-xl">
              <span className="w-6 h-6 rounded-full bg-primary/20 text-primary flex items-center justify-center text-xs font-bold shrink-0">{i + 1}</span>
              <p className="text-sm text-muted-foreground">{step}</p>
            </div>
          ))}
        </div>

        <div className="flex items-center justify-center gap-3 py-4">
          <span className="text-xs text-muted-foreground">Принимаем оплату через</span>
          <img src={cryptobotLogo} alt="CryptoBot" className="w-6 h-6 rounded-md" />
          <span className="text-xs font-medium">CryptoBot</span>
        </div>

        {/* Dynamic stats — hidden when no data per data-visibility-policy */}
        {stats.isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-8">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="text-center space-y-2">
                <Skeleton className="h-8 w-16 mx-auto" />
                <Skeleton className="h-4 w-20 mx-auto" />
              </div>
            ))}
          </div>
        ) : stats.data && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 py-8">
            <div className="text-center">
              <Users className="w-5 h-5 text-primary mx-auto mb-1" />
              <div className="font-display text-2xl sm:text-3xl font-bold text-primary">{stats.data.users ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1">Пользователей</div>
            </div>
            <div className="text-center">
              <CheckCircle2 className="w-5 h-5 text-primary mx-auto mb-1" />
              <div className="font-display text-2xl sm:text-3xl font-bold text-primary">{stats.data.completedOrders ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1">Заказов выполнено</div>
            </div>
            <div className="text-center">
              <Package className="w-5 h-5 text-primary mx-auto mb-1" />
              <div className="font-display text-2xl sm:text-3xl font-bold text-primary">{stats.data.activeProducts ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1">Товаров</div>
            </div>
            <div className="text-center">
              <MessageCircle className="w-5 h-5 text-primary mx-auto mb-1" />
              <div className="font-display text-2xl sm:text-3xl font-bold text-primary">{stats.data.approvedReviews ?? 0}</div>
              <div className="text-xs text-muted-foreground mt-1">Отзывов</div>
            </div>
          </div>
        )}

        <div className="text-center pt-6 sm:pt-8">
          <Link to={buildPath('/catalog')}><Button variant="hero" size="lg">Перейти в каталог</Button></Link>
        </div>
      </div>
    </div>
  );
};

export default About;
