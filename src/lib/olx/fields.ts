import { fieldFor, mapAttributes, type CarFacts, type OlxAttribute, type OlxAttributeDef } from "@/lib/olx/attributes";

/**
 * Os campos do OLX de uma categoria, como formulário e como filtros.
 *
 * A lista vem da API do OLX (`/categories/{id}/attributes`) e é guardada ao
 * escolher a categoria; aqui não se escreve nenhum campo à mão. Funções puras,
 * usadas pela ficha da viatura, pelo anúncio e pela pesquisa do site.
 *
 * Valores de uma viatura: os que o stand escolheu na ficha (`olx_attributes`)
 * por cima dos que o site deduz sozinho dos seus campos (marca, ano, km, …).
 */

export type OlxFieldKind = "select" | "multi" | "number" | "text";

export interface OlxField {
  code: string;
  label: string;
  kind: OlxFieldKind;
  unit: string | null;
  required: boolean;
  values: { code: string; label: string }[];
  /** Campo do site que lhe corresponde (marca, ano, …), se algum. */
  siteField: string | null;
}

/** { código: valor | [valores] } — os códigos e valores são os do OLX. */
export type OlxValues = Record<string, string | string[]>;

function isDef(x: unknown): x is OlxAttributeDef {
  return !!x && typeof x === "object" && typeof (x as OlxAttributeDef).code === "string";
}

/** As definições do OLX, tal como guardadas, em campos prontos a mostrar. */
export function toFields(attributes: unknown): OlxField[] {
  if (!Array.isArray(attributes)) return [];
  return attributes.filter(isDef).flatMap((def) => {
    const type = def.validation?.type;
    // Preço e salário têm campos próprios no anúncio.
    if (type === "price" || type === "salary") return [];
    const values = (def.values ?? []).filter((v) => v && typeof v.code === "string");
    const kind: OlxFieldKind = values.length
      ? def.validation?.allow_multiple_values
        ? "multi"
        : "select"
      : def.validation?.numeric
        ? "number"
        : "text";
    return [{
      code: def.code,
      label: def.label || def.code,
      kind,
      unit: def.unit ?? null,
      required: !!def.validation?.required,
      values: values.map((v) => ({ code: v.code, label: v.label || v.code })),
      siteField: fieldFor(def),
    }];
  });
}

function asDefs(fields: OlxField[]): OlxAttributeDef[] {
  return fields.map((f) => ({
    code: f.code,
    label: f.label,
    unit: f.unit,
    validation: {
      required: f.required,
      numeric: f.kind === "number",
      allow_multiple_values: f.kind === "multi",
    },
    values: f.values,
  }));
}

/** O que o site preenche sozinho a partir da ficha (marca, ano, km, …). */
export function autoValues(fields: OlxField[], car: CarFacts): OlxValues {
  const out: OlxValues = {};
  for (const a of mapAttributes(asDefs(fields), car).attributes) {
    if (a.values) out[a.code] = a.values;
    else if (a.value !== undefined) out[a.code] = a.value;
  }
  return out;
}

/**
 * Valida os valores escolhidos na ficha contra a lista do OLX: só ficam
 * campos que existem, valores que o OLX aceita e números válidos. Vazio sai.
 */
export function cleanValues(fields: OlxField[], raw: unknown): OlxValues {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const out: OlxValues = {};
  for (const f of fields) {
    const v = input[f.code];
    if (v === undefined || v === null || v === "") continue;
    const allowed = new Set(f.values.map((x) => x.code));
    if (f.kind === "multi") {
      const list = (Array.isArray(v) ? v : [v]).map(String).filter((x) => allowed.has(x));
      if (list.length) out[f.code] = [...new Set(list)];
    } else if (f.kind === "select") {
      if (allowed.has(String(v))) out[f.code] = String(v);
    } else if (f.kind === "number") {
      const n = Number(String(v).replace(",", "."));
      if (Number.isFinite(n) && n >= 0) out[f.code] = String(Math.round(n));
    } else {
      const s = String(v).trim().slice(0, 200);
      if (s) out[f.code] = s;
    }
  }
  return out;
}

/** Valores finais de uma viatura: os da ficha por cima dos automáticos. */
export function effectiveValues(fields: OlxField[], car: CarFacts, manual: unknown): OlxValues {
  return { ...autoValues(fields, car), ...cleanValues(fields, manual) };
}

