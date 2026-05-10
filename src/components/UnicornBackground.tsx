import { useEffect, useRef } from 'react';

interface Props {
  projectId: string;
  className?: string;
}

declare global {
  interface Window {
    UnicornStudio?: { isInitialized: boolean; init: () => void };
  }
}

const SCRIPT_SRC =
  'https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.4.30/dist/unicornStudio.umd.js';

const ensureUnicornStudio = () => {
  if (typeof window === 'undefined') return;
  if (window.UnicornStudio?.isInitialized) {
    window.UnicornStudio.init();
    return;
  }
  if (document.querySelector(`script[src="${SCRIPT_SRC}"]`)) return;
  window.UnicornStudio = { isInitialized: false, init: () => {} } as any;
  const s = document.createElement('script');
  s.src = SCRIPT_SRC;
  s.async = true;
  s.onload = () => {
    if (window.UnicornStudio && !window.UnicornStudio.isInitialized) {
      window.UnicornStudio.init();
      window.UnicornStudio.isInitialized = true;
    }
  };
  document.head.appendChild(s);
};

const UnicornBackground = ({ projectId, className = '' }: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ensureUnicornStudio();
    const t = window.setTimeout(() => {
      window.UnicornStudio?.init?.();
    }, 50);
    return () => window.clearTimeout(t);
  }, [projectId]);

  return (
    <div
      ref={ref}
      data-us-project={projectId}
      className={className}
      aria-hidden="true"
    />
  );
};

export default UnicornBackground;
