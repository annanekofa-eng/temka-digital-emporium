import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

type Plan = "start" | "basic" | "premium";
const PLAN_RANK: Record<Plan, number> = { start: 0, basic: 1, premium: 2 };

/** Mock guides catalog. Replace with DB lookup later — UI does not need to change. */
const GUIDES: Record<string, { required_plan: Plan; section: string; title: string; body: string }> = {
  // ─── Привлечение ────────────────────────────────────────────────
  "attr-tg-ads": {
    required_plan: "start",
    section: "attraction",
    title: "Реклама в Telegram-каналах",
    body: `Реклама в тематических Telegram-каналах — самый быстрый способ получить первых покупателей.

1. Подбор площадок
• Используйте TGStat и Telemetr для поиска каналов вашей ниши.
• Смотрите ER (вовлечённость) — здоровый показатель 8–25%.
• Проверяйте динамику подписчиков: резкие скачки = накрутка.

2. Расчёт стоимости подписчика
• CPM × 1000 / охват поста = ориентир по цене.
• Целевой CPF (cost per follower): $0.10–$0.50 для СНГ.
• Если получается дороже $1 — креатив или оффер слабые.

3. Креатив
• 1 экран = 1 идея. Сразу оффер, не «прелюдия».
• Кнопка → бот, не канал. Так вы сразу получите контакт.
• Тестируйте 3 креатива с бюджетом по $20–30 каждый.

4. Что измерять
• Подписки в бот, /start с UTM-меткой, первый заказ за 7 дней.
• Окупаемость считайте по LTV, а не по первому чеку.`,
  },

  "attr-organic": {
    required_plan: "basic",
    section: "attraction",
    title: "Органический рост: контент и SEO",
    body: `Органика — это бесплатный трафик, который работает в долгую.

1. Контент-план
• 3 типа постов: польза (50%), социальное доказательство (30%), оффер (20%).
• Постинг 3–5 раз в неделю, в одно и то же время.
• Закреп — всегда актуальный оффер с CTA в бот.

2. Форматы, которые работают
• Кейсы клиентов с цифрами.
• Короткие туториалы (как сделать X за 2 минуты).
• Подборки и сравнения.
• Личные истории основателя.

3. SEO внутри Telegram
• Ключевые слова в названии и описании канала.
• Хэштеги в постах: 2–3 релевантных.
• Папки и каталоги (TGStat Catalog, Telegram Folders).

4. Кросс-промо
• Обмен постами с каналами схожей аудитории.
• Совместные эфиры и интервью.
• Гостевые посты в больших каналах.`,
  },

  "attr-influencers": {
    required_plan: "premium",
    section: "attraction",
    title: "Работа с инфлюенсерами и блогерами",
    body: `Инфлюенсеры дают не просто трафик, а доверие аудитории.

1. Как находить
• Инструменты: LabelUp, GetBlogger, Instahero (для IG), TGStat (для TG).
• Микроинфлюенсеры (5–50k) часто эффективнее звёзд по ROI.
• Смотрите комментарии — настоящая ли там аудитория.

2. Скрипт первого касания
«Привет, [имя]! Ваш контент про [тема] — топ. У нас есть продукт, который точно зайдёт вашей аудитории. Готовы прислать на тест бесплатно + предложить интеграцию. Расскажете условия?»

3. Бриф для блогера
• Цель интеграции (продажи / подписки / охват).
• Ключевые сообщения (3 пункта максимум).
• Что нельзя говорить (стоп-лист).
• Дедлайны и формат отчёта.

4. Метрики
• CPM, CPF, ER на интеграции.
• Промокод с именем блогера = чистый трекинг.
• ROAS считайте через 30 дней, а не сразу.`,
  },

  // ─── Работа с клиентами ─────────────────────────────────────────
  "cli-onboarding": {
    required_plan: "start",
    section: "clients",
    title: "Онбординг покупателя в боте",
    body: `Первые 30 секунд в боте определяют, купит ли клиент.

1. Приветствие
• Кратко: кто вы, что продаёте, что получит клиент.
• Одна главная кнопка: «Открыть каталог».
• Без длинных описаний и правил — это убивает конверсию.

2. Навигация
• 3–5 кнопок в главном меню, не больше.
• Иконки в кнопках (эмодзи) повышают кликабельность на 20–30%.
• Кнопка «Назад» всегда на видном месте.

3. Быстрый первый заказ
• Покажите бестселлер сразу в приветствии.
• Минимум кликов до оплаты: 3–4 шага максимум.
• Принимайте оплату с баланса — это убирает трение.

4. Что добавить через неделю
• Welcome-скидка 10% по промокоду.
• Триггерное сообщение, если клиент не купил за 24 часа.
• Опрос «что не понравилось» при отказе.`,
  },

  "cli-support": {
    required_plan: "basic",
    section: "clients",
    title: "Поддержка и обработка возвратов",
    body: `Хорошая поддержка превращает разовых клиентов в постоянных.

1. SLA
• Первый ответ — до 30 минут в рабочее время.
• Решение вопроса — до 24 часов.
• Чётко обозначьте часы работы поддержки в боте.

2. Шаблоны ответов
• «Не пришёл товар» → проверка платежа → выдача / возврат.
• «Не подходит» → уточнение причины → замена / частичный возврат.
• «Не работает» → инструкция → эскалация на тех. поддержку.

3. Конфликтные ситуации
• Никогда не спорьте. Сначала признайте проблему.
• Дайте бонус: скидка, бесплатный товар, продление.
• Если клиент агрессивен — переводите на руководителя.

4. Возвраты
• Чёткая политика: что возвращаем, в какие сроки.
• Возврат на баланс — быстрее и удерживает клиента.
• Анализируйте причины — это улучшает продукт.`,
  },

  "cli-loyalty": {
    required_plan: "premium",
    section: "clients",
    title: "Система лояльности и удержания",
    body: `Удержание клиента в 5–7 раз дешевле, чем привлечение нового.

1. Реферальная программа
• Вознаграждение и рефереру, и приглашённому.
• Оптимально: 10% реферу + 10% скидка приглашённому.
• Промокод с именем реферера упрощает трекинг.

2. Скидки постоянникам
• Кэшбэк 3–5% на баланс с каждой покупки.
• Уровни: Bronze / Silver / Gold с растущими привилегиями.
• Закрытые предложения только для постоянных.

3. Реактивация «уснувших»
• 30 дней без покупки → персональный промокод.
• 60 дней → подборка новинок + бонус на баланс.
• 90 дней → опрос «почему ушли» + бонус за ответ.

4. Что измерять
• Retention rate по когортам (1, 7, 30, 90 дней).
• LTV по сегментам клиентов.
• Доля повторных покупок в общей выручке.`,
  },

  // ─── Увеличение дохода ──────────────────────────────────────────
  "rev-upsell": {
    required_plan: "basic",
    section: "revenue",
    title: "Допродажи и кросс-сейл",
    body: `Допродажи увеличивают средний чек на 15–40% без затрат на трафик.

1. Связки товаров
• Анализируйте, что покупают вместе.
• Показывайте «С этим товаром берут» в карточке.
• Бандл со скидкой 10–15% вместо отдельных товаров.

2. Апсейл в корзине
• «Добавьте до $X — получите бесплатную доставку/бонус».
• Премиум-версия товара рядом с базовой.
• Подписка вместо разовой покупки.

3. Постпродажный апсейл
• Сразу после оплаты — оффер на сопутствующий товар со скидкой.
• Окно «только следующие 15 минут» работает на 30% лучше.
• Email/бот-сообщение через 3–7 дней с релевантным предложением.

4. Что не работает
• Слишком много опций — клиент уходит.
• Дорогие апсейлы к дешёвым покупкам.
• Назойливые попапы на каждом шаге.`,
  },

  "rev-pricing": {
    required_plan: "basic",
    section: "revenue",
    title: "Ценообразование цифровых товаров",
    body: `Цифровые товары имеют почти нулевую себестоимость — цена определяется ценностью.

1. Якорение
• Покажите 3 опции: дешёвая / средняя / премиум.
• 70% выбирают среднюю — на ней и зарабатывайте.
• Премиум-опция повышает воспринимаемую ценность всех остальных.

2. Психология цен
• 9 в конце ($9.99) работает в массовом сегменте.
• Круглые числа ($100) — в премиум-сегменте.
• Месяц / год: годовой со скидкой 20% выгоднее в LTV.

3. Тестирование
• A/B-тест: одна и та же страница, разные цены.
• Минимум 200 посещений на каждый вариант.
• Смотрите не только конверсию, но и итоговую выручку.

4. Поднимать цену безопасно
• Сначала +10–15% для новых клиентов.
• Старым — фиксация старой цены на 3–6 месяцев.
• Объясняйте новые ценности, а не извиняйтесь.`,
  },

  "rev-automation": {
    required_plan: "premium",
    section: "revenue",
    title: "Автоворонки и реактивация",
    body: `Автоматизация даёт +20–40% к выручке без увеличения команды.

1. Welcome-серия
• Сообщение 1 (сразу): добро пожаловать + welcome-промокод.
• Сообщение 2 (день 2): полезный контент + кейс клиента.
• Сообщение 3 (день 5): оффер с дедлайном.
• Сообщение 4 (день 10): социальное доказательство.

2. Сегментация базы
• По частоте покупок: новички / постоянные / VIP.
• По чеку: low / mid / high ticket.
• По интересам (категории товаров).
• Каждому сегменту — свой контент и офферы.

3. Триггеры
• Брошенная корзина → напоминание через 1 час и через 24 часа.
• Просмотр товара без покупки → оффер на этот товар.
• День рождения / годовщина регистрации → персональный бонус.

4. Что автоматизировать в первую очередь
• Welcome-серию — самый высокий ROI.
• Брошенную корзину — окупается за неделю.
• Реактивацию — даёт «лёгкие» деньги с базы.`,
  },
};

