"use client";

import { useState } from "react";
import type {
  VehicleFilters,
  FuelType,
  Transmission,
  BodyType,
  SortKey,
} from "@/types/vehicle";
import { bodiesFor } from "@/lib/vehicle-categories";
import { activeFilterCount } from "@/lib/vehicles";
import { BodyPicker } from "@/components/ui/BodyPicker";
import type { SearchField } from "@/lib/olx/search";

interface FiltersProps {
  filters: VehicleFilters;
  sort: SortKey;
  options: {
    locations: { value: string; label: string }[];
    makes: string[];
    models: string[];
    fuels: FuelType[];
    transmissions: Transmission[];
    bodies: BodyType[];
    /** Quantas viaturas há em cada categoria (os quadrados da pesquisa). */
    bodyCounts?: Record<string, number>;
    colors?: string[];
    doors?: number[];
    seats?: number[];
    /** Campos do OLX com opções no stock (ver `inventoryWithOlx`). */
    olxFields?: SearchField[];
  };
  resultCount: number;
  onChange: (patch: Partial<VehicleFilters>) => void;
  onSort: (sort: SortKey) => void;
  onReset: () => void;
}

/** Atalhos rápidos que aplicam um conjunto de filtros de uma vez. */
const QUICK_CHIPS: { label: string; patch: Partial<VehicleFilters> }[] = [
  { label: "Elétrico", patch: { fuel: "Elétrico" } },
  { label: "Híbrido", patch: { fuel: "Híbrido" } },
  { label: "Automática", patch: { transmission: "Automática" } },
  { label: "SUV", patch: { body: "SUV" } },
  { label: "Até 30.000 km", patch: { maxMileage: 30000 } },
  { label: "Até 25.000 €", patch: { maxPrice: 25000 } },
];

/** Nas motas pesquisa-se pela carta: 125 cc (carta B ou A1) e A2 (até 35 kW ≈ 48 cv). */
const MOTO_CHIPS: { label: string; patch: Partial<VehicleFilters> }[] = [
  { label: "Até 125 cc (A1 / carta B)", patch: { maxDisplacement: 125 } },
  { label: "Até 48 cv (A2)", patch: { maxPower: 48 } },
  { label: "Até 5.000 €", patch: { maxPrice: 5000 } },
  { label: "Até 10.000 €", patch: { maxPrice: 10000 } },
  { label: "Até 20.000 km", patch: { maxMileage: 20000 } },
];

const SORT_LABELS: Record<SortKey, string> = {
  relevance: "Relevância",
  "price-asc": "Preço ↑",
  "price-desc": "Preço ↓",
  "year-desc": "Mais recentes",
  "mileage-asc": "Menos km",
};

