import Link from "next/link";
import Image from "next/image";
import type { VehicleType } from "@/lib/vehicle-categories";
import { STOCK_LINKS, categoryCards, heroTexts } from "@/themes/core2/ui";
import { Core2Icon } from "./icons";

/**
 * O topo do Stock do Core2 (como na maqueta, no fundo preto do site): o título
 * com o traço laranja, a frase, os botões «Ver motas» e «Ver carros» e a foto
 * da loja, a desvanecer para o título; por baixo, os cartões das categorias
 * (Motas, Moto 4, Automóveis). Os botões e os cartões filtram a lista de
 * baixo e saltam para ela (`#lista`).
 */
export function Core2StockTop({ siteTypes, hasMoto4 }: { siteTypes: VehicleType[]; hasMoto4: boolean }) {
  const hero = heroTexts(siteTypes, hasMoto4);
  const cards = categoryCards(siteTypes, hasMoto4);
  const moto = siteTypes.includes("motorcycle");
  const car = siteTypes.includes("car");

  return (
    <div className="text-paper">
      {/* No computador a foto à direita, a desvanecer para o título; no telemóvel por cima dele. */}
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
          <div className="absolute inset-0 bg-gradient-to-b from-transparent from-45% to-ink md:hidden" />
          <div className="absolute inset-0 hidden bg-gradient-to-r from-ink from-[6%] via-ink/45 via-[20%] to-transparent to-[42%] md:block" />
        </div>
        <div className="container-px relative -mt-9 pb-2 md:mt-0 md:flex md:min-h-[22rem] md:flex-col md:justify-center md:py-10">
          <h1 className="core2-serif max-w-[36rem] text-[2.55rem] leading-[1.04] md:text-[3.45rem]">{hero.title}</h1>
          <span aria-hidden className="mt-3 block h-1 w-14 rounded-full bg-accent md:mt-4 md:w-16" />
          <p className="mt-4 max-w-[30rem] text-[1.05rem] leading-snug text-paper/75 md:text-[1.2rem]">{hero.subtitle}</p>
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
                className="inline-flex items-center gap-3 rounded-md border-2 border-paper px-6 py-2 text-[1.1rem] font-semibold text-paper transition-colors hover:bg-paper hover:text-ink md:px-8 md:py-2.5"
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
              className="group relative block h-[5.5rem] overflow-hidden rounded-xl border border-white/10 sm:h-32 md:h-[10.5rem]"
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
    </div>
  );
}
