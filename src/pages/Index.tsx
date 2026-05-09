import { motion } from 'framer-motion';
import { Sparkles } from 'lucide-react';
import MarqueeBanner from '@/components/MarqueeBanner';
import ProjectCard from '@/components/ProjectCard';
import { useProjects, useSiteSettings } from '@/hooks/useShop';
import { Skeleton } from '@/components/ui/skeleton';

const Index = () => {
  const { data: projects, isLoading } = useProjects();
  const { data: settings } = useSiteSettings();

  const shopName = settings?.shop_name || 'TEMKA SHOP';
  const marquee = settings?.marquee_text || '';

  return (
    <div className="pb-8">
      {/* Hero / shop title */}
      <section className="px-4 pt-8 pb-6">
        <div className="container-main mx-auto max-w-2xl text-center">
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-border/60 bg-card text-xs text-muted-foreground mb-4"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Цифровой бутик
          </motion.div>
          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05, duration: 0.5 }}
            className="font-display text-4xl sm:text-5xl font-black tracking-tight leading-none"
          >
            {shopName}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
            className="text-muted-foreground text-sm sm:text-base mt-3 max-w-md mx-auto"
          >
            Дизайн, мерч и цифровые товары — три проекта в одном месте.
          </motion.p>
        </div>
      </section>

      {/* Marquee */}
      {marquee && <MarqueeBanner text={marquee} />}

      {/* Projects */}
      <section className="pt-8">
        <div className="container-main mx-auto max-w-2xl px-4">
          <h2 className="font-display text-lg font-bold mb-4 px-1">Наши проекты</h2>
        </div>
        {isLoading ? (
          <div className="flex gap-4 overflow-x-auto px-4 pb-4 scrollbar-hide snap-x snap-mandatory">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-56 w-[85%] sm:w-[420px] shrink-0 rounded-2xl snap-center" />
            ))}
          </div>
        ) : (
          <div className="flex gap-4 overflow-x-auto px-4 pb-4 scrollbar-hide snap-x snap-mandatory">
            {projects?.map((p, i) => (
              <div key={p.id} className="w-[85%] sm:w-[420px] shrink-0 snap-center">
                <ProjectCard project={p} index={i} />
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

export default Index;
