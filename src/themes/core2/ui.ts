import type { Vehicle } from "@/types/vehicle";
import type { VehicleType } from "@/lib/vehicle-categories";

/**
 * Tema Core2, página do Stock (as maquetes da Supermotas): textos fixos, links
 * e formatos do topo, dos filtros e dos cartões do telemóvel. Sem interface,
 * para se poder testar.
 */

/** Milhares com ponto, como nas maquetes («12.900»). Igual no servidor e no browser. */
export function dots(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  return `${n < 0 ? "-" : ""}${s.replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

export function euros(n: number): string {
  return `${dots(n)} €`;
}

/** O preço dos cartões do telemóvel: «9.950 €», ou «Sob consulta». */
export function priceText(v: Pick<Vehicle, "price" | "priceOnRequest">): string {
  return v.priceOnRequest || !(v.price > 0) ? "Sob consulta" : euros(v.price);
}

/**
 * As duas linhas de dados dos cartões do telemóvel (como na maqueta): a
 * categoria e a cilindrada (nos carros, o combustível); os km e a frase curta
 * do anúncio (sem frase, a potência; nos carros, a caixa).
 */
export function rowLines(
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
