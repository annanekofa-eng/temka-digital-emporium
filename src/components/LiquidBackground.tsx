/**
 * LiquidBackground
 * Animated mesh gradient that flows slowly behind the entire app.
 * Provides the "liquid base" for the Liquid Glass aesthetic.
 */
const LiquidBackground = () => {
  return (
    <div
      aria-hidden
      className="fixed inset-0 -z-50 overflow-hidden bg-[hsl(240_40%_4%)] pointer-events-none"
    >
      {/* Animated gradient blobs */}
      <div className="absolute -top-1/3 -left-1/4 w-[70vw] h-[70vw] rounded-full opacity-60 blur-3xl animate-liquid-1"
        style={{ background: 'radial-gradient(circle, hsl(265 85% 55% / 0.55), transparent 60%)' }}
      />
      <div className="absolute top-1/4 -right-1/4 w-[65vw] h-[65vw] rounded-full opacity-55 blur-3xl animate-liquid-2"
        style={{ background: 'radial-gradient(circle, hsl(195 90% 50% / 0.5), transparent 60%)' }}
      />
      <div className="absolute -bottom-1/4 left-1/4 w-[75vw] h-[75vw] rounded-full opacity-50 blur-3xl animate-liquid-3"
        style={{ background: 'radial-gradient(circle, hsl(160 80% 45% / 0.45), transparent 60%)' }}
      />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[55vw] h-[55vw] rounded-full opacity-40 blur-3xl animate-liquid-4"
        style={{ background: 'radial-gradient(circle, hsl(310 80% 55% / 0.5), transparent 60%)' }}
      />
      {/* Subtle noise / grain veil for depth */}
      <div className="absolute inset-0 opacity-[0.04] mix-blend-overlay"
        style={{
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%22120%22 height=%22120%22><filter id=%22n%22><feTurbulence type=%22fractalNoise%22 baseFrequency=%220.9%22 stitchTiles=%22stitch%22/></filter><rect width=%22100%25%22 height=%22100%25%22 filter=%22url(%23n)%22/></svg>")',
        }}
      />
      {/* Bottom vignette so content reads */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_80%_at_50%_0%,transparent_0%,hsl(240_40%_4%/0.6)_80%)]" />
    </div>
  );
};

export default LiquidBackground;
