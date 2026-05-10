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

let scriptPromise: Promise<void> | null = null;

const loadScript = (): Promise<void> => {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.UnicornStudio?.init) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve) => {
    if (!window.UnicornStudio) {
      window.UnicornStudio = { isInitialized: false, init: () => {} } as any;
    }
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener('load', () => resolve());
      if ((existing as any).dataset.loaded === 'true') resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.onload = () => {
      (s as any).dataset.loaded = 'true';
      resolve();
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
};

const UnicornBackground = ({ projectId, className = '' }: Props) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadScript().then(() => {
      if (cancelled) return;
      // Retry a few times — the parent may not have its final size yet.
      let tries = 0;
      const tick = () => {
        if (cancelled) return;
        const el = ref.current;
        if (el && el.clientWidth > 0 && el.clientHeight > 0) {
          try {
            window.UnicornStudio?.init?.();
            window.UnicornStudio!.isInitialized = true;
          } catch {}
          return;
        }
        if (tries++ < 30) setTimeout(tick, 100);
      };
      tick();
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <div
      ref={ref}
      data-us-project={projectId}
      className={className}
      style={{ width: '100%', height: '100%' }}
      aria-hidden="true"
    />
  );
};

export default UnicornBackground;
