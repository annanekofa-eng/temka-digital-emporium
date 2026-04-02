import { useState, useRef, useCallback, useEffect } from "react";
import storefrontScreenshot from "@/assets/storefront-screenshot.png";
import telestoreLogo from "@/assets/telestore-logo-icon.png";
import screenshotCatalog from "@/assets/screenshot-catalog.png";
import screenshotCart from "@/assets/screenshot-cart.png";
import screenshotProfile from "@/assets/screenshot-profile.png";
import { motion, useInView, type Variants } from "framer-motion";
import {
  Bot,
  Zap,
  ShoppingBag,
  CreditCard,
  Package,
  Settings,
  Users,
  Palette,
  ChevronRight,
  ArrowRight,
  CheckCircle2,
  Shield,
  Clock,
  Rocket,
  Store,
  Key,
  MonitorSmartphone,
  UserCheck,
  Code2,
  Headphones,
  XCircle,
  ChevronDown,
  Send,
  Globe,
  LayoutDashboard,
  Boxes,
  Sparkles,
  TrendingUp,
  Lock,
  MessageSquare,
} from "lucide-react";

const PLATFORM_BOT_URL = "https://t.me/Tele_Store_Robot";
const SUPPORT_URL = "https://t.me/TeleStoreHelp";

// ─── Animation helpers ────────────────────────
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.5, ease: [0.25, 0.1, 0.25, 1] },
  }),
};

const staggerContainer: Variants = {
  hidden: {},
  visible: { transition: { staggerChildren: 0.08 } },
};

