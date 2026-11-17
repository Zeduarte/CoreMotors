/**
 * Partilhas no Facebook: as regras, sem React nem base de dados (testáveis).
 *
 * - Quais os grupos que entram na fila de um anúncio (a sugestão pelo nome e a
 *   escolha do utilizador).
 * - Que grupos estão bloqueados por já terem recebido o anúncio.
 * - Os nomes e as chaves dos grupos lidos no Facebook.
 */
import type { FbShareStatus } from "@/lib/supabase/database.types";

export type ShareVehicleType = "car" | "motorcycle";

export interface ShareGroup {
  id: string;
  name: string;
  position: number | null;
  include: boolean | null;
}

export interface ShareAd {
  id: string;
  price: number | null;
  vehicle_type: ShareVehicleType;
}

export interface ShareAttempt {
  group_id: string;
  ad_id: string;
  status: FbShareStatus;
  created_at: string;
}

/** O que a extensão devolve de cada tentativa (mais «attention», que não se grava). */
export type ShareResultStatus = Exclude<FbShareStatus, "reset"> | "attention";

/** Estados que impedem voltar a partilhar o mesmo anúncio no mesmo grupo. */
export const BLOCKING_STATUSES: readonly FbShareStatus[] = ["confirmed", "pending", "uncertain", "rate_limited"];

export const STATUS_LABEL: Record<FbShareStatus, string> = {
  confirmed: "Publicado",
  pending: "À espera de aprovação",
  uncertain: "Por confirmar",
  rate_limited: "Limite do Facebook",
  failed: "Não submetido",
  reset: "Desbloqueado",
};

/** Sem acentos, minúsculas, espaços simples: para comparar nomes. */
export function normalizeName(value: string): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLocaleLowerCase("pt-PT")
    .replace(/\s+/g, " ")
    .trim();
}

const AUTO = /\b(automoveis?|automobil\w*|carros?|veiculos?|viaturas?|carrinhas?|auto\w*)\b/;
const MOTO = /\b(motas?|motos?|motorizadas?|motocicletas?|scooters?|quads?|motards?|enduro|mx)\b/;
const MARKET =
  /\b(market\s*place|marketplace|classificados?|anuncios?|compra\s*(e|&|\/)?\s*venda|vendas?\s*(e|&)?\s*trocas?|vendas?|usados?)\b/;

/**
 * A sugestão pelo nome do grupo: o motivo para o deixar de fora, ou "" se
 * parece adequado. É só uma sugestão: o utilizador decide em cada grupo.
 */
export function suggestExclusion(name: string, ad: Pick<ShareAd, "price" | "vehicle_type">): string {
  const n = normalizeName(name);
  // Compra e venda, mas de outras coisas («Venda de Bilhetes» passava só por ter «venda»).
  if (/\b(bilhet\w*|tickets?|reticket|imoveis|imobiliari\w*|apartamentos?|arrendamentos?|empregos?|roupas?|animais)\b/.test(n))
    return "Grupo de outro tipo de artigos (bilhetes, imóveis, emprego…)";
  if (/\b(pecas|desmanche|sucata|acessorios)\b/.test(n)) return "Grupo de peças ou acessórios";
  if (/\b(classicos?|vintage|antigos?)\b/.test(n)) return "Grupo de clássicos";
  const auto = AUTO.test(n);
  const moto = MOTO.test(n);
  if (ad.vehicle_type === "car" && moto && !auto) return "Grupo de motas";
  if (ad.vehicle_type === "motorcycle" && !moto && /\b(carros?|automoveis?|carrinhas?)\b/.test(n)) return "Grupo de carros";
  const cap = n.match(/\b(?:ate|under|up to|max\.?|maximo)\s*([\d][\d.\s,]*)\s*(k|mil)?/);
  if (cap && ad.price) {
    let limit = Number(cap[1]!.replace(/\D/g, ""));
    if (cap[2]) limit *= 1000;
    if (limit >= 500 && limit < ad.price)
      return `Preço máximo do grupo (${limit.toLocaleString("pt-PT")} €) abaixo do anúncio`;
  }
  if (!auto && !moto && !MARKET.test(n)) return "Sem indicação de viaturas nem de compra e venda";
  return "";
}

