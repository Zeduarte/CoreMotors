import type { VehicleType } from "@/lib/vehicle-categories";
import type { StockKind } from "@/themes/core2/stock";

/**
 * Tema Core3: textos, endereços e listas das páginas (sem interface, para se
 * poder testar). O stock por tipo é o do Core2 (`@/themes/core2/stock`).
 */

/** As páginas de stock por tipo, pela ordem do menu (e do deslize). */
export const CATEGORY_PATH: Record<StockKind, string> = { motas: "/motas", moto4: "/moto4", carros: "/carros" };

export interface Core3Category {
  key: StockKind;
  href: string;
  /** No menu e nos separadores. */
  short: string;
  /** Nos cartões e nos títulos. */
  label: string;
  /** A foto do cartão da página inicial. */
  photo: string;
  /**
   * Que parte da foto o cartão mostra (classe do Tailwind, escrita por inteiro
   * para o Tailwind a encontrar). A viatura está à direita e um pouco abaixo do
   * meio; na das motas sobe-se um pouco, para a mota aparecer inteira.
   */
  photoPosition: string;
  /** O título da página («Motas em stock»). */
  title: string;
  /** A frase por baixo do título. */
  subtitle: string;
  /** A foto do topo da página (as motas e a Moto 4 usam a das motas do site). */
  hero: string | null;
  /**
   * Que parte da foto do topo se vê no telemóvel (no computador, a esquerda a
   * desvanecer para o título). Classe do Tailwind, escrita por inteiro.
   */
  heroMobilePosition: string;
}

const CATEGORIES: Record<StockKind, Omit<Core3Category, "key" | "href">> = {
  motas: {
    short: "Motas",
    label: "Motas",
    photo: "/media/core2/motas.jpg",
    photoPosition: "object-[85%_40%]",
    title: "Motas em stock",
    subtitle: "Encontre a mota certa com filtros simples e uma navegação clara.",
    hero: null,
    heroMobilePosition: "object-left",
  },
  moto4: {
    short: "Moto 4",
    label: "Moto 4",
    photo: "/media/core2/moto4.jpg",
    photoPosition: "object-[85%_60%]",
    title: "Moto 4 em stock",
    subtitle: "Quads e side-by-side prontos para a aventura, com filtros simples.",
    hero: null,
    heroMobilePosition: "object-left",
  },
  carros: {
    short: "Carros",
    label: "Automóveis",
    photo: "/media/core2/carros.jpg",
    photoPosition: "object-[85%_60%]",
    title: "Automóveis em stock",
    subtitle: "Encontre o automóvel certo com filtros simples e uma navegação clara.",
    hero: "/media/core3/carros.jpg",
    // A foto é muito larga: no telemóvel vê-se a direita (a loja e os carros).
    heroMobilePosition: "object-right",
  },
};

export function categoryOf(key: StockKind): Core3Category {
  return { key, href: CATEGORY_PATH[key], ...CATEGORIES[key] };
}

/**
 * As categorias que o site mostra (como na maqueta: Motas, Moto 4, Carros):
 * as motas e a Moto 4 num site que venda motas, os carros num que venda carros.
 * A Moto 4 aparece mesmo sem stock (a página diz que não há nenhuma).
 */
export function core3Categories(siteTypes: VehicleType[]): Core3Category[] {
  const moto = siteTypes.includes("motorcycle");
  const keys: StockKind[] = [
    ...(moto ? (["motas", "moto4"] as const) : []),
    ...(siteTypes.includes("car") ? (["carros"] as const) : []),
  ];
  return keys.map(categoryOf);
}

/** O menu do Core3 (no cabeçalho do Core): as páginas de stock por tipo, «Vender» e «Contactos». */
export function core3Nav(siteTypes: VehicleType[]): { href: string; label: string }[] {
  return [
    ...core3Categories(siteTypes).map((c) => ({ href: c.href, label: c.short })),
    // «Compramos o seu veículo» (a avaliação da retoma).
    { href: "/vender", label: "Vender" },
    { href: "/contactos", label: "Contactos" },
  ];
}

/** A faixa de serviços: o que não depende do backoffice (as retomas, que levam ao «Vender», e a entrega). */
export const STATIC_PERKS = [
  { id: "retomas", icon: "refresh", title: "Aceitamos retomas", text: "Valorizamos a sua mota, moto 4 ou automóvel.", href: "/vender" },
  { id: "entregas", icon: "truck", title: "Entregas nacionais", text: "Levamos a sua nova viatura a qualquer ponto de Portugal.", href: undefined },
] as const;

/** O ícone dos serviços do backoffice que entram na faixa (o resto não cabe). */
export const SERVICE_PERKS: Record<string, "card" | "shield"> = { financiamento: "card", garantia: "shield" };
