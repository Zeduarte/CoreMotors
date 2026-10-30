import "server-only";
import { createClient } from "@/lib/supabase/server";
import {
  DEFAULT_BALANCE,
  type CompanyDay,
  type LeaveBalance,
  type LeaveDay,
} from "@/lib/leave";

/**
 * Leituras das férias. A RLS é que decide o que cada um vê: o próprio saldo,
 * os dias de toda a gente (para o mapa de equipa) e os dias especiais.
 */

export interface Colleague {
  id: string;
  name: string;
}

/** Dias especiais definidos pelo stand. Os nacionais são calculados. */
export async function getCompanyDays(year: number): Promise<CompanyDay[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("company_days")
    .select("day,kind,label")
    .gte("day", `${year}-01-01`)
    .lte("day", `${year}-12-31`)
    .order("day");
  if (error) {
    console.error("getCompanyDays:", error.message);
    return [];
  }
  return (data ?? []) as CompanyDay[];
}

/** Saldo do ano. Sem linha gravada, valem os valores por defeito. */
export async function getBalance(
  profileId: string,
  year: number,
): Promise<LeaveBalance> {
  const db = await createClient();
  const { data } = await db
    .from("leave_balances")
    .select("base_days,carried_days,birthday_day")
    .eq("profile_id", profileId)
    .eq("year", year)
    .maybeSingle();
  if (!data) return { ...DEFAULT_BALANCE };
  return {
    baseDays: Number(data.base_days),
    carriedDays: Number(data.carried_days),
    birthdayDay: Number(data.birthday_day),
  };
}

/** Dias marcados de um utilizador nesse ano. */
export async function getLeaveDays(
  profileId: string,
  year: number,
): Promise<LeaveDay[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("leave_days")
    .select("day,half,status")
    .eq("profile_id", profileId)
    .gte("day", `${year}-01-01`)
    .lte("day", `${year}-12-31`)
    .order("day");
  if (error) {
    console.error("getLeaveDays:", error.message);
    return [];
  }
  return (data ?? []) as LeaveDay[];
}

export interface TeamLeaveDay extends LeaveDay {
  profileId: string;
}

/**
 * Dias de toda a equipa num intervalo. Só o essencial para o mapa: quem,
 * quando e em que estado — nunca notas nem saldos.
 */
export async function getTeamLeave(
  from: string,
  to: string,
): Promise<TeamLeaveDay[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("leave_days")
    .select("profile_id,day,half,status")
    .gte("day", from)
    .lte("day", to)
    .in("status", ["pending", "approved"])
    .order("day");
  if (error) {
    console.error("getTeamLeave:", error.message);
    return [];
  }
  return (data ?? []).map((d) => ({
    profileId: d.profile_id as string,
    day: d.day as string,
    half: d.half as boolean,
    status: d.status as LeaveDay["status"],
  }));
}

/** Nome e id dos colegas, para as linhas do mapa de equipa. */
export async function getColleagues(): Promise<Colleague[]> {
  const db = await createClient();
  const { data, error } = await db.rpc("leave_directory");
  if (error) {
    console.error("getColleagues:", error.message);
    return [];
  }
  return (data ?? []).map((p: { id: string; full_name: string }) => ({
    id: p.id,
    name: p.full_name,
  }));
}

export interface PendingRequest {
  profileId: string;
  name: string;
  days: LeaveDay[];
}

/**
 * Dos ids dados, os de quem `me` decide as férias. Quem sabe é a base de
 * dados (`can_decide_leave_for`): o chefe nem sempre pode ler o papel dos
 * colegas em `profiles`, e adivinhar pelo papel em falta escondia ou mostrava
 * pedidos errados.
 */
async function decidableAmong(ids: string[]): Promise<Set<string>> {
  const db = await createClient();
  const respostas = await Promise.all(
    [...new Set(ids)].map(async (target) => {
      const { data, error } = await db.rpc("can_decide_leave_for", { target });
      if (error) console.error("can_decide_leave_for:", error.message);
      return [target, !error && data === true] as const;
    }),
  );
  return new Set(respostas.filter(([, pode]) => pode).map(([id]) => id));
}

/**
 * Pedidos por decidir, agrupados por colaborador.
 *
 * Só aparecem os que quem consulta pode mesmo decidir — mostrar um pedido
 * que depois o servidor recusa decidir seria enganador.
 */
export async function getPendingRequests(): Promise<PendingRequest[]> {
  const db = await createClient();
  const [{ data, error }, colegas] = await Promise.all([
    db
      .from("leave_days")
      .select("profile_id,day,half,status")
      .eq("status", "pending")
      .order("day"),
    getColleagues(),
  ]);
  if (error) {
    console.error("getPendingRequests:", error.message);
    return [];
  }
  const pode = await decidableAmong((data ?? []).map((d) => d.profile_id as string));
  const nomes = new Map(colegas.map((c) => [c.id, c.name]));
  const porPessoa = new Map<string, LeaveDay[]>();
  for (const d of data ?? []) {
    const id = d.profile_id as string;
    if (!pode.has(id)) continue;
    const lista = porPessoa.get(id) ?? [];
    lista.push({
      day: d.day as string,
      half: d.half as boolean,
      status: d.status as LeaveDay["status"],
    });
    porPessoa.set(id, lista);
  }
  return [...porPessoa.entries()].map(([profileId, days]) => ({
    profileId,
    name: nomes.get(profileId) ?? "Colaborador",
    days,
  }));
}

export interface ColleagueBalance extends Colleague {
  balance: LeaveBalance;
}

/**
 * Saldos do ano de quem `me` decide as férias (para os ajustar). O próprio
 * fica de fora, exceto o administrador, que decide o seu.
 */
export async function getManagedBalances(year: number): Promise<ColleagueBalance[]> {
  const colegas = await getColleagues();
  const pode = await decidableAmong(colegas.map((c) => c.id));
  const geridos = colegas.filter((c) => pode.has(c.id));
  return Promise.all(
    geridos.map(async (c) => ({ ...c, balance: await getBalance(c.id, year) })),
  );
}

export interface CompanyDayRow extends CompanyDay {
  id: string;
}

/** Os dias especiais do ano, com id, para os gerir. */
export async function getCompanyDayRows(year: number): Promise<CompanyDayRow[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("company_days")
    .select("id,day,kind,label")
    .gte("day", `${year}-01-01`)
    .lte("day", `${year}-12-31`)
    .order("day");
  if (error) {
    console.error("getCompanyDayRows:", error.message);
    return [];
  }
  return (data ?? []) as CompanyDayRow[];
}
