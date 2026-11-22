import Link from "next/link";
import Image from "next/image";
import type { Vehicle } from "@/types/vehicle";
import type { VehicleType } from "@/lib/vehicle-categories";
import { BENEFITS, STOCK_LINKS, categoryCards, heroTexts, latestFirst } from "@/themes/core2/ui";
import { kindOf, kindsFor } from "@/themes/core2/stock";
import { Core2Icon } from "./icons";
import { Core2Latest } from "./Core2Latest";

/**
 * Página inicial do Core2 (como nas maquetes): o topo com o título, os dois
 * botões e a foto da loja; os cartões das categorias (Motas, Moto 4,
 * Automóveis); as últimas entradas (as viaturas do backoffice que entraram há
 * menos tempo); e a faixa das vantagens. O rodapé vem da layout.
 */
export function Core2Home({ vehicles, siteTypes }: { vehicles: Vehicle[]; siteTypes: VehicleType[] }) {
  const hasMoto4 = vehicles.some((v) => kindOf(v) === "moto4");
  const hero = heroTexts(siteTypes, hasMoto4);
  const cards = categoryCards(siteTypes, hasMoto4);
  const moto = siteTypes.includes("motorcycle");
  const car = siteTypes.includes("car");
  // Só vão para o browser as 3 mais recentes de cada separador (Todos, Motas…).
  const kinds = kindsFor(siteTypes, vehicles);
  const sorted = latestFirst(vehicles);
  const chosen = new Set([...sorted.slice(0, 3), ...kinds.flatMap((k) => sorted.filter((v) => kindOf(v) === k).slice(0, 3))]);
  const latest = sorted.filter((v) => chosen.has(v));

  return (
    <div className="bg-white pb-10 text-neutral-900 md:pb-12">
      {/* Topo: no computador a foto à direita, a desvanecer para o título; no telemóvel por cima dele. */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="relative aspect-[5/2] md:absolute md:inset-y-0 md:right-0 md:aspect-auto md:w-[68%]">
          <Image
            src="/media/core2/inicio.jpg"
            alt=""
            fill
            priority
            sizes="(max-width: 768px) 100vw, 68vw"
            className="object-cover object-left"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent from-45% to-white md:hidden" />
          <div className="absolute inset-0 hidden bg-gradient-to-r from-white from-0% via-white/40 via-[16%] to-transparent to-[38%] md:block" />
        </div>
        <div className="container-px relative -mt-9 pb-2 md:mt-0 md:flex md:min-h-[22rem] md:flex-col md:justify-center md:py-10">
          <h1 className="core2-serif max-w-[36rem] text-[2.55rem] leading-[1.04] md:text-[3.45rem]">{hero.title}</h1>
          <span aria-hidden className="mt-3 block h-1 w-14 rounded-full bg-accent md:mt-4 md:w-16" />
          <p className="mt-4 max-w-[30rem] text-[1.05rem] leading-snug text-neutral-700 md:text-[1.2rem]">{hero.subtitle}</p>
          <div className="mt-6 flex flex-wrap gap-3 md:gap-5">
            {moto && (
              <Link
                href={STOCK_LINKS.motas}
                className="inline-flex items-center gap-3 rounded-md bg-accent px-6 py-2.5 text-[1.1rem] font-semibold text-white shadow-sm transition-[filter] hover:brightness-110 md:px-8 md:py-3"
              >
                Ver motas <Core2Icon name="arrow" className="h-5 w-5" strokeWidth={2.4} />
              </Link>
            )}
            {car && (
              <Link
                href={STOCK_LINKS.carros}
                className="inline-flex items-center gap-3 rounded-md border-2 border-neutral-900 px-6 py-2 text-[1.1rem] font-semibold text-neutral-900 transition-colors hover:bg-neutral-900 hover:text-white md:px-8 md:py-2.5"
              >
                Ver carros <Core2Icon name="arrow" className="h-5 w-5" strokeWidth={2.4} />
              </Link>
            )}
          </div>
        </div>
      </section>

      {/* Categorias: um cartão com foto por tipo. */}
      {cards.length > 0 && (
        <nav
          aria-label="Categorias"
          className={`container-px mt-7 grid gap-3 md:mt-6 md:gap-5 ${cards.length >= 3 ? "grid-cols-3" : cards.length === 2 ? "grid-cols-2" : "grid-cols-1"}`}
        >
          {cards.map((c) => (
            <Link
              key={c.key}
              href={c.href}
              className="group relative block h-[5.5rem] overflow-hidden rounded-xl shadow-[0_4px_14px_-6px_rgb(0_0_0/0.35)] sm:h-32 md:h-[10.5rem]"
            >
              <Image
                src={c.photo}
                alt=""
                fill
                sizes="(max-width: 768px) 33vw, 30vw"
                className="object-cover object-[72%_50%] transition-transform duration-500 group-hover:scale-105"
              />
              <span aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/55 via-black/20 to-transparent" />
              <span className="relative flex h-full flex-col justify-end gap-1.5 p-3 md:justify-center md:gap-3 md:px-8">
                <span className="core2-serif text-lg leading-none text-white drop-shadow md:text-[2.2rem]">
                  <span className="md:hidden">{c.short}</span>
                  <span className="hidden md:inline">{c.label}</span>
                </span>
                <span aria-hidden className="grid h-6 w-6 place-items-center rounded-full bg-accent text-white md:h-8 md:w-8">
                  <Core2Icon name="arrow" className="h-3.5 w-3.5 md:h-4 md:w-4" strokeWidth={2.6} />
                </span>
              </span>
            </Link>
          ))}
        </nav>
      )}

      {/* Últimas entradas (com os separadores por tipo no computador). */}
      <Core2Latest vehicles={latest} kinds={kinds} />

      {/* Vantagens. */}
      <section aria-label="Vantagens" className="container-px mt-8 md:mt-7">
        <ul className="grid grid-cols-3 rounded-xl bg-[#f3f2f0] py-4 md:py-5">
          {BENEFITS.map((b, i) => (
            <li
              key={b.title}
              className={`flex flex-col items-center gap-1.5 px-2 text-center md:flex-row md:justify-center md:gap-5 md:px-6 md:text-left ${
                i > 0 ? "border-l border-neutral-300" : ""
              }`}
            >
              <Core2Icon name={b.icon} className="h-8 w-8 shrink-0 text-accent md:h-11 md:w-11" strokeWidth={1.7} />
              <div>
                <p className="text-[0.82rem] font-semibold leading-tight text-neutral-900 md:text-[1.15rem]">{b.title}</p>
                <p className="mt-1 text-[0.72rem] leading-snug text-neutral-600 md:text-[0.8rem]">{b.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
