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

/** Pode trabalhar com este tipo? Sem tipo (contacto geral) → sim. */
export function canUseVehicleType(who: Who, type: string | null | undefined): boolean {
  if (!type) return true;
  if (!(VEHICLE_TYPES as readonly string[]).includes(type)) return false;
  return canAccessVehicleType(who.role, who.allowed_vehicle_types, type as VehicleType);
}

/** Erro se alguma das viaturas for de um tipo a que não tem acesso. */
export async function carTypesError(db: Db, who: Who, carIds: string[]): Promise<string | null> {
  if (!carIds.length || who.role === "admin") return null;
  const { data } = await db.from("cars").select("vehicle_type").in("id", carIds);
  return (data ?? []).every((c) => canUseVehicleType(who, c.vehicle_type)) ? null : VEHICLE_TYPE_DENIED;
}

/** Erro se o contacto for de um tipo a que não tem acesso. */
export async function leadTypeError(db: Db, who: Who, leadId: string): Promise<string | null> {
  if (who.role === "admin") return null;
  const { data } = await db.from("leads").select("vehicle_type").eq("id", leadId).maybeSingle();
  return canUseVehicleType(who, data?.vehicle_type) ? null : VEHICLE_TYPE_DENIED;
}
