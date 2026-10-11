import Link from "next/link";
import { BodyIcon } from "@/components/ui/BodyIcon";

/**
 * «Que segmento procura?» — um quadrado por categoria com viaturas em stock
 * (silhueta + nome + contagem). Leva ao stock já filtrado pela categoria.
 *
 * Telemóvel: fila que desliza na horizontal (com snap). Tablet: os quadrados
 * centrados, em mais de uma linha se preciso. Desktop: todos numa só linha.
 */
export function Segments({
  segments,
  title = "Que segmento procura?",
}: {
  segments: { body: string; count: number }[];
  title?: string;
}) {
  if (!segments.length) return null;

  return (
    <section aria-labelledby="segmentos" className="container-px pt-16 md:pt-24">
      <h2 id="segmentos" className="mb-6 text-2xl font-semibold text-paper md:mb-8 md:text-3xl">
        {title}
      </h2>

      <ul className="-mx-6 flex snap-x snap-mandatory scroll-px-6 gap-3 overflow-x-auto px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:flex-wrap md:justify-center md:gap-4 md:overflow-visible md:px-0 lg:flex-nowrap [&::-webkit-scrollbar]:hidden">
        {segments.map(({ body, count }) => (
          <li key={body} className="shrink-0 snap-start lg:max-w-[9rem] lg:flex-1 lg:shrink">
            <Link
              href={`/inventario?categoria=${encodeURIComponent(body)}`}
              className="group flex h-32 w-32 flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-ink-soft px-3 text-center transition-[transform,border-color,background-color] duration-300 ease-premium hover:-translate-y-1 hover:border-accent/40 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent md:h-36 md:w-36 lg:w-full"
            >
              <BodyIcon
                body={body}
                className="h-10 w-full max-w-[6.5rem] text-paper/70 transition-colors group-hover:text-accent"
              />
              <span className="max-w-full truncate text-sm font-medium text-paper">
                {body}
                <span className="ml-1.5 text-xs font-normal text-paper/40">{count}</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
