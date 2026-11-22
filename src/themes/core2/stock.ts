import type { SortKey, Vehicle, VehicleFilters } from "@/types/vehicle";
import { CAR_BODIES, MOTORCYCLE_BODIES, type VehicleType } from "@/lib/vehicle-categories";
import { applyFilters, emptyFilters, filtersFromQuery, filtersToQuery, sortFromQuery, sortVehicles } from "@/lib/vehicles";
import { brandOptions, canonicalBrand, sameBrand } from "@/lib/brand-name";
import { formatKm, formatNumber, formatPrice } from "@/lib/format";

/**
 * Stock do tema Core2: a lógica (sem interface), para se poder testar.
 *
 * - Tipo: Motas, Moto 4 e Carros, em caixas (várias de uma vez; nenhuma =
 *   todas). A Moto 4 é a categoria «Moto 4» das motas (no backoffice continua
 *   a ser uma mota); «Motas» são as outras.
 * - Marca, categoria e cilindrada também em caixas; preço, ano e quilómetros
 *   são os filtros de sempre (`applyFilters`), como o resto que chegue por um
 *   link (pesquisa, modelo, combustível…), que aparece nos filtros ativos.
 * - Tudo vai para o endereço, como no stock do Core: os links que já existem
 *   (?tipo=motas&categoria=Naked, ?marca=BMW, as páginas de SEO) abrem
 *   filtrados. `?tipo=motas` sozinho são todas as motas (com as Moto 4), como
 *   no Core; só «Motas» sem «Moto 4» escreve `&moto4=0`.
 */

export type StockKind = "motas" | "moto4" | "carros";
export const MOTO4 = "Moto 4";
/** A ordem das caixas do Tipo (como na maqueta: Motas, Moto 4, Carros). */
const KIND_ORDER: StockKind[] = ["motas", "moto4", "carros"];
export const KIND_LABEL: Record<StockKind, string> = { motas: "Motas", moto4: "Moto 4", carros: "Carros" };

/** As barras do preço e dos quilómetros: no fim («50 000 €+») é sem limite. */
export const PRICE_MAX = 50_000;
export const PRICE_STEP = 500;
export const KM_MAX = 100_000;
export const KM_STEP = 1_000;

/** Cilindrada das motas, em intervalos (caixas). Sem buracos entre eles. */
export const CC_BUCKETS = [
  { id: "125", label: "Até 125 cc", min: 0, max: 125 },
  { id: "450", label: "126 a 450 cc", min: 126, max: 450 },
  { id: "800", label: "451 a 800 cc", min: 451, max: 800 },
  { id: "801", label: "Mais de 800 cc", min: 801, max: Infinity },
] as const;

export const SORT_LABELS: Record<SortKey, string> = {
  relevance: "Relevância",
  "year-desc": "Mais recentes",
  "price-asc": "Preço mais baixo",
  "price-desc": "Preço mais alto",
  "mileage-asc": "Menos quilómetros",
};

export interface Core2Filters {
  /** Vazio: todos os tipos. */
  kinds: StockKind[];
  makes: string[];
  bodies: string[];
  cc: string[];
  /** O resto: preço, ano, km e o que vier de um link (pesquisa, modelo…). */
  base: VehicleFilters;
}

export interface Core2State {
  filters: Core2Filters;
  sort: SortKey;
}

export function emptyCore2(): Core2Filters {
  return { kinds: [], makes: [], bodies: [], cc: [], base: emptyFilters() };
}

export function kindOf(v: Pick<Vehicle, "vehicleType" | "body">): StockKind {
  if ((v.vehicleType ?? "car") === "car") return "carros";
  return v.body === MOTO4 ? "moto4" : "motas";
}

/**
 * Os tipos à escolha: os que o site vende (a Moto 4 só com alguma em stock).
 * Com menos de dois, não há escolha a fazer (a secção não aparece).
 */
export function kindsFor(siteTypes: VehicleType[], vehicles: Pick<Vehicle, "vehicleType" | "body">[]): StockKind[] {
  const out = KIND_ORDER.filter((k) =>
    k === "carros"
      ? siteTypes.includes("car")
      : siteTypes.includes("motorcycle") && (k === "motas" || vehicles.some((v) => kindOf(v) === "moto4")),
  );
  return out.length > 1 ? out : [];
}

/** As viaturas dos tipos escolhidos (nenhum escolhido: todas). */
export function inKinds(v: Pick<Vehicle, "vehicleType" | "body">, kinds: StockKind[]): boolean {
  return !kinds.length || kinds.includes(kindOf(v));
}

export function inBucket(displacement: number, id: string): boolean {
  const b = CC_BUCKETS.find((x) => x.id === id);
  return !!b && displacement >= b.min && displacement <= b.max;
}

type Params = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || null;
const list = (raw: string | string[] | undefined): string[] => [
  ...new Set(
    (first(raw) ?? "")
      .split(",")
      .map((s) => s.trim().slice(0, 80))
      .filter(Boolean),
  ),
].slice(0, 30);

