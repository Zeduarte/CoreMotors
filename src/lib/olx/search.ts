import "server-only";
import type { Vehicle } from "@/types/vehicle";
import type { VehicleType } from "@/lib/vehicle-categories";
import { toListVehicle } from "@/lib/vehicle-list";
import { getPublicOlxFields } from "./field-queries";
import { effectiveValues, searchableFields, valuesInStock, type OlxField } from "./fields";
import type { CarFacts } from "./attributes";

/** Um filtro do OLX pronto para o browser: só as opções que há no stock. */
export interface SearchField {
  code: string;
  label: string;
  kind: OlxField["kind"];
  unit: string | null;
  values: { code: string; label: string }[];
}

/**
 * Campos que o site já filtra pelos seus próprios campos (potência,
 * cilindrada, cor, portas, lugares) — não aparecem duas vezes. A condição é
 * sempre «usado».
 */
const SITE_COVERED = new Set(["power", "displacement", "color", "doors", "seats", "registrationMonth", "condition"]);
const MAX_FIELDS = 12;

function factsOf(v: Vehicle): CarFacts {
  return {
    make: v.make,
    model: v.model,
    year: v.year,
    mileage: v.mileage,
    fuel: v.fuel,
    transmission: v.transmission,
    body: v.body,
    power: v.power,
    displacement: v.displacement,
    color: v.color || null,
    doors: v.doors,
    seats: v.seats,
    registrationMonth: v.registrationMonth ?? null,
  };
}

/**
 * Stock para a pesquisa com os filtros do OLX: cada viatura leva os valores
 * dos campos pesquisáveis (os escolhidos na ficha por cima dos que o site
 * deduz), e os filtros levam só as opções que existem no stock — um filtro
 * com uma opção só não serve para nada e fica de fora.
 *
 * Sem ligação ao OLX (ou sem a migração 0032), devolve o stock sem filtros
 * extra: a pesquisa fica com os filtros do site.
 */
export async function inventoryWithOlx(
  vehicles: Vehicle[],
  type: VehicleType,
): Promise<{ vehicles: Vehicle[]; fields: SearchField[] }> {
  const all = searchableFields(await getPublicOlxFields(type).catch(() => [])).filter(
    (f) => !(f.siteField && SITE_COVERED.has(f.siteField)),
  );
  if (!all.length) return { vehicles: vehicles.map(toListVehicle), fields: [] };

  const withValues = vehicles.map((v) => ({ v, values: effectiveValues(all, factsOf(v), v.olxAttributes) }));
  const fields: SearchField[] = [];
  for (const f of all) {
    if (fields.length >= MAX_FIELDS) break;
    if (f.kind === "number") {
      const known = withValues.filter((x) => Number.isFinite(Number(x.values[f.code]))).length;
      if (known >= 2) fields.push({ code: f.code, label: f.label, kind: f.kind, unit: f.unit, values: [] });
      continue;
    }
    const values = valuesInStock(f, withValues.map((x) => x.values));
    if (values.length >= 2) fields.push({ code: f.code, label: f.label, kind: f.kind, unit: f.unit, values });
  }
  const codes = new Set(fields.map((f) => f.code));
  return {
    vehicles: withValues.map(({ v, values }) => ({
      ...toListVehicle(v),
      olx: Object.fromEntries(Object.entries(values).filter(([code]) => codes.has(code))),
    })),
    fields,
  };
}