/** Barra de filtros do inventário — totalmente controlada, sem estado próprio. */
export function Filters({
  filters,
  sort,
  options,
  resultCount,
  onChange,
  onSort,
  onReset,
  embedded = false,
}: FiltersProps & {
  /** Dentro do cartão do topo (sem moldura própria), em vez de um cartão à parte. */
  embedded?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const active = activeFilterCount(filters);
  const isMoto = filters.vehicleType === "motorcycle";
  const setOlx = (code: string, value: VehicleFilters["olx"][string] | null) => {
    const next = { ...filters.olx };
    if (value === null || value === "" || (typeof value === "object" && value.min == null && value.max == null)) delete next[code];
    else next[code] = value;
    onChange({ olx: next });
  };

  return (
    <div
      className={
        embedded
          ? "border-t border-white/10 p-5 md:p-6"
          : "rounded-2xl border border-white/10 bg-ink-soft p-5 md:p-6"
      }
    >
      {/* Categorias como no OLX: um quadrado por categoria com viaturas em
          stock, com a contagem. É a primeira escolha de quem procura. */}
      {filters.vehicleType && (
        <div className="mb-5">
          <p className="mb-2 text-xs font-medium uppercase tracking-wider text-paper/40">
            {filters.vehicleType === "motorcycle" ? "Categoria da mota" : "Carroçaria"}
          </p>
          <BodyPicker
            compact
            allLabel="Todas"
            options={bodiesFor(filters.vehicleType).filter(
              (b) => (options.bodyCounts?.[b] ?? 0) > 0 || filters.body === b,
            )}
            counts={options.bodyCounts}
            value={filters.body}
            onChange={(b) => onChange({ body: (b ?? null) as BodyType | null })}
          />
        </div>
      )}

      {/* Pesquisa livre */}
      <input
        type="search"
        value={filters.query ?? ""}
        onChange={(e) => onChange({ query: e.target.value || null })}
        placeholder="Pesquisar marca, modelo ou versão…"
        aria-label="Pesquisar viaturas"
        className="mb-4 w-full rounded-lg border border-white/10 bg-ink px-4 py-2.5 text-sm text-paper transition-colors placeholder:text-paper/30 focus:border-accent"
      />

      {/* Filtros básicos sempre visíveis: Marca, Modelo + botão de expandir */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
        <Field label="Marca">
          <Select
            value={filters.make ?? ""}
            onChange={(v) => onChange({ make: v || null, model: null })}
          >
            <option value="">Todas</option>
            {options.makes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Modelo">
          <Select
            value={filters.model ?? ""}
            onChange={(v) => onChange({ model: v || null })}
          >
            <option value="">Todos</option>
            {options.models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </Select>
        </Field>

        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="flex items-center justify-center gap-2 rounded-lg border border-white/15 px-4 py-2.5 text-sm text-paper/80 transition-colors hover:border-accent hover:text-accent"
        >
          {expanded ? "Menos filtros" : "Mais filtros"}
          {active > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-accent px-1.5 text-[11px] font-bold text-ink">
              {active}
            </span>
          )}
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-transform ${expanded ? "rotate-180" : ""}`}
            aria-hidden
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {/* Filtros avançados (expansíveis) */}
      {expanded && (
        <div className="mt-5 border-t border-white/10 pt-5">
          {/* Atalhos rápidos */}
          <div className="mb-5 flex flex-wrap gap-2">
            {(isMoto ? MOTO_CHIPS : QUICK_CHIPS).map((chip) => (
              <button
                key={chip.label}
                type="button"
                onClick={() => onChange(chip.patch)}
                className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-paper/70 transition-colors hover:border-accent hover:text-accent"
              >
                {chip.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
            <Field label="Combustível">
              <Select
                value={filters.fuel ?? ""}
                onChange={(v) =>
                  onChange({ fuel: (v || null) as FuelType | null })
                }
              >
                <option value="">Todos</option>
                {options.fuels.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label="Caixa">
              <Select
                value={filters.transmission ?? ""}
                onChange={(v) =>
                  onChange({ transmission: (v || null) as Transmission | null })
                }
              >
                <option value="">Todas</option>
                {options.transmissions.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>

            {/* A categoria escolhe-se nos quadrados do topo. Sem mundo
                definido (raro), fica a lista aqui. */}
            {!filters.vehicleType && (
            <Field label="Carroçaria">
              <Select
                value={filters.body ?? ""}
                onChange={(v) =>
                  onChange({ body: (v || null) as BodyType | null })
                }
              >
                <option value="">Todas</option>
                {options.bodies.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </Select>
            </Field>
            )}

            {options.colors && options.colors.length > 1 && (
              <Field label="Cor">
                <Select value={filters.color ?? ""} onChange={(v) => onChange({ color: v || null })}>
                  <option value="">Todas</option>
                  {options.colors.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {!isMoto && options.doors && options.doors.length > 1 && (
              <Field label="Portas">
                <Select value={filters.doors?.toString() ?? ""} onChange={(v) => onChange({ doors: v ? Number(v) : null })}>
                  <option value="">Todas</option>
                  {options.doors.map((d) => (
                    <option key={d} value={d}>
                      {d} portas
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            {options.seats && options.seats.length > 1 && (
              <Field label="Lugares">
                <Select value={filters.seats?.toString() ?? ""} onChange={(v) => onChange({ seats: v ? Number(v) : null })}>
                  <option value="">Todos</option>
                  {options.seats.map((d) => (
                    <option key={d} value={d}>
                      {d} {d === 1 ? "lugar" : "lugares"}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {([
              ["Preço (€)","minPrice","maxPrice"],
              ["Ano","minYear","maxYear"],
              ["Quilómetros","minMileage","maxMileage"],
              // Nas motas a cilindrada vem primeiro: é ela que diz a carta (A1, A2, A).
              ...(isMoto
                ? ([["Cilindrada (cm³)","minDisplacement","maxDisplacement"],["Potência (cv)","minPower","maxPower"]] as const)
                : ([["Potência (cv)","minPower","maxPower"],["Cilindrada (cm³)","minDisplacement","maxDisplacement"]] as const)),
            ] as const).map(([label,min,max]) => <fieldset key={label} className="col-span-2 rounded-xl border border-white/10 p-3">
              <legend className="px-1 text-xs uppercase tracking-wider text-paper/60">{label}</legend>
              <div className="grid grid-cols-2 gap-3"><Field label={`${label} desde`}><NumberInput value={filters[min]} placeholder="Mínimo" onChange={v=>onChange({[min]:v})}/></Field><Field label={`${label} até`}><NumberInput value={filters[max]} placeholder="Máximo" onChange={v=>onChange({[max]:v})}/></Field></div>
            </fieldset>)}
          </div>

          {/* Historial e origem, como no OLX. */}
          <div className="mt-5 flex flex-wrap gap-2">
            {([
              ["nationalOnly", "Nacional"],
              ["firstOwnerOnly", "1.º dono"],
              ["serviceBookOnly", "Livro de revisões"],
              ["warrantyOnly", "Com garantia"],
              ["campaignOnly", "Em campanha"],
            ] as const).map(([key, label]) => (
              <label
                key={key}
                className={`flex cursor-pointer items-center gap-2 rounded-full border px-3.5 py-2 text-sm transition-colors ${
                  filters[key]
                    ? "border-accent bg-accent/15 text-accent"
                    : "border-white/15 text-paper/75 hover:border-white/30"
                }`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={filters[key]}
                  onChange={(e) => onChange({ [key]: e.target.checked })}
                />
                {filters[key] ? "✓ " : ""}
                {label}
              </label>
            ))}
          </div>

          {/* Os restantes campos do OLX (os da categoria escolhida em
              Plataformas de anúncios), só com opções que existem no stock. */}
          {options.olxFields && options.olxFields.length > 0 && (
            <div className="mt-5 border-t border-white/10 pt-5">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-paper/40">Mais características</p>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
                {options.olxFields.map((f) => {
                  const current = filters.olx[f.code];
                  if (f.kind === "number") {
                    const range = typeof current === "object" ? current : { min: null, max: null };
                    const unit = f.unit ? ` (${f.unit})` : "";
                    return (
                      <fieldset key={f.code} className="col-span-2 rounded-xl border border-white/10 p-3">
                        <legend className="px-1 text-xs uppercase tracking-wider text-paper/60">{f.label}{unit}</legend>
                        <div className="grid grid-cols-2 gap-3">
                          <Field label={`${f.label} desde`}>
                            <NumberInput value={range.min} placeholder="Mínimo" onChange={(v) => setOlx(f.code, { ...range, min: v })} />
                          </Field>
                          <Field label={`${f.label} até`}>
                            <NumberInput value={range.max} placeholder="Máximo" onChange={(v) => setOlx(f.code, { ...range, max: v })} />
                          </Field>
                        </div>
                      </fieldset>
                    );
                  }
                  return (
                    <Field key={f.code} label={f.label}>
                      <Select value={typeof current === "string" ? current : ""} onChange={(v) => setOlx(f.code, v || null)}>
                        <option value="">{f.kind === "multi" ? "Qualquer" : "Todos"}</option>
                        {f.values.map((o) => (
                          <option key={o.code} value={o.code}>
                            {o.label}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-col items-start justify-between gap-4 border-t border-white/10 pt-5 sm:flex-row sm:items-center">
        <p className="text-sm text-paper/60" role="status" aria-live="polite">
          <span className="font-semibold text-paper">{resultCount}</span>{" "}
          {resultCount === 1 ? "viatura" : "viaturas"}
        </p>

        <div className="flex items-center gap-3">
          <Field label="Ordenar" inline>
            <Select value={sort} onChange={(v) => onSort(v as SortKey)}>
              {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORT_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <button
            type="button"
            onClick={onReset}
            className="whitespace-nowrap rounded-lg px-3 py-2 text-sm text-paper/60 transition-colors hover:text-paper"
          >
            Limpar
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  children,
  inline,
}: {
  label: string;
  children: React.ReactNode;
  inline?: boolean;
}) {
  return (
    <label className={inline ? "flex items-center gap-2" : "block"}>
      <span
        className={`text-xs font-medium uppercase tracking-wider text-paper/40 ${
          inline ? "" : "mb-1.5 block"
        }`}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function Select({
  value,
  onChange,
  children,
}: {
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-paper transition-colors focus:border-accent"
    >
      {children}
    </select>
  );
}

function NumberInput({
  value,
  placeholder,
  onChange,
}: {
  value: number | null;
  placeholder?: string;
  onChange: (v: number | null) => void;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      value={value ?? ""}
      placeholder={placeholder}
      onChange={(e) =>
        onChange(e.target.value === "" ? null : Number(e.target.value))
      }
      className="w-full rounded-lg border border-white/10 bg-ink px-3 py-2 text-sm text-paper transition-colors focus:border-accent"
    />
  );
}
