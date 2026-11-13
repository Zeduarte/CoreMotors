import Link from "next/link";
import type { Vehicle } from "@/types/vehicle";
import type { VehicleType } from "@/lib/vehicle-categories";
import { seoPagesFor, seoPath, TYPE_PATH, usedLabel, type SeoKind } from "@/lib/seo-pages";

const GROUPS: { kind: SeoKind; title: string }[] = [
  { kind: "brand", title: "Por marca" },
  { kind: "body", title: "Por categoria" },
  { kind: "fuel", title: "Por combustível" },
  { kind: "price", title: "Por preço" },
];

/**
 * "Pesquisas populares": links para as páginas por marca, categoria e preço.
 * São o caminho por onde o Google as encontra (além do sitemap) e um atalho
 * para quem prefere escolher a marca em vez de usar os filtros.
 */
export function SeoLinks({
  type,
  vehicles,
  current,
  showType = false,
  className = "",
}: {
  type: VehicleType;
  vehicles: Vehicle[];
  /** A página onde se está (não aparece na lista). */
  current?: string;
  /** Com uma caixa por tipo na mesma página: «Pesquisas populares — motas». */
  showType?: boolean;
  className?: string;
}) {
  const pages = seoPagesFor(type, vehicles).filter((p) => p.page.slug !== current);
  if (!pages.length) return null;
  // Um id por tipo: o stock tem uma caixa de carros e outra de motas.
  const id = `pesquisas-populares-${TYPE_PATH[type]}`;
  return (
    <nav aria-labelledby={id} className={`rounded-3xl border border-white/10 p-6 md:p-8 ${className}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id={id} className="text-lg font-semibold text-paper md:text-xl">
          Pesquisas populares{showType && ` — ${TYPE_PATH[type]}`}
        </h2>
        <Link href={`/${TYPE_PATH[type]}`} className="text-sm text-accent hover:underline">
          {type === "motorcycle" ? "Todas as" : "Todos os"} {usedLabel(type).toLowerCase()} →
        </Link>
      </div>
      <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {GROUPS.map((g) => {
          const items = pages.filter((p) => p.page.kind === g.kind);
          if (!items.length) return null;
          return (
            <div key={g.kind}>
              <p className="mb-2 text-xs font-medium uppercase tracking-wider text-paper/40">{g.title}</p>
              <ul className="flex flex-wrap gap-1.5">
                {items.map(({ page, count }) => (
                  <li key={page.slug}>
                    <Link
                      href={seoPath(page)}
                      prefetch={false}
                      className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-3 py-1.5 text-sm text-paper/80 transition-colors hover:border-accent hover:text-accent"
                    >
                      {page.label}
                      <span className="text-xs text-paper/40">{count}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </nav>
  );
}
