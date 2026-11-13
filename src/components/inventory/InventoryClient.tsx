"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
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
import { bodiesFor, type VehicleType } from "@/lib/vehicle-categories";
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
 * Tira os filtros que o tipo escolhido não tem. Um link antigo
 * (`?categoria=SUV` num site só de motas, `?tipo=motas&categoria=SUV`, ou
 * `?combustivel=Diesel` sem motas a diesel) deixava a lista vazia com o
 * filtro escondido — a categoria não aparece entre as do tipo, e só «Limpar»
 * resolvia. Também ao trocar de tipo no stock (Carros → Motas com Diesel, uma
 * cor ou uma potência mínima que nenhuma mota tem).
 */
export function fitFiltersToType(f: VehicleFilters, vehicles: Vehicle[]): VehicleFilters {
  const type = f.vehicleType;
  if (!type) return f;
  const pool = vehicles.filter((v) => (v.vehicleType ?? "car") === type);
  const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const next: VehicleFilters = {
    ...f,
    body: f.body && !bodiesFor(type).includes(f.body) ? null : f.body,
    fuel: f.fuel && !pool.some((v) => v.fuel === f.fuel) ? null : f.fuel,
    color: f.color && !pool.some((v) => same(v.color, f.color!)) ? null : f.color,
    minPower: f.minPower != null && !pool.some((v) => v.power >= f.minPower!) ? null : f.minPower,
    minDisplacement:
      f.minDisplacement != null && !pool.some((v) => v.displacement >= f.minDisplacement!) ? null : f.minDisplacement,
    // As motas não têm portas.
    doors: type === "motorcycle" ? null : f.doors,
  };
  const changed = (Object.keys(next) as (keyof VehicleFilters)[]).some((k) => next[k] !== f[k]);
  return changed ? next : f;
}

const fold = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim().toLowerCase();

/**
 * A marca e o modelo do endereço com a grafia do stock: `?marca=bmw` é a
 * «BMW» (o seletor não encontrava «bmw» e voltava a «Todas»), `?modelo=golf`
 * é o «Golf». Sem viatura com esse nome, fica como veio (o alerta usa-o).
 */
export function canonicalFilters(f: VehicleFilters, vehicles: Vehicle[]): VehicleFilters {
  const make = f.make ? vehicles.find((v) => sameBrand(v.make, f.make!))?.make ?? f.make : f.make;
  const model = f.model
    ? vehicles.find((v) => (!make || sameBrand(v.make, make)) && fold(v.model) === fold(f.model!))?.model ?? f.model
    : f.model;
  return make === f.make && model === f.model ? f : { ...f, make, model };
}

