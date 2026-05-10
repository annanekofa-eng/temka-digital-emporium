import { Link } from 'react-router-dom';
import { ArrowUpRight } from 'lucide-react';
import { motion } from 'framer-motion';
import type { DbProject } from '@/hooks/useShop';
import logoFlux from '@/assets/logo-flux.jpg';
import logoCursor from '@/assets/logo-cursor.jpg';
import logoVieto from '@/assets/logo-vieto.jpg';

const PROJECT_LOGOS: Record<string, string> = {
  flux: logoFlux,
  cursor: logoCursor,
  vieto: logoVieto,
};

interface Props {
  project: DbProject;
  index: number;
}

const ProjectCard = ({ project, index }: Props) => {
  const logo = PROJECT_LOGOS[project.id];
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.4 }}
    >
      <Link
        to={`/p/${project.id}`}
        className="group relative block overflow-hidden rounded-2xl liquid-glass liquid-glass-hover p-4"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
          style={{
            background:
              'radial-gradient(120% 80% at 50% 0%, hsl(0 0% 100% / 0.15), transparent 60%)',
          }}
        />
        <div className="relative flex items-center gap-4">
          {logo ? (
            <img
              src={logo}
              alt={project.title}
              className="w-14 h-14 rounded-xl object-cover shrink-0 bg-black"
              loading="lazy"
            />
          ) : (
            <div className="w-14 h-14 rounded-xl bg-secondary flex items-center justify-center text-2xl shrink-0">
              {project.icon}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="font-display text-xl font-bold tracking-tight truncate">{project.title}</h3>
            {project.subtitle && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">{project.subtitle}</p>
            )}
          </div>
          <div className="shrink-0 w-10 h-10 glass-button flex items-center justify-center rounded-full group-hover:rotate-45 transition-transform">
            <ArrowUpRight className="w-5 h-5" />
          </div>
        </div>
      </Link>
    </motion.div>
  );
};

export default ProjectCard;
