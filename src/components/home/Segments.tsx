import Link from "next/link";
import { FadeImage } from "@/components/ui/FadeImage";

export type Segment = {
  body: string;
  count: number;
  /** Capa de uma viatura em stock desta categoria. */
  image: { src: string; alt: string } | null;
};

/**
 * «Que segmento procura?» — um cartão por categoria com viaturas em stock:
 * foto real de uma delas, nome e quantas há. Leva ao stock já filtrado pela
 * categoria. Sem foto (raro), fica só o fundo neutro.
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
    <section aria-labelledby="segmentos" className="container-px pt-16 md:pt-24">
      <h2 id="segmentos" className="mb-6 text-2xl font-semibold text-paper md:mb-8 md:text-3xl">
        {title}
      </h2>

      <ul className="-mx-6 flex snap-x snap-mandatory scroll-px-6 gap-3 overflow-x-auto px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:flex-wrap md:justify-center md:gap-4 md:overflow-visible md:px-0 lg:flex-nowrap [&::-webkit-scrollbar]:hidden">
        {segments.map(({ body, count, image }) => (
          <li key={body} className="w-36 shrink-0 snap-start md:w-40 lg:w-auto lg:max-w-[11rem] lg:flex-1 lg:shrink">
            <Link
              href={`/inventario?categoria=${encodeURIComponent(body)}`}
              className="group block rounded-2xl border border-white/5 bg-ink-soft p-2 transition-[transform,border-color,background-color] duration-300 ease-premium hover:-translate-y-1 hover:border-accent/40 hover:bg-white/[0.04] focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
            >
              <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-ink-muted">
                {image && (
                  <FadeImage
                    src={image.src}
                    alt=""
                    fill
                    sizes="176px"
                    className="object-cover transition-transform duration-500 ease-premium group-hover:scale-105"
                  />
                )}
              </div>
              <div className="px-1 pb-1 pt-2.5 text-center">
                {/* Quebra depois da barra («Chopper/Cruiser») em vez de cortar. */}
                <p className="text-sm font-semibold leading-tight text-paper group-hover:text-accent">
                  {body.replace("/", "/​")}
                </p>
                <p className="mt-0.5 text-xs text-paper/50">
                  {count} {count === 1 ? "viatura" : "viaturas"}
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
