/** Formatadores centralizados na convenção pt-PT (espaço como milhar, € à direita). */

// `useGrouping: "always"`: o pt-PT, por defeito, só separa os milhares a
// partir de 5 algarismos («6900 €» mas «18 900 €»); assim é sempre «6 900 €».
const grouping = { useGrouping: "always" } as unknown as Intl.NumberFormatOptions;

const eur = new Intl.NumberFormat("pt-PT", {
  style: "currency",
  currency: "EUR",
  maximumFractionDigits: 0,
  ...grouping,
});

const number = new Intl.NumberFormat("pt-PT", grouping);

export function formatPrice(value: number): string {
  return eur.format(value);
}

/** Preço formatado, ou "Sob consulta" quando aplicável. */
export function priceLabel(
  value: number,
  onRequest?: boolean,
): string {
  if (onRequest || !value) return "Sob consulta";
  return eur.format(value);
}

export function formatKm(value: number): string {
  return `${number.format(value)} km`;
}

export function formatNumber(value: number): string {
  return number.format(value);
}

/**
 * O nome do campo da carroçaria: «Carroçaria» nos carros, «Categoria» nas
 * motas (Naked, Scooter…), e os dois numa lista com carros e motas. Recebe os
 * tipos das viaturas em causa (sem tipo conta como carro).
 */
export function bodyFieldLabel(types: readonly (string | null | undefined)[]): string {
  const moto = types.some((t) => t === "motorcycle");
  const car = types.some((t) => t !== "motorcycle");
  if (moto && car) return "Carroçaria / categoria";
  return moto ? "Categoria" : "Carroçaria";
}
