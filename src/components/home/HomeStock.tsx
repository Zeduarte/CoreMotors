"use client";

import { useState } from "react";
import Link from "next/link";
import type { Vehicle } from "@/types/vehicle";
import { VehicleCard } from "@/components/vehicle/VehicleCard";

const STEP = 12;

/**
 * «Stock» na homepage: todas as viaturas disponíveis em grelha (4 por linha no
 * desktop largo). Mostra 12 de cada vez — «Ver mais» acrescenta as seguintes —
 * para a página não carregar dezenas de fotos de uma vez.
 */
export function HomeStock({
  vehicles,
  eyebrow = "Veja todos os nossos veículos disponíveis em loja.",
  title = "Stock",
}: {
  vehicles: Vehicle[];
  eyebrow?: string;
  title?: string;
}) {
  const [visible, setVisible] = useState(STEP);
  if (!vehicles.length) return null;
  const shown = vehicles.slice(0, visible);
  const remaining = vehicles.length - shown.length;

  return (
    <section aria-labelledby="stock" className="container-px py-16 md:py-24">
      <div className="mb-8 md:mb-10">
        <p className="mb-2 text-sm font-medium text-accent md:text-base">{eyebrow}</p>
        <h2 id="stock" className="text-3xl font-semibold text-paper md:text-4xl">
          {title}
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((vehicle) => (
          // A mesma viatura já está nos destaques: sem foto partilhada aqui,
          // senão o browser cancelava a transição para a ficha.
          <VehicleCard key={vehicle.slug} vehicle={vehicle} sharedTransition={false} />
        ))}
      </div>

      <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
        {remaining > 0 && (
          <button
            type="button"
            onClick={() => setVisible((v) => v + STEP)}
            className="rounded-lg border border-white/15 px-6 py-3.5 text-sm font-semibold text-paper transition-colors hover:border-white/50"
          >
            Ver mais viaturas ({remaining})
          </button>
        )}
        <Link
          href="/inventario"
          className="group inline-flex items-center gap-2 rounded-lg bg-accent px-6 py-3.5 text-sm font-semibold text-ink transition-transform duration-300 ease-premium hover:scale-[1.03]"
        >
          Pesquisar com filtros
          <span className="transition-transform duration-300 group-hover:translate-x-1">→</span>
        </Link>
      </div>
    </section>
  );
}
