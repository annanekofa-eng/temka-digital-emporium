import { useMemo, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  ArrowRight,
  ChevronRight,
  Lock,
  Sparkles,
  Send,
  Megaphone,
  Users,
  TrendingUp,
  Crown,
  Zap,
  Star,
  type LucideIcon,
} from "lucide-react";
import telestoreLogo from "@/assets/telestore-logo-icon.png";
import { useTelegram } from "@/contexts/TelegramContext";
import { supabase } from "@/integrations/supabase/client";

type Plan = "start" | "basic" | "premium";
const PLAN_RANK: Record<Plan, number> = { start: 0, basic: 1, premium: 2 };

const PLAN_LABEL: Record<Plan, string> = {
  start: "Start",
  basic: "Basic",
  premium: "Premium",
};

const PLAN_BADGE: Record<Plan, { bg: string; text: string; border: string; icon: LucideIcon }> = {
  start: { bg: "bg-[#f1f5f9]", text: "text-[#475569]", border: "border-[#e2e8f0]", icon: Zap },
  basic: { bg: "bg-[#eff6ff]", text: "text-[#2563eb]", border: "border-[#bfdbfe]", icon: Star },
  premium: { bg: "bg-gradient-to-r from-amber-50 to-orange-50", text: "text-amber-700", border: "border-amber-200", icon: Crown },
};

interface Guide {
  id: string;
  title: string;
  description: string;
  required_plan: Plan;
  soon?: boolean;
}

interface Section {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  guides: Guide[];
}

const SECTIONS: Section[] = [
  {
    id: "attraction",
    title: "Привлечение",
    subtitle: "Где брать первых и постоянных покупателей",
    icon: Megaphone,
    guides: [
      {
        id: "attr-tg-ads",
        title: "Реклама в Telegram-каналах",
        description: "Как находить площадки, считать стоимость подписчика и не сливать бюджет.",
        required_plan: "start",
        soon: true,
      },
      {
        id: "attr-organic",
        title: "Органический рост: контент и SEO",
        description: "Контент-план, форматы постов и работа с поиском внутри Telegram.",
        required_plan: "basic",
        soon: true,
      },
      {
        id: "attr-influencers",
        title: "Работа с инфлюенсерами",
        description: "Скрипты переговоров, шаблоны брифов и метрики эффективности.",
        required_plan: "premium",
        soon: true,
      },
    ],
  },
  {
    id: "clients",
    title: "Работа с клиентами",
    subtitle: "Сервис, поддержка и удержание",
    icon: Users,
    guides: [
      {
        id: "cli-onboarding",
        title: "Онбординг покупателя в боте",
        description: "Первое впечатление: приветствие, навигация и быстрый первый заказ.",
        required_plan: "start",
        soon: true,
      },
      {
        id: "cli-support",
        title: "Поддержка и обработка возвратов",
        description: "SLA, шаблоны ответов, как закрывать конфликтные ситуации.",
        required_plan: "basic",
        soon: true,
      },
      {
        id: "cli-loyalty",
        title: "Система лояльности и удержания",
        description: "Реферальная программа, скидки постоянникам, реактивация.",
        required_plan: "premium",
        soon: true,
      },
    ],
  },
  {
    id: "revenue",
    title: "Увеличение дохода",
    subtitle: "Как зарабатывать больше с тех же клиентов",
    icon: TrendingUp,
    guides: [
      {
        id: "rev-upsell",
        title: "Допродажи и кросс-сейл",
        description: "Связки товаров, апсейл в корзине, бандлы и комплекты.",
        required_plan: "basic",
        soon: true,
      },
      {
        id: "rev-pricing",
        title: "Ценообразование цифровых товаров",
        description: "Как поднять цену без потери конверсии: тесты и психология.",
        required_plan: "basic",
        soon: true,
      },
      {
        id: "rev-automation",
        title: "Автоворонки и реактивация",
        description: "Автосообщения, сегментация базы, возврат «уснувших» клиентов.",
        required_plan: "premium",
        soon: true,
      },
    ],
  },
];

function CardSkeleton() {
  return (
    <div className="rounded-2xl border border-[#e2e8f0] bg-white p-5 animate-pulse">
      <div className="h-4 w-20 rounded-full bg-[#f1f5f9] mb-4" />
      <div className="h-5 w-3/4 rounded bg-[#f1f5f9] mb-2" />
      <div className="h-4 w-full rounded bg-[#f1f5f9]" />
      <div className="h-4 w-5/6 rounded bg-[#f1f5f9] mt-1.5" />
    </div>
  );
}

