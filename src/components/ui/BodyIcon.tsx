/**
 * Silhueta (vista de lado, em traço) de cada categoria de viatura — os
 * quadrados «Que segmento procura?» da homepage. Desenhadas num viewBox
 * 64×28 com `currentColor`, por isso seguem a cor do texto à volta.
 */
type Shape = { wheels: [number, number, number][]; paths: string[] };

// Rodas dos carros: [cx, cy, r]. A linha de baixo interrompe-se nas rodas.
const CAR_WHEELS: [number, number, number][] = [
  [16, 22, 4.5],
  [48, 22, 4.5],
];
const CAR_FLOOR = "M3 22h8.5M20.5 22h23M52.5 22H61";

// Rodas das motas.
const MOTO_WHEELS: [number, number, number][] = [
  [13, 20, 6],
  [51, 20, 6],
];

const SHAPES: Record<string, Shape> = {
  Berlina: {
    wheels: CAR_WHEELS,
    paths: [
      CAR_FLOOR,
      "M3 22v-5.5Q3 14 6 14h8l7-6q1.5-1 4-1h12q2.5 0 4 1.5l6 5.5h10q4 .5 4 4v4",
      "M15.5 14l6-5h16.5l5.5 5M30 9v5",
    ],
  },
  SUV: {
    wheels: CAR_WHEELS,
    paths: [
      CAR_FLOOR,
      "M3 22V9q0-3.5 3.5-3.5H38q2.5 0 4 1.5l5 5.5h11q3 .5 3 4V22",
      "M6.5 8h31l5 4.5h-36zM22 8v4.5M32 8v4.5",
    ],
  },
  Coupé: {
    wheels: CAR_WHEELS,
    paths: [
      CAR_FLOOR,
      "M3 22v-5.5q0-1.5 2.5-2l10.5-1q6-6 12-6h6q4 0 8 3.5l5 3h10q4 .5 4 4v4",
      "M18 13.5q5-4.5 10-4.5h5q3 0 6.5 3l2 1.5z",
    ],
  },
  Carrinha: {
    wheels: CAR_WHEELS,
    paths: [
      CAR_FLOOR,
      "M3 22V10q0-3 3-3h31q2.5 0 4 1.5l6 5.5h10q4 .5 4 4v4",
      "M6.5 9.5H37l5 4.5H6.5zM22 9.5V14M32 9.5V14",
    ],
  },
  Citadino: {
    wheels: [
      [20, 22, 4.5],
      [44, 22, 4.5],
    ],
    paths: [
      "M10 22h5.5M24.5 22h15M48.5 22H54",
      "M10 22V12q0-5.5 5-5.5h18q3 0 5 2.5l4 4.5h8q4 .5 4 4.5v4",
      "M14 9h18.5l4.5 4.5H14zM24 9v4.5",
    ],
  },
  Utilitário: {
    wheels: CAR_WHEELS,
    paths: [
      CAR_FLOOR,
      "M3 22V12q0-4 3-4h30q2.5 0 4 1.5l6 4.5h11q4 .5 4 4v4",
      "M6.5 10h29l5 4h-34zM22 10v4",
    ],
  },
  Descapotável: {
    wheels: CAR_WHEELS,
    paths: [
      CAR_FLOOR,
      "M3 22v-5.5Q3 14 6 14h51q4 .5 4 4v4",
      "M44 14l-5-5.5M6 14q2-2.5 8-2.5",
    ],
  },
  Monovolume: {
    wheels: CAR_WHEELS,
    paths: [
      CAR_FLOOR,
      "M3 22V8q0-3 3-3h28q3 0 5.5 2.5l10.5 6h7q4 .5 4 4.5v4",
      "M6.5 7.5h27l7.5 6H6.5zM18 7.5v6M28 7.5v6",
    ],
  },
  Scooter: {
    wheels: [
      [14, 21, 5],
      [50, 21, 5],
    ],
    paths: [
      "M8 13h17q2 0 2.5 2l1.5 4h15",
      "M44 19l4-13M45 6h6",
      "M8 13q0 3 6 3",
    ],
  },
  Naked: {
    wheels: MOTO_WHEELS,
    paths: ["M13 20l14-3", "M8 11h14l4-2.5h10l4 2.5", "M24 11v6h12l4-6", "M51 20L44 6.5M41 6.5h6"],
  },
  Desportiva: {
    wheels: MOTO_WHEELS,
    paths: [
      "M13 20l14-3",
      "M7 11.5l15-1 5-2.5h10l9-1.5 6 3.5-4 5H36l-4 3h-6",
      "M47 9l4 11",
    ],
  },
  Trail: {
    wheels: MOTO_WHEELS,
    paths: ["M13 20l14-5", "M7 9h15l3-2h11l5 3", "M24 9v6h12l5-5", "M51 20L44 4M40 4h8", "M44 6q5 1 8 5"],
  },
  Touring: {
    wheels: MOTO_WHEELS,
    paths: ["M13 20l14-3", "M3 7h8v5H3z", "M11 10h12l3-2h10l6 3", "M24 10v7h14l4-6", "M51 20L44 7M42 3l4 5"],
  },
  "Chopper/Cruiser": {
    wheels: MOTO_WHEELS,
    paths: ["M13 20l15-2", "M8 13q6-1 12 0l6-2h10q4 0 5 2", "M26 13v5h12", "M51 20L42 6M39 5q3-1 6 1"],
  },
  Enduro: {
    wheels: MOTO_WHEELS,
    paths: ["M13 20l13-5", "M7 10h17l3-3h8l5 2", "M24 10l4 5h6l6-6", "M51 20L45 5M42 5h6", "M46 7l7 2"],
  },
  "Moto 4": {
    wheels: [
      [14, 20, 6],
      [50, 20, 6],
    ],
    paths: ["M5 13h19l3-3h10l4 3h18", "M8 13q6-4 12 0M44 13q6-4 12 0", "M37 10l3-5M37 5h6"],
  },
};

export function BodyIcon({ body, className = "" }: { body: string; className?: string }) {
  const shape = SHAPES[body] ?? SHAPES.Berlina!;
  return (
    <svg
      viewBox="0 0 64 28"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {shape.paths.map((d) => (
        <path key={d} d={d} />
      ))}
      {shape.wheels.map(([cx, cy, r]) => (
        <g key={`${cx}-${cy}`}>
          <circle cx={cx} cy={cy} r={r} />
          <circle cx={cx} cy={cy} r={r * 0.35} />
        </g>
      ))}
    </svg>
  );
}
