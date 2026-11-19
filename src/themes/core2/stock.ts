import type { SortKey, Vehicle, VehicleFilters } from "@/types/vehicle";
import type { VehicleType } from "@/lib/vehicle-categories";
import { applyFilters, emptyFilters, filtersFromQuery, filtersToQuery, sortFromQuery, sortVehicles } from "@/lib/vehicles";
import { sameBrand } from "@/lib/brand-name";

/**
 * Stock do tema Core2: a lógica (sem interface), para se poder testar.
 *
 * - Tipo: «Todos», Carros, Motas e Moto 4. A Moto 4 é a categoria «Moto 4»
 *   das motas (no backoffice continua a ser uma mota); «Motas» são as outras.
 * - Marca, categoria, combustível, caixa e cilindrada escolhem-se em caixas
 *   (várias de uma vez); o resto (preço, ano, km, extras, campos do OLX) são os
 *   filtros de sempre (`applyFilters`).
 * - Tudo vai para o endereço, como no stock do Core (os links que já existem —
 *   ?tipo=motas&categoria=Naked, ?marca=BMW… — continuam a abrir filtrados).
 */

export type StockKind = "todos" | "carros" | "motas" | "moto4";
export const MOTO4 = "Moto 4";

/** Cilindrada das motas, em intervalos (caixas). */
export const CC_BUCKETS = [
  { id: "125", label: "Até 125 cc", min: 0, max: 125 },
  { id: "450", label: "126 a 450 cc", min: 126, max: 450 },
  { id: "800", label: "451 a 800 cc", min: 451, max: 800 },
  { id: "801", label: "Mais de 800 cc", min: 801, max: Infinity },
] as const;

export interface Core2Filters {
  kind: StockKind;
  makes: string[];
  bodies: string[];
  fuels: string[];
  transmissions: string[];
  cc: string[];
  /** O resto: preço, ano, km, extras, campos do OLX, pesquisa e modelo. */
  base: VehicleFilters;
}

export function emptyCore2(kind: StockKind = "todos"): Core2Filters {
  return { kind, makes: [], bodies: [], fuels: [], transmissions: [], cc: [], base: emptyFilters() };
}

/** Os tipos à escolha, conforme o que o site vende. */
export function kindsFor(siteTypes: VehicleType[]): StockKind[] {
  const out: StockKind[] = [];
  if (siteTypes.includes("car")) out.push("carros");
  if (siteTypes.includes("motorcycle")) out.push("motas", "moto4");
  return out.length > 1 ? ["todos", ...out] : out;
}

export function kindOf(v: Pick<Vehicle, "vehicleType" | "body">): Exclude<StockKind, "todos"> {
  if ((v.vehicleType ?? "car") === "car") return "carros";
  return v.body === MOTO4 ? "moto4" : "motas";
}

export function inKind(v: Vehicle, kind: StockKind): boolean {
  return kind === "todos" || kindOf(v) === kind;
}

const list = (raw: string | string[] | undefined): string[] =>
  (Array.isArray(raw) ? raw.join(",") : raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 30);

/** Lê o endereço (?tipo=motas&marca=BMW,Honda&categoria=Naked…). */
export function core2FromQuery(
  sp: Record<string, string | string[] | undefined>,
  kinds: StockKind[],
): { filters: Core2Filters; sort: SortKey } {
  const base = { ...emptyFilters(), ...filtersFromQuery(sp) };
  const tipo = Array.isArray(sp.tipo) ? sp.tipo[0] : sp.tipo;
  const asked: StockKind | null =
    tipo === "carros" ? "carros" : tipo === "motas" ? "motas" : tipo === "moto4" ? "moto4" : null;
  // ?tipo=motas&categoria=Moto 4 (links antigos) → Moto 4.
  const bodies = list(sp.categoria);
  let kind: StockKind = asked && kinds.includes(asked) ? asked : kinds[0] ?? "todos";
  if (kind === "motas" && bodies.length === 1 && bodies[0] === MOTO4 && kinds.includes("moto4")) kind = "moto4";
  // As escolhas múltiplas são deste stock; nos filtros de sempre ficam vazias.
  base.make = null;
  base.body = null;
  base.fuel = null;
  base.transmission = null;
  base.vehicleType = null;
  return {
    filters: {
      kind,
      makes: list(sp.marca ?? sp.make),
      bodies: kind === "moto4" ? [] : bodies,
      fuels: list(sp.combustivel ?? sp.fuel),
      transmissions: list(sp.caixa ?? sp.transmission),
      cc: list(sp.cc).filter((id) => CC_BUCKETS.some((b) => b.id === id)),
      base,
    },
    sort: sortFromQuery(sp),
  };
}