/** A pesquisa do endereço com o 1.º valor de cada parâmetro repetido — como o servidor. */
function firstValues(sp: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of sp) if (!(k in out)) out[k] = v;
  return out;
}

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
  olxFieldsByType = {},
  header,
  headerByType,
  vehicleTypes = ["car", "motorcycle"],
}: {
  vehicles: Vehicle[];
  initialFilters?: Partial<VehicleFilters>;
  initialSort?: SortKey;
  /**
   * Filtros do OLX com opções no stock, por tipo (vazio sem ligação ao OLX).
   * Aparecem os do tipo escolhido; em «Todos» não há (cada tipo tem os seus).
   */
  olxFieldsByType?: Partial<Record<VehicleType, SearchField[]>>;
  /** Topo da página, unido ao cartão dos filtros. */
  header?: React.ReactNode;
  /**
   * O topo para cada escolha de «Todos · Carros · Motas» (a foto das motas
   * com «Motas»). Sem a escolha aqui, fica `header`.
   */
  headerByType?: Partial<Record<VehicleType | "all", React.ReactNode>>;
  /**
   * Os tipos que o site vende. Com os dois, o stock tem o seletor «Todos ·
   * Carros · Motas»; com um só, o tipo fica fixo (e fora do endereço).
   */
  vehicleTypes?: VehicleType[];
}) {
  const locked = vehicleTypes.length === 1 ? vehicleTypes[0]! : null;
  // O endereço manda: ao voltar da ficha, o Next pode repor a página com os
  // dados do 1.º pedido (sem os filtros escritos depois), mas o endereço já
  // os tem (o Next acompanha o `replaceState` de baixo). Lido do router e não
  // de `window.location`: numa navegação (o «Stock» do menu, já no stock), o
  // `window.location` ainda tinha o endereço antigo e os filtros voltavam. Num
  // parâmetro repetido (`?tipo=motas&tipo=carros`), o 1.º, como no servidor
  // (com critérios diferentes, a hidratação falhava).
  const searchParams = useSearchParams();
  const [fromUrl] = useState(() => {
    const sp = firstValues(searchParams ?? []);
    return { filters: filtersFromQuery(sp), sort: sortFromQuery(sp) };
  });
  const [filters, setFilters] = useState<VehicleFilters>(() => {
    const f: VehicleFilters = {
      ...emptyFilters(),
      ...initialFilters,
      ...fromUrl.filters,
      ...(locked ? { vehicleType: locked } : {}),
    };
    // Campos do OLX que não existem (um link antigo, `?olx_foo=bar`)
    // esvaziavam a lista: só ficam os do tipo escolhido.
    const codes = new Set((f.vehicleType ? olxFieldsByType[f.vehicleType] ?? [] : []).map((x) => x.code));
    const olx = Object.fromEntries(Object.entries(f.olx ?? {}).filter(([code]) => codes.has(code)));
    return canonicalFilters(fitFiltersToType({ ...f, olx }, vehicles), vehicles);
  });
  const [sort, setSort] = useState<SortKey>(fromUrl.sort ?? initialSort);

  // A pesquisa vai para o endereço (como no OLX): guarda-se, partilha-se e o
  // «voltar» da ficha regressa a ela. `replaceState` não cria entradas novas
  // no histórico a cada letra escrita. Com `null` (e não o estado atual do
  // histórico), o Next sincroniza o router com o endereço novo; com o estado
  // dele, ao voltar da ficha repunha o endereço antigo e os filtros perdiam-se.
  useEffect(() => {
    const id = window.setTimeout(() => {
      // Num site de um só tipo, o tipo não vai para o endereço (é sempre o mesmo).
      const qs = filtersToQuery(locked ? { ...filters, vehicleType: null } : filters, sort);
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
      if (url !== `${window.location.pathname}${window.location.search}`) {
        window.history.replaceState(null, "", url);
      }
    }, 300);
    return () => window.clearTimeout(id);
  }, [filters, sort, locked]);

  const olxFields = useMemo(
    () => (filters.vehicleType ? olxFieldsByType[filters.vehicleType] ?? [] : []),
    [filters.vehicleType, olxFieldsByType],
  );

  // As opções (marcas, categorias, cores…) seguem o tipo escolhido: com
  // «Motas», a lista de marcas não traz as dos carros.
  const pool = useMemo(
    () =>
      filters.vehicleType
        ? vehicles.filter((v) => (v.vehicleType ?? "car") === filters.vehicleType)
        : vehicles,
    [vehicles, filters.vehicleType],
  );
  // Uma marca que só existe no outro tipo (um link como ?tipo=motas&marca=
  // Renault) deixava a lista vazia sem se perceber porquê: a marca sai (e o
  // modelo com ela). Uma marca sem stock nenhum fica — o alerta usa-a.
  useEffect(() => {
    const make = filters.make;
    if (
      make &&
      filters.vehicleType &&
      !pool.some((v) => sameBrand(v.make, make)) &&
      vehicles.some((v) => sameBrand(v.make, make))
    ) {
      setFilters((f) => ({ ...f, make: null, model: null }));
    }
  }, [pool, vehicles, filters.make, filters.vehicleType]);

  const typeCounts = useMemo(
    () => ({
      all: vehicles.length,
      car: vehicles.filter((v) => (v.vehicleType ?? "car") === "car").length,
      motorcycle: vehicles.filter((v) => v.vehicleType === "motorcycle").length,
    }),
    [vehicles],
  );

  const options = useMemo(
    () => ({
      locations: Array.from(
        new Map(
          pool
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
      makes: distinctMakes(pool),
      // Os modelos acompanham a marca selecionada, se houver.
      models: distinctValues(
        filters.make
          ? pool.filter((v) => sameBrand(v.make, filters.make!))
          : pool,
        "model",
      ) as string[],
      fuels: distinctValues(pool, "fuel"),
      transmissions: distinctValues(pool, "transmission"),
      bodies: distinctValues(pool, "body"),
      // Quantas viaturas há em cada categoria (os quadrados da pesquisa).
      bodyCounts: pool.reduce<Record<string, number>>((acc, v) => {
        acc[v.body] = (acc[v.body] ?? 0) + 1;
        return acc;
      }, {}),
      colors: [...new Set(pool.map((v) => v.color.trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt")),
      doors: [...new Set(pool.map((v) => v.doors).filter((d) => d > 0))].sort((a, b) => a - b),
      seats: [...new Set(pool.map((v) => v.seats).filter((d) => d > 0))].sort((a, b) => a - b),
      olxFields,
    }),
    [pool, filters.make, olxFields],
  );

  const top = headerByType?.[filters.vehicleType ?? "all"] ?? header;

  const results = useMemo(
    () => sortVehicles(applyFilters(vehicles, filters), sort),
    [vehicles, filters, sort],
  );

  return (
    <div className="space-y-10">
      <div
        className={top ? "relative overflow-hidden rounded-3xl border border-white/10 bg-ink-soft" : undefined}
      >
        {top}
        <Filters
          embedded={!!top}
          filters={filters}
          sort={sort}
          options={options}
          resultCount={results.length}
          // Ao trocar de tipo, saem os filtros que o tipo novo não tem.
          onChange={(patch) =>
            setFilters((f) => {
              const next = { ...f, ...patch };
              return next.vehicleType !== f.vehicleType ? fitFiltersToType(next, vehicles) : next;
            })
          }
          onSort={setSort}
          typeChoices={locked ? undefined : vehicleTypes}
          typeCounts={typeCounts}
          // «Limpar» tira os filtros, mas fica no tipo escolhido (Motas).
          onReset={() => {
            setFilters({
              ...emptyFilters(),
              vehicleType: locked ?? filters.vehicleType,
            });
            setSort("relevance");
          }}
        />
      </div>

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
          vehicleType={filters.vehicleType ?? null}
          vehicleTypes={vehicleTypes}
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
