"use client";

import { useState } from "react";
import Link from "next/link";
import type { Vehicle } from "@/types/vehicle";
import { FadeImage } from "@/components/ui/FadeImage";
import { kindOf, type StockKind } from "@/themes/core2/stock";
import { latestLines, priceText } from "@/themes/core2/ui";
import { Core2Icon } from "./icons";

const TAB_LABEL: Record<StockKind, string> = { motas: "Motas", moto4: "Moto 4", carros: "Automóveis" };

/**
 * «Últimas entradas» do Core2: três cartões horizontais (foto à esquerda,
 * marca, modelo, ano, duas linhas de dados, preço e a seta para a ficha). No
 * computador, os separadores Todos · Motas · Moto 4 · Automóveis escolhem o
 * tipo; no telemóvel ficam só os cartões, como na maqueta.
 */
export function Core2Latest({ vehicles, kinds }: { vehicles: Vehicle[]; kinds: StockKind[] }) {
  const [tab, setTab] = useState<"todos" | StockKind>("todos");
  const shown = (tab === "todos" ? vehicles : vehicles.filter((v) => kindOf(v) === tab)).slice(0, 3);
  if (!vehicles.length) return null;

  return (
    <section aria-labelledby="ultimas-entradas" className="container-px mt-9 md:mt-10">
      <div className="flex items-center justify-between gap-4">
        <h2 id="ultimas-entradas" className="core2-serif text-[1.85rem] leading-tight md:text-[2.4rem]">
          Últimas entradas
        </h2>
        <div className="flex items-center gap-4">
          {kinds.length > 0 && (
            <>
              <div role="group" aria-label="Tipo" className="hidden items-center gap-2.5 md:flex">
                {(["todos", ...kinds] as const).map((k) => {
                  const on = tab === k;
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setTab(k)}
                      className={`rounded-full border px-4 py-1 text-[0.95rem] transition-colors ${
                        on
                          ? "border-accent bg-accent font-semibold text-white"
                          : "border-neutral-300 bg-white text-neutral-800 hover:border-neutral-500"
                      }`}
                    >
                      {k === "todos" ? "Todos" : TAB_LABEL[k]}
                    </button>
                  );
                })}
              </div>
              <span aria-hidden className="hidden h-7 w-px bg-neutral-300 md:block" />
            </>
          )}
          <Link href="/inventario" className="inline-flex items-center gap-1.5 whitespace-nowrap text-[0.95rem] font-semibold text-accent hover:underline">
            Ver todo o stock <Core2Icon name="arrow" className="h-4 w-4" strokeWidth={2.4} />
          </Link>
        </div>
      </div>

      {shown.length ? (
        <ul className="mt-4 grid gap-3 md:mt-5 md:grid-cols-3 md:gap-5">
          {shown.map((v, i) => (
            <li key={v.slug}>
              <LatestCard vehicle={v} priority={i === 0} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-5 rounded-xl border border-neutral-200 p-6 text-center text-neutral-600">Sem entradas recentes deste tipo.</p>
      )}
    </section>
  );
}

function LatestCard({ vehicle: v, priority }: { vehicle: Vehicle; priority: boolean }) {
  const cover = v.images[0];
  const [line1, line2] = latestLines(v);
  return (
    <Link
      href={`/viaturas/${v.slug}`}
      className="group flex h-full min-h-[8.5rem] overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-[0_2px_10px_-4px_rgb(0_0_0/0.15)] transition-shadow hover:shadow-[0_8px_22px_-8px_rgb(0_0_0/0.25)] md:min-h-[11.5rem]"
    >
      <div className="relative w-[41%] shrink-0 overflow-hidden bg-neutral-100 md:w-[56%]">
        {cover && (
          <FadeImage
            src={cover.src}
            alt={cover.alt || `${v.make} ${v.model}`}
            fill
            priority={priority}
            sizes="(max-width: 768px) 40vw, 18vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col px-4 py-3 md:px-4 md:py-4">
        <p className="text-[0.95rem] font-bold leading-tight">{v.make}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 md:flex-col md:items-start">
          <h3 className="text-[1.15rem] font-bold leading-tight md:text-[1.2rem]">{v.model}</h3>
          {v.year ? (
            <span className="rounded-md border border-neutral-300 px-2 py-px text-[0.78rem] font-medium tabular-nums text-neutral-800">
              {v.year}
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[0.8rem] leading-snug text-neutral-600">
          {line1}
          <br />
          {line2}
        </p>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="core2-serif text-[1.65rem] leading-none text-accent md:text-[1.75rem]">{priceText(v)}</span>
          <span
            aria-hidden
            className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-neutral-300 text-accent transition-colors group-hover:border-accent"
          >
            <Core2Icon name="arrow" className="h-4 w-4" strokeWidth={2.4} />
          </span>
        </div>
      </div>
    </Link>
  );
}
