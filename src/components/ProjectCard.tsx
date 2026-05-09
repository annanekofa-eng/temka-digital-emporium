import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DbProject } from '@/hooks/useShop';

interface Props {
  project: DbProject;
  index: number;
}

const ProjectCard = ({ project, index }: Props) => (
  <motion.div
    initial={{ opacity: 0, y: 16 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.08, duration: 0.4 }}
  >
    <Link
      to={`/p/${project.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-primary/40 bg-card p-5 transition-all hover:border-primary hover:-translate-y-0.5"
      style={{
        boxShadow:
          '0 0 0 1px hsl(var(--primary) / 0.15), 0 0 20px -2px hsl(var(--primary) / 0.35), inset 0 0 24px -8px hsl(var(--primary) / 0.25)',
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
        style={{
          background:
            'radial-gradient(120% 80% at 50% 0%, hsl(var(--primary) / 0.18), transparent 60%)',
        }}
      />
      <div className="relative flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{project.icon}</span>
            <h3 className="font-display text-xl font-bold tracking-tight truncate">{project.title}</h3>
          </div>
          {project.subtitle && (
            <p className="text-sm text-muted-foreground mt-1.5 line-clamp-2">{project.subtitle}</p>
          )}
        </div>
        <div className="shrink-0 w-10 h-10 rounded-full bg-primary text-primary-foreground flex items-center justify-center group-hover:rotate-45 transition-transform">
          <ArrowUpRight className="w-5 h-5" />
        </div>
      </div>
    </Link>
  </motion.div>
);

export default ProjectCard;
