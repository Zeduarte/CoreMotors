/**
 * Ilustrações dos segmentos («Que segmento procura?»): perfis desenhados à
 * mão, em traço fino, todos na mesma grelha (160×80, chão em y=66, virados
 * para a direita). Genéricos — não representam nenhuma marca.
 *
 *  - `body`   contorno principal (fica com um preenchimento muito leve);
 *  - `detail` janelas, guiador, motor… (traço mais fino);
 *  - `accent` um vinco na cor do site;
 *  - `wheels` rodas assentes no chão (centro em y = GROUND − r).
 */
export const GROUND = 66;

export interface SegmentArt {
  body: string;
  detail?: string;
  accent?: string;
  wheels: { x: number; r: number }[];
  /** Raios nas rodas (motas de terra) em vez de jantes de 5 braços. */
  spoked?: boolean;
}

/**
 * Carroçaria fechada: o perfil de cima (da esquerda, em y=`yb`, à direita,
 * também em y=`yb`) e, por baixo, a linha com as cavas das rodas.
 */
function car(
  top: string,
  yb: number,
  wheels: { x: number; r: number }[],
): string {
  const arches = [...wheels]
    .sort((a, b) => b.x - a.x)
    .map(({ x, r }) => {
      const ar = r + 2.5;
      return `L${x + ar} ${yb} A${ar} ${ar} 0 0 0 ${x - ar} ${yb}`;
    })
    .join(" ");
  return `${top} ${arches} Z`;
}

const W = (x: number, r = 10) => ({ x, r });

const CAR: Record<string, SegmentArt> = {
  Berlina: {
    body: car(
      "M10 58 C9 52 10 48 16 47 L46 43 C52 38 60 32 68 30 C74 29 92 29 100 30 C108 32 114 38 120 43 L140 46 C147 47 150 50 150 54 L150 58",
      58,
      [W(38), W(124)],
    ),
    detail:
      "M55 43 C61 37.5 66 34 72 33.5 L85 33.5 L85 43 Z M89 43 L89 33.5 L99 33.5 C104 34.5 109 38 113 43 Z",
    accent: "M20 50 C60 48 110 48 144 50",
    wheels: [W(38), W(124)],
  },
  SUV: {
    body: car(
      "M10 57 L10 47 C10 43 13 41 20 40 L40 39 L54 24 C56 22 58 21 62 21 L124 21 C129 21 132 23 134 27 L140 39 C147 40 150 43 150 47 L150 57",
      57,
      [W(38, 11), W(122, 11)],
    ),
    detail:
      "M46 39 L57 26.5 C58 25.5 59 25 62 25 L86 25 L86 39 Z M90 39 L90 25 L121 25 C124 25 126 26 127 28 L132 39 Z M64 18 L122 18",
    accent: "M16 47 L146 47",
    wheels: [W(38, 11), W(122, 11)],
  },
  Coupé: {
    body: car(
      "M10 58 C9 53 11 50 18 49 L56 45 C66 37 76 32 86 31 C96 30 104 31 110 34 C118 38 126 43 132 46 L144 48 C148 49 150 52 150 55 L150 58",
      58,
      [W(36), W(126)],
    ),
    detail:
      "M66 44.5 C73 38.5 80 35 88 34.5 L98 34.5 C104 35 110 38 115 42 L117 44.5 Z M99 34.5 L101 44.5",
    accent: "M20 52 C70 50 110 50 142 51",
    wheels: [W(36), W(126)],
  },
  Carrinha: {
    body: car(
      "M10 58 L10 34 C10 30 12 28 16 28 L92 28 C100 29 108 36 116 42 L140 45 C147 46 150 50 150 54 L150 58",
      58,
      [W(34), W(124)],
    ),
    detail:
      "M17 42 L17 32 L44 32 L44 42 Z M48 42 L48 32 L72 32 L72 42 Z M76 42 L76 32 L91 32 C97 33 102 37 107 42 Z M18 25 L88 25",
    accent: "M14 49 L146 49",
    wheels: [W(34), W(124)],
  },
  Citadino: {
    body: car(
      "M30 58 L30 44 C30 38 32 34 36 30 C40 26 46 24 54 24 L92 24 C98 24 102 26 106 30 L116 40 C124 41 130 44 130 50 L130 58",
      58,
      [W(50), W(112)],
    ),
    detail:
      "M38 40 L41 31 C43 28.5 46 27.5 52 27.5 L70 27.5 L70 40 Z M74 40 L74 27.5 L91 27.5 C95 27.5 98 29 101 31.5 L109 40 Z",
    accent: "M34 47 L126 47",
    wheels: [W(50), W(112)],
  },
  Utilitário: {
    body: car(
      "M10 58 L10 22 C10 18 12 16 16 16 L112 16 C118 16 121 18 124 22 L136 38 C145 40 150 43 150 48 L150 58",
      58,
      [W(34), W(126)],
    ),
    detail:
      "M114 36 L114 20.5 L119 20.5 C120.5 20.5 121.5 21 122.5 22.5 L132 36 Z M108 19 L108 54 M76 19 L76 42",
    accent: "M14 45 L146 45",
    wheels: [W(34), W(126)],
  },
  Descapotável: {
    body: car(
      "M10 58 C9 53 11 49 18 48 L100 45 L140 46 C147 47 150 50 150 55 L150 58",
      58,
      [W(36), W(126)],
    ),
    detail:
      "M100 45 L109 31 L112 31 L105 45 M50 46 C50 41 52 39 56 39 C60 39 62 41 62 46 M70 46 C70 40 72 38 76 38 C80 38 82 40 82 46 M20 48 C23 43 30 42 40 43 L44 46.5",
    accent: "M20 52 C70 50 110 50 142 51",
    wheels: [W(36), W(126)],
  },
  Monovolume: {
    body: car(
      "M10 58 L10 30 C10 25 13 22 18 22 L96 22 C104 22 110 26 118 32 L136 42 C145 43 150 46 150 51 L150 58",
      58,
      [W(36), W(124)],
    ),
    detail:
      "M16 40 L16 27 L44 27 L44 40 Z M48 40 L48 27 L76 27 L76 40 Z M80 40 L80 27 L96 27 C102 27 108 30 113 34 L120 40 Z",
    accent: "M14 47 L146 47",
    wheels: [W(36), W(124)],
  },
};

