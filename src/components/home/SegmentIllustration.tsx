import { GROUND, type SegmentArt } from "./segment-art";

/**
 * Desenho do segmento: perfil em traço fino sobre um brilho na cor do site,
 * com o reflexo no chão. Ao passar o rato no cartão (`group`), as rodas
 * giram e aparecem riscos de velocidade.
 */
export function SegmentIllustration({
  art,
  id,
}: {
  art: SegmentArt;
  id: string;
}) {
  const fill = `seg-fill-${id}`;
  const floor = `seg-floor-${id}`;
  const left = Math.min(...art.wheels.map((w) => w.x - w.r));
  const right = Math.max(...art.wheels.map((w) => w.x + w.r));

  return (
    <svg
      viewBox="0 0 160 80"
      aria-hidden
      className="h-full w-full overflow-visible"
    >
      <defs>
        <linearGradient id={fill} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.14" />
          <stop offset="1" stopColor="#fff" stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id={floor} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0" />
          <stop offset="0.5" stopColor="var(--accent)" stopOpacity="0.7" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Riscos de velocidade (só ao passar o rato). */}
      <g
        className="text-paper opacity-0 transition-[opacity,transform] duration-500 ease-premium group-hover:-translate-x-1 group-hover:opacity-100"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeLinecap="round"
      >
        <path d={`M${left - 22} 40 L${left - 6} 40`} strokeOpacity="0.35" />
        <path d={`M${left - 30} 48 L${left - 4} 48`} strokeOpacity="0.5" />
        <path d={`M${left - 18} 56 L${left - 6} 56`} strokeOpacity="0.3" />
      </g>

      {/* Chão: linha que se desvanece nas pontas e sombra por baixo. */}
      <ellipse
        cx={(left + right) / 2}
        cy={GROUND + 0.5}
        rx={(right - left) / 2}
        ry="2.2"
        fill="#000"
        opacity="0.5"
      />
      <path
        d={`M${left - 14} ${GROUND + 0.5} L${right + 14} ${GROUND + 0.5}`}
        stroke={`url(#${floor})`}
        strokeWidth="0.9"
      />

      <g
        className="text-paper transition-transform duration-500 ease-premium group-hover:translate-x-1"
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          d={art.body}
          fill={`url(#${fill})`}
          strokeWidth="1.5"
          strokeOpacity="0.9"
        />
        {art.detail && (
          <path d={art.detail} strokeWidth="1" strokeOpacity="0.55" />
        )}
        {art.accent && (
          <path d={art.accent} stroke="var(--accent)" strokeWidth="1.4" />
        )}

        {art.wheels.map(({ x, r }) => {
          const cy = GROUND - r;
          const spokes = art.spoked ? 10 : 5;
          const inner = art.spoked ? r * 0.82 : r * 0.62;
          return (
            <g key={x}>
              <circle
                cx={x}
                cy={cy}
                r={r}
                fill="#0b0b0b"
                strokeWidth="1.5"
                strokeOpacity="0.9"
              />
              <circle
                cx={x}
                cy={cy}
                r={inner}
                strokeWidth="0.8"
                strokeOpacity="0.45"
              />
              <g
                className="origin-center [transform-box:fill-box] group-hover:animate-[spin_1.4s_linear_infinite] motion-reduce:!animate-none"
                strokeWidth="0.7"
                strokeOpacity="0.5"
              >
                {Array.from({ length: spokes }, (_, i) => {
                  const a = (i / spokes) * Math.PI * 2;
                  const x1 = x + Math.cos(a) * r * 0.16;
                  const y1 = cy + Math.sin(a) * r * 0.16;
                  const x2 = x + Math.cos(a) * inner;
                  const y2 = cy + Math.sin(a) * inner;
                  return (
                    <path
                      key={i}
                      d={`M${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`}
                    />
                  );
                })}
              </g>
              <circle
                cx={x}
                cy={cy}
                r={r * 0.16}
                fill="var(--accent)"
                stroke="none"
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
