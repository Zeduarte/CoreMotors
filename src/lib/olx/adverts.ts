import { canonicalBrand } from "@/lib/brand-name";
import type { OlxAdvertOrigin } from "@/lib/supabase/database.types";

/**
 * Anúncios da conta do OLX que o site não criou: de onde vêm e a que viatura
 * do stock parecem pertencer. Funções puras — a leitura do OLX e as
 * associações vivem em `import.ts` e `links.ts`.
 */

export type AdvertOrigin = OlxAdvertOrigin;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * De onde vem um anúncio, pelo `external_id` que o OLX devolve:
 *  - um id de viatura (UUID) → foi o backoffice que o criou (mesmo que a
 *    viatura já tenha sido apagada);
 *  - vazio → feito à mão no OLX (gere-se pela API);
 *  - outro → exportado por outro programa. Na conta do stand são todos do
 *    Standvirtual, e o OLX recusa alterá-los, por isso tratam-se como tal.
 *
 * O que já se sabia mantém-se (`previous`): um anúncio do OLX adotado por uma
 * viatura passa a levar o id dela e continua a ser «OLX», e um que o OLX
 * recusou alterar por ser do Standvirtual fica «Standvirtual» de vez.
 */
export function advertOrigin(externalId: string | null | undefined, previous?: AdvertOrigin | null): AdvertOrigin {
  if (previous === "standvirtual" || previous === "olx") return previous;
  if (!externalId) return "olx";
  return UUID.test(externalId) ? "site" : "standvirtual";
}

/** Estados do OLX em que o anúncio está (ou pode voltar a estar) à vista sem ser reativado. */
const LIVE = new Set(["new", "active", "limited", "unconfirmed", "unpaid"]);
export const isLiveAdvert = (status: string | null | undefined) => !!status && LIVE.has(status);

/** O que o backoffice diz de um anúncio que só se altera no Standvirtual. */
export const STANDVIRTUAL_NOTE = "Gerido no Standvirtual";

/** A recusa do OLX a alterar um anúncio que veio do Standvirtual. */
export function isStandvirtualExport(error: string | null | undefined): boolean {
  return !!error && /exportado do\s+standvirtual/i.test(error);
}

export interface MatchAdvert {
  id: number;
  title: string;
  price: number | null;
  /** Nome da categoria do OLX: nos carros é a marca. */
  categoryName: string | null;
}

export interface MatchCar {
  id: string;
  make: string;
  model: string;
  price: number | null;
}

export interface Suggestion {
  carId: string;
  /** Marca, modelo e preço iguais. Só esta impede criar um anúncio novo. */
  strong: boolean;
}

/** Minúsculas, sem acentos, só letras e algarismos separados por um espaço. */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Sem espaços: «116d» e «116 d» passam a ser o mesmo. */
const compact = (text: string) => fold(text).replace(/ /g, "");

function sameMake(advert: MatchAdvert, car: MatchCar): boolean {
  const make = fold(canonicalBrand(car.make));
  if (!make) return false;
  if (advert.categoryName && compact(advert.categoryName) === make.replace(/ /g, "")) return true;
  return ` ${fold(advert.title)} `.includes(` ${make} `);
}

/**
 * O modelo tem de ser feito de palavras inteiras e seguidas do título — juntas
 * sem espaços, para «116d» bater com «116 d». Assim «3» não bate com «CX-30»
 * nem «500» com «500X».
 */
function sameModel(advert: MatchAdvert, car: MatchCar): boolean {
  const model = compact(car.model);
  if (!model) return false;
  const words = fold(advert.title).split(" ").filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    let joined = "";
    for (let j = i; j < words.length && joined.length < model.length; j++) {
      joined += words[j];
      if (joined === model) return true;
    }
  }
  return false;
}

/**
 * A viatura a que o anúncio parece pertencer. Forte quando também o preço é
 * igual; fraca quando só a marca e o modelo batem e não há outra candidata.
 * Várias candidatas sem uma de preço igual → nenhuma (escolhe-se à mão).
 */
export function suggestCar(advert: MatchAdvert, cars: MatchCar[]): Suggestion | null {
  const candidates = cars.filter((c) => sameMake(advert, c) && sameModel(advert, c));
  if (!candidates.length) return null;
  const samePrice = candidates.filter((c) => advert.price != null && c.price != null && Number(c.price) === Number(advert.price));
  if (samePrice.length === 1) return { carId: samePrice[0]!.id, strong: true };
  if (samePrice.length > 1) return null;
  return candidates.length === 1 ? { carId: candidates[0]!.id, strong: false } : null;
}

/**
 * Sugestões para vários anúncios de uma vez (`cars` já sem as viaturas
 * associadas). Quando dois anúncios apontam para a mesma viatura — o C3 à
 * venda e um C3 antigo, já vendido — fica a sugestão forte; sem uma forte,
 * nenhuma.
 */
export function suggestAll(adverts: MatchAdvert[], cars: MatchCar[]): Map<number, Suggestion> {
  const byCar = new Map<string, { advertId: number; s: Suggestion }[]>();
  for (const advert of adverts) {
    const s = suggestCar(advert, cars);
    if (!s) continue;
    byCar.set(s.carId, [...(byCar.get(s.carId) ?? []), { advertId: advert.id, s }]);
  }
  const result = new Map<number, Suggestion>();
  for (const list of byCar.values()) {
    const strong = list.filter((x) => x.s.strong);
    const winner = strong.length === 1 ? strong[0] : strong.length === 0 && list.length === 1 ? list[0] : null;
    if (winner) result.set(winner.advertId, winner.s);
  }
  return result;
}
