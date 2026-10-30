"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { Vehicle, VehicleFilters, SortKey } from "@/types/vehicle";
import {
  applyFilters,
  sortVehicles,
  emptyFilters,
  distinctValues,
  distinctMakes,
  filtersToQuery,
  filtersFromQuery,
  sortFromQuery,
} from "@/lib/vehicles";
import type { SearchField } from "@/lib/olx/search";
import dynamic from "next/dynamic";

// O alerta fica no fim da página: descarrega-se depois de a lista aparecer.
const StockAlertForm = dynamic(() => import("./StockAlertForm").then((m) => m.StockAlertForm), {
  ssr: false,
  loading: () => <div className="h-[34rem] animate-pulse rounded-3xl border border-white/10 bg-ink-soft" />,
});
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
  initialSort = "relevance",
  olxFields = [],
}: {
  vehicles: Vehicle[];
  initialFilters?: Partial<VehicleFilters>;
  initialSort?: SortKey;
  /** Filtros do OLX com opções no stock (vazio sem ligação ao OLX). */
  olxFields?: SearchField[];
}) {
  // O endereço manda: ao voltar da ficha, o Next pode repor a página com os
  // dados do 1.º pedido (sem os filtros escritos depois), mas o endereço já
  // os tem. No servidor e na hidratação é o mesmo endereço → mesmo resultado.
  const [fromUrl] = useState(() => {
    if (typeof window === "undefined") return null;
    const sp = Object.fromEntries(new URLSearchParams(window.location.search));
    return { filters: filtersFromQuery(sp), sort: sortFromQuery(sp) };
  });
  const [filters, setFilters] = useState<VehicleFilters>(() => ({
    ...emptyFilters(),
    ...initialFilters,
    ...(fromUrl?.filters ?? {}),
    ...(initialFilters?.vehicleType ? { vehicleType: initialFilters.vehicleType } : {}),
  }));
  const [sort, setSort] = useState<SortKey>(fromUrl?.sort ?? initialSort);

  // A pesquisa vai para o endereço (como no OLX): guarda-se, partilha-se e o
  // «voltar» da ficha regressa a ela. `replaceState` não cria entradas novas
  // no histórico a cada letra escrita. Com `null` (e não o estado atual do
  // histórico), o Next sincroniza o router com o endereço novo; com o estado
  // dele, ao voltar da ficha repunha o endereço antigo e os filtros perdiam-se.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const qs = filtersToQuery(filters, sort);
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
      if (url !== `${window.location.pathname}${window.location.search}`) {
        window.history.replaceState(null, "", url);
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [filters, sort]);

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
      colors: [...new Set(vehicles.map((v) => v.color.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt")),
      doors: [...new Set(vehicles.map((v) => v.doors).filter((d) => d > 0))].sort((a, b) => a - b),
      seats: [...new Set(vehicles.map((v) => v.seats).filter((d) => d > 0))].sort((a, b) => a - b),
      olxFields,
    }),
    [vehicles, filters.make, olxFields],
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
        <div className="rounded-2xl border border-white/10 bg-ink-soft p-10 text-center md:p-12">
          <p className="text-paper/70">
            Nenhuma viatura corresponde aos filtros. Experimente alargar os critérios
            — ou deixe um alerta e avisamos quando entrar.
          </p>
          <a
            href="#alerta"
            className="mt-5 inline-flex rounded-full bg-accent px-6 py-3 text-sm font-semibold text-ink transition-transform hover:scale-[1.02]"
          >
            Criar alerta para esta pesquisa
          </a>
        </div>
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

      {/* O alerta acompanha a pesquisa: quem filtrou e não encontrou tem os
          critérios já preenchidos. */}
      <section id="alerta" className="scroll-mt-28 pt-10">
        <StockAlertForm
          vehicleType={filters.vehicleType ?? "car"}
          makes={options.makes}
          defaults={{
            make: filters.make,
            model: filters.model,
            body: filters.body,
            fuel: filters.fuel,
            max_price: filters.maxPrice,
            min_year: filters.minYear,
            max_km: filters.maxMileage,
          }}
        />
      </section>
    </div>
  );
}