function AnimatedSection({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  return (
    <motion.div
      ref={ref}
      initial="hidden"
      animate={isInView ? "visible" : "hidden"}
      variants={staggerContainer}
      className={className}
    >
      {children}
    </motion.div>
  );
}

// ─── FAQ Accordion ────────────────────────────
function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-[#e2e8f0]">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between py-5 text-left group">
        <span className="font-semibold text-[#1e293b] text-[15px] sm:text-base pr-4 group-hover:text-[#2563eb] transition-colors">
          {q}
        </span>
        <ChevronDown
          className={`w-5 h-5 text-[#94a3b8] shrink-0 transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          className="pb-5 text-[#64748b] text-sm leading-relaxed"
        >
          {a}
        </motion.div>
      )}
    </div>
  );
}

// ─── Main Landing ─────────────────────────────
export default function Landing() {
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxImage, setLightboxImage] = useState("");
  const [activeSlide, setActiveSlide] = useState(0);

  const slides = [
    { src: storefrontScreenshot, label: "Главная", alt: "Главная страница магазина" },
    { src: screenshotCatalog, label: "Каталог", alt: "Каталог товаров" },
    { src: screenshotCart, label: "Корзина", alt: "Корзина с товарами" },
    { src: screenshotProfile, label: "Профиль", alt: "Профиль пользователя" },
  ];

  useEffect(() => {
    const timer = setInterval(() => {
      setActiveSlide((prev) => (prev + 1) % slides.length);
    }, 4000);
    return () => clearInterval(timer);
  }, [slides.length]);

  return (
    <>
      {/* Lightbox */}
      {lightboxOpen && (
        <div
          className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightboxOpen(false)}
        >
          <img
            src={lightboxImage}
            alt="Интерфейс Telegram-магазина"
            className="max-w-full max-h-[90vh] rounded-2xl shadow-2xl object-contain"
          />
        </div>
      )}
      <div
        className="min-h-screen antialiased"
        style={{
          fontFamily: "'Inter', sans-serif",
          background: "linear-gradient(180deg, #f0f5ff 0%, #ffffff 30%, #f8fafc 100%)",
          color: "#1e293b",
        }}
      >
        {/* ═══ HEADER ═══ */}
        <header className="sticky top-0 z-50 backdrop-blur-xl bg-white/80 border-b border-[#e2e8f0]/60">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <img src={telestoreLogo} alt="TeleStore" className="w-9 h-9 rounded-xl shadow-md shadow-blue-500/20 object-cover" />
              <span
                className="font-bold text-lg tracking-tight text-[#0f172a]"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Tele<span className="text-[#2563eb]">Store</span>
              </span>
            </div>
            <a
              href={PLATFORM_BOT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-[#2563eb] to-[#3b82f6] text-white text-sm font-semibold shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] transition-all duration-200"
            >
              <Send className="w-4 h-4" /> Создать магазин
            </a>
          </div>
        </header>

        {/* ═══ 1. HERO ═══ */}
        <section className="relative overflow-hidden pt-10 sm:pt-24 pb-12 sm:pb-28 px-4 sm:px-6">
          {/* Background decorations */}
          <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-20 -right-32 w-96 h-96 rounded-full bg-blue-400/10 blur-3xl" />
            <div className="absolute -top-20 -left-32 w-80 h-80 rounded-full bg-blue-500/8 blur-3xl" />
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-4xl h-px bg-gradient-to-r from-transparent via-[#2563eb]/20 to-transparent" />
          </div>

          <div className="max-w-6xl mx-auto relative">
            <AnimatedSection className="max-w-3xl mx-auto text-center">
              <motion.div
                variants={fadeUp}
                custom={0}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#eff6ff] border border-[#bfdbfe] text-[#2563eb] text-xs sm:text-sm font-medium mb-4 sm:mb-6"
              >
                <Sparkles className="w-4 h-4" /> Telegram-first платформа для продаж
              </motion.div>

              <motion.h1
                variants={fadeUp}
                custom={1}
                className="text-[28px] sm:text-5xl lg:text-6xl font-extrabold leading-[1.15] tracking-tight text-[#0f172a] mb-4 sm:mb-6"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Создайте свой
                <br />
                <span className="bg-gradient-to-r from-[#2563eb] to-[#60a5fa] bg-clip-text text-transparent">
                  Telegram-магазин
                </span>
                <br />
                цифровых товаров
              </motion.h1>

              <motion.p
                variants={fadeUp}
                custom={2}
                className="text-sm sm:text-xl text-[#64748b] max-w-2xl mx-auto mb-6 sm:mb-8 leading-relaxed"
              >
                Собственный бот с Mini-App, приём оплаты через CryptoBot и СБП, автоматическая выдача товаров 24/7 — без
                кода, хостинга и ручной работы.
              </motion.p>

              <motion.div
                variants={fadeUp}
                custom={3}
                className="flex flex-col sm:flex-row items-center justify-center gap-2.5 sm:gap-3 mb-6 sm:mb-10"
              >
                <a
                  href={PLATFORM_BOT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2.5 px-6 sm:px-8 py-3 sm:py-4 rounded-2xl bg-gradient-to-r from-[#2563eb] to-[#3b82f6] text-white text-sm sm:text-base font-bold shadow-xl shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] transition-all duration-200 w-full sm:w-auto justify-center"
                >
                  <Send className="w-5 h-5" /> Создать магазин
                </a>
                <a
                  href="#how-it-works"
                  className="inline-flex items-center gap-2 px-5 sm:px-6 py-3 sm:py-4 rounded-2xl border-2 border-[#e2e8f0] text-[#475569] text-sm sm:text-base font-semibold hover:border-[#2563eb]/30 hover:text-[#2563eb] transition-all duration-200 w-full sm:w-auto justify-center"
                >
                  Как это работает <ChevronRight className="w-4 h-4" />
                </a>
              </motion.div>

              {/* Trust bullets */}
              <motion.div
                variants={fadeUp}
                custom={4}
                className="flex flex-wrap items-center justify-center gap-x-4 sm:gap-x-6 gap-y-1.5 text-xs sm:text-sm text-[#64748b]"
              >
                <span className="flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-[#2563eb]" /> Запуск за 5 минут
                </span>
                <span className="flex items-center gap-1.5">
                  <Shield className="w-4 h-4 text-[#2563eb]" /> Без программирования
                </span>
                <span className="flex items-center gap-1.5">
                  <Clock className="w-4 h-4 text-[#2563eb]" /> Автовыдача 24/7
                </span>
                <span className="flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-[#2563eb]" /> CryptoBot + СБП
                </span>
              </motion.div>
            </AnimatedSection>

            {/* Hero Visual — Storefront screenshots carousel */}
            <AnimatedSection className="mt-10 sm:mt-16 max-w-5xl mx-auto">
              <motion.div variants={fadeUp} custom={5} className="relative">
                {/* Label */}
                <div className="text-center mb-4">
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[#eff6ff] border border-[#bfdbfe] text-[#2563eb] text-xs font-semibold">
                    Пример готового магазина
                  </span>
                </div>
                {/* Glow behind */}
                <div className="absolute -inset-4 bg-gradient-to-b from-[#2563eb]/8 via-[#3b82f6]/5 to-transparent rounded-[2rem] blur-xl pointer-events-none" />
                {/* Browser frame */}
                <div className="relative bg-[#1e1e2e] rounded-2xl sm:rounded-3xl shadow-2xl shadow-black/15 border border-[#334155]/50 overflow-hidden">
                  {/* Browser bar */}
                  <div className="flex items-center gap-2 px-4 sm:px-5 py-3 bg-[#282838] border-b border-[#334155]/50">
                    <div className="flex gap-1.5">
                      <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
                      <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
                      <div className="w-3 h-3 rounded-full bg-[#28c840]" />
                    </div>
                    <div className="flex-1 h-7 bg-[#1e1e2e] rounded-md flex items-center px-3 text-xs text-[#94a3b8] font-mono">
                      yourshop.telestore.app
                    </div>
                  </div>
                  {/* Carousel */}
                  <div
                    className="relative overflow-hidden cursor-zoom-in max-h-[400px] sm:max-h-[600px]"
                    onClick={() => {
                      setLightboxImage(slides[activeSlide].src);
                      setLightboxOpen(true);
                    }}
                  >
                    <div
                      className="flex transition-transform duration-500 ease-in-out"
                      style={{ transform: `translateX(-${activeSlide * 100}%)` }}
                    >
                      {slides.map((slide, i) => (
                        <img
                          key={i}
                          src={slide.src}
                          alt={slide.alt}
                          className="w-full shrink-0 block"
                          loading={i === 0 ? "eager" : "lazy"}
                        />
                      ))}
                    </div>
                  </div>
                </div>
                {/* Slide indicators & labels */}
                <div className="flex items-center justify-center gap-2 sm:gap-3 mt-4 sm:mt-5">
                  {slides.map((slide, i) => (
                    <button
                      key={i}
                      onClick={() => setActiveSlide(i)}
                      className={`px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-200 ${
                        activeSlide === i
                          ? "bg-[#2563eb] text-white shadow-md shadow-blue-500/25"
                          : "bg-[#f1f5f9] text-[#64748b] hover:bg-[#e2e8f0]"
                      }`}
                    >
                      {slide.label}
                    </button>
                  ))}
                </div>
              </motion.div>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══ 2. TRUST STRIP ═══ */}
        <section className="border-y border-[#e2e8f0] bg-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-8">
              {[
                { icon: Rocket, label: "Запуск за минуты", desc: "Онбординг из 7 шагов" },
                { icon: Zap, label: "Автовыдача 24/7", desc: "Мгновенная доставка" },
                { icon: CreditCard, label: "Приём оплат", desc: "CryptoBot + СБП" },
                { icon: Lock, label: "Надёжная система", desc: "Telegram-first" },
              ].map((item, i) => (
                <AnimatedSection key={i} className="text-center">
                  <motion.div variants={fadeUp} custom={i}>
                    <item.icon className="w-6 sm:w-7 h-6 sm:h-7 text-[#2563eb] mx-auto mb-2" />
                    <div className="font-bold text-xs sm:text-sm text-[#0f172a]">{item.label}</div>
                    <div className="text-[10px] sm:text-xs text-[#94a3b8] mt-0.5">{item.desc}</div>
                  </motion.div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ 3. HOW IT WORKS ═══ */}
        <section id="how-it-works" className="py-12 sm:py-28 px-4 sm:px-6">
          <div className="max-w-5xl mx-auto">
            <AnimatedSection className="text-center mb-8 sm:mb-16">
              <motion.div
                variants={fadeUp}
                custom={0}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#eff6ff] text-[#2563eb] text-xs font-semibold mb-3 sm:mb-4"
              >
                Просто и быстро
              </motion.div>
              <motion.h2
                variants={fadeUp}
                custom={1}
                className="text-2xl sm:text-4xl font-extrabold text-[#0f172a] mb-2 sm:mb-4"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Как это работает
              </motion.h2>
              <motion.p variants={fadeUp} custom={2} className="text-[#64748b] text-sm sm:text-lg max-w-xl mx-auto">
                От идеи до работающего магазина — 5 простых шагов
              </motion.p>
            </AnimatedSection>

            <div
              className="flex sm:grid sm:grid-cols-5 gap-3 sm:gap-4 overflow-x-auto pb-2 sm:pb-0 -mx-4 px-4 sm:mx-0 sm:px-0 snap-x snap-mandatory scrollbar-hide"
              style={{ touchAction: "pan-x", overscrollBehaviorY: "contain" }}
            >
              {[
                { step: "1", icon: Store, title: "Создайте магазин", desc: "Пройдите онбординг в платформенном боте" },
                { step: "2", icon: Bot, title: "Подключите бота", desc: "Привяжите своего Telegram-бота" },
                { step: "3", icon: Palette, title: "Настройте витрину", desc: "Добавьте товары и оформление" },
                {
                  step: "4",
                  icon: CreditCard,
                  title: "Подключите оплату",
                  desc: "Настройте CryptoBot и/или СБП",
                },
                { step: "5", icon: Package, title: "Продавайте", desc: "Товары выдаются автоматически 24/7" },
              ].map((item, i) => (
                <AnimatedSection key={i}>
                  <motion.div
                    variants={fadeUp}
                    custom={i}
                    className="relative bg-white rounded-xl sm:rounded-2xl p-4 sm:p-6 border border-[#e2e8f0] shadow-sm hover:shadow-lg hover:border-[#bfdbfe] transition-all duration-300 text-center h-full min-w-[140px] sm:min-w-0 snap-start"
                  >
                    <div className="w-8 sm:w-10 h-8 sm:h-10 rounded-lg sm:rounded-xl bg-gradient-to-br from-[#2563eb] to-[#3b82f6] text-white font-bold text-sm sm:text-lg flex items-center justify-center mx-auto mb-2 sm:mb-4 shadow-md shadow-blue-500/20">
                      {item.step}
                    </div>
                    <item.icon className="w-5 sm:w-6 h-5 sm:h-6 text-[#2563eb] mx-auto mb-2 sm:mb-3" />
                    <h3 className="font-bold text-xs sm:text-sm text-[#0f172a] mb-1">{item.title}</h3>
                    <p className="text-[10px] sm:text-xs text-[#64748b] leading-relaxed">{item.desc}</p>
                  </motion.div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ 4. FEATURES ═══ */}
        <section className="py-12 sm:py-28 px-4 sm:px-6 bg-gradient-to-b from-[#f8fafc] to-white">
          <div className="max-w-6xl mx-auto">
            <AnimatedSection className="text-center mb-8 sm:mb-16">
              <motion.div
                variants={fadeUp}
                custom={0}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-[#eff6ff] text-[#2563eb] text-xs font-semibold mb-3 sm:mb-4"
              >
                Возможности
              </motion.div>
              <motion.h2
                variants={fadeUp}
                custom={1}
                className="text-2xl sm:text-4xl font-extrabold text-[#0f172a] mb-2 sm:mb-4"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Что вы получаете
              </motion.h2>
              <motion.p variants={fadeUp} custom={2} className="text-[#64748b] text-sm sm:text-lg max-w-xl mx-auto">
                Полноценная торговая система внутри Telegram
              </motion.p>
            </AnimatedSection>

            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
              {[
                { icon: Bot, title: "Telegram-бот", desc: "Ваш бот — ваш бренд. Полная кастомизация." },
                { icon: Globe, title: "Mini App витрина", desc: "Полноценное приложение внутри Telegram." },
                { icon: CreditCard, title: "Оплата крипто + СБП", desc: "CryptoBot и перевод по карте — на выбор." },
                { icon: Zap, title: "Автовыдача", desc: "Товары доставляются автоматически 24/7." },
                { icon: LayoutDashboard, title: "Админка в боте", desc: "Товары, заказы, промокоды и рассылки." },
                { icon: Palette, title: "Свой стиль", desc: "Цвет, название, описание — ваш магазин." },
                { icon: Boxes, title: "Инвентарь", desc: "Загрузка пакетами, автотрекинг наличия." },
                { icon: UserCheck, title: "Профиль", desc: "Личный кабинет, баланс, история." },
                { icon: TrendingUp, title: "Масштабируемость", desc: "Инфраструктура на нас. Вы — продаёте." },
              ].map((feature, i) => (
                <AnimatedSection key={i}>
                  <motion.div
                    variants={fadeUp}
                    custom={i % 3}
                    className="bg-white rounded-xl sm:rounded-2xl p-3.5 sm:p-6 border border-[#e2e8f0] shadow-sm hover:shadow-xl hover:border-[#bfdbfe] hover:-translate-y-1 transition-all duration-300 h-full"
                  >
                    <div className="w-9 sm:w-11 h-9 sm:h-11 rounded-lg sm:rounded-xl bg-[#eff6ff] flex items-center justify-center mb-2.5 sm:mb-4">
                      <feature.icon className="w-4.5 sm:w-5.5 h-4.5 sm:h-5.5 text-[#2563eb]" />
                    </div>
                    <h3 className="font-bold text-xs sm:text-[15px] text-[#0f172a] mb-1 sm:mb-2">{feature.title}</h3>
                    <p className="text-[10px] sm:text-sm text-[#64748b] leading-relaxed">{feature.desc}</p>
                  </motion.div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ 5. TARGET AUDIENCE ═══ */}
        <section className="py-12 sm:py-28 px-4 sm:px-6">
          <div className="max-w-5xl mx-auto">
            <AnimatedSection className="text-center mb-8 sm:mb-16">
              <motion.h2
                variants={fadeUp}
                custom={0}
                className="text-2xl sm:text-4xl font-extrabold text-[#0f172a] mb-2 sm:mb-4"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Для кого это
              </motion.h2>
              <motion.p variants={fadeUp} custom={1} className="text-[#64748b] text-sm sm:text-lg max-w-xl mx-auto">
                TeleStore подходит всем, кто продаёт цифровые товары в Telegram
              </motion.p>
            </AnimatedSection>

            <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-5">
              {[
                { icon: Key, title: "Продавцы аккаунтов", desc: "Игровые, соцсети, сервисы" },
                { icon: MonitorSmartphone, title: "Подписки", desc: "VPN, стриминг, SaaS" },
                { icon: Users, title: "Продавцы услуг", desc: "Рассылки, папки чатов" },
                { icon: Code2, title: "Софт", desc: "Скрипты, боты, плагины" },
                { icon: Package, title: "Игровые товары", desc: "Игры, подписки, донат" },
                { icon: Rocket, title: "Магазины", desc: "Множество товаров" },
              ].map((item, i) => (
                <AnimatedSection key={i}>
                  <motion.div
                    variants={fadeUp}
                    custom={i % 3}
                    className="flex gap-3 sm:gap-4 bg-white rounded-xl sm:rounded-2xl p-3 sm:p-5 border border-[#e2e8f0] shadow-sm hover:shadow-lg transition-all duration-300"
                  >
                    <div className="w-9 sm:w-11 h-9 sm:h-11 rounded-lg sm:rounded-xl bg-[#eff6ff] flex items-center justify-center shrink-0">
                      <item.icon className="w-4 sm:w-5 h-4 sm:h-5 text-[#2563eb]" />
                    </div>
                    <div className="min-w-0">
                      <h3 className="font-bold text-xs sm:text-sm text-[#0f172a] mb-0.5">{item.title}</h3>
                      <p className="text-[10px] sm:text-xs text-[#64748b] leading-relaxed">{item.desc}</p>
                    </div>
                  </motion.div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ 6. PAIN SECTION ═══ */}
        <section className="py-12 sm:py-28 px-4 sm:px-6 bg-gradient-to-b from-white to-[#f8fafc]">
          <div className="max-w-5xl mx-auto">
            <AnimatedSection className="text-center mb-8 sm:mb-16">
              <motion.h2
                variants={fadeUp}
                custom={0}
                className="text-2xl sm:text-4xl font-extrabold text-[#0f172a] mb-2 sm:mb-4"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Зачем автоматизировать?
              </motion.h2>
              <motion.p variants={fadeUp} custom={1} className="text-[#64748b] text-sm sm:text-lg max-w-xl mx-auto">
                Ручные продажи в Telegram — это хаос. TeleStore делает их системой.
              </motion.p>
            </AnimatedSection>

            <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
              {/* Pains */}
              <AnimatedSection>
                <motion.div
                  variants={fadeUp}
                  custom={0}
                  className="bg-white rounded-xl sm:rounded-2xl border border-[#fecaca]/60 p-4 sm:p-8 h-full"
                >
                  <div className="flex items-center gap-2 mb-4 sm:mb-6">
                    <XCircle className="w-5 sm:w-6 h-5 sm:h-6 text-[#ef4444]" />
                    <h3 className="font-bold text-sm sm:text-lg text-[#0f172a]">Без платформы</h3>
                  </div>
                  <ul className="space-y-2.5 sm:space-y-3.5">
                    {[
                      "Вручную принимать оплату в каждом чате",
                      "Копировать и отправлять товар руками",
                      "Терять заказы и путаться в переписках",
                      "Не спать, чтобы не пропустить покупателя",
                      "Невозможно масштабироваться",
                      "Нет статистики и контроля",
                    ].map((pain, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs sm:text-sm text-[#64748b]">
                        <XCircle className="w-4 h-4 text-[#fca5a5] shrink-0 mt-0.5" />
                        {pain}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </AnimatedSection>

              {/* Solutions */}
              <AnimatedSection>
                <motion.div
                  variants={fadeUp}
                  custom={1}
                  className="bg-white rounded-xl sm:rounded-2xl border border-[#bbf7d0]/60 p-4 sm:p-8 h-full"
                >
                  <div className="flex items-center gap-2 mb-4 sm:mb-6">
                    <CheckCircle2 className="w-5 sm:w-6 h-5 sm:h-6 text-[#16a34a]" />
                    <h3 className="font-bold text-sm sm:text-lg text-[#0f172a]">С TeleStore</h3>
                  </div>
                  <ul className="space-y-2.5 sm:space-y-3.5">
                    {[
                      "Оплата через CryptoBot или СБП — автоматически",
                      "Товар выдаётся сразу после оплаты",
                      "Все заказы в одном месте с историей",
                      "Магазин работает 24/7 без вашего участия",
                      "Масштабируйте продажи без лимитов",
                      "Полная статистика и аналитика",
                    ].map((solution, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs sm:text-sm text-[#1e293b]">
                        <CheckCircle2 className="w-4 h-4 text-[#86efac] shrink-0 mt-0.5" />
                        {solution}
                      </li>
                    ))}
                  </ul>
                </motion.div>
              </AnimatedSection>
            </div>
          </div>
        </section>

        {/* ═══ 7. PRODUCT SHOWCASE ═══ */}
        <section className="py-12 sm:py-28 px-4 sm:px-6">
          <div className="max-w-5xl mx-auto">
            <AnimatedSection className="text-center mb-8 sm:mb-16">
              <motion.h2
                variants={fadeUp}
                custom={0}
                className="text-2xl sm:text-4xl font-extrabold text-[#0f172a] mb-2 sm:mb-4"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Интерфейс, который продаёт
              </motion.h2>
              <motion.p variants={fadeUp} custom={1} className="text-[#64748b] text-sm sm:text-lg max-w-xl mx-auto">
                Готовый продукт — не прототип. Каждый экран продуман до деталей.
              </motion.p>
            </AnimatedSection>

            <div className="grid grid-cols-2 sm:grid-cols-2 gap-3 sm:gap-6">
              {[
                {
                  title: "Витрина магазина",
                  desc: "Каталог товаров с категориями, фильтрами и корзиной — работает как Telegram Mini App",
                  gradient: "from-[#eff6ff] to-[#dbeafe]",
                  icon: ShoppingBag,
                },
                {
                  title: "Админ-панель в боте",
                  desc: "Управляйте товарами, заказами, клиентами и промокодами через /admin в своём боте",
                  gradient: "from-[#f0fdf4] to-[#dcfce7]",
                  icon: Settings,
                },
                {
                  title: "Профиль владельца",
                  desc: "Подписка, баланс, настройки магазина и статистика — всё в одном месте",
                  gradient: "from-[#fff7ed] to-[#fed7aa]",
                  icon: UserCheck,
                },
                {
                  title: "Telegram-бот покупателя",
                  desc: "Покупатели получают товар сразу после оплаты. Автоматический чек и поддержка.",
                  gradient: "from-[#fdf4ff] to-[#f5d0fe]",
                  icon: MessageSquare,
                },
              ].map((screen, i) => (
                <AnimatedSection key={i}>
                  <motion.div
                    variants={fadeUp}
                    custom={i % 2}
                    className={`bg-gradient-to-br ${screen.gradient} rounded-xl sm:rounded-2xl p-4 sm:p-8 border border-white/60 shadow-sm hover:shadow-xl transition-all duration-300`}
                  >
                    <screen.icon className="w-7 sm:w-10 h-7 sm:h-10 text-[#2563eb] mb-2 sm:mb-4" />
                    <h3 className="font-bold text-sm sm:text-lg text-[#0f172a] mb-1 sm:mb-2">{screen.title}</h3>
                    <p className="text-[10px] sm:text-sm text-[#475569] leading-relaxed">{screen.desc}</p>
                  </motion.div>
                </AnimatedSection>
              ))}
            </div>
          </div>
        </section>

        {/* ═══ 8. PRICING ═══ */}
        <section className="py-12 sm:py-28 px-4 sm:px-6 bg-gradient-to-b from-[#f8fafc] to-white">
          <div className="max-w-3xl mx-auto">
            <AnimatedSection className="text-center mb-8 sm:mb-12">
              <motion.h2
                variants={fadeUp}
                custom={0}
                className="text-2xl sm:text-4xl font-extrabold text-[#0f172a] mb-2 sm:mb-4"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Простая и честная цена
              </motion.h2>
              <motion.p variants={fadeUp} custom={1} className="text-[#64748b] text-sm sm:text-lg max-w-xl mx-auto">
                Вы платите не за абстрактную подписку, а за готовую торговую систему
              </motion.p>
            </AnimatedSection>

            <AnimatedSection>
              <motion.div
                variants={fadeUp}
                custom={0}
                className="bg-white rounded-2xl sm:rounded-3xl border-2 border-[#2563eb]/20 shadow-xl shadow-blue-500/5 p-5 sm:p-10 relative overflow-hidden"
              >
                <div className="absolute top-0 right-0 bg-gradient-to-l from-[#2563eb] to-[#3b82f6] text-white text-xs font-bold px-4 py-1.5 rounded-bl-xl">
                  Пробный период
                </div>

                <div className="text-center mb-5 sm:mb-8">
                  <h3
                    className="font-bold text-xl sm:text-2xl text-[#0f172a] mb-2"
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    TeleStore
                  </h3>
                  <div className="flex items-baseline justify-center gap-1">
                    <span className="text-3xl sm:text-4xl font-extrabold text-[#0f172a]">от $5</span>
                    <span className="text-[#94a3b8] text-base sm:text-lg">/мес</span>
                  </div>
                  <p className="text-xs sm:text-sm text-[#64748b] mt-2">3 дня бесплатно для новых пользователей</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-3 mb-6 sm:mb-8">
                  {[
                    "1 Telegram-магазин",
                    "Собственный бот",
                    "Свое Mini-App",
                    "Приём оплат через CryptoBot",
                    "Автовыдача 24/7",
                    "Управление через /admin",
                    "Промокоды и рассылки",
                    "Поддержка платформы",
                  ].map((feature, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs sm:text-sm text-[#1e293b]">
                      <CheckCircle2 className="w-4.5 h-4.5 text-[#2563eb] shrink-0" />
                      {feature}
                    </div>
                  ))}
                </div>

                <div className="text-center">
                  <a
                    href={PLATFORM_BOT_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2.5 px-6 sm:px-10 py-3 sm:py-4 rounded-2xl bg-gradient-to-r from-[#2563eb] to-[#3b82f6] text-white text-sm sm:text-base font-bold shadow-xl shadow-blue-500/25 hover:shadow-blue-500/40 hover:scale-[1.02] transition-all duration-200"
                  >
                    <Send className="w-5 h-5" /> Начать бесплатно
                  </a>
                </div>
              </motion.div>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══ 9. FAQ ═══ */}
        <section className="py-12 sm:py-28 px-4 sm:px-6">
          <div className="max-w-3xl mx-auto">
            <AnimatedSection className="text-center mb-6 sm:mb-12">
              <motion.h2
                variants={fadeUp}
                custom={0}
                className="text-2xl sm:text-4xl font-extrabold text-[#0f172a] mb-2 sm:mb-4"
                style={{ fontFamily: "'Space Grotesk', sans-serif" }}
              >
                Частые вопросы
              </motion.h2>
            </AnimatedSection>

            <div className="bg-white rounded-xl sm:rounded-2xl border border-[#e2e8f0] shadow-sm p-4 sm:p-8">
              <FAQItem
                q="Нужны ли навыки программирования?"
                a="Нет. Весь процесс создания магазина — это пошаговый онбординг в Telegram-боте. Вам нужно только отвечать на вопросы и нажимать кнопки."
              />

              <FAQItem
                q="Как быстро можно запустить магазин?"
                a="От 5 до 15 минут. Вы проходите 7 шагов онбординга, подключаете бота и добавляете товары. После этого магазин сразу начинает работать."
              />

              <FAQItem
                q="Нужен ли свой Telegram-бот?"
                a="Да, вам понадобится создать бота через @BotFather в Telegram. Это занимает 2 минуты. Платформа подскажет каждый шаг."
              />

              <FAQItem
                q="Как работает оплата?"
                a="Покупатели оплачивают через CryptoBot — это надёжный платёжный сервис в Telegram. Вам нужно создать аккаунт в @CryptoBot и подключить API-токен."
              />

              <FAQItem
                q="Как происходит выдача товара?"
                a="После оплаты система автоматически резервирует товар из инвентаря и отправляет его покупателю в Telegram. Всё происходит за секунды."
              />

              <FAQItem
                q="Какие товары можно продавать?"
                a="Любые цифровые товары: аккаунты, ключи, подписки, лицензии, файлы, скрипты. Всё, что можно доставить в текстовом формате."
              />

              <FAQItem
                q="Где управлять магазином?"
                a="Через команду /admin в вашем подключённом Telegram-боте. Там доступны: товары, заказы, клиенты, промокоды, рассылки, настройки и статистика."
              />

              <FAQItem
                q="Что делать, если нужна поддержка?"
                a="Напишите в нашу поддержку через Telegram. Мы помогаем с настройкой, техническими вопросами и любыми проблемами."
              />
            </div>
          </div>
        </section>

        {/* ═══ 10. FINAL CTA ═══ */}
        <section className="py-12 sm:py-28 px-4 sm:px-6">
          <div className="max-w-4xl mx-auto">
            <AnimatedSection className="text-center">
              <motion.div
                variants={fadeUp}
                custom={0}
                className="bg-gradient-to-br from-[#1e3a8a] via-[#2563eb] to-[#3b82f6] rounded-2xl sm:rounded-3xl p-6 sm:p-16 relative overflow-hidden"
              >
                {/* Decorative circles */}
                <div className="absolute top-0 right-0 w-64 h-64 rounded-full bg-white/5 -translate-y-1/2 translate-x-1/3" />
                <div className="absolute bottom-0 left-0 w-48 h-48 rounded-full bg-white/5 translate-y-1/2 -translate-x-1/3" />

                <div className="relative">
                  <h2
                    className="text-xl sm:text-4xl font-extrabold text-white mb-3 sm:mb-4 leading-tight"
                    style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                  >
                    Запустите свой Telegram-магазин
                    <br className="hidden sm:block" /> уже сегодня
                  </h2>
                  <p className="text-blue-100 text-sm sm:text-lg max-w-xl mx-auto mb-5 sm:mb-8">
                    Без кода. Без ручной выдачи. Без лишней инфраструктуры.
                    <br className="hidden sm:block" />
                    Всё, что нужно — уже внутри платформы.
                  </p>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
                    <a
                      href={PLATFORM_BOT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2.5 px-8 py-4 rounded-2xl bg-white text-[#2563eb] text-base font-bold shadow-xl hover:shadow-2xl hover:scale-[1.02] transition-all duration-200 w-full sm:w-auto justify-center"
                    >
                      <Send className="w-5 h-5" /> Создать магазин
                    </a>
                    <a
                      href={SUPPORT_URL}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-6 py-4 rounded-2xl border-2 border-white/30 text-white text-base font-semibold hover:bg-white/10 transition-all duration-200 w-full sm:w-auto justify-center"
                    >
                      <Headphones className="w-4 h-4" /> Связаться с нами
                    </a>
                  </div>
                </div>
              </motion.div>
            </AnimatedSection>
          </div>
        </section>

        {/* ═══ 11. FOOTER ═══ */}
        <footer className="border-t border-[#e2e8f0] bg-white py-6 sm:py-10 px-4 sm:px-6">
          <div className="max-w-6xl mx-auto">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#2563eb] to-[#3b82f6] flex items-center justify-center">
                  <Bot className="w-4 h-4 text-white" />
                </div>
                <span
                  className="font-bold text-sm text-[#0f172a]"
                  style={{ fontFamily: "'Space Grotesk', sans-serif" }}
                >
                  TeleStore
                </span>
              </div>

              <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-[#94a3b8]">
                <a href="/platform/terms" className="hover:text-[#2563eb] transition-colors">
                  Соглашение
                </a>
                <a href="/platform/rules" className="hover:text-[#2563eb] transition-colors">
                  Правила
                </a>
                <a href="/platform/privacy" className="hover:text-[#2563eb] transition-colors">
                  Конфиденциальность
                </a>
                <a href="/platform/subscription" className="hover:text-[#2563eb] transition-colors">
                  Подписка
                </a>
                <a href="/platform/consent" className="hover:text-[#2563eb] transition-colors">
                  Согласие на ПД
                </a>
                <a
                  href={SUPPORT_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-[#2563eb] transition-colors"
                >
                  Поддержка
                </a>
              </div>

              <div className="text-xs text-[#cbd5e1]">© {new Date().getFullYear()} TeleStore</div>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