const M = (x: number, r = 17) => ({ x, r });

const MOTO: Record<string, SegmentArt> = {
  Scooter: {
    body: "M28 45 C28 36 36 31 50 30 L78 30 C84 30 86 34 86 38 L86 49 L102 49 C104 40 104 30 101 19 L108 18 C112 30 114 42 112 52 C110 56 104 57 98 57 L62 57 C54 57 50 54 47 50 L30 50 C28.5 49 28 47 28 45 Z M44 30 C50 25.5 70 25 82 28.5 L80 30 Z",
    detail:
      "M96 15 L112 13 M105 18 L104 14 M107 22 L111.5 21 M112 48 L120 54 M28 42 L25.5 42",
    accent: "M50 40 L82 40",
    wheels: [M(42, 12), M(120, 12)],
  },
  Naked: {
    body: "M34 24 L48 29 C56 28 66 27.5 74 28 C78 22 90 19 102 20 C106 20.5 108 23 108 26 L104 30 C96 33 86 34 78 34 L72 34 C62 34 52 33 46 32 L33 26.5 Z M74 35 L98 33 L101 45 C94 50 86 52 80 51 L72 45 Z",
    detail:
      "M120 49 L106 19 M100 15 L110 13.5 L108 19 M116.5 25 a3.5 3.5 0 1 1 -7 0 a3.5 3.5 0 1 1 7 0 M40 49 L74 43 M76 39 L99 37.5 M78 43 L100 41.5 M82 51 C72 53 60 52 54 47 L50 44 M48 32 L56 40 L72 43 M112 36 C118 33 126 34 130 38",
    accent: "M80 25 C88 22 96 21 102 22",
    wheels: [M(40), M(120)],
  },
  Desportiva: {
    body: "M30 19 L36 18.5 L54 25 C62 24 70 24 74 24 C80 20 90 18 98 19 L104 20 C110 18 116 18 120 21 L128 31 C128 34 124 36 120 37 L110 44 C106 47 102 49 96 50 L84 48 C80 45 78 40 78 35 L60 33 L36 25 Z",
    detail:
      "M104 20 C108 14 114 13 118 17 M120 49 L113 32 M40 49 L78 43 M84 48 L62 50 M60 33 L72 42 M90 41 L100 37 M93 45 L104 40",
    accent: "M84 36 C96 30 110 26 124 27",
    wheels: [M(40), M(120)],
  },
  Trail: {
    body: "M30 20 L46 25 C58 22 70 21 78 22 C84 14 96 12 106 14 L112 18 L118 22 L112 30 L104 31 C96 33 86 33 78 32 L72 32 C60 31 50 30 44 29 L30 23 Z M72 33 L96 32 L99 44 C92 48 86 50 80 49 L72 43 Z",
    detail:
      "M124 48 L111 16 M110 28 L132 32 L128 35 L114 33 M108 14 L111 6 L117 7 L116 15 M100 11 L112 9 M40 48 L74 42 M80 51 L100 47 M78 33 L48 30 M48 27 L34 27 L34 31.5 L48 31.5 Z",
    accent: "M84 18 C92 15 100 15 106 16",
    wheels: [M(40, 18), M(124, 18)],
    spoked: true,
  },
  Touring: {
    body: "M48 30 C56 28 66 27 74 28 L80 27 C86 24 94 23 98 24 C102 21 110 18 118 19 L122 22 L126 32 C122 38 114 42 106 46 L98 46 C94 42 92 38 92 34 L82 35 L70 35 C62 35 54 34 48 33 Z M44 30 L43 21 C43 19 45 18 47 18 L51 18.5 L51 30 Z M23 11 C23 9 24 8 26 8 L43 8 C45 8 46 9 46 11 L46 20 L23 20 Z M20 25 C20 23 21 22 23 22 L50 22 L50 34 C50 35 49 35.5 48 35.5 L23 35.5 C21 35.5 20 34.5 20 33 Z M70 36 L92 36 L95 47 C88 50 80 51 76 50 L70 46 Z",
    detail:
      "M110 19 L106 6 L114 5 L120 19 M120 50 L112 32 M40 50 L72 46 M76 50 C66 51 56 50 48 46 M26 28.5 L44 28.5",
    accent: "M100 36 C108 31 116 28 123 28",
    wheels: [M(40, 16), M(120, 16)],
  },
  "Chopper/Cruiser": {
    body: "M80 30 C84 23 96 21 106 25 C102 29 92 32 82 32 Z M42 36 C50 38 62 38 74 33 L80 31 L78 35 C66 40 52 41 42 39 Z M72 38 L82 30 L88 36 L94 30 L102 38 L98 48 L76 48 Z",
    detail:
      "M132 50 L107 14 M106 15 L100 4 L108 3 M44 37 L40 20 L44 19 M78 35 L74 48 L36 50 M106 25 L102 38 M88 51 L46 56 M94 54 L54 59 M20 46 C22 34 34 30 48 34",
    accent: "M86 26 C92 24 98 24 103 25",
    wheels: [M(36, 16), M(132, 15)],
  },
  Enduro: {
    body: "M26 15 L44 22 C60 20 80 19.5 92 20 C96 16 102 15 108 16 L106 25 C98 29 88 30 80 30 L74 30 C62 29 52 28 46 27 L30 19 Z M74 31 L92 31 L94 41 C88 45 82 46 78 45 L72 40 Z",
    detail:
      "M122 48 L109 12 M102 22 L134 25 L129 28 L106 26 M106 13 L114 11 L118 21 L110 23 Z M100 9 L112 7 M40 48 L74 41 M82 32 C70 28 56 25 42 24 M78 46 L94 42",
    accent: "M90 24 C96 21 102 20 106 20",
    wheels: [M(40, 18), M(122, 18)],
    spoked: true,
  },
  "Moto 4": {
    body: "M20 40 C22 30 34 26 48 28 L56 28 C64 24 82 24 92 28 L100 28 C108 22 128 22 138 32 L140 38 L136 38 C132 32 114 31 110 38 L104 40 L58 40 L56 38 C52 32 34 32 28 40 Z",
    detail:
      "M18 26 L50 26 M22 26 L22 30 M90 16 L104 14 M97 16 L100 28 M108 22 L136 22 M132 22 L134 28 M60 46 L100 46 M58 40 L60 46 M104 40 L100 46",
    accent: "M64 34 L96 34",
    wheels: [M(40, 14), M(122, 14)],
  },
};

/** Ilustração do segmento, ou null se não houver (categoria nova). */
export function segmentArt(body: string): SegmentArt | null {
  return CAR[body] ?? MOTO[body] ?? null;
}
