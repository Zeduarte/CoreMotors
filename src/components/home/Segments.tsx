import Link from "next/link";
import { Cormorant_Garamond } from "next/font/google";

// Letra de título com requinte, só para os nomes dos segmentos.
const serif = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["italic"],
  display: "swap",
});

export type Segment = {
  body: string;
  count: number;
};

/**
 * «Que segmento procura?» — um cartão por categoria com viaturas em stock:
 * o nome, em letra de título, e quantas há. Leva ao stock já filtrado pela
 * categoria.
 *
 * Telemóvel: fila que desliza na horizontal (com snap). Tablet: os cartões
 * centrados, em mais de uma linha se preciso. Desktop: todos numa só linha.
 */
export function Segments({
  segments,
  title = "Que segmento procura?",
}: {
  segments: Segment[];
  title?: string;
}) {
  if (!segments.length) return null;

  return (
    <section aria-labelledby="segmentos" className="container-px pt-8 md:pt-24">
      <h2
        id="segmentos"
        className="mb-6 text-2xl font-semibold text-paper md:mb-8 md:text-3xl"
      >
        {title}
      </h2>

      <ul className="-mx-6 flex snap-x snap-mandatory scroll-px-6 gap-3 overflow-x-auto px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:flex-wrap md:justify-center md:gap-4 md:overflow-visible md:px-0 lg:flex-nowrap [&::-webkit-scrollbar]:hidden">
        {segments.map(({ body, count }) => (
          <li
            key={body}
            className="w-[10.5rem] shrink-0 snap-start md:w-44 lg:w-auto lg:max-w-[15rem] lg:flex-1 lg:shrink"
          >
            <Link
              href={`/inventario?categoria=${encodeURIComponent(body)}`}
              className="group relative flex h-32 flex-col justify-between overflow-hidden rounded-2xl border border-white/[0.07] bg-gradient-to-br from-white/[0.06] via-white/[0.02] to-transparent p-4 transition-[transform,border-color] duration-300 ease-premium hover:-translate-y-1 hover:border-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:h-36 md:p-5"
            >
              {/* Brilho na cor do site no canto, mais forte ao passar o rato. */}
              <span
                aria-hidden
                className="pointer-events-none absolute -bottom-10 -right-10 h-28 w-28 rounded-full bg-accent/10 blur-2xl transition-opacity duration-500 group-hover:bg-accent/25"
              />

              <span className="flex items-center justify-between text-[10px] font-medium uppercase tracking-[0.22em] text-paper/45">
                {count} {count === 1 ? "viatura" : "viaturas"}
                <span
                  aria-hidden
                  className="text-sm tracking-normal text-accent opacity-0 transition-[opacity,transform] duration-300 ease-premium group-hover:translate-x-0.5 group-hover:opacity-100"
                >
                  →
                </span>
              </span>

              <span>
                {/* Quebra depois da barra («Chopper/Cruiser») em vez de cortar. */}
                <span
                  className={`${serif.className} block text-[1.6rem] font-semibold italic leading-[0.95] text-paper transition-colors duration-300 group-hover:text-accent md:text-[2rem]`}
                >
                  {body.replace("/", "/​")}
                </span>
                <span
                  aria-hidden
                  className="mt-2.5 block h-px w-6 bg-accent transition-[width] duration-500 ease-premium group-hover:w-12"
                />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
