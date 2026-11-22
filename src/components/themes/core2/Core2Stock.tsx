"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import type { SortKey, Vehicle, VehicleFilters } from "@/types/vehicle";
import type { VehicleType } from "@/lib/vehicle-categories";
import { formatNumber, formatPrice, priceLabel } from "@/lib/format";
import { sameBrand } from "@/lib/brand-name";
import { trapTab } from "@/lib/focus-trap";
import { setVehiclePreview } from "@/lib/vehicle-preview";
import { FadeImage } from "@/components/ui/FadeImage";
import {
  CC_BUCKETS,
  KIND_LABEL,
  KM_MAX,
  KM_STEP,
  MOTO4,
  PRICE_MAX,
  PRICE_STEP,
  SORT_LABELS,
  activeChips,
  applyCore2,
  bodyOptions,
  cardFacts,
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

// O alerta fica no fim da página: descarrega-se depois de a lista aparecer.
const StockAlertForm = dynamic(() => import("@/components/inventory/StockAlertForm").then((m) => m.StockAlertForm), {
  ssr: false,
  loading: () => <div className="h-[34rem] animate-pulse rounded-3xl border border-white/10 bg-ink-soft" />,
});

/**
 * Página do Stock do tema Core2 (fundo escuro, como o resto do site):
 *
 * - à esquerda, o cartão «Filtros» com as secções que abrem e fecham (Tipo,
 *   Marca, Categoria, Preço máximo, Ano, Quilómetros, Cilindrada, Ordenar
 *   por) e os botões «Aplicar filtros» e «Limpar». O que se muda na coluna é
 *   um rascunho: o número de resultados no canto acompanha-o, e a lista só
 *   muda com «Aplicar filtros»;
 * - em cima, os filtros ativos (cada um sai com o «×»), quantos veículos e a
 *   ordem;
 * - a grelha de cartões (foto, nome, ano, dados, preço e «Ver detalhes»).
 *
 * No telemóvel, a coluna abre-se com o botão «Filtros». A pesquisa fica no
 * endereço, como no stock do Core (ver `src/themes/core2/stock.ts`).
 */
export function Core2Stock({
  vehicles,
  siteTypes,
  below,
}: {
  vehicles: Vehicle[];
  /** Os tipos que o site vende (as caixas do Tipo). */
  siteTypes: VehicleType[];
  /** Por baixo de tudo: as pesquisas populares (do servidor). */
  below?: React.ReactNode;
}) {
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
    const empty: Core2State = { filters: emptyCore2(), sort: "relevance" };
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

  const alertType = alertVehicleType(applied.filters.kinds, siteTypes);

  return (
    <div className="core2-stock container-px pb-24 pt-6 md:pt-10">
      <h1 className="sr-only">Stock</h1>
      <div className="grid gap-6 lg:grid-cols-[18.5rem_minmax(0,1fr)] xl:grid-cols-[19.5rem_minmax(0,1fr)]">
        {/* Coluna dos filtros (no telemóvel, no painel do botão «Filtros»). */}
        <aside aria-label="Filtros" className="hidden lg:block">
          {panel(false)}
        </aside>

        <div className="min-w-0">
          {/* Barra de cima: filtros ativos · quantos · ordenar. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-2xl border border-white/10 bg-ink-soft px-4 py-3">
            <button
              type="button"
              onClick={openSheet}
              aria-haspopup="dialog"
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 px-4 py-2 text-sm font-semibold transition-colors hover:border-accent lg:hidden"
            >
              <Icon name="sliders" className="h-4 w-4 text-accent" /> Filtros
              {chips.length > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1 text-xs font-bold text-ink">
                  {chips.length}
                </span>
              )}
            </button>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="text-sm font-semibold">Filtros ativos:</span>
              {chips.length ? (
                chips.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => removeChip(c.key)}
                    aria-label={`Tirar o filtro ${c.label}`}
                    className="inline-flex items-center gap-1.5 rounded-full border border-accent/70 px-3 py-1 text-sm font-medium text-accent transition-colors hover:bg-accent/10"
                  >
                    {c.label} <span aria-hidden className="text-base leading-none">×</span>
                  </button>
                ))
              ) : (
                <span className="text-sm text-paper/50">nenhum</span>
              )}
            </div>
            <span aria-hidden className="hidden h-6 w-px bg-white/10 md:block" />
            <p className="text-sm text-paper/80" aria-live="polite">
              <strong className="font-semibold text-paper">{results.length}</strong>{" "}
              {results.length === 1 ? "veículo encontrado" : "veículos encontrados"}
            </p>
            <span aria-hidden className="hidden h-6 w-px bg-white/10 md:block" />
            <label className="flex items-center gap-2 text-sm">
              <span className="whitespace-nowrap text-paper/70">Ordenar por:</span>
              <SortSelect value={applied.sort} onChange={sortNow} />
            </label>
          </div>

          {results.length === 0 ? (
            <div className="mt-6 rounded-2xl border border-white/10 bg-ink-soft p-10 text-center">
              <p className="text-paper/75">
                Nenhuma viatura corresponde aos filtros. Experimente alargar os critérios — ou deixe um alerta e
                avisamos quando entrar.
              </p>
              <div className="mt-5 flex flex-wrap justify-center gap-3">
                <button
                  type="button"
                  onClick={clear}
                  className="rounded-xl border border-white/20 px-5 py-2.5 text-sm font-semibold transition-colors hover:border-accent"
                >
                  Limpar filtros
                </button>
                <a href="#alerta" className="rounded-xl bg-accent px-5 py-2.5 text-sm font-semibold text-ink">
                  Criar alerta
                </a>
              </div>
            </div>
          ) : (
            <section aria-label="Viaturas" className="mt-6">
              <ul className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
                {results.map((v, i) => (
                  <li key={v.slug}>
                    <StockCard vehicle={v} priority={i < 3} />
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      {/* O alerta acompanha a pesquisa (quem não encontrou tem os critérios preenchidos). */}
      <section id="alerta" className="scroll-mt-28 pt-16">
        <StockAlertForm
          vehicleType={alertType}
          vehicleTypes={siteTypes}
          makes={makeOptions(vehicles, [])}
          defaults={{
            make: applied.filters.makes.length === 1 ? applied.filters.makes[0]! : null,
            model: applied.filters.base.model,
            body:
              applied.filters.kinds.length === 1 && applied.filters.kinds[0] === "moto4"
                ? MOTO4
                : applied.filters.bodies.length === 1
                  ? applied.filters.bodies[0]!
                  : null,
            fuel: applied.filters.base.fuel,
            max_price: applied.filters.base.maxPrice,
            min_year: applied.filters.base.minYear,
            max_km: applied.filters.base.maxMileage,
          }}
        />
      </section>
      {below}

      {sheet && <FilterSheet onClose={() => setSheet(false)}>{panel(true)}</FilterSheet>}
    </div>
  );
}

/** O tipo do alerta: um só tipo escolhido (carros, ou motas/Moto 4), senão nenhum. */
function alertVehicleType(kinds: StockKind[], siteTypes: VehicleType[]): VehicleType | null {
  if (siteTypes.length === 1) return siteTypes[0]!;
  if (!kinds.length) return null;
  const types = new Set(kinds.map((k) => (k === "carros" ? "car" : "motorcycle")));
  return types.size === 1 ? [...types][0]! : null;
}

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
  const toggle = (key: "makes" | "bodies" | "cc", value: string) =>
    set({ [key]: f[key].includes(value) ? f[key].filter((x) => x !== value) : [...f[key], value] });

  // As opções seguem o tipo escolhido (com «Moto 4», só as marcas das Moto 4).
  const pool = useMemo(() => vehicles.filter((v) => inKinds(v, f.kinds)), [vehicles, f.kinds]);
  const makes = useMemo(() => makeOptions(pool, f.makes), [pool, f.makes]);
  const bodies = useMemo(() => bodyOptions(pool, f.bodies), [pool, f.bodies]);
  const years = useMemo(() => yearOptions(vehicles), [vehicles]);
  const onlyCars = pool.length > 0 && pool.every((v) => (v.vehicleType ?? "car") === "car");
  const showCc = f.cc.length > 0 || pool.some((v) => v.vehicleType === "motorcycle" && v.displacement > 0);

  return (
    <div className="rounded-2xl border border-white/10 bg-ink-soft">
      <div className="flex items-center justify-between gap-3 px-5 pb-4 pt-5">
        <h2 className="flex items-center gap-2.5 text-2xl font-bold tracking-tight">
          <Icon name="sliders" className="h-6 w-6 text-accent" /> Filtros
        </h2>
        <span className="text-sm text-paper/70" aria-live="polite">
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
              limit={10}
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
              limit={10}
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
            format={formatPrice}
            minLabel="0 €"
            maxLabel={`${formatNumber(PRICE_MAX)} €+`}
            onChange={(maxPrice) => setBase({ maxPrice })}
          />
        </Section>
        {years.length > 0 && (
          <Section title="Ano">
            <div className="grid grid-cols-[auto_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 text-sm">
              <span className="text-paper/70">De</span>
              <select
                aria-label="Ano — de"
                className="core2-select"
                value={f.base.minYear ?? ""}
                onChange={(e) => setBase({ minYear: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Qualquer</option>
                {years
                  .filter((y) => f.base.maxYear == null || y <= f.base.maxYear)
                  .map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
              </select>
              <span className="text-paper/70">Até</span>
              <select
                aria-label="Ano — até"
                className="core2-select"
                value={f.base.maxYear ?? ""}
                onChange={(e) => setBase({ maxYear: e.target.value ? Number(e.target.value) : null })}
              >
                <option value="">Qualquer</option>
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
            format={(n) => `${formatNumber(n)} km`}
            minLabel="0 km"
            maxLabel={`${formatNumber(KM_MAX)} km+`}
            onChange={(maxMileage) => setBase({ maxMileage })}
          />
        </Section>
        {showCc && (
          <Section title="Cilindrada">
            <CheckGrid
              options={CC_BUCKETS.map((b) => ({ value: b.id, label: b.label }))}
              checked={(id) => f.cc.includes(id)}
              onToggle={(id) => toggle("cc", id)}
            />
          </Section>
        )}
        <div className="flex items-center justify-between gap-3 border-t border-white/10 py-4">
          <span className="text-base font-bold">Ordenar por</span>
          <SortSelect value={state.sort} onChange={(sort) => onChange({ ...state, sort })} />
        </div>
      </div>

      <div
        className={`grid grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] gap-3 border-t border-white/10 p-5 ${
          sticky ? "sticky bottom-0 rounded-b-2xl bg-ink-soft" : ""
        }`}
      >
        <button
          type="button"
          onClick={onApply}
          className={`inline-flex items-center justify-center gap-2 rounded-xl bg-accent px-4 py-3 text-base font-semibold text-ink transition-[filter,box-shadow] hover:brightness-110 ${
            dirty ? "shadow-[0_0_0_3px_rgb(255_255_255/0.12)]" : ""
          }`}
        >
          <Icon name="search" className="h-5 w-5" /> Aplicar filtros
        </button>
        <button
          type="button"
          onClick={onClear}
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/25 px-4 py-3 text-base font-semibold transition-colors hover:border-accent hover:text-accent"
        >
          <Icon name="reset" className="h-5 w-5" /> Limpar
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
          className="flex w-full items-center justify-between gap-3 text-left text-base font-bold"
        >
          {title}
          <Icon name="chevron" className={`h-4 w-4 text-paper/60 transition-transform ${open ? "" : "rotate-180"}`} />
        </button>
      </h3>
      <div id={id} hidden={!open} className="mt-3">
        {children}
      </div>
    </section>
  );
}

/** Caixas em duas colunas (com «Ver todas» quando são muitas). */
function CheckGrid({
  options,
  checked,
  onToggle,
  limit,
  more = "Ver todas",
}: {
  options: { value: string; label: string }[];
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
      <div className="grid grid-cols-2 gap-x-3 gap-y-2.5">
        {shown.map((o) => (
          <label key={o.value} className="flex min-w-0 cursor-pointer items-center gap-2.5 text-sm leading-tight">
            <input type="checkbox" className="core2-check" checked={checked(o.value)} onChange={() => onToggle(o.value)} />
            <span className="min-w-0 break-words">{o.label}</span>
          </label>
        ))}
      </div>
      {limit && options.length > limit && (
        <button type="button" onClick={() => setAll((a) => !a)} className="mt-3 text-sm font-semibold text-accent">
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
      <div className="flex items-center gap-3">
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
        <output className="min-w-[6.75rem] rounded-lg border border-white/15 bg-ink px-2.5 py-1.5 text-right text-sm font-semibold tabular-nums">
          {text}
        </output>
      </div>
      <div className="mt-1.5 flex justify-between text-xs text-paper/50">
        <span>{minLabel}</span>
        <span>{maxLabel}</span>
      </div>
    </div>
  );
}

function SortSelect({ value, onChange }: { value: SortKey; onChange: (sort: SortKey) => void }) {
  return (
    <select className="core2-select" value={value} onChange={(e) => onChange(e.target.value as SortKey)}>
      {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
        <option key={k} value={k}>
          {SORT_LABELS[k]}
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
          className="grid h-10 w-10 place-items-center rounded-full border border-white/15 text-paper/80"
        >
          <Icon name="close" className="h-5 w-5" />
        </button>
      </div>
      {children}
    </div>
  );
}

// ---- Cartão de uma viatura ------------------------------------------------------

/** Foto, nome e ano, a linha de dados, o preço e «Ver detalhes» (abre a ficha). */
function StockCard({ vehicle: v, priority }: { vehicle: Vehicle; priority: boolean }) {
  const router = useRouter();
  const href = `/viaturas/${v.slug}`;
  const cover = v.images[0];
  const price = priceLabel(v.price, v.priceOnRequest);
  const prefetched = useRef(false);
  // A ficha carrega-se quando o rato (ou o dedo) chega ao cartão, como no Core.
  const prefetch = () => {
    if (prefetched.current) return;
    prefetched.current = true;
    router.prefetch(href, { kind: "full" } as Parameters<typeof router.prefetch>[1]);
  };
  return (
    <Link
      href={href}
      onPointerEnter={prefetch}
      onTouchStart={prefetch}
      onFocus={prefetch}
      // A foto à vista vai já para o esqueleto da ficha (ver loading.tsx).
      onClick={(e) => setVehiclePreview(v.slug, e.currentTarget.querySelector("img")?.currentSrc)}
      className="group flex h-full flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-soft transition-[border-color,transform] duration-300 hover:-translate-y-0.5 hover:border-white/25"
    >
      <div className="relative aspect-[16/10] overflow-hidden rounded-t-2xl bg-ink-muted">
        {cover && (
          <FadeImage
            src={cover.src}
            alt={cover.alt || `${v.make} ${v.model}`}
            fill
            priority={priority}
            sizes="(max-width: 640px) 100vw, (max-width: 1280px) 50vw, 33vw"
            className="object-cover transition-transform duration-500 group-hover:scale-105"
          />
        )}
        {v.status === "reserved" && (
          <span className="absolute left-3 top-3 rounded-full bg-accent px-2.5 py-1 text-xs font-semibold text-ink">
            Reservado
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col px-4 pb-4 pt-3.5">
        <div className="flex items-start justify-between gap-3">
          <h3 className="min-w-0 text-lg font-bold leading-snug">
            {v.make} {v.model}
          </h3>
          {v.year ? (
            <span className="mt-0.5 shrink-0 rounded-md bg-white/10 px-2 py-0.5 text-xs font-semibold tabular-nums text-paper/85">
              {v.year}
            </span>
          ) : null}
        </div>
        <p className="mt-1.5 text-sm text-paper/65">{cardFacts(v).join(" • ")}</p>
        <div className="mt-auto flex items-center justify-between gap-3 pt-4">
          <span className="text-2xl font-bold tracking-tight text-accent">{price}</span>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-white/20 px-3 py-1.5 text-sm font-semibold transition-colors group-hover:border-accent group-hover:text-accent">
            Ver detalhes <Icon name="arrow" className="h-4 w-4" />
          </span>
        </div>
      </div>
    </Link>
  );
}

// ---- Ícones ---------------------------------------------------------------------

type IconName = "sliders" | "chevron" | "arrow" | "search" | "reset" | "close";

const PATHS: Record<IconName, React.ReactNode> = {
  sliders: (
    <>
      <path d="M4 6h9M17 6h3M4 12h3M11 12h9M4 18h11M19 18h1" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="17" cy="18" r="2" />
    </>
  ),
  chevron: <path d="m6 15 6-6 6 6" />,
  arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </>
  ),
  reset: (
    <>
      <path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" />
      <path d="M5 3v5h5M19 21v-5h-5" />
    </>
  ),
  close: <path d="M6 6l12 12M18 6 6 18" />,
};

function Icon({ name, className = "" }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={className}
    >
      {PATHS[name]}
    </svg>
  );
}