/** O grupo entra na fila deste anúncio? A escolha do utilizador manda; senão, a sugestão. */
export function isIncluded(group: Pick<ShareGroup, "name" | "include">, ad: Pick<ShareAd, "price" | "vehicle_type">): boolean {
  if (group.include !== null) return group.include;
  return suggestExclusion(group.name, ad) === "";
}

/** O último estado de cada grupo para um anúncio (o histórico vem em qualquer ordem). */
export function latestStatusByGroup(attempts: readonly ShareAttempt[], adId: string): Map<string, ShareAttempt> {
  const latest = new Map<string, ShareAttempt>();
  for (const a of attempts) {
    if (a.ad_id !== adId) continue;
    const cur = latest.get(a.group_id);
    if (!cur || a.created_at > cur.created_at) latest.set(a.group_id, a);
  }
  return latest;
}

export function isBlocked(status: FbShareStatus | undefined): boolean {
  return status !== undefined && BLOCKING_STATUSES.includes(status);
}

/**
 * A fila de um anúncio: os grupos ainda na lista do Facebook, incluídos e sem
 * partilha anterior que bloqueie, pela ordem do Facebook.
 */
export function buildQueue<G extends ShareGroup>(groups: readonly G[], attempts: readonly ShareAttempt[], ad: ShareAd): G[] {
  const latest = latestStatusByGroup(attempts, ad.id);
  return groups
    .filter((g) => g.position !== null && isIncluded(g, ad) && !isBlocked(latest.get(g.id)?.status))
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
}

/** Grupos lidos no Facebook, como a extensão os manda. */
export interface ScannedGroup {
  key: string;
  name: string;
  url: string | null;
}

/** A chave de um grupo acrescentado à mão (sem endereço). */
export function manualGroupKey(name: string): string {
  return `nome:${normalizeName(name)}`.slice(0, 220);
}

/** A chave de um grupo pelo endereço: /groups/<id ou nome curto>/. */
export function groupKeyFromUrl(url: string): string | null {
  try {
    const u = new URL(url);
    if (!/(^|\.)facebook\.com$/i.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean);
    if (parts[0] !== "groups" || !parts[1]) return null;
    if (["joins", "discover", "create", "feed"].includes(parts[1])) return null;
    return parts[1].slice(0, 220);
  } catch {
    return null;
  }
}

/**
 * Limpa a lista que a extensão mandou: só nomes e chaves plausíveis, sem
 * repetidos, pela ordem em que vieram (a do Facebook). No máximo 2000.
 */
export function cleanScannedGroups(input: unknown): ScannedGroup[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: ScannedGroup[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim() : "";
    if (name.length < 2 || name.length > 200) continue;
    const url = typeof r.url === "string" && groupKeyFromUrl(r.url) ? r.url.slice(0, 500) : null;
    const key = (url && groupKeyFromUrl(url)) || (typeof r.key === "string" && /^[\w.-]{1,220}$/.test(r.key) ? r.key : null) || manualGroupKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ key, name, url: url ? `https://www.facebook.com/groups/${key}/` : null });
    if (out.length >= 2000) break;
  }
  return out;
}

/** Os grupos colados à mão: um por linha, sem repetidos. */
export function parseManualGroups(text: string): ScannedGroup[] {
  return cleanScannedGroups(
    String(text ?? "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const key = groupKeyFromUrl(line);
        return key ? { key, name: key, url: line } : { name: line };
      }),
  );
}

/** Um link de anúncio que a extensão pode abrir (só do Facebook). */
export function isFacebookUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return u.protocol === "https:" && /(^|\.)facebook\.com$/i.test(u.hostname);
  } catch {
    return false;
  }
}

/** O id da conta do Facebook (cookie c_user/i_user): só dígitos. */
export function isFbUserId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9]{1,30}$/.test(value);
}

/**
 * A extensão instalada (`installed`, ex. "1.0.2") é mais antiga do que a
 * publicada com o site (`latest`)? Compara número a número; uma versão que
 * não se consegue ler não conta como antiga (não se pede uma atualização à toa).
 */
export function isOlderVersion(installed: string, latest: string): boolean {
  const parse = (v: string) => (/^\d+(\.\d+){0,3}$/.test(String(v ?? "").trim()) ? String(v).trim().split(".").map(Number) : null);
  const a = parse(installed);
  const b = parse(latest);
  if (!a || !b) return false;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x < y;
  }
  return false;
}
