import { VEHICLE_TYPES, type VehicleType } from "@/lib/vehicle-categories";

/**
 * O que o site vende — Definições → «Tipo de site»: só carros, carros e
 * motas, ou só motas. Fica em `site_content` (chave `site`), que o público já
 * lê, por isso não precisa de migração. Sem nada guardado: carros e motas.
 */
export type SiteMode = "carros" | "carros-motas" | "motas";

export const SITE_MODES: { value: SiteMode; label: string; hint: string; types: VehicleType[] }[] = [
  { value: "carros", label: "Só carros", hint: "O site mostra apenas carros.", types: ["car"] },
  {
    value: "carros-motas",
    label: "Carros e motas",
    hint: "Tudo no mesmo site, com o filtro «Todos · Carros · Motas» no stock.",
    types: ["car", "motorcycle"],
  },
  { value: "motas", label: "Só motas", hint: "O site mostra apenas motas.", types: ["motorcycle"] },
];

export const DEFAULT_SITE_TYPES: VehicleType[] = ["car", "motorcycle"];

/** Os tipos guardados (`{ vehicle_types: [...] }`), validados; senão os de fábrica. */
export function parseSiteTypes(content: unknown): VehicleType[] {
  const raw = (content as { vehicle_types?: unknown } | null)?.vehicle_types;
  if (!Array.isArray(raw)) return [...DEFAULT_SITE_TYPES];
  // Sempre na ordem carros → motas, sem repetidos nem valores estranhos.
  const types = VEHICLE_TYPES.filter((t) => raw.includes(t));
  return types.length ? types : [...DEFAULT_SITE_TYPES];
}

export function siteModeOf(types: readonly VehicleType[]): SiteMode {
  if (types.length > 1) return "carros-motas";
  return types[0] === "motorcycle" ? "motas" : "carros";
}

export function typesOfMode(mode: SiteMode): VehicleType[] {
  return [...(SITE_MODES.find((m) => m.value === mode)?.types ?? DEFAULT_SITE_TYPES)];
}

/**
 * O tipo «principal» do site: o que dá o aspeto (fotos, topo da página
 * inicial, textos). É o dos carros, salvo num site só de motas.
 */
export function primaryType(types: readonly VehicleType[]): VehicleType {
  return types.includes("car") ? "car" : "motorcycle";
}

/** «Automóveis e motas», «Automóveis» ou «Motas», conforme o que o site vende. */
export function vehiclesLabel(types: readonly VehicleType[]): string {
  if (types.length > 1) return "Automóveis e motas";
  return types[0] === "motorcycle" ? "Motas" : "Automóveis";
}

/** A frase de apresentação do stand, conforme o que o site vende. */
export function siteDescription(types: readonly VehicleType[]): string {
  return `Stand de ${vehiclesLabel(types).toLowerCase()} em Portugal. Viaturas selecionadas, histórico transparente e uma experiência de compra sem fricção.`;
}
