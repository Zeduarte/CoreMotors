import type { Vehicle } from "@/types/vehicle";
import type { VehicleType } from "@/lib/vehicle-categories";

/**
 * Tema Core2, página do Stock (as maquetes da Supermotas): textos fixos, links
 * e formatos do topo e dos cartões. Sem interface, para se poder testar.
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
 * O stock por tipo (os mesmos endereços que o stock do Core2 lê), com o salto
 * para a lista: o topo e os cartões das categorias estão por cima dela.
 */
export const STOCK_LINKS = {
  motas: "/inventario?tipo=motas&moto4=0#lista",
  moto4: "/inventario?tipo=moto4#lista",
  carros: "/inventario?tipo=carros#lista",
} as const;

/** Os cartões das categorias do topo (no telemóvel, «Carros»). */
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

/** O topo do stock (textos das maquetes; a frase segue o que o site vende). */
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
