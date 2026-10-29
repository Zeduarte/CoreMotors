import { isCampaign } from "./vehicle-categories";
import type { Vehicle, VehicleFilters, SortKey } from "@/types/vehicle";
import { brandOptions, sameBrand } from "./brand-name";
import { matchesOlxFilters } from "./olx/filter-match";

/**
 * Helpers PUROS de inventário (filtros, ordenação).
 *
 * Sem dependências de servidor — podem ser importados por Client Components.
 * As leituras à base de dados (Supabase) vivem em `src/lib/queries.ts`
 * (server-only). Esta separação evita puxar `next/headers` para o browser.
 */

/** Lista ordenada e sem duplicados de valores de um campo — alimenta os filtros. */
/** Marcas presentes na lista, agrupadas sem olhar a maiúsculas. */
export function distinctMakes(list: Vehicle[]): string[] {
  return brandOptions(list.map((v) => v.make));
}

export function distinctValues<K extends keyof Vehicle>(
  list: Vehicle[],
  key: K,
): Array<Vehicle[K]> {
  return Array.from(new Set(list.map((v) => v[key]))).sort((a, b) =>
    String(a).localeCompare(String(b), "pt"),
  );
}

const EMPTY_FILTERS: VehicleFilters = {
  query: null,
  make: null,
  model: null,
  fuel: null,
  transmission: null,
  body: null,
  minPrice: null,
  maxPrice: null,
  minYear: null,
  maxMileage: null,
  minMileage: null,
  maxYear: null,
  location: null,
  vehicleType: null,
  campaignOnly: false,
  minPower: null,
  maxPower: null,
  minDisplacement: null,
  maxDisplacement: null,
  color: null,
  doors: null,
  seats: null,
  nationalOnly: false,
  firstOwnerOnly: false,
  serviceBookOnly: false,
  warrantyOnly: false,
  olx: {},
};

export function emptyFilters(): VehicleFilters {
  return { ...EMPTY_FILTERS, olx: {} };
}

const inRange = (value: number, min: number | null, max: number | null) =>
  (min == null || value >= min) && (max == null || value <= max);

/** Aplica filtros de forma pura (sem mutação) — fácil de testar. */
export function applyFilters(
  list: Vehicle[],
  filters: VehicleFilters,
): Vehicle[] {
  const q = filters.query?.trim().toLowerCase();
  return list.filter((v) => {
    if (
      q &&
      !`${v.make} ${v.model} ${v.variant ?? ""}`.toLowerCase().includes(q)
    )
      return false;
    // Sem olhar a maiúsculas: "BMW" e "Bmw" são a mesma marca.
    if (filters.make && !sameBrand(v.make, filters.make)) return false;
    if (filters.model && v.model !== filters.model) return false;
    if (filters.fuel && v.fuel !== filters.fuel) return false;
    if (filters.transmission && v.transmission !== filters.transmission)
      return false;
    if (filters.body && v.body !== filters.body) return false;
    if (
      filters.location &&
      (v.pointOfSaleId || v.location) !== filters.location
    )
      return false;
    if (filters.vehicleType && (v.vehicleType ?? "car") !== filters.vehicleType)
      return false;
    if (filters.campaignOnly && !isCampaign(v)) return false;
    if (filters.maxYear != null && v.year > filters.maxYear) return false;
    if (filters.minMileage != null && v.mileage < filters.minMileage)
      return false;
    if (
      v.priceOnRequest &&
      (filters.minPrice != null || filters.maxPrice != null)
    )
      return false;
    if (filters.minPrice != null && v.price < filters.minPrice) return false;
    if (filters.maxPrice != null && v.price > filters.maxPrice) return false;
    if (filters.minYear != null && v.year < filters.minYear) return false;
    if (filters.maxMileage != null && v.mileage > filters.maxMileage)
      return false;
    // Potência e cilindrada a zero são "não indicado": só ficam de fora quando
    // se filtra por elas.
    if ((filters.minPower != null || filters.maxPower != null) && (!v.power || !inRange(v.power, filters.minPower, filters.maxPower)))
      return false;
    if (
      (filters.minDisplacement != null || filters.maxDisplacement != null) &&
      (!v.displacement || !inRange(v.displacement, filters.minDisplacement, filters.maxDisplacement))
    )
      return false;
    if (filters.color && v.color.trim().toLowerCase() !== filters.color.toLowerCase()) return false;
    if (filters.doors != null && v.doors !== filters.doors) return false;
    if (filters.seats != null && v.seats !== filters.seats) return false;
    if (filters.nationalOnly && !v.national) return false;
    if (filters.firstOwnerOnly && !v.firstOwner && v.owners !== 1) return false;
    if (filters.serviceBookOnly && !v.serviceBook) return false;
    if (filters.warrantyOnly && !(v.warrantyMonths && v.warrantyMonths > 0)) return false;
    if (filters.olx && Object.keys(filters.olx).length && !matchesOlxFilters(v.olx, filters.olx)) return false;
    return true;
  });
}

// ---- Pesquisa no endereço ---------------------------------------------------

/**
 * A pesquisa fica no endereço (como no OLX): pode guardar-se, partilhar-se e
 * voltar-se a ela. Nomes em português e curtos; os antigos (`make`, `model`,
 * `fuel`, `transmission`) continuam a ser lidos, para os links que já existem.
 */
