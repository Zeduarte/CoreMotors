import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { canAccessVehicleType } from "@/lib/permissions";
import { VEHICLE_TYPES, type VehicleType } from "@/lib/vehicle-categories";
import type { Database, ProfileRow } from "@/lib/supabase/database.types";

/**
 * O tipo de viatura de cada utilizador (Utilizadores → «Carros/Motas») também
 * nas gravações, e não só no menu: quem só vende motas não grava carros nem
 * mexe em contactos de carros escrevendo os pedidos à mão.
 *
 * A base de dados faz a mesma regra desde a 0047 (políticas restritivas); isto
 * cobre as bases ainda sem ela e dá uma mensagem clara em vez de «0 linhas».
 */

type Db = SupabaseClient<Database>;
type Who = Pick<ProfileRow, "role" | "allowed_vehicle_types">;

export const VEHICLE_TYPE_DENIED = "Sem acesso a este tipo de viatura.";
/** Um id que a consulta não devolve: não existe, ou a RLS (0047) esconde-o por ser do outro tipo. */
export const CAR_NOT_FOUND = "Viatura não encontrada (ou sem acesso a este tipo de viatura).";
export const LEAD_NOT_FOUND = "Contacto não encontrado (ou sem acesso a este tipo de viatura).";
export const ASSIGNEE_TYPE_DENIED = "Essa pessoa não trabalha este tipo de viatura.";

/** Pode trabalhar com este tipo? Sem tipo (contacto geral) → sim. */
export function canUseVehicleType(who: Who, type: string | null | undefined): boolean {
  if (!type) return true;
  if (!(VEHICLE_TYPES as readonly string[]).includes(type)) return false;
  return canAccessVehicleType(who.role, who.allowed_vehicle_types, type as VehicleType);
}

/**
 * Erro se alguma das viaturas for de um tipo a que não tem acesso — ou se não
 * vier na consulta. A RLS (0047) esconde as do outro tipo que não estão à
 * venda; antes, um id escondido não contava como proibido e passava: dava um
 * erro técnico mais à frente, ou nenhum, nas ações com o cliente de serviço.
 * `db` tem de ser o cliente da sessão, para a RLS se aplicar.
 */
export async function carTypesError(db: Db, who: Who, carIds: string[]): Promise<string | null> {
  const wanted = [...new Set(carIds)];
  if (!wanted.length || who.role === "admin") return null;
  const { data, error } = await db.from("cars").select("id, vehicle_type").in("id", wanted);
  if (error || !data) return CAR_NOT_FOUND;
  const found = new Set(data.map((c) => c.id));
  if (!wanted.every((id) => found.has(id))) return CAR_NOT_FOUND;
  return data.every((c) => canUseVehicleType(who, c.vehicle_type)) ? null : VEHICLE_TYPE_DENIED;
}

/**
 * Erro se o contacto for de um tipo a que não tem acesso (sem tipo → pode).
 * Um contacto que não vem na consulta (não existe, ou a RLS esconde-o por ser
 * do outro tipo) também é recusado, pela mesma razão de `carTypesError`.
 */
export async function leadTypeError(db: Db, who: Who, leadId: string): Promise<string | null> {
  if (who.role === "admin") return null;
  const { data, error } = await db.from("leads").select("vehicle_type").eq("id", leadId).maybeSingle();
  if (error || !data) return LEAD_NOT_FOUND;
  return canUseVehicleType(who, data.vehicle_type) ? null : VEHICLE_TYPE_DENIED;
}

/**
 * Erro se quem vai receber o contacto não trabalhar o tipo dele (contacto sem
 * tipo → qualquer um). O perfil de outra pessoa não se lê com a sessão de quem
 * atribui (a RLS só mostra o próprio, ou todos a quem tem «Utilizadores»), por
 * isso pergunta-se à base de dados, com a mesma regra das políticas
 * (`has_vehicle_type_for`, 0024 — executável pelo papel `authenticated`).
 */
export async function assigneeTypeError(db: Db, assignee: string, type: string | null | undefined): Promise<string | null> {
  if (!type) return null;
  const { data, error } = await db.rpc("has_vehicle_type_for", { uid: assignee, vtype: type });
  if (error) return "Não foi possível confirmar o tipo de viatura do responsável.";
  return data === true ? null : ASSIGNEE_TYPE_DENIED;
}