/** A pesquisa do endereço com o 1.º valor de cada parâmetro repetido — como o servidor. */
export function firstValues(sp: Iterable<[string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of sp) if (!(k in out)) out[k] = v;
  return out;
}

/** Lê o endereço (?tipo=motas&marca=BMW,Honda&categoria=Naked&preco_max=15000…). */
export function core2FromQuery(sp: Params, available: StockKind[]): Core2State {
  const base = { ...emptyFilters(), ...filtersFromQuery(sp) };
  // As escolhas múltiplas são deste stock; nos filtros de sempre ficam vazias.
  // O local e os campos do OLX não têm caixa aqui: ficavam escondidos.
  base.make = null;
  base.body = null;
  base.vehicleType = null;
  base.location = null;
  base.olx = {};

  const asked = new Set<StockKind>();
  for (const t of list(sp.tipo)) {
    if (t === "carros") asked.add("carros");
    if (t === "moto4") asked.add("moto4");
    if (t === "motas") {
      asked.add("motas");
      if (first(sp.moto4) !== "0") asked.add("moto4");
    }
  }
  let kinds = available.filter((k) => asked.has(k));
  let bodies = list(sp.categoria);
  // Links da Moto 4 (?tipo=motas&categoria=Moto 4, da página inicial): o tipo Moto 4.
  if (available.includes("moto4") && bodies.length === 1 && bodies[0] === MOTO4 && !kinds.includes("carros")) {
    kinds = ["moto4"];
    bodies = [];
  }
  // Todos escolhidos é o mesmo que nenhum.
  if (kinds.length === available.length) kinds = [];

  return {
    filters: {
      kinds,
      makes: list(sp.marca ?? sp.make).map(canonicalBrand),
      bodies,
      cc: list(sp.cc).filter((id) => CC_BUCKETS.some((b) => b.id === id)),
      base,
    },
    sort: sortFromQuery(sp),
  };
}

/** Escreve o endereço (o contrário de `core2FromQuery`). */
export function core2ToQuery(f: Core2Filters, sort: SortKey, available: StockKind[]): string {
  const qs = new URLSearchParams();
  const kinds = available.filter((k) => f.kinds.includes(k));
  if (kinds.length && kinds.length < available.length) {
    const tokens: string[] = [];
    if (kinds.includes("carros")) tokens.push("carros");
    if (kinds.includes("motas")) tokens.push("motas");
    else if (kinds.includes("moto4")) tokens.push("moto4");
    qs.set("tipo", tokens.join(","));
    if (kinds.includes("motas") && !kinds.includes("moto4") && available.includes("moto4")) qs.set("moto4", "0");
  }
  if (f.makes.length) qs.set("marca", f.makes.join(","));
  if (f.bodies.length) qs.set("categoria", f.bodies.join(","));
  if (f.cc.length) qs.set("cc", f.cc.join(","));
  const rest = new URLSearchParams(
    filtersToQuery({ ...f.base, make: null, body: null, vehicleType: null, location: null, olx: {} }, sort),
  );
  for (const [k, v] of rest) qs.set(k, v);
  return qs.toString();
}

/** As viaturas que passam nos filtros (sem ordenar). */
export function filterCore2(vehicles: Vehicle[], f: Core2Filters): Vehicle[] {
  const picked = vehicles.filter((v) => {
    if (!inKinds(v, f.kinds)) return false;
    if (f.makes.length && !f.makes.some((m) => sameBrand(v.make, m))) return false;
    if (f.bodies.length && !f.bodies.includes(v.body)) return false;
    // A cilindrada é das motas (os intervalos são de motas); a zero é «não
    // indicada» e fica de fora quando se filtra por ela.
    if (f.cc.length) {
      if (v.vehicleType !== "motorcycle" || !v.displacement) return false;
      if (!f.cc.some((id) => inBucket(v.displacement, id))) return false;
    }
    return true;
  });
  return applyFilters(picked, f.base);
}

/** As viaturas que se veem, já ordenadas. */
export function applyCore2(vehicles: Vehicle[], f: Core2Filters, sort: SortKey): Vehicle[] {
  return sortVehicles(filterCore2(vehicles, f), sort);
}

// ---- Opções das caixas -------------------------------------------------------

/** Marcas do stock (as escolhidas ficam sempre, para se poderem tirar). */
export function makeOptions(pool: Pick<Vehicle, "make">[], selected: string[]): string[] {
  const out = brandOptions(pool.map((v) => v.make));
  for (const m of selected) if (!out.some((o) => sameBrand(o, m))) out.push(m);
  return out;
}

const BODY_ORDER: string[] = [...MOTORCYCLE_BODIES, ...CAR_BODIES];
const bodyRank = (b: string) => {
  const i = BODY_ORDER.indexOf(b);
  return i < 0 ? BODY_ORDER.length : i;
};

/** Categorias do stock, pela ordem habitual (as escolhidas ficam sempre). */
export function bodyOptions(pool: Pick<Vehicle, "body">[], selected: string[]): string[] {
  const all = new Set<string>([...pool.map((v) => v.body).filter(Boolean), ...selected]);
  return [...all].sort((a, b) => bodyRank(a) - bodyRank(b) || a.localeCompare(b, "pt"));
}

