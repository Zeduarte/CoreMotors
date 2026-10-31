import { slugify } from "./slug";
import { brandOptions, sameBrand } from "./brand-name";
import { CAR_BRANDS } from "./car-brands";
import { MOTORCYCLE_BRANDS, bodiesFor, type VehicleType } from "./vehicle-categories";
import type { Vehicle, VehicleFilters } from "@/types/vehicle";

/**
 * Páginas por marca, categoria, preço e combustível, para o Google:
 * /motas/yamaha, /motas/quads, /carros/suv, /carros/ate-15000-euros…
 *
 * São o que as pessoas escrevem na pesquisa («motas yamaha usadas», «carros
 * até 15000 euros»). Cada página tem título, texto e lista próprios, e não
 * depende da escolha carros/motas guardada no browser — o Google não guarda
 * cookies, e o /inventario mostra os carros a quem chega sem escolha.
 *
 * Funções PURAS: as páginas, o sitemap e os links internos usam as mesmas.
 */

export const TYPE_PATH: Record<VehicleType, string> = { car: "carros", motorcycle: "motas" };

export function typeFromPath(path: string): VehicleType | null {
  return path === "carros" ? "car" : path === "motas" ? "motorcycle" : null;
}

const WORDS: Record<VehicleType, { used: string; one: string; many: string }> = {
  car: { used: "Carros usados", one: "carro", many: "carros" },
  motorcycle: { used: "Motas usadas", one: "mota", many: "motas" },
};

export function usedLabel(type: VehicleType): string {
  return WORDS[type].used;
}

/** Faixas de preço: as que as pessoas pesquisam, diferentes para carros e motas. */
export const PRICE_BANDS: Record<VehicleType, number[]> = {
  car: [10000, 15000, 20000, 30000],
  motorcycle: [3000, 5000, 8000, 12000],
};

/** Título de cada categoria, como se pesquisa. */
const BODY_TITLES: Record<string, { title: string; slug?: string }> = {
  Berlina: { title: "Berlinas usadas" },
  SUV: { title: "SUV usados" },
  Coupé: { title: "Coupés usados" },
  Carrinha: { title: "Carrinhas usadas" },
  Citadino: { title: "Citadinos usados" },
  Utilitário: { title: "Utilitários usados" },
  Descapotável: { title: "Descapotáveis usados" },
  Monovolume: { title: "Monovolumes usados" },
  Scooter: { title: "Scooters usadas" },
  Naked: { title: "Motas naked usadas" },
  Desportiva: { title: "Motas desportivas usadas" },
  Trail: { title: "Motas trail usadas" },
  Touring: { title: "Motas touring usadas" },
  "Chopper/Cruiser": { title: "Motas custom usadas (chopper e cruiser)", slug: "custom" },
  Enduro: { title: "Motas de enduro usadas" },
  "Moto 4": { title: "Moto 4 e quads usados", slug: "quads" },
};

const FUEL_PAGES: { slug: string; fuels: string[]; title: string }[] = [
  { slug: "eletricos", fuels: ["Elétrico"], title: "Carros elétricos usados" },
  { slug: "hibridos", fuels: ["Híbrido", "Híbrido Plug-in"], title: "Carros híbridos usados" },
  { slug: "diesel", fuels: ["Diesel"], title: "Carros a diesel usados" },
  { slug: "gasolina", fuels: ["Gasolina"], title: "Carros a gasolina usados" },
];

export type SeoKind = "brand" | "body" | "price" | "fuel";

export interface SeoPage {
  type: VehicleType;
  slug: string;
  kind: SeoKind;
  /** "Yamaha", "SUV", "Até 15 000 €" — para os links. */
  label: string;
  /** O título da página (h1 e <title>). */
  title: string;
  /** Filtros equivalentes no stock e no alerta. */
  filters: Partial<VehicleFilters>;
  matches: (v: Vehicle) => boolean;
}

const euros = (n: number) => `${new Intl.NumberFormat("pt-PT").format(n)} €`;

export function bodySlug(body: string): string {
  return BODY_TITLES[body]?.slug ?? slugify(body);
}

function bodyPage(type: VehicleType, body: string): SeoPage {
  return {
    type,
    slug: bodySlug(body),
    kind: "body",
    label: body === "Moto 4" ? "Moto 4 / quads" : body,
    title: BODY_TITLES[body]?.title ?? `${body} usados`,
    filters: { body: body as VehicleFilters["body"] },
    matches: (v) => v.body === body,
  };
}

function brandPage(type: VehicleType, brand: string): SeoPage {
  const used = type === "motorcycle" ? `Motas ${brand} usadas` : `Carros ${brand} usados`;
  return {
    type,
    slug: slugify(brand),
    kind: "brand",
    label: brand,
    title: used,
    filters: { make: brand },
    matches: (v) => sameBrand(v.make, brand),
  };
}

