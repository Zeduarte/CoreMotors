"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { SortKey, Vehicle, VehicleFilters } from "@/types/vehicle";
import type { VehicleType } from "@/lib/vehicle-categories";
import { sameBrand } from "@/lib/brand-name";
import { trapTab } from "@/lib/focus-trap";
import { VehicleCard } from "@/components/vehicle/VehicleCard";
import { dots, euros } from "@/themes/core2/ui";
import {
  CC_BUCKETS,
  DEFAULT_SORT,
  KIND_LABEL,
  KM_MAX,
  KM_STEP,
  PRICE_MAX,
  PRICE_STEP,
  SORT_OPTIONS,
  activeChips,
  applyCore2,
  bodyOptions,
  core2FromQuery,
  core2ToQuery,
  emptyCore2,
  filterCore2,
  firstValues,
  inKinds,
  kindsFor,
  makeOptions,
  withoutChip,
  yearOptions,
  type Core2Filters,
  type Core2State,
  type StockKind,
} from "@/themes/core2/stock";
import { Core2Icon } from "./icons";

/**
 * A lista do Stock do tema Core2 (como na maqueta, no fundo preto do site;
 * o topo com a foto e as categorias é o `Core2StockTop`, por cima):
 *
 * - à esquerda, o cartão «Filtros» com as secções que abrem e fecham (Tipo,
 *   Marca, Categoria, Preço máximo, Ano, Quilómetros, Cilindrada), «Ordenar
 *   por» e os botões «Aplicar filtros» e «Limpar». O que se muda na coluna é
 *   um rascunho: o número de resultados no canto acompanha-o, e a lista só
 *   muda com «Aplicar filtros»;
 * - em cima, os filtros activos (cada um sai com o «×»), quantos veículos e a
 *   ordem;
 * - a grelha com os cartões das viaturas (os mesmos do stock do Core).
 *
 * No telemóvel, a coluna abre-se com o botão «Filtros». A pesquisa fica no
 * endereço, como no stock do Core (ver `src/themes/core2/stock.ts`).
 */
