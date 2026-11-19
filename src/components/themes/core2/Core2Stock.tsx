"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { SortKey, Vehicle, VehicleFilters } from "@/types/vehicle";
import type { VehicleType } from "@/lib/vehicle-categories";
import type { SearchField } from "@/lib/olx/search";
import { brandOptions, sameBrand } from "@/lib/brand-name";
import { formatKm, priceLabel } from "@/lib/format";
import { core2Serif } from "@/themes/core2/fonts";
import {
  CC_BUCKETS,
  MOTO4,
  activeCount,
  applyCore2,
  core2FromQuery,
  core2ToQuery,
  emptyCore2,
  inKind,
  kindsFor,
  switchKind,
  type Core2Filters,
  type StockKind,
} from "@/themes/core2/stock";

const StockAlertForm = dynamic(() => import("@/components/inventory/StockAlertForm").then((m) => m.StockAlertForm), {
  ssr: false,
  loading: () => <div className="h-[34rem] animate-pulse rounded-3xl border border-white/10 bg-ink-soft" />,
});

/**
 * Página do Stock do tema Core2 (fundo claro, como nas maquetes): topo com a
 * fachada, cartões «Todos · Motas · Moto 4 · Carros», coluna de filtros com
 * caixas (atualizam logo), chips dos filtros ativos, cartões das viaturas e a
 * faixa de vantagens. Os dados são os do stock (os mesmos do Core).
 */

const KIND: Record<StockKind, { label: string; title: string; subtitle: string; hero: string; card?: string }> = {
  todos: {
    label: "Todos",
    title: "Viaturas em stock",
    subtitle: "Encontre a sua próxima viatura com filtros simples e rápidos.",
    hero: "/media/core2/stock-todos.jpg",
    card: "/media/core2/stock-todos.jpg",
  },
  motas: {
    label: "Motas",
    title: "Motas em stock",
    subtitle: "Escolha a sua próxima mota com filtros simples e rápidos.",
    hero: "/media/core2/stock-motas.jpg",
    card: "/media/core2/tipo-motas.jpg",
  },
  moto4: {
    label: "Moto 4",
    title: "Moto 4 em stock",
    subtitle: "Encontre a sua moto 4 com filtros simples e rápidos.",
    hero: "/media/core2/stock-motas.jpg",
    card: "/media/core2/tipo-moto4.jpg",
  },
  carros: {
    label: "Carros",
    title: "Automóveis em stock",
    subtitle: "Encontre o automóvel certo com filtros simples e uma navegação clara.",
    hero: "/media/core2/stock-carros.jpg",
    card: "/media/core2/tipo-carros.jpg",
  },
};
// A ordem dos cartões (como nas maquetes: Motas, Moto 4, Carros).
const CARD_ORDER: StockKind[] = ["todos", "motas", "moto4", "carros"];

const SORT_LABELS: Record<SortKey, string> = {
  relevance: "Relevância",
  "year-desc": "Mais recentes",
  "price-asc": "Preço mais baixo",
  "price-desc": "Preço mais alto",
  "mileage-asc": "Menos quilómetros",
};

const KM_STEPS = [0, 10000, 25000, 50000, 75000, 100000, 150000, 200000];
const nf = new Intl.NumberFormat("pt-PT", { useGrouping: "always" } as unknown as Intl.NumberFormatOptions);

