import { isMotorcycleBody } from "@/lib/vehicle-categories";
import Link from "next/link";

export type Segment = {
  body: string;
  count: number;
};

/**
 * «Que segmento procura?» — um cartão por categoria com viaturas em stock:
 * o nome e quantas há. Leva ao stock já filtrado pela
 * categoria.
 *
 * Num site com carros e motas, as categorias ficam em dois grupos («Carros»
 * e «Motas»): são até 13 e, numa só fila, saíam do ecrã pelos dois lados.
 *
 * Telemóvel: cada grupo é uma fila que desliza na horizontal (com snap).
 * Tablet e computador: grelha de cartões da mesma largura, em quantas linhas
 * forem precisas — nunca mais larga do que o ecrã.
 */
export function Segments({
  segments,
  title = "Que segmento procura?",
}: {
  segments: Segment[];
  title?: string;
}) {
  if (!segments.length) return null;

  // A categoria diz o tipo (Naked é de motas). Só com os dois há títulos.
  const groups = [
    { label: "Carros", items: segments.filter((s) => !isMotorcycleBody(s.body)) },
    { label: "Motas", items: segments.filter((s) => isMotorcycleBody(s.body)) },
  ].filter((g) => g.items.length > 0);
  const labelled = groups.length > 1;

  return (
    <section aria-labelledby="segmentos" className="container-px pt-8 md:pt-24">
      <h2
        id="segmentos"
        className="mb-6 text-2xl font-semibold text-paper md:mb-8 md:text-3xl"
      >
        {title}
      </h2>

      <div className="space-y-6 md:space-y-8">
        {groups.map((g) => (
          <div key={g.label}>
            {labelled && (
              <h3 className="mb-3 text-xs font-medium uppercase tracking-[0.22em] text-paper/45">
                {g.label}
              </h3>
            )}
            <SegmentList segments={g.items} />
          </div>
        ))}
      </div>
    </section>
  );
}

function SegmentList({ segments }: { segments: Segment[] }) {
  // Cartões da mesma largura: tantas colunas quantas couberem (a largura
  // mínima deixa caber «Descapotável» sem cortar).
  return (
    <ul className="-mx-6 flex snap-x snap-mandatory scroll-px-6 gap-3 overflow-x-auto px-6 pb-2 [-ms-overflow-style:none] [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] md:gap-4 md:overflow-visible md:px-0 md:pb-0 xl:grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] [&::-webkit-scrollbar]:hidden">
        {segments.map(({ body, count }) => (
          <li
            key={body}
            className="w-[10.5rem] shrink-0 snap-start md:w-auto md:min-w-0"
          >
            <Link
              // A categoria diz o tipo (Naked é de motas): o stock abre já nele.
              href={`/inventario?${isMotorcycleBody(body) ? "tipo=motas" : "tipo=carros"}&categoria=${encodeURIComponent(body)}`}
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
                  className="block break-words text-xl font-semibold leading-tight tracking-tight text-paper transition-colors duration-300 group-hover:text-accent xl:text-2xl"
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
  );
}
