/**
 * Partilhas · procurar grupos novos: as regras, sem React nem base de dados.
 *
 * - As palavras-chave das categorias e que grupos lhes correspondem.
 * - O limite diário de adesões a grupos por conta do Facebook.
 * - Que resultados da pesquisa do Facebook se tentam (sem repetir grupos).
 * - Os horários automáticos.
 */
import { groupCategory, groupKeyFromUrl, normalizeName } from "@/lib/fb-shares";
import type { FbGroupJoinRow, FbJoinStatus } from "@/lib/supabase/database.types";

/**
 * Adesões a grupos por conta do Facebook, em 24 horas. A Meta não publica um
 * limite; os relatos mais citados falam de bloqueios temporários (cerca de uma
 * semana sem poder aderir) a partir de ~10 grupos por dia. Fica 10 − 5 = 5,
 * com margem, contando os que entraram e os pedidos enviados.
 */
export const JOIN_DAILY_LIMIT = 5;

/** Intervalo entre adesões: um mínimo, mais um acaso (não parecer um robô). */
export const JOIN_GAP_MIN_SECONDS = 90;
export const JOIN_GAP_JITTER_SECONDS = 90;

/** Estados que contam para o limite diário (o Facebook registou um pedido). */
export const JOIN_COUNTED: readonly FbJoinStatus[] = ["joined", "requested"];

/** Grupos que não se voltam a tentar nesta conta. */
export const JOIN_DONE: readonly FbJoinStatus[] = ["joined", "requested", "questions", "member"];

export const JOIN_STATUS_LABEL: Record<FbJoinStatus, string> = {
  joined: "Entrou",
  requested: "Pedido enviado",
  questions: "Tem perguntas",
  member: "Já era membro",
  limited: "Limite do Facebook",
  failed: "Falhou",
};

/** Palavras-chave de uma categoria: separadas por vírgulas ou linhas, sem repetidas. */
export function cleanKeywords(input: string | readonly string[]): string[] {
  const parts = typeof input === "string" ? input.split(/[,;\n]/) : [...input];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of parts) {
    const k = String(raw ?? "").replace(/\s+/g, " ").trim();
    const n = normalizeName(k);
    if (n.length < 2 || k.length > 60 || seen.has(n)) continue;
    seen.add(n);
    out.push(k);
    if (out.length >= 30) break;
  }
  return out;
}

/** A primeira palavra-chave que aparece no nome do grupo (sem acentos nem maiúsculas), ou null. */
export function matchedKeyword(name: string, keywords: readonly string[]): string | null {
  const n = ` ${normalizeName(name).replace(/[^\p{L}\p{N}]+/gu, " ")} `;
  for (const k of keywords) {
    const kn = normalizeName(k).replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (kn && n.includes(` ${kn}`)) return k;
  }
  return null;
}

export function matchesKeywords(name: string, keywords: readonly string[]): boolean {
  return matchedKeyword(name, keywords) !== null;
}

/** Quantas adesões contam para o limite nas últimas 24 horas. */
export function joinsInLastDay(joins: readonly Pick<FbGroupJoinRow, "status" | "created_at">[], now: Date): number {
  const since = now.getTime() - 24 * 3600_000;
  return joins.filter((j) => JOIN_COUNTED.includes(j.status) && new Date(j.created_at).getTime() > since).length;
}

export function remainingJoins(joins: readonly Pick<FbGroupJoinRow, "status" | "created_at">[], now: Date): number {
  return Math.max(0, JOIN_DAILY_LIMIT - joinsInLastDay(joins, now));
}

/** Os grupos já tratados nesta conta (não se voltam a tentar). */
export function doneJoinKeys(joins: readonly Pick<FbGroupJoinRow, "group_key" | "status">[]): Set<string> {
  return new Set(joins.filter((j) => JOIN_DONE.includes(j.status)).map((j) => j.group_key));
}

/** Um grupo encontrado na pesquisa de grupos do Facebook, como a extensão o manda. */
export interface FoundGroup {
  key: string;
  name: string;
  url: string;
  privacy: "public" | "private" | null;
  /** «12K members · 90+ posts a day», como o Facebook mostra. */
  info: string;
  /** join = pode aderir; member = já é membro; pending = pedido feito. */
  state: "join" | "member" | "pending" | "other";
}

/** Limpa o que a extensão mandou da pesquisa (só grupos com endereço). */
export function cleanFoundGroups(input: unknown): FoundGroup[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: FoundGroup[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const r = raw as Record<string, unknown>;
    const name = typeof r.name === "string" ? r.name.replace(/\s+/g, " ").trim() : "";
    const key = typeof r.url === "string" ? groupKeyFromUrl(r.url) : null;
    if (!key || name.length < 2 || name.length > 200 || seen.has(key)) continue;
    seen.add(key);
    const state = ["join", "member", "pending"].includes(r.state as string) ? (r.state as FoundGroup["state"]) : "other";
    const privacy = r.privacy === "public" || r.privacy === "private" ? r.privacy : null;
    out.push({ key, name, url: `https://www.facebook.com/groups/${key}/`, privacy, info: String(r.info ?? "").slice(0, 120), state });
  }
  return out;
}

/**
 * Os grupos da pesquisa a que vale a pena pedir adesão: ainda não é membro nem
 * pediu, o nome tem uma das palavras-chave, não é de outros artigos
 * (bilhetes, imóveis…) e não foi já tratado nesta conta.
 */
export function pickJoinCandidates(
  found: readonly FoundGroup[],
  opts: { keywords: readonly string[]; skipKeys: ReadonlySet<string>; publicOnly?: boolean },
): FoundGroup[] {
  return found.filter(
    (g) =>
      g.state === "join" &&
      !opts.skipKeys.has(g.key) &&
      (!opts.publicOnly || g.privacy === "public") &&
      groupCategory(g.name) !== "outros" &&
      matchesKeywords(g.name, opts.keywords),
  );
}

// ---------------------------------------------------------------------------
// Horários
// ---------------------------------------------------------------------------

export const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"] as const;

/** «Seg, Qua, Sex às 18:00» / «Todos os dias às 21:00». */
export function describeSchedule(weekdays: readonly number[], atTime: string): string {
  const days = [...new Set(weekdays)].filter((d) => d >= 0 && d <= 6).sort();
  const order = [1, 2, 3, 4, 5, 6, 0]; // a semana começa à segunda
  const label =
    days.length === 7
      ? "Todos os dias"
      : days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d))
        ? "Dias úteis"
        : order.filter((d) => days.includes(d)).map((d) => WEEKDAY_SHORT[d]).join(", ");
  return `${label} às ${atTime}`;
}

export function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}
