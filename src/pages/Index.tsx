import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import MarqueeBanner from '@/components/MarqueeBanner';
import ProjectCard from '@/components/ProjectCard';
import CasesSection from '@/components/CasesSection';
import ProductShowcase from '@/components/ProductShowcase';
import ReviewsSection from '@/components/ReviewsSection';
import UnicornBackground from '@/components/UnicornBackground';
import { useProjects, useSiteSettings } from '@/hooks/useShop';
import { Skeleton } from '@/components/ui/skeleton';

const Index = () => {
  const { data: projects, isLoading } = useProjects();
  const { data: settings } = useSiteSettings();

  const shopName = settings?.shop_name || 'Hustlify';
  const marquee = settings?.marquee_text || '';

  return (
    <div className="pb-8">
      {/* Hero / shop title */}
      <section className="relative overflow-hidden isolate min-h-[280px] sm:min-h-[320px] lg:min-h-[380px]">
        {/* Animated Unicorn Studio background */}
        <div className="absolute inset-0 z-0">
          <UnicornBackground
            projectId="N9XzvQXu7fA5SY2ewADJ"
            className="absolute inset-0 w-full h-full opacity-70 mix-blend-screen [&>canvas]:!w-full [&>canvas]:!h-full [&_canvas]:!w-full [&_canvas]:!h-full"
          />
          {/* Soft fade so hero blends into the liquid bg */}
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-[hsl(240_40%_4%/0.5)] pointer-events-none" />
        </div>

        <div className="relative z-10 px-4 pt-10 pb-10 sm:pt-14 sm:pb-14 lg:pt-16 lg:pb-16">
          <div className="container-main mx-auto max-w-2xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full liquid-glass text-xs text-foreground/90 mb-4"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Цифровой бутик
            </motion.div>
            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.05, duration: 0.5 }}
              className="font-display text-5xl sm:text-6xl lg:text-7xl font-black tracking-tight leading-none text-glass"
            >
              {shopName}
            </motion.h1>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.15 }}
              className="text-foreground/80 text-sm sm:text-base mt-3 max-w-md mx-auto text-glass"
            >
              Дизайн, мерч и цифровые товары — три проекта в одном месте.
            </motion.p>
          </div>
        </div>
      </section>

      {/* Marquee */}
      {marquee && <MarqueeBanner text={marquee} />}

      {/* Cases */}
      <CasesSection />

      {/* Projects */}
      <section className="pt-10">
        <div className="container-main mx-auto max-w-2xl lg:max-w-6xl px-4">
          <h2 className="font-display text-2xl font-black tracking-tight mb-5 px-1">Наши проекты</h2>
          {isLoading ? (
            <div className="grid gap-3 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-24 w-full rounded-2xl" />
              ))}
            </div>
          ) : (
            <div className="grid gap-3 lg:grid-cols-3">
              {projects?.map((p, i) => (
                <ProjectCard key={p.id} project={p} index={i} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Catalog showcase */}
      <ProductShowcase />

      {/* Reviews */}
      <ReviewsSection />
    </div>
  );
};

export default Index;
