"use client";

import { useState } from "react";
import Link from "next/link";
import type { Vehicle } from "@/types/vehicle";
import { kindOf, type StockKind } from "@/themes/core2/stock";
import { RowCard } from "@/components/themes/core2/Core2Stock";
import type { Core3Category } from "@/themes/core3/ui";
import { Core3Icon } from "./icons";

const SHOWN = 6;

/**
 * «Últimas entradas» da página inicial: as viaturas mais recentes, com os
 * separadores Todos · Motas · Moto 4 · Automóveis (só os tipos do site) e a
 * ligação ao stock completo. Os cartões são os do stock (deitados).
 */
export function Core3Latest({ vehicles, categories }: { vehicles: Vehicle[]; categories: Core3Category[] }) {
  const [tab, setTab] = useState<StockKind | "all">("all");
  if (!vehicles.length) return null;
  const shown = vehicles.filter((v) => tab === "all" || kindOf(v) === tab).slice(0, SHOWN);
  const tabs = [{ key: "all" as const, label: "Todos" }, ...categories.map((c) => ({ key: c.key, label: c.label }))];

  return (
    <section className="container-px mt-12 text-paper md:mt-14" aria-labelledby="core3-latest">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h2 id="core3-latest" className="core2-serif text-3xl md:text-4xl">
          Últimas entradas
        </h2>
        <div className="flex items-center gap-4">
          {categories.length > 1 && (
            <div role="group" aria-label="Tipo de viatura" className="flex flex-wrap gap-2">
              {tabs.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={`rounded-full border px-3.5 py-1 text-sm font-medium transition-colors ${
                    tab === t.key ? "border-accent bg-accent text-ink" : "border-white/20 text-paper/80 hover:border-white/50"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}
          <Link href="/inventario" className="hidden items-center gap-1.5 text-sm font-semibold text-accent hover:underline sm:inline-flex">
            Ver todo o stock <Core3Icon name="arrow" className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {shown.map((v) => (
          <RowCard key={v.slug} vehicle={v} />
        ))}
      </div>
      <Link href="/inventario" className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-accent hover:underline sm:hidden">
        Ver todo o stock <Core3Icon name="arrow" className="h-4 w-4" />
      </Link>
    </section>
  );
}