function verifyTelegramInitData(initData: string, botToken: string): { ok: boolean; userId?: number } {
  try {
    const params = new URLSearchParams(initData);
    const hash = params.get("hash");
    if (!hash) return { ok: false };
    params.delete("hash");
    const entries = Array.from(params.entries()).sort(([a], [b]) => a.localeCompare(b));
    const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");
    const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
    const hmac = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
    if (hmac !== hash) return { ok: false };
    const authDate = params.get("auth_date");
    if (!authDate) return { ok: false };
    const now = Math.floor(Date.now() / 1000);
    if (now - Number(authDate) > 300) return { ok: false };
    const userStr = params.get("user");
    const user = userStr ? JSON.parse(userStr) : null;
    if (!user?.id) return { ok: false };
    return { ok: true, userId: Number(user.id) };
  } catch {
    return { ok: false };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const body = await req.json().catch(() => ({}));
    const { initData, guideId } = body || {};

    if (!guideId || typeof guideId !== "string") {
      return json({ ok: false, error: "missing_guide_id" }, 400);
    }
    const guide = GUIDES[guideId];
    if (!guide) return json({ ok: false, error: "not_found" }, 404);

    const botToken = Deno.env.get("PLATFORM_BOT_TOKEN") || Deno.env.get("TELEGRAM_BOT_TOKEN");
    if (!botToken) return json({ ok: false, error: "server_config" }, 500);

    let userPlan: Plan | null = null;
    if (initData && typeof initData === "string") {
      const v = verifyTelegramInitData(initData, botToken);
      if (v.ok && v.userId) {
        const supabase = createClient(
          Deno.env.get("SUPABASE_URL")!,
          Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
        );
        const { data: u } = await supabase
          .from("platform_users")
          .select("subscription_plan, subscription_status, subscription_expires_at")
          .eq("telegram_id", v.userId)
          .maybeSingle();
        if (u) {
          const active =
            ["active", "trial", "grace_period"].includes(String(u.subscription_status)) &&
            (!u.subscription_expires_at || new Date(u.subscription_expires_at) > new Date());
          if (active && (u.subscription_plan === "start" || u.subscription_plan === "basic" || u.subscription_plan === "premium")) {
            userPlan = u.subscription_plan as Plan;
          }
        }
      }
    }

    const required = guide.required_plan;
    const hasAccess = userPlan !== null && PLAN_RANK[userPlan] >= PLAN_RANK[required];

    if (!hasAccess) {
      return json({
        ok: false,
        error: "forbidden",
        required_plan: required,
        user_plan: userPlan,
      }, 403);
    }

    return json({
      ok: true,
      guide: {
        id: guideId,
        title: guide.title,
        body: guide.body || "Контент скоро будет добавлен.",
        required_plan: required,
      },
    });
  } catch (e) {
    console.error("get-guide error", String(e));
    return json({ ok: false, error: "internal" }, 500);
  }
});