function PlanBadge({ plan }: { plan: Plan }) {
  const cfg = PLAN_BADGE[plan];
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${cfg.bg} ${cfg.text} ${cfg.border}`}>
      <Icon className="w-3 h-3" /> {PLAN_LABEL[plan]}
    </span>
  );
}

function GuideCard({ guide, userPlan, onLockedCTA, onOpen }: { guide: Guide; userPlan: Plan | null; onLockedCTA: () => void; onOpen: (id: string) => void }) {
  const hasAccess = userPlan !== null && PLAN_RANK[userPlan] >= PLAN_RANK[guide.required_plan];
  const locked = !hasAccess;

  return (
    <motion.div
      whileHover={{ y: -2 }}
      transition={{ duration: 0.2 }}
      className={`group relative rounded-2xl border bg-white p-5 transition-all duration-200 ${
        locked
          ? "border-[#e2e8f0] hover:border-[#cbd5e1]"
          : "border-[#e2e8f0] hover:border-[#bfdbfe] hover:shadow-lg hover:shadow-blue-500/5"
      }`}
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <PlanBadge plan={guide.required_plan} />
        {guide.soon && (
          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#fef3c7] text-[#92400e] border border-[#fde68a]">
            Скоро
          </span>
        )}
      </div>

      <h3 className={`font-bold text-[15px] sm:text-base leading-snug mb-1.5 ${locked ? "text-[#475569]" : "text-[#0f172a]"}`}>
        {guide.title}
      </h3>
      <p className="text-[13px] sm:text-sm text-[#64748b] leading-relaxed mb-4 line-clamp-3">
        {guide.description}
      </p>

      {locked ? (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs text-[#94a3b8]">
            <Lock className="w-3.5 h-3.5" />
            Доступно с тарифа {PLAN_LABEL[guide.required_plan]}
          </div>
          <button
            onClick={onLockedCTA}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-[#0f172a] text-white text-xs font-semibold hover:bg-[#1e293b] transition-colors"
          >
            Обновить тариф <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => onOpen(guide.id)}
          disabled={guide.soon}
          className={`w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold transition-colors ${
            guide.soon
              ? "bg-[#f1f5f9] text-[#94a3b8] cursor-not-allowed"
              : "bg-[#2563eb] text-white hover:bg-[#1d4ed8]"
          }`}
        >
          {guide.soon ? "Скоро" : "Открыть гайд"}
          {!guide.soon && <ArrowRight className="w-3.5 h-3.5" />}
        </button>
      )}
    </motion.div>
  );
}

export default function Guides() {
  const navigate = useNavigate();
  const { initData, isReady, isInTelegram } = useTelegram();
  const [userPlan, setUserPlan] = useState<Plan | null>(null);
  const [planLoading, setPlanLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);

  // Resolve current user's plan via existing get-my-data (server-side TG verification).
  useEffect(() => {
    let cancelled = false;
    async function loadPlan() {
      if (!isReady) return;
      if (!isInTelegram || !initData) {
        setPlanLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase.functions.invoke("get-my-data", {
          body: { initData, action: "platform-profile" },
        });
        if (cancelled) return;
        if (error || data?.error) {
          setUserPlan(null);
        } else {
          const sub = data?.subscription;
          const status = sub?.status;
          const plan = sub?.plan as Plan | null | undefined;
          const expiresAt = sub?.expires_at as string | null | undefined;
          const active =
            !!status &&
            ["active", "trial", "grace_period"].includes(status) &&
            (!expiresAt || new Date(expiresAt) > new Date());
          if (active && (plan === "start" || plan === "basic" || plan === "premium")) {
            setUserPlan(plan);
          } else {
            setUserPlan(null);
          }
        }
      } catch {
        if (!cancelled) setUserPlan(null);
      } finally {
        if (!cancelled) setPlanLoading(false);
      }
    }
    loadPlan();
    return () => {
      cancelled = true;
    };
  }, [isReady, isInTelegram, initData]);

  const handleUpgrade = () => {
    // Goes to platform profile and auto-opens subscription sheet
    navigate("/platform/profile?subscription=1");
  };

  const handleOpenGuide = async (guideId: string) => {
    // Server-side check before showing content (placeholder for now)
    try {
      const { data, error } = await supabase.functions.invoke("get-guide", {
        body: { initData, guideId },
      });
      if (error || !data?.ok) {
        // either forbidden or other error — silently fail (mocks)
        return;
      }
      // TODO: open guide reader (modal/page) with data.guide
      console.log("[guides] opened", data.guide);
    } catch {}
  };

  const sections = useMemo(() => SECTIONS, []);

  // Scrollspy: highlight tab while scrolling sections
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]?.target?.id) {
          setActiveSection(visible[0].target.id);
        }
      },
      { rootMargin: "-30% 0px -55% 0px", threshold: [0, 0.25, 0.5, 1] },
    );
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  const handleTabClick = (id: string) => {
    setActiveSection(id);
    const el = document.getElementById(id);
    if (el) {
      const top = el.getBoundingClientRect().top + window.scrollY - 140;
      window.scrollTo({ top, behavior: "smooth" });
    }
  };

  return (
    <div
      className="min-h-screen antialiased"
      style={{
        fontFamily: "'Inter', sans-serif",
        background: "linear-gradient(180deg, #f0f5ff 0%, #ffffff 30%, #f8fafc 100%)",
        color: "#1e293b",
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-[#e2e8f0]/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <a href="/landing" className="flex items-center gap-2.5">
            <img src={telestoreLogo} alt="TeleStore" className="w-9 h-9 rounded-xl shadow-md shadow-blue-500/20 object-cover" />
            <span className="font-bold text-lg tracking-tight text-[#0f172a]" style={{ fontFamily: "'Space Grotesk', sans-serif" }}>
              Tele<span className="text-[#2563eb]">Store</span>
            </span>
          </a>
          <a
            href="https://t.me/Tele_Store_Robot"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-gradient-to-r from-[#2563eb] to-[#3b82f6] text-white text-xs sm:text-sm font-semibold shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] transition-all duration-200"
          >
            <Send className="w-4 h-4" /> В платформу
          </a>
        </div>
      </header>

      {/* Section Tabs */}
      <div className="sticky top-16 z-40 backdrop-blur-xl bg-white/85 border-b border-[#e2e8f0]/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">
          <div className="flex gap-2 overflow-x-auto scrollbar-none -mx-1 px-1">
            {SECTIONS.map((s) => {
              const Icon = s.icon;
              const active = activeSection === s.id;
              return (
                <button
                  key={s.id}
                  onClick={() => handleTabClick(s.id)}
                  className={`inline-flex items-center gap-2 px-3.5 sm:px-4 py-2 rounded-full text-xs sm:text-sm font-semibold whitespace-nowrap border transition-all duration-200 ${
                    active
                      ? "bg-[#0f172a] text-white border-[#0f172a] shadow-md shadow-slate-900/10"
                      : "bg-white text-[#475569] border-[#e2e8f0] hover:border-[#cbd5e1] hover:text-[#0f172a]"
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  {s.title}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Hero */}
      <section className="px-4 sm:px-6 pt-10 sm:pt-16 pb-6 sm:pb-10">
        <div className="max-w-5xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#eff6ff] border border-[#bfdbfe] text-[#2563eb] text-xs sm:text-sm font-medium mb-4">
            <Sparkles className="w-4 h-4" /> База знаний для продавцов
          </div>
          <h1
            className="text-[28px] sm:text-5xl font-extrabold leading-[1.15] tracking-tight text-[#0f172a] mb-3 sm:mb-4"
            style={{ fontFamily: "'Space Grotesk', sans-serif" }}
          >
            Мануалы и гайды
          </h1>
          <p className="text-sm sm:text-lg text-[#64748b] max-w-2xl mx-auto">
            Готовые сценарии для привлечения клиентов, организации сервиса и роста выручки. Часть материалов открывается с тарифами Basic и Premium.
          </p>
        </div>
      </section>

      {/* Sections */}
      <main className="px-4 sm:px-6 pb-16 sm:pb-24">
        <div className="max-w-6xl mx-auto space-y-12 sm:space-y-16">
          {sections.map((section) => {
            const SectionIcon = section.icon;
            return (
              <section key={section.id} id={section.id} className="scroll-mt-36">
                <div className="flex items-start sm:items-center gap-3 mb-5 sm:mb-6">
                  <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-xl bg-[#eff6ff] border border-[#bfdbfe] flex items-center justify-center shrink-0">
                    <SectionIcon className="w-5 h-5 text-[#2563eb]" />
                  </div>
                  <div className="min-w-0">
                    <h2
                      className="text-xl sm:text-2xl font-extrabold text-[#0f172a]"
                      style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                    >
                      {section.title}
                    </h2>
                    <p className="text-xs sm:text-sm text-[#64748b] mt-0.5">{section.subtitle}</p>
                  </div>
                </div>

                {planLoading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <CardSkeleton key={i} />
                    ))}
                  </div>
                ) : section.guides.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-[#e2e8f0] bg-white/50 p-8 text-center text-sm text-[#94a3b8]">
                    Здесь пока пусто. Материалы появятся скоро.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
                    {section.guides.map((guide) => (
                      <GuideCard
                        key={guide.id}
                        guide={guide}
                        userPlan={userPlan}
                        onLockedCTA={handleUpgrade}
                        onOpen={handleOpenGuide}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}

          {/* Bottom CTA */}
          <section className="rounded-3xl border border-[#e2e8f0] bg-gradient-to-br from-[#eff6ff] via-white to-white p-6 sm:p-10 text-center">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-white border border-[#bfdbfe] text-[#2563eb] text-xs font-semibold mb-3">
              <Crown className="w-4 h-4" /> Полный доступ к гайдам
            </div>
            <h3
              className="text-xl sm:text-3xl font-extrabold text-[#0f172a] mb-2"
              style={{ fontFamily: "'Space Grotesk', sans-serif" }}
            >
              Открыть все материалы
            </h3>
            <p className="text-sm text-[#64748b] max-w-md mx-auto mb-5">
              Тарифы Basic и Premium открывают все гайды по привлечению, сервису и росту выручки.
            </p>
            <button
              onClick={handleUpgrade}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-2xl bg-gradient-to-r from-[#2563eb] to-[#3b82f6] text-white text-sm font-bold shadow-xl shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] transition-all duration-200"
            >
              Выбрать тариф <ChevronRight className="w-4 h-4" />
            </button>
          </section>
        </div>
      </main>

      <footer className="border-t border-[#e2e8f0] bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 text-center text-xs text-[#94a3b8]">
          © TeleStore — платформа для Telegram-магазинов
        </div>
      </footer>
    </div>
  );
}