/**
 * Atributos para o anúncio e os obrigatórios que faltam (em português, a
 * dizer onde preencher). Nada se inventa: sem valor, o anúncio não sai.
 */
export function advertAttributes(
  fields: OlxField[],
  car: CarFacts,
  manual: unknown,
): { attributes: OlxAttribute[]; missing: string[] } {
  const values = effectiveValues(fields, car, manual);
  const attributes: OlxAttribute[] = [];
  const missing: string[] = [];
  for (const f of fields) {
    const v = values[f.code];
    if (v === undefined || (Array.isArray(v) && !v.length)) {
      if (f.required) missing.push(`«${f.label}» é obrigatório no OLX — preencha-o em «Campos do OLX» na ficha`);
      continue;
    }
    attributes.push(Array.isArray(v) ? { code: f.code, values: v } : { code: f.code, value: v });
  }
  return { attributes, missing };
}

// ---- Ficha ------------------------------------------------------------------

/**
 * Onde cada campo do OLX entra na ficha, para ser um formulário só (sem uma
 * caixa «Campos do OLX» à parte nem campos repetidos):
 *  - os que o site já tem (marca, km, …) não aparecem — vão automaticamente;
 *    só voltam se forem obrigatórios e o OLX não reconhecer o valor do site
 *    (`fixes`), para se escolher da lista do OLX;
 *  - os restantes de escolha única entram em «Características»;
 *  - os de escolha múltipla entram junto ao equipamento.
 */
export function formPlacement(
  fields: OlxField[],
  auto: OlxValues,
  /** O campo do site correspondente já tem valor? (vazio → preenche-se lá). */
  siteFilled: (siteField: string) => boolean = () => true,
): { characteristics: OlxField[]; equipment: OlxField[]; fixes: OlxField[] } {
  const characteristics: OlxField[] = [];
  const equipment: OlxField[] = [];
  const fixes: OlxField[] = [];
  for (const f of fields) {
    if (f.siteField) {
      // Só se o site TEM valor e o OLX não o reconhece; vazio preenche-se no
      // campo do site, e não num segundo campo igual.
      if (f.required && auto[f.code] === undefined && siteFilled(f.siteField)) fixes.push(f);
      continue;
    }
    (f.kind === "multi" ? equipment : characteristics).push(f);
  }
  return { characteristics, equipment, fixes };
}

/** Obrigatórios do OLX ainda sem valor (nem escolhido, nem automático). */
export function missingRequired(fields: OlxField[], values: OlxValues, auto: OlxValues): OlxField[] {
  return fields.filter((f) => f.required && values[f.code] === undefined && auto[f.code] === undefined);
}

/** Texto de um valor (etiqueta do OLX), para mostrar. */
export function valueLabel(field: OlxField, value: string | string[]): string {
  const label = (c: string) => field.values.find((x) => x.code === c)?.label ?? c;
  return Array.isArray(value) ? value.map(label).join(", ") : field.kind === "text" || field.kind === "number" ? value : label(value);
}

// ---- Pesquisa ---------------------------------------------------------------

export { matchesOlxFilters, type OlxFilter, type OlxFilters } from "./filter-match";

/**
 * Campos que fazem sentido como filtro: listas e números. Os que o site já
 * filtra pelos seus campos (marca, modelo, ano, km, combustível, caixa,
 * segmento) ficam de fora, para não aparecer o mesmo filtro duas vezes.
 */
export function searchableFields(fields: OlxField[]): OlxField[] {
  const covered = new Set(["make", "model", "year", "mileage", "fuel", "transmission", "body"]);
  return fields.filter((f) => f.kind !== "text" && !(f.siteField && covered.has(f.siteField)));
}

/** Valores de um campo que existem no stock — as opções do filtro. */
export function valuesInStock(field: OlxField, stock: (OlxValues | undefined)[]): { code: string; label: string }[] {
  const present = new Set<string>();
  for (const s of stock) {
    const v = s?.[field.code];
    for (const x of Array.isArray(v) ? v : v !== undefined ? [v] : []) present.add(x);
  }
  return field.values.filter((x) => present.has(x.code));
}
