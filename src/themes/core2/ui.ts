import type { Vehicle } from "@/types/vehicle";
import type { VehicleType } from "@/lib/vehicle-categories";
import type { Branding } from "@/lib/branding";

/**
 * Tema Core2 (as maquetes da Supermotas): textos fixos, links e formatos
 * partilhados pelo menu, rodapé, página inicial e stock. Sem interface, para
 * se poder testar.
 */

/** Milhares com ponto, como nas maquetes («12.900»). Igual no servidor e no browser. */
export function dots(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  return `${n < 0 ? "-" : ""}${s.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export function euros(n: number): string {
  return `${dots(n)} €`;
}

/** O preço do cartão: «9.950 €», ou «Sob consulta». */
export function priceText(v: Pick<Vehicle, "price" | "priceOnRequest">): string {
  return v.priceOnRequest || !(v.price > 0) ? "Sob consulta" : euros(v.price);
}

/**
 * O aviso do custo da chamada, junto ao número (obrigatório desde 2024):
 * «(chamada para rede fixa nacional)» nos 2…, «móvel» nos 9….
 */
export function callNotice(phone: string): string | null {
  const national = phone.replace(/\D/g, "").replace(/^(00)?351(?=\d{9}$)/, "");
  if (/^2\d{8}$/.test(national)) return "(chamada para rede fixa nacional)";
  if (/^9\d{8}$/.test(national)) return "(chamada para rede móvel nacional)";
  return null;
}

/** As listas do stock por tipo (os mesmos endereços que o stock do Core2 lê). */
export const STOCK_LINKS = {
  motas: "/inventario?tipo=motas&moto4=0",
  moto4: "/inventario?tipo=moto4",
  carros: "/inventario?tipo=carros",
} as const;

export interface NavLink {
  href: string;
  label: string;
}

/**
 * O menu de cima: Motas, Moto 4 e Carros (os tipos que o site vende; a Moto 4
 * só com alguma em stock), Vender e Contactos. O «Ver stock» é o botão à parte.
 */
export function navLinks(siteTypes: VehicleType[], hasMoto4: boolean): NavLink[] {
  const moto = siteTypes.includes("motorcycle");
  return [
    ...(moto ? [{ href: STOCK_LINKS.motas, label: "Motas" }] : []),
    ...(moto && hasMoto4 ? [{ href: STOCK_LINKS.moto4, label: "Moto 4" }] : []),
    ...(siteTypes.includes("car") ? [{ href: STOCK_LINKS.carros, label: "Carros" }] : []),
    { href: "/vender", label: "Vender" },
    { href: "/contactos", label: "Contactos" },
  ];
}

/** Os cartões das categorias da página inicial (no telemóvel, «Carros»). */
export function categoryCards(
  siteTypes: VehicleType[],
  hasMoto4: boolean,
): { key: "motas" | "moto4" | "carros"; href: string; label: string; short: string; photo: string }[] {
  const moto = siteTypes.includes("motorcycle");
  return [
    ...(moto ? [{ key: "motas" as const, href: STOCK_LINKS.motas, label: "Motas", short: "Motas", photo: "/media/core2/motas.jpg" }] : []),
    ...(moto && hasMoto4
      ? [{ key: "moto4" as const, href: STOCK_LINKS.moto4, label: "Moto 4", short: "Moto 4", photo: "/media/core2/moto4.jpg" }]
      : []),
    ...(siteTypes.includes("car")
      ? [{ key: "carros" as const, href: STOCK_LINKS.carros, label: "Automóveis", short: "Carros", photo: "/media/core2/carros.jpg" }]
      : []),
  ];
}

/** O topo da página inicial (textos das maquetes; a frase segue o que o site vende). */
export function heroTexts(siteTypes: VehicleType[], hasMoto4: boolean): { title: string; subtitle: string } {
  const moto = siteTypes.includes("motorcycle");
  const car = siteTypes.includes("car");
  const parts = [...(moto ? ["Motas"] : []), ...(moto && hasMoto4 ? ["moto 4"] : []), ...(car ? [moto ? "automóveis" : "Automóveis"] : [])];
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} e ${parts.at(-1)}` : parts[0] ?? "Viaturas";
  // «Motas e moto 4 selecionadas»; com automóveis, «selecionados».
  const agree = car || !moto ? "selecionados" : "selecionadas";
  return {
    title: "A sua próxima aventura começa aqui.",
    subtitle: `${list} ${agree}, com qualidade, confiança e o acompanhamento de uma equipa especializada.`,
  };
}

/** A faixa das vantagens (por baixo das últimas entradas). */
export const BENEFITS = [
  { icon: "refresh", title: "Aceitamos retomas", text: "Valorizamos a sua mota, moto 4 ou automóvel." },
  { icon: "truck", title: "Entregas nacionais", text: "Levamos a sua nova viatura a qualquer ponto de Portugal." },
  { icon: "card", title: "Opções de pagamento", text: "Soluções de financiamento simples e flexíveis." },
] as const;

/** As últimas entradas: as viaturas que entraram há menos tempo primeiro. */
export function latestFirst<T extends Pick<Vehicle, "createdAt" | "updatedAt" | "year">>(vehicles: T[]): T[] {
  const when = (v: T) => Date.parse(v.createdAt ?? v.updatedAt ?? "") || 0;
  return [...vehicles].sort((a, b) => when(b) - when(a) || b.year - a.year);
}

/** As duas linhas de dados do cartão das últimas entradas. */
export function latestLines(
  v: Pick<Vehicle, "vehicleType" | "body" | "displacement" | "fuel" | "mileage" | "tagline" | "power" | "transmission">,
): [string, string] {
  const moto = v.vehicleType === "motorcycle";
  const first = [v.body, moto ? (v.displacement ? `${dots(v.displacement)} cc` : null) : v.fuel];
  const second = [
    `${dots(v.mileage || 0)} km`,
    v.tagline?.trim() || (moto ? (v.power ? `${dots(v.power)} cv` : null) : v.transmission),
  ];
  const join = (xs: (string | null | undefined)[]) => xs.filter(Boolean).join(" • ");
  return [join(first), join(second)];
}

/**
 * As redes sociais do rodapé. Só há o Messenger nas Definições: dele sai a
 * página do Facebook (m.me/pagina → facebook.com/pagina).
 */
export function socialLinks(branding: Pick<Branding, "company">): { network: "facebook"; href: string; label: string }[] {
  const m = /^https?:\/\/(?:www\.)?m\.me\/([A-Za-z0-9.\-_]+)\/?$/.exec(branding.company.messenger?.trim() ?? "");
  return m ? [{ network: "facebook", href: `https://www.facebook.com/${m[1]}`, label: "Facebook" }] : [];
}
