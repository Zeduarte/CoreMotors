import Link from "next/link";
import { sameBrand } from "@/lib/brand-name";
import { DEFAULT_HOME_CONTENT } from "@/lib/home-content";

/**
 * Faixa de marcas em scroll contínuo (marquee). Duplicamos a lista e animamos
 * −50% em loop infinito para um deslize sem costura. Cada marca com viaturas
 * em stock é um link para o stock filtrado por essa marca (ex.: Yamaha → todas
 * as Yamaha); a faixa pára enquanto o rato está por cima, para se conseguir
 * clicar. Sob reduced-motion fica estática, mas continua legível.
 */
export function BrandMarquee({
  brands = DEFAULT_HOME_CONTENT.brands,
  available,
}: {
  brands?: string[];
  /** Marcas com viaturas em stock — só estas são clicáveis. Omisso: todas. */
  available?: string[];
}) {
  if (!brands.length) return null;
  const items = [...brands, ...brands];
  const inStock = (brand: string) =>
    !available || available.some((m) => sameBrand(m, brand));

  return (
    <section
      aria-label="Marcas representadas"
      className="overflow-hidden border-y border-white/10 py-8"
    >
      <div className="relative flex">
        <ul className="flex shrink-0 animate-marquee items-center gap-16 pr-16 will-change-transform hover:[animation-play-state:paused] focus-within:[animation-play-state:paused] motion-reduce:animate-none">
          {items.map((brand, i) => {
            const copy = i >= brands.length;
            const label =
              "whitespace-nowrap text-2xl font-semibold transition-colors md:text-3xl";
            return (
              <li key={`${brand}-${i}`} aria-hidden={copy || undefined}>
                {inStock(brand) ? (
                  <Link
                    href={`/inventario?make=${encodeURIComponent(brand)}`}
                    tabIndex={copy ? -1 : undefined}
                    title={`Ver viaturas ${brand}`}
                    className={`${label} text-paper/60 hover:text-accent focus-visible:text-accent focus-visible:outline-none`}
                  >
                    {brand}
                  </Link>
                ) : (
                  <span className={`${label} text-paper/25`}>{brand}</span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