function pricePage(type: VehicleType, max: number): SeoPage {
  return {
    type,
    slug: `ate-${max}-euros`,
    kind: "price",
    label: `Até ${euros(max)}`,
    title: `${WORDS[type].used} até ${euros(max)}`,
    filters: { maxPrice: max },
    matches: (v) => !v.priceOnRequest && v.price > 0 && v.price <= max,
  };
}

function fuelPage(type: VehicleType, def: (typeof FUEL_PAGES)[number]): SeoPage {
  return {
    type,
    slug: def.slug,
    kind: "fuel",
    label: def.title.replace(/^Carros /, "").replace(/ usados$/, "").replace(/^a /, ""),
    title: def.title,
    filters: def.fuels.length === 1 ? { fuel: def.fuels[0] as VehicleFilters["fuel"] } : {},
    matches: (v) => def.fuels.includes(v.fuel),
  };
}

function bodiesOf(type: VehicleType): string[] {
  return [...bodiesFor(type)];
}

/**
 * A página de um endereço, ou `null` se não existir. Uma marca do catálogo
 * sem viaturas em stock tem página (com o alerta), mas sem indexação.
 */
export function resolveSeoPage(type: VehicleType, slug: string, stock: Vehicle[]): SeoPage | null {
  const s = slug.toLowerCase();
  const price = /^ate-(\d+)-euros$/.exec(s);
  if (price) {
    const max = Number(price[1]);
    return PRICE_BANDS[type].includes(max) ? pricePage(type, max) : null;
  }
  if (type === "car") {
    const fuel = FUEL_PAGES.find((f) => f.slug === s);
    if (fuel) return fuelPage(type, fuel);
  }
  const body = bodiesOf(type).find((b) => bodySlug(b) === s || (b === "Moto 4" && s === "moto-4"));
  if (body) return bodyPage(type, body);
  const inStock = brandOptions(stock.map((v) => v.make)).find((b) => slugify(b) === s);
  if (inStock) return brandPage(type, inStock);
  const known = (type === "motorcycle" ? MOTORCYCLE_BRANDS : CAR_BRANDS).find((b) => slugify(b) === s);
  return known ? brandPage(type, known) : null;
}

/** As páginas com viaturas, para os links e o sitemap (as marcas primeiro). */
export function seoPagesFor(type: VehicleType, stock: Vehicle[]): { page: SeoPage; count: number }[] {
  const own = stock.filter((v) => (v.vehicleType ?? "car") === type);
  const pages: SeoPage[] = [
    ...brandOptions(own.map((v) => v.make)).map((b) => brandPage(type, b)),
    ...bodiesOf(type).map((b) => bodyPage(type, b)),
    ...(type === "car" ? FUEL_PAGES.map((f) => fuelPage(type, f)) : []),
    ...PRICE_BANDS[type].map((m) => pricePage(type, m)),
  ];
  const seen = new Set<string>();
  return pages.flatMap((page) => {
    if (seen.has(page.slug)) return [];
    seen.add(page.slug);
    const count = own.filter(page.matches).length;
    return count > 0 ? [{ page, count }] : [];
  });
}

export function seoPath(page: Pick<SeoPage, "type" | "slug">): string {
  return `/${TYPE_PATH[page.type]}/${page.slug}`;
}

/**
 * Primeira letra em minúscula, para o título caber a meio de uma frase —
 * exceto siglas e nomes em maiúsculas ("SUV usados", "BMW…"), que ficam.
 */
export function midSentence(title: string): string {
  const first = title.split(/\s/, 1)[0] ?? "";
  if (/^[A-ZÀ-Ý0-9]{2,}$/.test(first.replace(/[^\p{L}\p{N}]/gu, ""))) return title;
  return title.charAt(0).toLowerCase() + title.slice(1);
}

/** Texto de abertura da página, com os números do stock. */
export function seoIntro(page: SeoPage | null, type: VehicleType, count: number, from: number | null, company: string): string {
  const w = WORDS[type];
  const what = page ? midSentence(page.title) : w.used.toLowerCase();
  if (count === 0) {
    return `De momento não temos ${what} em stock na ${company}. Deixe um alerta e avisamos assim que entrar.`;
  }
  const n = count === 1 ? `1 ${w.one}` : `${count} ${w.many}`;
  return (
    `${n} disponíve${count === 1 ? "l" : "is"} na ${company}` +
    (page ? ` — ${what}` : "") +
    (from ? `, desde ${euros(from)}` : "") +
    `. Viaturas revistas, com historial transparente e possibilidade de visita ao stand.`
  );
}