/** Os anos para as listas «De» e «Até»: do mais antigo ao mais recente do stock. */
export function yearOptions(pool: Pick<Vehicle, "year">[]): number[] {
  const years = pool.map((v) => v.year).filter((y) => Number.isInteger(y) && y > 1900);
  if (!years.length) return [];
  const max = Math.max(...years);
  // No máximo 80 anos (um clássico de 1950 não enche a lista).
  const n = Math.min(max - Math.min(...years) + 1, 80);
  return Array.from({ length: n }, (_, i) => max - n + 1 + i);
}

// ---- Filtros ativos (as etiquetas com «×») --------------------------------------

export interface Chip {
  key: string;
  label: string;
}

type BaseKey = keyof VehicleFilters;
const FLAG_LABELS: Partial<Record<BaseKey, string>> = {
  campaignOnly: "Em campanha",
  nationalOnly: "Nacional",
  firstOwnerOnly: "1.º dono",
  serviceBookOnly: "Livro de revisões",
  warrantyOnly: "Com garantia",
};

/** Os filtros escolhidos, pela ordem da coluna, cada um com a sua chave. */
export function activeChips(f: Core2Filters): Chip[] {
  const b = f.base;
  const out: Chip[] = [
    ...f.kinds.map((k) => ({ key: `tipo:${k}`, label: KIND_LABEL[k] })),
    ...f.makes.map((m) => ({ key: `marca:${m}`, label: m })),
    ...f.bodies.map((x) => ({ key: `categoria:${x}`, label: x })),
  ];
  const add = (key: BaseKey, label: string | null) => {
    if (label) out.push({ key, label });
  };
  add("query", b.query ? `«${b.query}»` : null);
  add("model", b.model);
  add("minPrice", b.minPrice != null ? `Desde ${formatPrice(b.minPrice)}` : null);
  add("maxPrice", b.maxPrice != null ? `Até ${formatPrice(b.maxPrice)}` : null);
  add("minYear", b.minYear != null ? `Desde ${b.minYear}` : null);
  add("maxYear", b.maxYear != null ? `Até ${b.maxYear}` : null);
  add("minMileage", b.minMileage != null ? `Desde ${formatKm(b.minMileage)}` : null);
  add("maxMileage", b.maxMileage != null ? `Até ${formatKm(b.maxMileage)}` : null);
  out.push(...f.cc.map((id) => ({ key: `cc:${id}`, label: CC_BUCKETS.find((x) => x.id === id)?.label ?? id })));
  add("fuel", b.fuel);
  add("transmission", b.transmission);
  add("color", b.color);
  add("minPower", b.minPower != null ? `Desde ${formatNumber(b.minPower)} cv` : null);
  add("maxPower", b.maxPower != null ? `Até ${formatNumber(b.maxPower)} cv` : null);
  add("minDisplacement", b.minDisplacement != null ? `Desde ${formatNumber(b.minDisplacement)} cc` : null);
  add("maxDisplacement", b.maxDisplacement != null ? `Até ${formatNumber(b.maxDisplacement)} cc` : null);
  add("doors", b.doors != null ? `${b.doors} portas` : null);
  add("seats", b.seats != null ? `${b.seats} lugares` : null);
  for (const [key, label] of Object.entries(FLAG_LABELS) as [BaseKey, string][]) if (b[key] === true) add(key, label);
  return out;
}

/** Tira um filtro (o «×» da etiqueta). */
export function withoutChip(f: Core2Filters, key: string): Core2Filters {
  const [group, ...rest] = key.split(":");
  const value = rest.join(":");
  if (group === "tipo") return { ...f, kinds: f.kinds.filter((k) => k !== value) };
  if (group === "marca") return { ...f, makes: f.makes.filter((m) => m !== value) };
  if (group === "categoria") return { ...f, bodies: f.bodies.filter((x) => x !== value) };
  if (group === "cc") return { ...f, cc: f.cc.filter((x) => x !== value) };
  if (!(key in f.base) || key === "olx") return f;
  const current = f.base[key as BaseKey];
  return { ...f, base: { ...f.base, [key]: typeof current === "boolean" ? false : null } };
}

// ---- Cartões -----------------------------------------------------------------

/** A linha de dados do cartão: «4 000 km • 450 cc • 50 cv • Moto 4». */
export function cardFacts(
  v: Pick<Vehicle, "vehicleType" | "mileage" | "displacement" | "power" | "body" | "fuel" | "transmission">,
): string[] {
  const moto = v.vehicleType === "motorcycle";
  const out = [
    formatKm(v.mileage || 0),
    moto ? (v.displacement ? `${formatNumber(v.displacement)} cc` : null) : v.fuel,
    moto ? (v.power ? `${formatNumber(v.power)} cv` : null) : v.transmission,
    moto ? v.body : v.power ? `${formatNumber(v.power)} cv` : null,
  ];
  return out.filter((x): x is string => !!x).slice(0, 4);
}
