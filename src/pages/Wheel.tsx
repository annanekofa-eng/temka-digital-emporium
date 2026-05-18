import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import { Copy, Sparkles, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { useTelegram } from '@/contexts/TelegramContext';
import { toast } from 'sonner';
import wheelLogo from '@/assets/wheel-logo.jpg';

// Alternating dark segments (chrome wheel aesthetic). Values still drive prize logic.
const SEGMENTS = [
  { value: 75, color: '#1f1f1f' },
  { value: 0,  color: '#070707' },
  { value: 50, color: '#1f1f1f' },
  { value: 5,  color: '#070707' },
  { value: 25, color: '#1f1f1f' },
  { value: 10, color: '#070707' },
  { value: 15, color: '#1f1f1f' },
  { value: 0,  color: '#070707' },
] as const;

const SEG_COUNT = SEGMENTS.length;
const SEG_ANGLE = 360 / SEG_COUNT;

function rotationForIndex(idx: number, fullTurns = 6): number {
  const segCentre = idx * SEG_ANGLE + SEG_ANGLE / 2;
  const base = (360 - segCentre) % 360;
  return fullTurns * 360 + base;
}

function pickIndexForPrize(prize: number, exclude?: number): number {
  const candidates = SEGMENTS.map((s, i) => ({ s, i })).filter(
    ({ s, i }) => s.value === prize && i !== exclude,
  );
  const pool = candidates.length ? candidates : SEGMENTS.map((s, i) => ({ s, i })).filter(({ s }) => s.value === prize);
  return pool[Math.floor(Math.random() * pool.length)].i;
}

function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00:00';
  const total = Math.floor(ms / 1000);
  const h = String(Math.floor(total / 3600)).padStart(2, '0');
  const m = String(Math.floor((total % 3600) / 60)).padStart(2, '0');
  const s = String(total % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

type Status = { canSpin: boolean; nextSpinAt: string | null; lastPrize: number | null; lastCode: string | null };
type SpinResult = 'idle' | 'spinning' | 'win' | 'lose';

const Wheel = () => {
  const { user, initData, haptic } = useTelegram();
  const [rotation, setRotation] = useState(0);
  const [status, setStatus] = useState<Status | null>(null);
  const [now, setNow] = useState(Date.now());
  const [resultState, setResultState] = useState<SpinResult>('idle');
  const [lastWin, setLastWin] = useState<{ prize: number; code: string | null } | null>(null);
  const [spinning, setSpinning] = useState(false);
  const segIdxRef = useRef<number | undefined>(undefined);

  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const loadStatus = useCallback(async () => {
    if (!initData) return;
    try {
      const { data, error } = await supabase.functions.invoke('spin-wheel', {
        body: { initData, action: 'status' },
      });
      if (error) throw error;
      setStatus(data as Status);
    } catch (e) {
      console.error('[wheel] status', e);
    }
  }, [initData]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  const nextAtMs = status?.nextSpinAt ? new Date(status.nextSpinAt).getTime() : 0;
  const remaining = Math.max(0, nextAtMs - now);
  const canSpin = !!status?.canSpin || remaining <= 0;

  const handleSpin = useCallback(async () => {
    if (spinning) return;
    if (!user || !initData) {
      toast.error('Откройте через Telegram, чтобы крутить колесо');
      return;
    }
    if (!canSpin) {
      toast.error(`Подождите ещё ${formatRemaining(remaining)} до следующего вращения`);
      return;
    }

    setSpinning(true);
    setResultState('spinning');
    haptic.impact('medium');

    try {
      const { data, error } = await supabase.functions.invoke('spin-wheel', {
        body: { initData, action: 'spin' },
      });
      if (error) throw error;
      if ((data as any)?.error === 'cooldown') {
        toast.error('Сегодня вы уже крутили колесо');
        await loadStatus();
        setSpinning(false);
        setResultState('idle');
        return;
      }
      const prize = Number((data as any).prize ?? 0);
      const promoCode = (data as any).promoCode ?? null;
      const idx = pickIndexForPrize(prize, segIdxRef.current);
      segIdxRef.current = idx;
      const target = rotationForIndex(idx, 6 + Math.floor(Math.random() * 2));
      const newRot = rotation + (target - (rotation % 360) + 360) % 360 + 360 * 6;
      setRotation(newRot);

      window.setTimeout(() => {
        if (prize > 0) {
          setResultState('win');
          setLastWin({ prize, code: promoCode });
          haptic.notification('success');
          toast.success(`Поздравляем! Скидка ${prize}%`);
        } else {
          setResultState('lose');
          setLastWin({ prize: 0, code: null });
          haptic.notification('error');
          toast.error('В этот раз не повезло. Возвращайтесь завтра!');
        }
        setSpinning(false);
        loadStatus();
      }, 5200);
    } catch (e: any) {
      console.error('[wheel] spin', e);
      toast.error(e?.message || 'Ошибка вращения');
      setSpinning(false);
      setResultState('idle');
    }
  }, [spinning, user, initData, canSpin, remaining, rotation, haptic, loadStatus]);

  const glowClass = useMemo(() => {
    if (resultState === 'win') {
      const hue = (lastWin?.prize ?? 0) >= 50 ? 'shadow-[0_0_60px_15px_rgba(167,139,250,0.7)]'
        : (lastWin?.prize ?? 0) >= 25 ? 'shadow-[0_0_50px_12px_rgba(96,165,250,0.7)]'
        : 'shadow-[0_0_45px_10px_rgba(52,211,153,0.7)]';
      return hue;
    }
    if (resultState === 'lose') return 'shadow-[0_0_45px_12px_rgba(248,113,113,0.75)]';
    return 'shadow-[0_0_35px_8px_rgba(255,255,255,0.45)]';
  }, [resultState, lastWin]);

  const cx = 160;
  const cy = 160;
  const rimOuter = 158;     // outer edge of chrome ring
  const rimInner = 128;     // inner edge of chrome ring = segments outer
  const segRadius = rimInner - 2;
  const studRadius = (rimOuter + rimInner) / 2; // where LED studs sit
  const tickRadius = rimInner + 4;              // where small arrow ticks sit

  const segPath = (i: number) => {
    const a0 = (i * SEG_ANGLE - 90) * Math.PI / 180;
    const a1 = ((i + 1) * SEG_ANGLE - 90) * Math.PI / 180;
    const x0 = cx + segRadius * Math.cos(a0);
    const y0 = cy + segRadius * Math.sin(a0);
    const x1 = cx + segRadius * Math.cos(a1);
    const y1 = cy + segRadius * Math.sin(a1);
    return `M${cx},${cy} L${x0},${y0} A${segRadius},${segRadius} 0 0 1 ${x1},${y1} Z`;
  };

  return (
    <div className="container-main mx-auto px-4 pt-2 pb-24 max-w-md">
      <div className="text-center mb-3">
        <div className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-wider text-primary font-semibold mb-1.5">
          <Sparkles className="w-3 h-3" /> Колесо удачи
        </div>
        <h1 className="font-display text-3xl font-black tracking-tight">Испытай удачу</h1>
        <p className="text-sm text-muted-foreground mt-1.5 px-2">
          Одно бесплатное вращение в 24 часа. Срывай куш, собирай скидки и возвращайся завтра за новым призом.
        </p>
      </div>

      <div className="flex flex-wrap justify-center gap-1.5 mb-4">
        {[75, 50, 25, 15, 10, 5].map((v) => (
          <span
            key={v}
            className="text-[11px] font-bold px-2.5 py-1 rounded-full bg-secondary border border-border/60 text-foreground"
          >
            -{v}%
          </span>
        ))}
      </div>

      <div className="relative w-full aspect-square max-w-sm mx-auto select-none">
        {/* Soft outer halo */}
        <div className={`absolute inset-6 rounded-full transition-shadow duration-500 ${glowClass}`} />

        {/* Fixed pointer — stays at top, points down into the wheel */}
        <div className="absolute left-1/2 -translate-x-1/2 z-30 pointer-events-none" style={{ top: '8%' }}>
          <svg width="22" height="34" viewBox="0 0 22 34">
            <defs>
              <linearGradient id="ptrG" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#fafafa" />
                <stop offset="55%" stopColor="#d4d4d8" />
                <stop offset="100%" stopColor="#6b7280" />
              </linearGradient>
            </defs>
            <path d="M11 30 L2 4 Q11 0 20 4 Z" fill="url(#ptrG)" stroke="#0a0a0a" strokeWidth="1" />
            <circle cx="11" cy="6" r="2" fill="#fafafa" opacity="0.95" />
          </svg>
        </div>

        <button
          type="button"
          onClick={handleSpin}
          disabled={spinning}
          className="absolute inset-0 w-full h-full focus:outline-none disabled:cursor-not-allowed"
          aria-label="Крутить колесо"
        >
          <motion.svg
            viewBox="0 0 320 320"
            className="w-full h-full drop-shadow-[0_12px_30px_rgba(0,0,0,0.7)]"
            animate={{ rotate: rotation }}
            transition={{ duration: 5, ease: [0.16, 1, 0.3, 1] }}
          >
            <defs>
              {/* Chrome ring gradient — light at top, dark at bottom with mid highlight */}
              <linearGradient id="chromeRing" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#f5f5f5" />
                <stop offset="20%"  stopColor="#a3a3a3" />
                <stop offset="42%"  stopColor="#e7e7e7" />
                <stop offset="50%"  stopColor="#fafafa" />
                <stop offset="58%"  stopColor="#d4d4d4" />
                <stop offset="78%"  stopColor="#3f3f46" />
                <stop offset="100%" stopColor="#71717a" />
              </linearGradient>
              {/* Inner chrome inset (creates depth between ring and segments) */}
              <linearGradient id="chromeInset" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#27272a" />
                <stop offset="50%"  stopColor="#a1a1aa" />
                <stop offset="100%" stopColor="#18181b" />
              </linearGradient>
              {/* Stud (LED) gradient */}
              <radialGradient id="stud" cx="0.35" cy="0.3" r="0.7">
                <stop offset="0%"   stopColor="#ffffff" />
                <stop offset="55%"  stopColor="#e4e4e7" />
                <stop offset="100%" stopColor="#52525b" />
              </radialGradient>
              {/* Hub bezel */}
              <radialGradient id="hubBezel" cx="0.35" cy="0.3" r="0.85">
                <stop offset="0%"   stopColor="#fafafa" />
                <stop offset="55%"  stopColor="#a1a1aa" />
                <stop offset="100%" stopColor="#27272a" />
              </radialGradient>
              {/* Subtle radial vignette inside segments */}
              <radialGradient id="segVignette" cx="0.5" cy="0.5" r="0.5">
                <stop offset="60%"  stopColor="rgba(0,0,0,0)" />
                <stop offset="100%" stopColor="rgba(0,0,0,0.55)" />
              </radialGradient>
            </defs>

            {/* Outer chrome ring */}
            <circle cx={cx} cy={cy} r={rimOuter} fill="url(#chromeRing)" />
            {/* Thin dark edge */}
            <circle cx={cx} cy={cy} r={rimOuter} fill="none" stroke="#09090b" strokeWidth="1.5" />
            {/* Inner chrome inset (creates the polished groove) */}
            <circle cx={cx} cy={cy} r={rimInner + 4} fill="url(#chromeInset)" />
            <circle cx={cx} cy={cy} r={rimInner + 4} fill="none" stroke="#09090b" strokeWidth="0.8" />

            {/* Segments */}
            {SEGMENTS.map((seg, i) => (
              <g key={i}>
                <path d={segPath(i)} fill={seg.color} stroke="#000" strokeWidth="0.8" />
                {(() => {
                  const a = (i * SEG_ANGLE + SEG_ANGLE / 2 - 90) * Math.PI / 180;
                  const tx = cx + (segRadius - 30) * Math.cos(a);
                  const ty = cy + (segRadius - 30) * Math.sin(a);
                  const rot = i * SEG_ANGLE + SEG_ANGLE / 2;
                  return (
                    <text
                      x={tx}
                      y={ty}
                      transform={`rotate(${rot} ${tx} ${ty})`}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fontFamily="ui-sans-serif, system-ui"
                      fontWeight="800"
                      fontSize={seg.value === 0 ? 20 : 22}
                      fill="#f4f4f5"
                      letterSpacing="-0.5"
                    >
                      {seg.value === 0 ? '0' : `${seg.value}`}
                    </text>
                  );
                })()}
              </g>
            ))}
            {/* Vignette over segments */}
            <circle cx={cx} cy={cy} r={segRadius} fill="url(#segVignette)" pointerEvents="none" />

            {/* Small arrow tick marks pointing inward (on inner rim) */}
            {Array.from({ length: SEG_COUNT }).map((_, i) => {
              const a = (i * SEG_ANGLE - 90) * Math.PI / 180;
              const x = cx + tickRadius * Math.cos(a);
              const y = cy + tickRadius * Math.sin(a);
              const rotDeg = i * SEG_ANGLE;
              return (
                <g key={`tick-${i}`} transform={`translate(${x} ${y}) rotate(${rotDeg})`}>
                  <path d="M -4 -3 L 0 3 L 4 -3 Z" fill="#fafafa" opacity="0.9" />
                </g>
              );
            })}

            {/* LED studs around the chrome ring */}
            {Array.from({ length: 24 }).map((_, i) => {
              const a = (i * (360 / 24) - 90) * Math.PI / 180;
              return (
                <g key={`stud-${i}`}>
                  <circle
                    cx={cx + studRadius * Math.cos(a)}
                    cy={cy + studRadius * Math.sin(a)}
                    r={3.2}
                    fill="url(#stud)"
                    stroke="#27272a"
                    strokeWidth="0.6"
                  />
                </g>
              );
            })}

            {/* Highlight arc on top of ring (glass reflection) */}
            <path
              d={`M ${cx - rimOuter + 14} ${cy - 18} A ${rimOuter - 6} ${rimOuter - 6} 0 0 1 ${cx + rimOuter - 14} ${cy - 18}`}
              fill="none"
              stroke="rgba(255,255,255,0.55)"
              strokeWidth="2"
              strokeLinecap="round"
            />

            {/* Central hub with logo */}
            <defs>
              <clipPath id="hubClip">
                <circle cx={cx} cy={cy} r={26} />
              </clipPath>
            </defs>
            <circle cx={cx} cy={cy} r={32} fill="url(#hubBezel)" />
            <circle cx={cx} cy={cy} r={32} fill="none" stroke="#09090b" strokeWidth="1.2" />
            <circle cx={cx} cy={cy} r={26} fill="#0a0a0a" />
            <image
              href={wheelLogo}
              x={cx - 26}
              y={cy - 26}
              width={52}
              height={52}
              clipPath="url(#hubClip)"
              preserveAspectRatio="xMidYMid slice"
            />
            <circle cx={cx} cy={cy} r={26} fill="none" stroke="#3f3f46" strokeWidth="1" />
          </motion.svg>
        </button>
      </div>


      <div className="mt-6 flex flex-col items-center gap-3">
        {canSpin ? (
          <button
            type="button"
            onClick={handleSpin}
            disabled={spinning}
            className={`relative rounded-full px-10 py-3.5 font-display font-black text-base tracking-wide transition-all disabled:opacity-70 ${
              resultState === 'win'
                ? 'bg-gradient-to-r from-violet-500 via-blue-500 to-emerald-500 text-white shadow-[0_0_40px_8px_rgba(96,165,250,0.7)]'
                : resultState === 'lose'
                ? 'bg-red-600 text-white shadow-[0_0_40px_8px_rgba(248,113,113,0.7)]'
                : 'bg-white text-black shadow-[0_0_30px_6px_rgba(255,255,255,0.5)] hover:shadow-[0_0_45px_10px_rgba(255,255,255,0.7)]'
            }`}
          >
            {spinning ? 'Крутим…' : 'Крутить'}
          </button>
        ) : (
          <div className="rounded-full px-8 py-3 bg-secondary border border-border/60 text-foreground font-mono font-bold text-lg flex items-center gap-2">
            <Clock className="w-4 h-4 text-muted-foreground" />
            {formatRemaining(remaining)}
          </div>
        )}
        {!canSpin && (
          <p className="text-xs text-muted-foreground">До следующего вращения</p>
        )}
      </div>

      {(lastWin || (status?.lastPrize !== null && status?.lastPrize !== undefined && !lastWin)) && (
        <div className="mt-6 rounded-2xl border border-border/60 bg-card p-4">
          {(() => {
            const prize = lastWin?.prize ?? status?.lastPrize ?? 0;
            const code = lastWin?.code ?? status?.lastCode ?? null;
            if (prize > 0 && code) {
              return (
                <div className="space-y-2.5">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider">Ваш приз</div>
                  <div className="font-display text-2xl font-black">Скидка −{prize}%</div>
                  <p className="text-xs text-muted-foreground">
                    Промокод действует 24 часа. Используйте при оформлении заказа.
                  </p>
                  <div className="flex items-center gap-2 mt-1">
                    <code className="flex-1 font-mono font-bold text-base bg-secondary border border-border/60 rounded-lg px-3 py-2 select-all">
                      {code}
                    </code>
                    <Button
                      size="sm"
                      onClick={() => {
                        navigator.clipboard?.writeText(code);
                        toast.success('Промокод скопирован');
                      }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              );
            }
            return (
              <div className="text-center text-sm text-muted-foreground">
                В прошлый раз приз не выпал. Попробуйте снова через 24 часа.
              </div>
            );
          })()}
        </div>
      )}

      <details className="mt-6 rounded-2xl border border-border/60 bg-card p-4">
        <summary className="cursor-pointer text-sm font-semibold">Шансы выпадения</summary>
        <div className="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
          {[
            { v: 75, p: 3 }, { v: 50, p: 5 }, { v: 25, p: 8 },
            { v: 15, p: 12 }, { v: 10, p: 20 }, { v: 5, p: 22 }, { v: 0, p: 30 },
          ].map((r) => (
            <div key={r.v} className="flex justify-between pr-3">
              <span className="text-muted-foreground">{r.v === 0 ? 'Без приза' : `−${r.v}%`}</span>
              <span className="font-mono">{r.p}%</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
};

export default Wheel;