const NUMBER_PARAMS = {
  preco_min: "minPrice",
  preco_max: "maxPrice",
  ano_min: "minYear",
  ano_max: "maxYear",
  km_min: "minMileage",
  km_max: "maxMileage",
  cv_min: "minPower",
  cv_max: "maxPower",
  cc_min: "minDisplacement",
  cc_max: "maxDisplacement",
  portas: "doors",
  lugares: "seats",
} as const satisfies Record<string, keyof VehicleFilters>;
const TEXT_PARAMS = {
  q: "query",
  marca: "make",
  modelo: "model",
  combustivel: "fuel",
  caixa: "transmission",
  categoria: "body",
  cor: "color",
  local: "location",
} as const satisfies Record<string, keyof VehicleFilters>;
const LEGACY_TEXT = { make: "make", model: "model", fuel: "fuel", transmission: "transmission" } as const;
const FLAG_PARAMS = {
  campanha: "campaignOnly",
  nacional: "nationalOnly",
  primeiro_dono: "firstOwnerOnly",
  livro: "serviceBookOnly",
  garantia: "warrantyOnly",
} as const satisfies Record<string, keyof VehicleFilters>;

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;
const toNumber = (v: string | null) => {
  if (!v) return null;
  const n = Number(v.replace(/[^\d]/g, ""));
  return v.replace(/[^\d]/g, "") && Number.isFinite(n) ? n : null;
};

export function filtersFromQuery(sp: Params): Partial<VehicleFilters> {
  const out: Partial<VehicleFilters> = {};
  const set = <K extends keyof VehicleFilters>(k: K, v: VehicleFilters[K]) => {
    out[k] = v;
  };
  for (const [param, key] of Object.entries(LEGACY_TEXT)) {
    const v = first(sp[param]);
    if (v) set(key, v as never);
  }
  for (const [param, key] of Object.entries(TEXT_PARAMS)) {
    const v = first(sp[param]);
    if (v) set(key, v.slice(0, 80) as never);
  }
  for (const [param, key] of Object.entries(NUMBER_PARAMS)) {
    const v = toNumber(first(sp[param]));
    if (v != null) set(key, v as never);
  }
  for (const [param, key] of Object.entries(FLAG_PARAMS)) {
    if (first(sp[param]) === "1") set(key, true as never);
  }
  const olx: VehicleFilters["olx"] = {};
  for (const [param, raw] of Object.entries(sp)) {
    const m = /^olx_([a-z0-9_]{1,60}?)(_min|_max)?$/.exec(param);
    const v = first(raw);
    if (!m || !v) continue;
    const [, code, bound] = m;
    if (!bound) olx[code!] = v.slice(0, 80);
    else {
      const prev = olx[code!];
      const range = typeof prev === "object" ? prev : { min: null, max: null };
      range[bound === "_min" ? "min" : "max"] = toNumber(v);
      olx[code!] = range;
    }
  }
  if (Object.keys(olx).length) out.olx = olx;
  return out;
}

export function filtersToQuery(f: VehicleFilters, sort?: SortKey): string {
  const qs = new URLSearchParams();
  for (const [param, key] of Object.entries(TEXT_PARAMS)) {
    const v = f[key];
    if (typeof v === "string" && v.trim()) qs.set(param, v.trim());
  }
  for (const [param, key] of Object.entries(NUMBER_PARAMS)) {
    const v = f[key];
    if (typeof v === "number") qs.set(param, String(v));
  }
  for (const [param, key] of Object.entries(FLAG_PARAMS)) {
    if (f[key]) qs.set(param, "1");
  }
  for (const [code, v] of Object.entries(f.olx ?? {})) {
    if (typeof v === "string") {
      if (v) qs.set(`olx_${code}`, v);
    } else {
      if (v.min != null) qs.set(`olx_${code}_min`, String(v.min));
      if (v.max != null) qs.set(`olx_${code}_max`, String(v.max));
    }
  }
  if (sort && sort !== "relevance") qs.set("ordem", sort);
  return qs.toString();
}

const SORT_KEYS: SortKey[] = ["relevance", "price-asc", "price-desc", "year-desc", "mileage-asc"];
export function sortFromQuery(sp: Params): SortKey {
  const v = first(sp.ordem);
  return SORT_KEYS.includes(v as SortKey) ? (v as SortKey) : "relevance";
}

/** Quantos filtros estão ativos (o número no botão "Mais filtros"). */
export function activeFilterCount(f: VehicleFilters): number {
  const skip = new Set<keyof VehicleFilters>(["vehicleType", "olx", "query", "make", "model", "body"]);
  let n = 0;
  for (const [k, v] of Object.entries(f) as [keyof VehicleFilters, unknown][]) {
    if (skip.has(k)) continue;
    if (v === true || typeof v === "number" || (typeof v === "string" && v)) n++;
  }
  for (const v of Object.values(f.olx ?? {})) {
    if (typeof v === "string" ? v : v.min != null || v.max != null) n++;
  }
  return n;
}

/** Sem preço publicado: "sob consulta" (ou 0 por preencher). */
const noPrice = (v: Vehicle) => v.priceOnRequest || !(v.price > 0);

/**
 * Ordena por preço com as viaturas sem preço SEMPRE no fim, nas duas ordens:
 * o "sob consulta" tem `price` 0 e, sem isto, aparecia como a mais barata.
 */
const byPrice =
  (dir: 1 | -1) =>
  (a: Vehicle, b: Vehicle): number =>
    Number(noPrice(a)) - Number(noPrice(b)) || (noPrice(a) ? 0 : dir * (a.price - b.price));

const SORTERS: Record<SortKey, (a: Vehicle, b: Vehicle) => number> = {
  relevance: (a, b) =>
    Number(b.featured) - Number(a.featured) || b.year - a.year,
  "price-asc": byPrice(1),
  "price-desc": byPrice(-1),
  "year-desc": (a, b) => b.year - a.year,
  "mileage-asc": (a, b) => a.mileage - b.mileage,
};

export function sortVehicles(list: Vehicle[], key: SortKey): Vehicle[] {
  return [...list].sort(SORTERS[key]);
}