export function Core2Stock({
  vehicles,
  query,
  siteTypes,
  olxFieldsByType = {},
  below,
}: {
  vehicles: Vehicle[];
  /** A pesquisa do endereço (o servidor e o browser começam iguais). */
  query: Record<string, string | undefined>;
  siteTypes: VehicleType[];
  olxFieldsByType?: Partial<Record<VehicleType, SearchField[]>>;
  /** Por baixo de tudo: as pesquisas populares (do servidor). */
  below?: React.ReactNode;
}) {
  const kinds = useMemo(() => kindsFor(siteTypes), [siteTypes]);
  const [state, setState] = useState(() => core2FromQuery(query, kinds));
  const { filters: f, sort } = state;
  const [sheet, setSheet] = useState(false);
  const set = (patch: Partial<Core2Filters>) => setState((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  const setBase = (patch: Partial<VehicleFilters>) => setState((s) => ({ ...s, filters: { ...s.filters, base: { ...s.filters.base, ...patch } } }));

  // A pesquisa vai para o endereço (guarda-se, partilha-se, o «voltar» regressa a ela).
  useEffect(() => {
    const id = window.setTimeout(() => {
      const qs = core2ToQuery(f, sort, kinds);
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
      if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
    }, 300);
    return () => window.clearTimeout(id);
  }, [f, sort, kinds]);

  const pool = useMemo(() => vehicles.filter((v) => inKind(v, f.kind)), [vehicles, f.kind]);
  const results = useMemo(() => applyCore2(vehicles, f, sort), [vehicles, f, sort]);
  const count = (pick: (v: Vehicle) => boolean) => pool.filter(pick).length;
  const isMoto = f.kind === "motas" || f.kind === "moto4";
  const olxType: VehicleType | null = f.kind === "carros" ? "car" : isMoto ? "motorcycle" : null;
  const olxFields = olxType ? olxFieldsByType[olxType] ?? [] : [];

  const makes = useMemo(() => brandOptions(pool.map((v) => v.make)), [pool]);
  const bodies = useMemo(
    () => [...new Set(pool.map((v) => v.body))].filter((b) => b !== MOTO4).sort((a, b) => a.localeCompare(b, "pt")),
    [pool],
  );
  const fuels = useMemo(() => [...new Set(pool.map((v) => v.fuel))].sort(), [pool]);
  const transmissions = useMemo(() => [...new Set(pool.map((v) => v.transmission))].sort(), [pool]);
  const years = useMemo(() => [...new Set(pool.map((v) => v.year).filter(Boolean))].sort((a, b) => a - b), [pool]);
  const priceTop = useMemo(() => {
    const top = Math.max(0, ...pool.filter((v) => !v.priceOnRequest).map((v) => v.price));
    return Math.max(5000, Math.ceil(top / 5000) * 5000);
  }, [pool]);

  const toggle = (key: "makes" | "bodies" | "fuels" | "transmissions" | "cc", value: string) =>
    set({ [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value] });
  const reset = () => setState((s) => ({ filters: emptyCore2(s.filters.kind), sort: "relevance" }));
  const chooseKind = (kind: StockKind) => setState((s) => ({ ...s, filters: switchKind(s.filters, kind, vehicles) }));

  // Os filtros ativos, em chips que se tiram com o «×».
  const chips: { label: string; remove: () => void }[] = [
    ...f.makes.map((m) => ({ label: m, remove: () => toggle("makes", m) })),
    ...f.bodies.map((b) => ({ label: b, remove: () => toggle("bodies", b) })),
    ...f.fuels.map((x) => ({ label: x, remove: () => toggle("fuels", x) })),
    ...f.transmissions.map((x) => ({ label: x, remove: () => toggle("transmissions", x) })),
    ...f.cc.map((id) => ({ label: CC_BUCKETS.find((b) => b.id === id)?.label ?? id, remove: () => toggle("cc", id) })),
    ...(f.base.maxPrice != null ? [{ label: `Até ${nf.format(f.base.maxPrice)} €`, remove: () => setBase({ maxPrice: null }) }] : []),
    ...(f.base.minYear != null ? [{ label: `Desde ${f.base.minYear}`, remove: () => setBase({ minYear: null }) }] : []),
    ...(f.base.maxYear != null ? [{ label: `Até ${f.base.maxYear}`, remove: () => setBase({ maxYear: null }) }] : []),
    ...(f.base.minMileage != null ? [{ label: `Desde ${formatKm(f.base.minMileage)}`, remove: () => setBase({ minMileage: null }) }] : []),
    ...(f.base.maxMileage != null ? [{ label: `Até ${formatKm(f.base.maxMileage)}`, remove: () => setBase({ maxMileage: null }) }] : []),
    ...(f.base.model ? [{ label: f.base.model, remove: () => setBase({ model: null }) }] : []),
    ...(f.base.query ? [{ label: `«${f.base.query}»`, remove: () => setBase({ query: null }) }] : []),
    ...(f.base.campaignOnly ? [{ label: "Em campanha", remove: () => setBase({ campaignOnly: false }) }] : []),
    ...(f.base.nationalOnly ? [{ label: "Nacional", remove: () => setBase({ nationalOnly: false }) }] : []),
    ...(f.base.firstOwnerOnly ? [{ label: "1.º dono", remove: () => setBase({ firstOwnerOnly: false }) }] : []),
    ...(f.base.serviceBookOnly ? [{ label: "Livro de revisões", remove: () => setBase({ serviceBookOnly: false }) }] : []),
    ...(f.base.warrantyOnly ? [{ label: "Com garantia", remove: () => setBase({ warrantyOnly: false }) }] : []),
  ];
  const active = activeCount(f);
  const meta = KIND[f.kind];

  const filterColumn = (
    <FilterColumn
      resultCount={results.length}
      onReset={reset}
      active={active}
      sections={[
        makes.length > 0 && (
          <Section key="marca" icon="tag" title="Marca">
            <Checks options={makes} values={f.makes} count={(m) => count((v) => sameBrand(v.make, m))} onToggle={(m) => toggle("makes", m)} />
          </Section>
        ),
        f.kind !== "moto4" && bodies.length > 0 && (
          <Section key="cat" icon={isMoto ? "moto" : "car"} title={f.kind === "carros" ? "Carroçaria" : "Categoria"}>
            <Checks options={bodies} values={f.bodies} count={(b) => count((v) => v.body === b)} onToggle={(b) => toggle("bodies", b)} />
          </Section>
        ),
        !isMoto && fuels.length > 1 && (
          <Section key="fuel" icon="fuel" title="Combustível">
            <Checks options={fuels} values={f.fuels} count={(x) => count((v) => v.fuel === x)} onToggle={(x) => toggle("fuels", x)} />
          </Section>
        ),
        !isMoto && transmissions.length > 1 && (
          <Section key="caixa" icon="gear" title="Caixa">
            <Checks options={transmissions} values={f.transmissions} count={(x) => count((v) => v.transmission === x)} onToggle={(x) => toggle("transmissions", x)} />
          </Section>
        ),
        <Section key="preco" icon="euro" title="Preço máximo">
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={0}
              max={priceTop}
              step={500}
              value={f.base.maxPrice ?? priceTop}
              onChange={(e) => setBase({ maxPrice: Number(e.target.value) >= priceTop ? null : Number(e.target.value) })}
              aria-label="Preço máximo"
              className="core2-range flex-1"
            />
            <span className="min-w-[5.5rem] rounded-lg border border-paper/15 px-2 py-1 text-right text-sm tabular-nums">
              {f.base.maxPrice != null ? `${nf.format(f.base.maxPrice)} €` : "Sem limite"}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-xs text-paper/50">
            <span>0 €</span>
            <span>{nf.format(priceTop)} €+</span>
          </div>
        </Section>,
        years.length > 1 && (
          <Section key="ano" icon="calendar" title="Ano">
            <Range
              from={f.base.minYear}
              to={f.base.maxYear}
              options={years.map((y) => ({ value: y, label: String(y) }))}
              onFrom={(v) => setBase({ minYear: v })}
              onTo={(v) => setBase({ maxYear: v })}
              label="Ano"
            />
          </Section>
        ),
        <Section key="km" icon="gauge" title="Quilómetros">
          <Range
            from={f.base.minMileage}
            to={f.base.maxMileage}
            options={KM_STEPS.map((k) => ({ value: k, label: `${nf.format(k)} km` }))}
            onFrom={(v) => setBase({ minMileage: v })}
            onTo={(v) => setBase({ maxMileage: v })}
            label="Quilómetros"
          />
        </Section>,
        isMoto && (
          <Section key="cc" icon="engine" title="Cilindrada">
            <Checks
              options={CC_BUCKETS.map((b) => b.id)}
              labels={Object.fromEntries(CC_BUCKETS.map((b) => [b.id, b.label]))}
              values={f.cc}
              count={(id) => {
                const b = CC_BUCKETS.find((x) => x.id === id)!;
                return count((v) => !!v.displacement && v.displacement >= b.min && v.displacement <= b.max);
              }}
              onToggle={(id) => toggle("cc", id)}
            />
          </Section>
        ),
        <Section key="mais" icon="sliders" title="Mais filtros" defaultOpen={false}>
          <div className="space-y-2">
            {(
              [
                ["campaignOnly", "Em campanha"],
                ["nationalOnly", "Nacional"],
                ["firstOwnerOnly", "1.º dono"],
                ["serviceBookOnly", "Livro de revisões"],
                ["warrantyOnly", "Com garantia"],
              ] as const
            ).map(([key, label]) => (
              <CheckRow key={key} label={label} checked={!!f.base[key]} onChange={() => setBase({ [key]: !f.base[key] })} />
            ))}
            {olxFields.map((field) => {
              const current = f.base.olx?.[field.code];
              const put = (value: string | null) => {
                const olx = { ...f.base.olx };
                if (value) olx[field.code] = value;
                else delete olx[field.code];
                setBase({ olx });
              };
              return field.values.length ? (
                <label key={field.code} className="block text-sm">
                  <span className="mb-1 block text-paper/70">{field.label}</span>
                  <select className="core2-select w-full" value={typeof current === "string" ? current : ""} onChange={(e) => put(e.target.value || null)}>
                    <option value="">Todos</option>
                    {field.values.map((o) => (
                      <option key={o.code} value={o.code}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null;
            })}
          </div>
        </Section>,
      ]}
    />
  );

  return (
    <div className={`core2-stock ${core2Serif.variable} bg-ink pb-20 text-paper`}>
      {/* Topo: caminho, título com o traço, subtítulo e a fachada à direita. */}
      <section className="relative overflow-hidden border-b border-paper/10 bg-ink-muted">
        {/* Telemóvel: a fachada por cima do título; computador: à direita. */}
        <div aria-hidden className="relative h-40 sm:h-52 md:absolute md:inset-y-0 md:right-0 md:h-auto md:w-[62%]">
          <Image key={meta.hero} src={meta.hero} alt="" fill priority sizes="(max-width: 768px) 100vw, 62vw" className="object-cover object-center" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent from-35% to-ink-muted md:hidden" />
          <div className="core2-hero-fade absolute inset-0 hidden md:block" />
        </div>
        <div className="container-px relative -mt-6 pb-7 md:mt-0 md:py-12">
          <nav aria-label="Caminho" className="text-sm text-paper/70">
            <ol className="flex flex-wrap items-center gap-2">
              <li>
                <Link href="/" className="inline-flex items-center gap-1.5 hover:text-accent">
                  <Icon name="home" className="h-4 w-4" /> Início
                </Link>
              </li>
              <li aria-hidden>›</li>
              {f.kind === "todos" ? (
                <li className="text-accent">Stock</li>
              ) : (
                <>
                  <li>
                    <button type="button" onClick={() => chooseKind(kinds[0] ?? "todos")} className="hover:text-accent">
                      Stock
                    </button>
                  </li>
                  <li aria-hidden>›</li>
                  <li className="text-accent">{meta.title}</li>
                </>
              )}
            </ol>
          </nav>
          <h1 className="core2-serif mt-3 text-4xl leading-tight md:mt-4 md:text-6xl">{meta.title}</h1>
          <span aria-hidden className="mt-3 block h-1 w-20 rounded-full bg-accent" />
          <p className="mt-3 max-w-xl text-base text-paper/75 md:mt-4 md:text-lg">{meta.subtitle}</p>
        </div>
      </section>

      <div className="container-px">
        {/* Tipo: Todos · Motas · Moto 4 · Carros (só num site com mais de um). */}
        {kinds.length > 1 && (
          <div
            role="group"
            aria-label="Tipo de viatura"
            className={`mt-5 grid gap-2 sm:gap-3 md:mt-6 ${kinds.length === 4 ? "grid-cols-4" : kinds.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}
          >
            {CARD_ORDER.filter((k) => kinds.includes(k)).map((k) => {
              const on = f.kind === k;
              const n = k === "todos" ? vehicles.length : vehicles.filter((v) => inKind(v, k)).length;
              return (
                <button
                  key={k}
                  type="button"
                  aria-pressed={on}
                  onClick={() => !on && chooseKind(k)}
                  className={`group relative h-[5.5rem] overflow-hidden rounded-xl border text-left shadow-sm transition sm:rounded-2xl md:h-24 ${
                    on ? "core2-on" : "border-paper/10 core2-hover-accent"
                  }`}
                >
                  {KIND[k].card ? (
                    <Image src={KIND[k].card!} alt="" fill sizes="(max-width: 768px) 50vw, 25vw" className="object-cover transition-transform duration-500 group-hover:scale-105" />
                  ) : (
                    <span aria-hidden className="absolute inset-0 grid place-items-center bg-ink-muted">
                      <Icon name="grid" className="h-8 w-8 text-paper/30" />
                    </span>
                  )}
                  <span aria-hidden className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/30 to-transparent" />
                  <span className="relative flex h-full flex-col justify-between p-2 sm:p-3">
                    <span className="core2-serif text-base leading-tight text-white drop-shadow sm:text-xl md:text-2xl">{KIND[k].label}</span>
                    <span className="flex items-center gap-2 text-xs font-semibold text-white/90">
                      <span className={`grid h-6 w-6 place-items-center rounded-full ${on ? "bg-white text-accent" : "bg-accent text-white"}`}>
                        <Icon name="arrow" className="h-3.5 w-3.5" />
                      </span>
                      <span className="hidden sm:inline">
                        {n} {n === 1 ? "viatura" : "viaturas"}
                      </span>
                      <span className="sr-only sm:hidden">
                        {n} {n === 1 ? "viatura" : "viaturas"}
                      </span>
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-[18.5rem_1fr]">
          {/* Coluna de filtros (no telemóvel, num painel). */}
          <aside className="hidden lg:block">{filterColumn}</aside>

          <div className="min-w-0">
            {/* Barra: filtros ativos, quantos, ordenar. */}
            <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-paper/10 bg-ink-soft px-4 py-3 shadow-sm">
              <button
                type="button"
                onClick={() => setSheet(true)}
                className="inline-flex items-center gap-2 rounded-full border border-paper/20 px-4 py-2 text-sm font-semibold lg:hidden"
              >
                <Icon name="sliders" className="h-4 w-4 text-accent" /> Filtros{active ? ` (${active})` : ""}
              </button>
              {chips.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">Filtros ativos:</span>
                  {chips.map((c) => (
                    <button
                      key={c.label}
                      type="button"
                      onClick={c.remove}
                      aria-label={`Tirar o filtro ${c.label}`}
                      className="core2-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm"
                    >
                      {c.label} <span aria-hidden>×</span>
                    </button>
                  ))}
                </div>
              )}
              <p className="text-sm text-paper/80 sm:ml-auto">
                <strong className="font-semibold text-paper">{results.length}</strong>{" "}
                {results.length === 1 ? "veículo encontrado" : "veículos encontrados"}
              </p>
              <label className="flex items-center gap-2 text-sm">
                <span className="text-paper/70">Ordenar por:</span>
                <select className="core2-select" value={sort} onChange={(e) => setState((s) => ({ ...s, sort: e.target.value as SortKey }))}>
                  {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                    <option key={k} value={k}>
                      {SORT_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {results.length === 0 ? (
              <div className="mt-6 rounded-2xl border border-paper/10 bg-ink-soft p-10 text-center">
                <p className="text-paper/75">Nenhuma viatura corresponde aos filtros. Experimente alargar os critérios — ou deixe um alerta e avisamos quando entrar.</p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button type="button" onClick={reset} className="rounded-full border border-paper/20 px-5 py-2.5 text-sm font-semibold">
                    Limpar filtros
                  </button>
                  <a href="#alerta" className="rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-ink">
                    Criar alerta
                  </a>
                </div>
              </div>
            ) : (
              <ul className="mt-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((v, i) => (
                  <li key={v.slug}>
                    <Core2Card vehicle={v} priority={i < 3} />
                  </li>
                ))}
              </ul>
            )}

            <Benefits />
          </div>
        </div>

        {/* O alerta acompanha a pesquisa (quem não encontrou tem os critérios preenchidos). */}
        <section id="alerta" className="scroll-mt-28 pt-12">
          <StockAlertForm
            vehicleType={f.kind === "carros" ? "car" : isMoto ? "motorcycle" : null}
            vehicleTypes={siteTypes}
            makes={makes}
            defaults={{
              make: f.makes.length === 1 ? f.makes[0]! : null,
              model: f.base.model,
              body: f.kind === "moto4" ? MOTO4 : f.bodies.length === 1 ? f.bodies[0]! : null,
              fuel: f.fuels.length === 1 ? f.fuels[0]! : null,
              max_price: f.base.maxPrice,
              min_year: f.base.minYear,
              max_km: f.base.maxMileage,
            }}
          />
        </section>
        {below}
      </div>

      {/* Telemóvel: os filtros num painel. */}
      {sheet && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-ink lg:hidden" role="dialog" aria-modal="true" aria-label="Filtros">
          <div className="flex items-center justify-between border-b border-paper/10 px-4 py-3">
            <span className="core2-serif text-2xl">Filtros</span>
            <button type="button" onClick={() => setSheet(false)} className="rounded-full p-2 text-paper/70" aria-label="Fechar">
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto px-4 py-4">{filterColumn}</div>
          <div className="border-t border-paper/10 p-4">
            <button type="button" onClick={() => setSheet(false)} className="w-full rounded-xl bg-accent py-3 text-base font-semibold text-ink">
              Ver {results.length} {results.length === 1 ? "viatura" : "viaturas"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterColumn({
  sections,
  resultCount,
  active,
  onReset,
}: {
  sections: React.ReactNode[];
  resultCount: number;
  active: number;
  onReset: () => void;
}) {
  return (
    <div className="rounded-2xl border border-paper/10 bg-ink-soft p-4 shadow-sm">
      <div className="flex items-center justify-between border-b border-paper/10 pb-3">
        <span className="flex items-center gap-2">
          <Icon name="sliders" className="h-5 w-5 text-accent" />
          <span className="core2-serif text-2xl">Filtros</span>
        </span>
        <span className="text-sm text-paper/70">
          {resultCount} {resultCount === 1 ? "resultado" : "resultados"}
        </span>
      </div>
      <div className="divide-y divide-paper/10">{sections.filter(Boolean)}</div>
      <button
        type="button"
        onClick={onReset}
        disabled={!active}
        className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-paper/25 py-2.5 text-sm font-semibold transition-colors hover:border-accent hover:text-accent disabled:opacity-40"
      >
        <Icon name="reset" className="h-4 w-4" /> Limpar filtros
      </button>
    </div>
  );
}

function Section({
  title,
  icon,
  children,
  defaultOpen = true,
}: {
  title: string;
  icon: IconName;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="py-3">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between text-left">
        <span className="flex items-center gap-2 font-semibold">
          <Icon name={icon} className="h-5 w-5 text-accent" /> {title}
        </span>
        <Icon name="chevron" className={`h-4 w-4 text-paper/60 transition-transform ${open ? "" : "rotate-180"}`} />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function Checks({
  options,
  values,
  labels,
  count,
  onToggle,
}: {
  options: string[];
  values: string[];
  labels?: Record<string, string>;
  count: (value: string) => number;
  onToggle: (value: string) => void;
}) {
  const [all, setAll] = useState(false);
  const shown = all ? options : options.slice(0, 8);
  return (
    <div>
      <div className="grid grid-cols-1 gap-x-3 gap-y-1 sm:grid-cols-2 lg:grid-cols-1">
        {shown.map((o) => (
          <CheckRow key={o} label={labels?.[o] ?? o} checked={values.includes(o)} onChange={() => onToggle(o)} count={count(o)} />
        ))}
      </div>
      {options.length > 8 && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-1 text-sm font-semibold text-accent">
          {all ? "Ver menos" : `Ver todas (${options.length})`}
        </button>
      )}
    </div>
  );
}

function CheckRow({ label, checked, onChange, count }: { label: string; checked: boolean; onChange: () => void; count?: number }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-0.5 text-sm">
      <input type="checkbox" checked={checked} onChange={onChange} className="core2-check" />
      <span className="flex-1">{label}</span>
      {count !== undefined && <span className="text-xs tabular-nums text-paper/45">{count}</span>}
    </label>
  );
}

function Range({
  from,
  to,
  options,
  onFrom,
  onTo,
  label,
}: {
  from: number | null;
  to: number | null;
  options: { value: number; label: string }[];
  onFrom: (v: number | null) => void;
  onTo: (v: number | null) => void;
  label: string;
}) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto_1fr] items-center gap-2 text-sm">
      <span className="text-paper/70">De</span>
      <select className="core2-select" aria-label={`${label} — de`} value={from ?? ""} onChange={(e) => onFrom(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Qualquer</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <span className="text-paper/70">Até</span>
      <select className="core2-select" aria-label={`${label} — até`} value={to ?? ""} onChange={(e) => onTo(e.target.value ? Number(e.target.value) : null)}>
        <option value="">Qualquer</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** Cartão de uma viatura, como nas maquetes (dados reais do anúncio). */
function Core2Card({ vehicle: v, priority }: { vehicle: Vehicle; priority: boolean }) {
  const moto = v.vehicleType === "motorcycle";
  const cover = v.images[0];
  // Uma linha de destaques: a frase do anúncio, ou os primeiros extras.
  const line = v.tagline?.trim() || (v.extras ?? []).slice(0, 4).join(" · ");
  const specs: { icon: IconName; text: string }[] = moto
    ? [
        { icon: "gauge", text: formatKm(v.mileage) },
        ...(v.displacement ? [{ icon: "engine" as IconName, text: `${nf.format(v.displacement)} cc` }] : []),
        ...(v.power ? [{ icon: "bolt" as IconName, text: `${v.power} cv` }] : []),
      ]
    : [
        { icon: "calendar", text: String(v.year) },
        { icon: "gauge", text: formatKm(v.mileage) },
        { icon: "fuel", text: v.fuel },
        { icon: "gear", text: v.transmission },
      ];
  return (
    <Link
      href={`/viaturas/${v.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-paper/10 bg-ink-soft shadow-sm transition hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative aspect-[16/10] overflow-hidden bg-ink-muted">
        {cover && (
          <Image
            src={cover.src}
            alt={cover.alt || `${v.make} ${v.model}`}
            fill
            priority={priority}
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        {v.status === "reserved" && (
          <span className="absolute left-3 top-3 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-ink">Reservado</span>
        )}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-2">
          <h3 className="core2-serif text-2xl leading-tight">
            {v.make} {v.model}
          </h3>
          {moto && v.year ? <span className="shrink-0 rounded-md border border-paper/15 px-2 py-0.5 text-xs">{v.year}</span> : null}
        </div>
        <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-paper/75">
          {specs.map((s) => (
            <li key={s.text} className="inline-flex items-center gap-1">
              <Icon name={s.icon} className="h-3.5 w-3.5 text-paper/55" /> {s.text}
            </li>
          ))}
        </ul>
        {line && <p className="mt-2 line-clamp-1 text-sm text-paper/70">{line}</p>}
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <span className="core2-serif text-3xl text-accent">{priceLabel(v.price, v.priceOnRequest)}</span>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-paper/25 px-4 py-1.5 text-sm font-semibold transition-colors group-hover:border-accent group-hover:text-accent">
            Ver detalhes <Icon name="arrow" className="h-3.5 w-3.5" />
          </span>
        </div>
      </div>
    </Link>
  );
}

/** A faixa de vantagens, por baixo da lista. */
function Benefits() {
  const items: { icon: IconName; title: string; text: string }[] = [
    { icon: "refresh", title: "Aceitamos retomas", text: "Valorizamos a sua mota, moto 4 ou automóvel." },
    { icon: "truck", title: "Entregas nacionais", text: "Levamos a sua nova viatura a qualquer ponto de Portugal." },
    { icon: "card", title: "Opções de pagamento", text: "Soluções de financiamento simples e flexíveis." },
  ];
  return (
    <div className="mt-8 grid gap-4 rounded-2xl bg-ink-muted p-5 sm:grid-cols-3 sm:divide-x sm:divide-paper/10">
      {items.map((b) => (
        <div key={b.title} className="flex items-center gap-3 sm:px-4">
          <Icon name={b.icon} className="h-9 w-9 shrink-0 text-accent" />
          <div>
            <p className="font-semibold">{b.title}</p>
            <p className="text-xs text-paper/65">{b.text}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

type IconName =
  | "home" | "tag" | "car" | "moto" | "fuel" | "gear" | "euro" | "calendar" | "gauge" | "engine"
  | "sliders" | "chevron" | "arrow" | "reset" | "refresh" | "truck" | "card" | "bolt" | "grid";

const PATHS: Record<IconName, React.ReactNode> = {
  home: <path d="M3 10.5 12 3l9 7.5V21h-6v-6H9v6H3z" />,
  tag: <><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></>,
  car: <><path d="M5 16V11l2-5h10l2 5v5" /><path d="M3 16h18v3H3z" /><circle cx="7.5" cy="16" r="1.5" /><circle cx="16.5" cy="16" r="1.5" /></>,
  moto: <><circle cx="5.5" cy="16.5" r="3.5" /><circle cx="18.5" cy="16.5" r="3.5" /><path d="M5.5 16.5 9 10h5l4.5 6.5M14 10l-1-3h3" /></>,
  fuel: <><path d="M4 21V5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v16" /><path d="M3 21h13M7 8h5M15 10h2a2 2 0 0 1 2 2v5a1.5 1.5 0 0 0 3 0V9l-3-3" /></>,
  gear: <><circle cx="6" cy="6" r="2" /><circle cx="12" cy="6" r="2" /><circle cx="18" cy="6" r="2" /><path d="M6 8v8M12 8v8M18 8v4H6" /></>,
  euro: <><path d="M18 7c-1.2-2-3.2-3-5.5-3C8.9 4 6 7.1 6 12s2.9 8 6.5 8c2.3 0 4.3-1 5.5-3" /><path d="M4 10h10M4 14h10" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>,
  gauge: <><path d="M4 18a8 8 0 1 1 16 0" /><path d="m12 14 4-4" /></>,
  engine: <><path d="M4 9h3l2-2h5l2 2h2v3h2v4h-2v2H9l-2-2H4z" /></>,
  sliders: <><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>,
  chevron: <path d="m6 15 6-6 6 6" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  reset: <><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" /><path d="M5 3v5h5M19 21v-5h-5" /></>,
  truck: <><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z" /><circle cx="7" cy="17.5" r="1.8" /><circle cx="17" cy="17.5" r="1.8" /></>,
  card: <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h4" /></>,
  bolt: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
};

function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden className={className}>
      {PATHS[name]}
    </svg>
  );
}