/** Escreve o endereço. Num site de um só tipo, o tipo não vai (é sempre o mesmo). */
export function core2ToQuery(f: Core2Filters, sort: SortKey, kinds: StockKind[]): string {
  const qs = new URLSearchParams();
  if (f.kind !== "todos" && kinds.length > 1) qs.set("tipo", f.kind);
  if (f.makes.length) qs.set("marca", f.makes.join(","));
  if (f.bodies.length) qs.set("categoria", f.bodies.join(","));
  if (f.fuels.length) qs.set("combustivel", f.fuels.join(","));
  if (f.transmissions.length) qs.set("caixa", f.transmissions.join(","));
  if (f.cc.length) qs.set("cc", f.cc.join(","));
  const rest = new URLSearchParams(filtersToQuery(f.base, sort));
  for (const [k, v] of rest) qs.set(k, v);
  return qs.toString();
}

/** As viaturas que se veem, já ordenadas. */
export function applyCore2(vehicles: Vehicle[], f: Core2Filters, sort: SortKey): Vehicle[] {
  const picked = vehicles.filter((v) => {
    if (!inKind(v, f.kind)) return false;
    if (f.makes.length && !f.makes.some((m) => sameBrand(v.make, m))) return false;
    if (f.bodies.length && !f.bodies.includes(v.body)) return false;
    if (f.fuels.length && !f.fuels.includes(v.fuel)) return false;
    if (f.transmissions.length && !f.transmissions.includes(v.transmission)) return false;
    if (f.cc.length) {
      // Cilindrada a zero é «não indicada»: fica de fora quando se filtra por ela.
      if (!v.displacement) return false;
      if (!f.cc.some((id) => { const b = CC_BUCKETS.find((x) => x.id === id); return !!b && v.displacement >= b.min && v.displacement <= b.max; })) return false;
    }
    return true;
  });
  return sortVehicles(applyFilters(picked, f.base), sort);
}

/** Muda de tipo: o que só fazia sentido no outro tipo sai (categoria, combustível, caixa, cilindrada, campos do OLX). */
export function switchKind(f: Core2Filters, kind: StockKind, pool: Vehicle[]): Core2Filters {
  const next = pool.filter((v) => inKind(v, kind));
  return {
    ...f,
    kind,
    // Marcas que existem no novo tipo ficam (BMW: carros e motas).
    makes: f.makes.filter((m) => next.some((v) => sameBrand(v.make, m))),
    bodies: [],
    fuels: [],
    transmissions: [],
    cc: [],
    base: { ...f.base, model: null, olx: {}, doors: null, seats: null, minDisplacement: null, maxDisplacement: null, minPower: null, maxPower: null },
  };
}

/** Quantos filtros estão escolhidos (para o «Limpar» e o botão do telemóvel). */
export function activeCount(f: Core2Filters): number {
  const b = f.base;
  const extra = [b.query, b.model, b.minPrice, b.maxPrice, b.minYear, b.maxYear, b.minMileage, b.maxMileage].filter((x) => x != null && x !== "").length;
  const flags = [b.campaignOnly, b.nationalOnly, b.firstOwnerOnly, b.serviceBookOnly, b.warrantyOnly].filter(Boolean).length;
  return f.makes.length + f.bodies.length + f.fuels.length + f.transmissions.length + f.cc.length + extra + flags + Object.keys(b.olx ?? {}).length;
}
