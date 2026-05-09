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
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: index * 0.08, duration: 0.4 }}
  >
    <Link
      to={`/p/${project.id}`}
      className="group relative block overflow-hidden rounded-2xl border border-border bg-card hover:border-primary/40 transition-all hover-lift"
    >
      {project.banner ? (
        <div className="aspect-[16/9] w-full overflow-hidden bg-secondary">
          <img
            src={project.banner}
            alt={project.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
            loading="lazy"
          />
        </div>
      ) : (
        <div className="aspect-[16/9] w-full bg-gradient-to-br from-secondary to-muted flex items-center justify-center text-6xl">
          {project.icon}
        </div>
      )}
      <div className="p-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-2xl">{project.icon}</span>
            <h3 className="font-display text-xl font-bold tracking-tight truncate">{project.title}</h3>
          </div>
          {project.subtitle && (
            <p className="text-sm text-muted-foreground mt-1 line-clamp-1">{project.subtitle}</p>
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
