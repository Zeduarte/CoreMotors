import { sameBrand } from "./brand-name";
import { formatKm, formatPrice } from "./format";
import { normalizeWhatsApp } from "./phone";

/**
 * Alertas de stock («avise-me quando entrar») — regras PURAS.
 *
 * Um alerta guarda o que a pessoa procura; quando uma viatura é publicada,
 * `carMatches` diz se é a que ela queria. Sem dependências de servidor: o
 * formulário mostra o resumo com `criteriaLabel` e os testes correm sem base
 * de dados. O envio dos avisos vive em `stock-alert-run.ts`.
 */

export const ALERT_MAX_AGE_DAYS = 180;

export interface AlertCriteria {
  vehicle_type: "car" | "motorcycle";
  make: string | null;
  model: string | null;
  body: string | null;
  fuel: string | null;
  max_price: number | null;
  min_year: number | null;
  max_km: number | null;
}

/** "Yamaha MT-07 · até 8 000 € · desde 2019 · até 30 000 km". */
export function criteriaLabel(c: AlertCriteria): string {
  const what = [c.make, c.model].filter(Boolean).join(" ");
  const parts = [
    what || c.body || (c.vehicle_type === "motorcycle" ? "Mota" : "Carro"),
    what && c.body ? c.body : null,
    c.fuel,
    c.max_price ? `até ${formatPrice(c.max_price)}` : null,
    c.min_year ? `desde ${c.min_year}` : null,
    c.max_km != null && c.max_km > 0 ? `até ${formatKm(c.max_km)}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}

/** O que é preciso saber de uma viatura para a comparar com um alerta. */
export interface AlertCar {
  id: string;
  slug: string;
  vehicle_type: "car" | "motorcycle" | null;
  make: string;
  model: string;
  variant: string | null;
  body: string;
  fuel: string;
  price: number | null;
  price_on_request: boolean;
  year: number;
  mileage: number;
  published_at: string | null;
}

/** Minúsculas, sem acentos nem pontuação: "Série 3" ≈ "serie 3". */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function carMatches(car: AlertCar, c: AlertCriteria): boolean {
  if ((car.vehicle_type ?? "car") !== c.vehicle_type) return false;
  if (c.make && !sameBrand(car.make, c.make)) return false;
  // "MT-07" encontra "MT-07 ABS" e "Série 3" encontra "Série 3 320d".
  if (c.model && !norm(`${car.model} ${car.variant ?? ""}`).includes(norm(c.model))) return false;
  if (c.body && car.body !== c.body) return false;
  if (c.fuel && car.fuel !== c.fuel) return false;
  // Sob consulta não se sabe se cabe no orçamento: não se avisa.
  if (c.max_price != null && (car.price_on_request || car.price == null || car.price > c.max_price)) return false;
  if (c.min_year != null && car.year < c.min_year) return false;
  if (c.max_km != null && c.max_km > 0 && car.mileage > c.max_km) return false;
  return true;
}

/**
 * A viatura chegou depois do alerta? Só essas são novidade: as que já estavam
 * à venda quando o alerta foi criado, a pessoa já as viu na pesquisa.
 */
export function arrivedAfter(car: AlertCar, alertCreatedAt: string): boolean {
  if (!car.published_at) return false;
  return new Date(car.published_at).getTime() >= new Date(alertCreatedAt).getTime();
}

/** Texto do aviso, para o botão «Enviar pelo WhatsApp» da equipa. */
export function alertMessage(input: {
  name: string;
  company: string;
  car: string;
  url: string;
}): string {
  const first = input.name.trim().split(/\s+/)[0] || "";
  return (
    `Olá${first ? ` ${first}` : ""}! Aqui é da ${input.company}. ` +
    `Entrou uma viatura compatível com o alerta que criou no nosso site: ${input.car}.\n\n` +
    `Veja fotos e detalhes em ${input.url}`
  );
}

/** "Yamaha MT-07 · 2021 · 12 000 km · 6 900 €". */
export function alertCarLabel(
  car: Pick<AlertCar, "make" | "model" | "mileage" | "price" | "price_on_request"> & { year: number | null },
): string {
  return [
    `${car.make} ${car.model}`.trim(),
    car.year ? String(car.year) : null,
    formatKm(car.mileage),
    car.price_on_request || !car.price ? "preço sob consulta" : formatPrice(car.price),
  ]
    .filter(Boolean)
    .join(" · ");
}

export function customerPhone(raw: string | null | undefined): string | null {
  const digits = normalizeWhatsApp(raw ?? "");
  return /^\d{9,15}$/.test(digits) ? digits : null;
}