export function Core2Stock({ vehicles, siteTypes }: { vehicles: Vehicle[]; siteTypes: VehicleType[] }) {
  const kinds = useMemo(() => kindsFor(siteTypes, vehicles), [siteTypes, vehicles]);
  // O endereço manda (lido do router, como no Core): ao voltar da ficha, a
  // pesquisa volta com ele.
  const searchParams = useSearchParams();
  const [applied, setApplied] = useState<Core2State>(() => core2FromQuery(firstValues(searchParams ?? []), kinds));
  const [draft, setDraft] = useState<Core2State>(applied);
  const [sheet, setSheet] = useState(false);

  // A pesquisa aplicada vai para o endereço (guarda-se, partilha-se e o
  // «voltar» da ficha regressa a ela), sem criar entradas no histórico.
  useEffect(() => {
    const id = window.setTimeout(() => {
      const qs = core2ToQuery(applied.filters, applied.sort, kinds);
      const url = `${window.location.pathname}${qs ? `?${qs}` : ""}`;
      if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
    }, 300);
    return () => window.clearTimeout(id);
  }, [applied, kinds]);

  const results = useMemo(() => applyCore2(vehicles, applied.filters, applied.sort), [vehicles, applied]);
  const draftCount = useMemo(() => filterCore2(vehicles, draft.filters).length, [vehicles, draft.filters]);
  const chips = activeChips(applied.filters);
  const dirty = core2ToQuery(draft.filters, draft.sort, kinds) !== core2ToQuery(applied.filters, applied.sort, kinds);

  const apply = () => {
    setApplied(draft);
    setSheet(false);
  };
  const clear = () => {
    const empty: Core2State = { filters: emptyCore2(), sort: DEFAULT_SORT };
    setApplied(empty);
    setDraft(empty);
  };
  // O «×» e a ordem de cima mudam logo a lista (e a coluna acompanha).
  const removeChip = (key: string) => {
    setApplied((s) => ({ ...s, filters: withoutChip(s.filters, key) }));
    setDraft((s) => ({ ...s, filters: withoutChip(s.filters, key) }));
  };
  const sortNow = (sort: SortKey) => {
    setApplied((s) => ({ ...s, sort }));
    setDraft((s) => ({ ...s, sort }));
  };
  // Telemóvel: Marca e Modelo à vista (mudam logo a lista, como no stock do Core).
  const quick = (patch: Partial<Core2Filters>) => {
    setApplied((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
    setDraft((s) => ({ ...s, filters: { ...s.filters, ...patch } }));
  };
  const openSheet = () => {
    // O painel abre com o que está aplicado (o que ficou por aplicar da última vez sai).
    setDraft(applied);
    setSheet(true);
  };

  const panel = (inSheet: boolean) => (
    <FilterPanel
      vehicles={vehicles}
      kinds={kinds}
      state={draft}
      onChange={setDraft}
      count={draftCount}
      dirty={dirty}
      onApply={apply}
      onClear={clear}
      sticky={inSheet}
    />
  );

  return (
    // `#lista`: os botões e as categorias do topo saltam para aqui.
    <div id="lista" className="core2-stock scroll-mt-20 pb-24 pt-8 text-paper md:pt-10">
      <div className="container-px">
        <div className="grid gap-6 lg:grid-cols-[19rem_minmax(0,1fr)] xl:grid-cols-[20.5rem_minmax(0,1fr)]">
          {/* Coluna dos filtros (no telemóvel, no painel do botão «Filtros»). */}
          <aside aria-label="Filtros" className="hidden lg:block">
            {panel(false)}
          </aside>

          <div className="min-w-0">
            <QuickFilters vehicles={vehicles} filters={applied.filters} onChange={quick} />

            {/* Barra de cima: filtros activos · quantos · ordenar. */}
            <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-xl border border-white/10 bg-ink-soft px-4 py-3 md:px-6">
              <button
                type="button"
                onClick={openSheet}
                aria-haspopup="dialog"
                className="inline-flex items-center gap-2 rounded-md border border-white/20 bg-ink px-4 py-2 text-[0.95rem] font-semibold lg:hidden"
              >
                <Core2Icon name="sliders" className="h-5 w-5 text-accent" /> Filtros
                {chips.length > 0 && (
                  <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-xs font-bold text-white">
                    {chips.length}
                  </span>
                )}
              </button>
              {chips.length > 0 && (
                <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2.5">
                  <span className="text-[0.95rem] font-semibold">Filtros activos:</span>
                  {chips.map((c) => (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => removeChip(c.key)}
                      aria-label={`Tirar o filtro ${c.label}`}
                      className="inline-flex items-center gap-2 rounded-full border-[1.5px] border-accent bg-[color-mix(in_srgb,var(--accent)_12%,transparent)] px-3.5 py-1 text-[0.95rem] font-medium text-accent transition-colors hover:bg-[color-mix(in_srgb,var(--accent)_22%,transparent)]"
                    >
                      {c.label} <span aria-hidden className="text-lg leading-none">×</span>
                    </button>
                  ))}
                </div>
              )}
              <div className={`flex flex-wrap items-center gap-x-5 gap-y-2 ${chips.length ? "" : "flex-1 justify-end"}`}>
                <span aria-hidden className="hidden h-7 w-px bg-white/15 md:block" />
                <p className="text-[1rem] text-paper/85" aria-live="polite">
                  {results.length} {results.length === 1 ? "veículo encontrado" : "veículos encontrados"}
                </p>
                <span aria-hidden className="hidden h-7 w-px bg-white/15 md:block" />
                <label className="flex items-center gap-3 text-[0.95rem]">
                  <span className="whitespace-nowrap text-paper/85">Ordenar por:</span>
                  <SortSelect value={applied.sort} onChange={sortNow} />
                </label>
              </div>
            </div>

            {results.length === 0 ? (
              <div className="mt-6 rounded-xl border border-white/10 bg-ink-soft p-10 text-center">
                <p className="text-paper/70">Nenhuma viatura corresponde aos filtros. Experimente alargar os critérios.</p>
                <button
                  type="button"
                  onClick={clear}
                  className="mt-5 inline-flex items-center gap-2 rounded-md border border-white/30 px-5 py-2.5 text-[0.95rem] font-semibold transition-colors hover:border-accent"
                >
                  <Core2Icon name="reset" className="h-4 w-4" /> Limpar filtros
                </button>
              </div>
            ) : (
              <section aria-label="Viaturas" className="mt-6">
                <ul className="grid gap-x-5 gap-y-8 sm:grid-cols-2 xl:grid-cols-3 min-[1600px]:grid-cols-4">
                  {results.map((v, i) => (
                    <li key={v.slug}>
                      <VehicleCard vehicle={v} priority={i < 3} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>

      {sheet && <FilterSheet onClose={() => setSheet(false)}>{panel(true)}</FilterSheet>}
    </div>
  );
}

/**
 * Telemóvel: os filtros rápidos do stock do Core, só Marca e Modelo (o resto
 * fica no botão «Filtros»). Com várias marcas escolhidas na coluna, a lista
 * diz «Várias marcas» até se escolher outra.
 */
function QuickFilters({
  vehicles,
  filters: f,
  onChange,
}: {
  vehicles: Vehicle[];
  filters: Core2Filters;
  onChange: (patch: Partial<Core2Filters>) => void;
}) {
  const pool = useMemo(() => vehicles.filter((v) => inKinds(v, f.kinds)), [vehicles, f.kinds]);
  const makes = useMemo(() => makeOptions(pool, f.makes), [pool, f.makes]);
  const make = f.makes.length === 1 ? (makes.find((m) => sameBrand(m, f.makes[0]!)) ?? f.makes[0]!) : f.makes.length ? MANY : "";
  const models = useMemo(() => {
    const scoped = f.makes.length ? pool.filter((v) => f.makes.some((m) => sameBrand(v.make, m))) : pool;
    const list = [...new Set(scoped.map((v) => v.model).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt"));
    return f.base.model && !list.includes(f.base.model) ? [...list, f.base.model] : list;
  }, [pool, f.makes, f.base.model]);

  return (
    <div className="mb-4 space-y-4 rounded-2xl border border-white/10 bg-ink-soft p-4 lg:hidden">
      <label className="block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.15em] text-paper/55">Marca</span>
        <select
          className="core2-select w-full !rounded-xl !px-4 !py-3 !text-base"
          value={make}
          onChange={(e) => {
            const value = e.target.value;
            if (value === MANY) return;
            const next = value ? [value] : [];
            // O modelo sai se não for da marca escolhida.
            const keepModel =
              !!f.base.model && pool.some((v) => v.model === f.base.model && (!value || sameBrand(v.make, value)));
            onChange({ makes: next, base: { ...f.base, model: keepModel ? f.base.model : null } });
          }}
        >
          <option value="">Todas</option>
          {make === MANY && (
            <option value={MANY} disabled>
              Várias marcas
            </option>
          )}
          {makes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="mb-2 block text-xs font-semibold uppercase tracking-[0.15em] text-paper/55">Modelo</span>
        <select
          className="core2-select w-full !rounded-xl !px-4 !py-3 !text-base"
          value={f.base.model ?? ""}
          onChange={(e) => onChange({ base: { ...f.base, model: e.target.value || null } })}
        >
          <option value="">Todos</option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
const MANY = "__varias__";

// ---- Coluna dos filtros -----------------------------------------------------------

function FilterPanel({
  vehicles,
  kinds,
  state,
  onChange,
  count,
  dirty,
  onApply,
  onClear,
  sticky,
}: {
  vehicles: Vehicle[];
  kinds: StockKind[];
  state: Core2State;
  onChange: (next: Core2State) => void;
  count: number;
  dirty: boolean;
  onApply: () => void;
  onClear: () => void;
  /** No painel do telemóvel: os botões ficam sempre à vista, em baixo. */
  sticky: boolean;
}) {
  const f = state.filters;
  const set = (patch: Partial<Core2Filters>) => onChange({ ...state, filters: { ...f, ...patch } });
  const setBase = (patch: Partial<VehicleFilters>) => set({ base: { ...f.base, ...patch } });
  const toggle = (key: "bodies" | "cc", value: string) =>
    set({ [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value] });

  // As opções seguem o tipo escolhido (com «Moto 4», só as marcas das Moto 4).
  const pool = useMemo(() => vehicles.filter((v) => inKinds(v, f.kinds)), [vehicles, f.kinds]);
  const makes = useMemo(() => makeOptions(pool, f.makes), [pool, f.makes]);
  const bodies = useMemo(() => bodyOptions(pool, f.bodies), [pool, f.bodies]);
  const years = useMemo(() => yearOptions(vehicles), [vehicles]);
  const onlyCars = pool.length > 0 && pool.every((v) => (v.vehicleType ?? "car") === "car");
  const showCc = f.cc.length > 0 || pool.some((v) => v.vehicleType === "motorcycle" && v.displacement > 0);

  return (
    <div className="rounded-xl border border-white/10 bg-ink-soft">
      <div className="flex items-center justify-between gap-3 px-5 pb-3 pt-5">
        <h2 className="core2-serif flex items-center gap-3 text-[2rem] leading-none">
          <Core2Icon name="sliders" className="h-7 w-7 text-accent" strokeWidth={2.2} /> Filtros
        </h2>
        <span className="text-[0.95rem] text-paper/70" aria-live="polite">
          {count} {count === 1 ? "resultado" : "resultados"}
        </span>
      </div>

      <div className="px-5">
        {kinds.length > 0 && (
          <Section title="Tipo">
            <CheckGrid
              options={kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
              checked={(k) => f.kinds.includes(k as StockKind)}
              // Pela ordem das caixas, para o endereço ser sempre o mesmo.
              onToggle={(k) =>
                set({ kinds: kinds.filter((x) => (x === k ? !f.kinds.includes(x) : f.kinds.includes(x))) })
              }
            />
          </Section>
        )}
        {makes.length > 0 && (
          <Section title="Marca">
            <CheckGrid
              options={makes.map((m) => ({ value: m, label: m }))}
              checked={(m) => f.makes.some((x) => sameBrand(x, m))}
              onToggle={(m) => {
                const on = f.makes.some((x) => sameBrand(x, m));
                set({ makes: on ? f.makes.filter((x) => !sameBrand(x, m)) : [...f.makes, m] });
              }}
              limit={8}
              more="Ver todas as marcas"
            />
          </Section>
        )}
        {bodies.length > 0 && (
          <Section title={onlyCars ? "Carroçaria" : "Categoria"}>
            <CheckGrid
              options={bodies.map((b) => ({ value: b, label: b }))}
              checked={(b) => f.bodies.includes(b)}
              onToggle={(b) => toggle("bodies", b)}
              limit={8}
              more="Ver todas"
            />
          </Section>
        )}
        <Section title="Preço máximo">
          <Slider
            label="Preço máximo"
            value={f.base.maxPrice}
            min={PRICE_STEP}
            max={PRICE_MAX}
            step={PRICE_STEP}
            format={euros}
            minLabel="0 €"
            maxLabel={`${dots(PRICE_MAX)} €+`}
            onChange={(maxPrice) => setBase({ maxPrice })}
          />
        </Section>
        {years.length > 0 && (
          <Section title="Ano">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2.5 text-[0.95rem]">
              <span className="text-paper/85">De</span>
              <select
                aria-label="Ano — de"
                className="core2-select"
                value={f.base.minYear ?? ""}
                onChange={(e) => setBase({ minYear: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Todos</option>
                {years
                  .filter((y) => f.base.maxYear == null || y <= f.base.maxYear)
                  .map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
              </select>
              <span className="text-paper/85">Até</span>
              <select
                aria-label="Ano — até"
                className="core2-select"
                value={f.base.maxYear ?? ""}
                onChange={(e) => setBase({ maxYear: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Todos</option>
                {years
                  .filter((y) => f.base.minYear == null || y >= f.base.minYear)
                  .map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
              </select>
            </div>
          </Section>
        )}
        <Section title="Quilómetros">
          <Slider
            label="Quilómetros (máximo)"
            value={f.base.maxMileage}
            min={0}
            max={KM_MAX}
            step={KM_STEP}
            format={(n) => `${dots(n)} km`}
            minLabel="0 km"
            maxLabel={`${dots(KM_MAX)} km+`}
            onChange={(maxMileage) => setBase({ maxMileage })}
          />
        </Section>
        {showCc && (
          <Section title="Cilindrada">
            <CheckGrid
              options={CC_BUCKETS.map((b) => ({ value: b.id, label: b.label, title: b.range }))}
              checked={(id) => f.cc.includes(id)}
              onToggle={(id) => toggle("cc", id)}
            />
          </Section>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-white/10 py-4">
          <span className="text-[1.15rem] font-semibold">Ordenar por</span>
          <SortSelect value={state.sort} onChange={(sort) => onChange({ ...state, sort })} />
        </div>
      </div>

      <div
        className={`grid grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] gap-2.5 border-t border-white/10 p-5 ${
          sticky ? "sticky bottom-0 rounded-b-xl bg-ink-soft" : ""
        }`}
      >
        <button
          type="button"
          onClick={onApply}
          className={`inline-flex items-center justify-center gap-2 rounded-md bg-accent px-3 py-3.5 text-[0.95rem] font-semibold text-white transition-[filter,box-shadow] hover:brightness-110 ${
            dirty ? "shadow-[0_0_0_3px_rgb(255_255_255/0.14)]" : ""
          }`}
        >
          <Core2Icon name="search" className="h-5 w-5" strokeWidth={2.4} /> Aplicar filtros
        </button>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center justify-center gap-2 rounded-md border border-white/30 bg-transparent px-3 py-3.5 text-[0.95rem] font-semibold text-paper transition-colors hover:bg-white/5"
        >
          <Core2Icon name="reset" className="h-5 w-5" /> Limpar
        </button>
      </div>
    </div>
  );
}

/** Uma secção da coluna, que abre e fecha (seta para cima quando aberta). */
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  const id = useId();
  return (
    <section className="border-t border-white/10 py-4">
      <h3>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="flex w-full items-center justify-between gap-3 text-left text-[1.15rem] font-semibold"
        >
          {title}
          <Core2Icon name="chevron" className={`h-5 w-5 text-paper/70 transition-transform ${open ? "" : "rotate-180"}`} />
        </button>
      </h3>
      <div id={id} hidden={!open} className="mt-3">
        {children}
      </div>
    </section>
  );
}

/** Caixas em duas colunas, de cima para baixo (com «Ver todas» quando são muitas). */
function CheckGrid({
  options,
  checked,
  onToggle,
  limit,
  more = "Ver todas",
}: {
  options: { value: string; label: string; title?: string }[];
  checked: (value: string) => boolean;
  onToggle: (value: string) => void;
  limit?: number;
  more?: string;
}) {
  const [all, setAll] = useState(false);
  // As escolhidas ficam sempre à vista, mesmo para lá do limite.
  const shown = !limit || all ? options : options.filter((o, i) => i < limit || checked(o.value));
  return (
    <div>
      <div className="columns-2 gap-x-4">
        {shown.map((o) => (
          <label
            key={o.value}
            title={o.title}
            className="mb-2.5 flex min-w-0 cursor-pointer break-inside-avoid items-center gap-3 text-[1rem] leading-tight text-paper/85"
          >
            <input type="checkbox" className="core2-check" checked={checked(o.value)} onChange={() => onToggle(o.value)} />
            <span className="min-w-0 break-words">{o.label}</span>
          </label>
        ))}
      </div>
      {limit && options.length > limit && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-1 text-[0.9rem] font-semibold text-accent">
          {all ? "Ver menos" : `${more} (${options.length})`}
        </button>
      )}
    </div>
  );
}

/** Barra deslizante com o valor numa caixa ao lado; no fim é «sem limite». */
function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  minLabel,
  maxLabel,
  onChange,
}: {
  label: string;
  value: number | null;
  min: number;
  max: number;
  step: number;
  format: (n: number) => string;
  minLabel: string;
  maxLabel: string;
  onChange: (value: number | null) => void;
}) {
  const current = Math.min(value ?? max, max);
  // A parte já escolhida da barra (na cor de destaque), do mínimo ao valor.
  const fill = `${Math.max(0, Math.min(1, (current - min) / (max - min))) * 100}%`;
  const text = value == null || value >= max ? maxLabel : format(value);
  return (
    <div>
      <div className="flex items-center gap-4">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={current}
          aria-label={label}
          aria-valuetext={text}
          onChange={(e) => {
            const n = Number(e.target.value);
            onChange(n >= max ? null : n);
          }}
          className="core2-range min-w-0 flex-1"
          style={{ "--fill": fill } as React.CSSProperties}
        />
        <output className="min-w-[7rem] rounded-md border border-white/15 bg-ink px-3 py-2 text-right text-[0.95rem] font-medium tabular-nums text-paper">
          {text}
        </output>
      </div>
      <div className="mt-2 flex justify-between pr-[8rem] text-[0.85rem] text-paper/70">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function SortSelect({ value, onChange }: { value: SortKey; onChange: (sort: SortKey) => void }) {
  return (
    <select className="core2-select min-w-[10rem]" value={value} onChange={(e) => onChange(e.target.value as SortKey)}>
      {SORT_OPTIONS.map((o) => (
        <option key={o.key} value={o.key}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

/** Telemóvel: a coluna dos filtros num painel por cima da página. */
function FilterSheet({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  // O efeito corre só ao abrir e ao fechar (o `onClose` muda a cada desenho).
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  });
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    ref.current?.querySelector<HTMLElement>("[data-close]")?.focus();
    // No computador a coluna já está à vista: o painel fecha.
    const wide = window.matchMedia("(min-width: 1024px)");
    const onWide = () => {
      if (wide.matches) close.current();
    };
    wide.addEventListener("change", onWide);
    return () => {
      document.body.style.overflow = overflow;
      wide.removeEventListener("change", onWide);
      before?.focus?.();
    };
  }, []);
  return (
    <div
      ref={ref}
      role="dialog"
      aria-modal="true"
      aria-label="Filtros"
      className="fixed inset-0 z-[70] overflow-y-auto bg-ink p-3 lg:hidden"
      onKeyDown={(e) => {
        if (e.key === "Escape") onClose();
        else trapTab(ref.current, e);
      }}
    >
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          data-close
          onClick={onClose}
          aria-label="Fechar os filtros"
          className="grid h-10 w-10 place-items-center rounded-full border border-white/15 bg-ink-soft text-paper"
        >
          <Core2Icon name="close" className="h-5 w-5" />
        </button>
      </div>
      {children}
    </div>
  );
}
