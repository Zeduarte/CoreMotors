"use client";

import { useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Vehicle, VehicleFilters, SortKey } from "@/types/vehicle";
import {
  applyFilters,
  sortVehicles,
  emptyFilters,
  distinctValues,
  distinctMakes,
} from "@/lib/vehicles";
import { sameBrand } from "@/lib/brand-name";
import { Filters } from "./Filters";
import { VehicleCard } from "@/components/vehicle/VehicleCard";

/**
 * Ilha cliente do inventário.
 *
 * Recebe TODAS as viaturas do servidor e faz a filtragem/ordenação em memória
 * — adequado a um stand (dezenas a centenas de viaturas). Quando a fonte passar
 * a API paginada, `applyFilters`/`sortVehicles` migram para query params sem
 * alterar este componente.
 *
 * Animação: `AnimatePresence` + `layout` fazem os cards reorganizarem-se com
 * transição ao filtrar/ordenar (entrada/saída em stagger via `delay` por
 * índice). O Framer Motion respeita `prefers-reduced-motion` do sistema.
 */
export function InventoryClient({
  vehicles,
  initialFilters,
}: {
  vehicles: Vehicle[];
  initialFilters?: Partial<VehicleFilters>;
}) {
  const [filters, setFilters] = useState<VehicleFilters>(() => ({
    ...emptyFilters(),
    ...initialFilters,
  }));
  const [sort, setSort] = useState<SortKey>("relevance");

  const options = useMemo(
    () => ({
      locations: Array.from(
        new Map(
          vehicles
            .filter((v) => v.pointOfSaleId || v.location)
            .map((v) => [
              v.pointOfSaleId || v.location!,
              {
                value: v.pointOfSaleId || v.location!,
                label: v.location || "Ponto de venda",
              },
            ]),
        ).values(),
      ),
      makes: distinctMakes(vehicles),
      // Os modelos acompanham a marca selecionada, se houver.
      models: distinctValues(
        filters.make
          ? vehicles.filter((v) => sameBrand(v.make, filters.make!))
          : vehicles,
        "model",
      ) as string[],
      fuels: distinctValues(vehicles, "fuel"),
      transmissions: distinctValues(vehicles, "transmission"),
      bodies: distinctValues(vehicles, "body"),
      // Quantas viaturas há em cada categoria (os quadrados da pesquisa).
      bodyCounts: vehicles.reduce<Record<string, number>>((acc, v) => {
        acc[v.body] = (acc[v.body] ?? 0) + 1;
        return acc;
      }, {}),
    }),
    [vehicles, filters.make],
  );

  const results = useMemo(
    () => sortVehicles(applyFilters(vehicles, filters), sort),
    [vehicles, filters, sort],
  );

  return (
    <div className="space-y-10">
      <Filters
        filters={filters}
        sort={sort}
        options={options}
        resultCount={results.length}
        onChange={(patch) => setFilters((f) => ({ ...f, ...patch }))}
        onSort={setSort}
        onReset={() => {
          setFilters({
            ...emptyFilters(),
            vehicleType: initialFilters?.vehicleType ?? null,
          });
          setSort("relevance");
        }}
      />

      {results.length === 0 ? (
        <p className="rounded-2xl border border-white/10 bg-ink-soft p-12 text-center text-paper/60">
          Nenhuma viatura corresponde aos filtros. Experimente alargar os
          critérios.
        </p>
      ) : (
        <motion.div
          layout
          className="grid gap-x-6 gap-y-12 sm:grid-cols-2 lg:grid-cols-3 min-[1400px]:grid-cols-4"
        >
          {/* `initial={false}`: ao chegar à página os cartões já lá estão (a
              página entra a deslizar); só os que entram ao filtrar animam. */}
          <AnimatePresence mode="popLayout" initial={false}>
            {results.map((vehicle, i) => (
              <motion.div
                key={vehicle.slug}
                layout
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                // Saída mais rápida do que a entrada: o que sai não deve
                // atrasar o que fica.
                exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.2 } }}
                transition={{
                  duration: 0.4,
                  ease: [0.22, 1, 0.36, 1],
                  delay: Math.min(i * 0.05, 0.3),
                  // A reorganização (filtrar/ordenar) move todos os cards em
                  // conjunto — sem o atraso em cascata da entrada.
                  layout: { duration: 0.45, ease: [0.22, 1, 0.36, 1] },
                }}
              >
                <VehicleCard vehicle={vehicle} priority={i < 3} />
              </motion.div>
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}
