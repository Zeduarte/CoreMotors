import "server-only";
import { redirect } from "next/navigation";
import { getCurrentProfile } from "@/lib/admin-queries";
import { canAccess, canAccessVehicleType, type Section } from "@/lib/permissions";
import { createClient } from "@/lib/supabase/server";
import type { VehicleType } from "@/lib/vehicle-categories";
import type { ProfileRow } from "@/lib/supabase/database.types";

/**
 * Protege uma página do backoffice por separador. Sem sessão → login; sem
 * acesso ao separador → volta ao Dashboard (sempre acessível). Devolve o perfil
 * para a página poder usar (ex.: role).
 */
export async function requireSection(section: Section): Promise<ProfileRow> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/admin/login");
  if (!canAccess(profile.role, profile.allowed_sections, section)) {
    redirect("/admin");
  }
  return profile;
}

/**
 * Quem só tem acesso a carros (ou só a motas) não pode criar nem mexer no
 * outro tipo: a RLS só olha ao separador, por isso a barreira é feita aqui,
 * nas Server Actions, e não só escondendo o outro mundo na interface.
 */
export async function requireVehicleType(type: VehicleType): Promise<void> {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/admin/login");
  if (!canAccessVehicleType(profile.role, profile.allowed_vehicle_types, type)) redirect("/admin");
}

/**
 * O mesmo, para viaturas que já existem: lê o tipo de cada uma. Um id que não
 * volta na consulta (não existe, ou a RLS esconde-o por ser do outro tipo)
 * também é recusado: senão passava sem verificação e a media dessa viatura,
 * cujas políticas só olham ao separador, ficava à mercê de quem soubesse o id.
 */
export async function requireCarsAccess(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/admin/login");
  const db = await createClient();
  const wanted = new Set(ids);
  const { data, error } = await db.from("cars").select("id, vehicle_type").in("id", [...wanted]);
  if (error || !data || data.length < wanted.size) redirect("/admin");
  for (const row of data) {
    if (!canAccessVehicleType(profile.role, profile.allowed_vehicle_types, row.vehicle_type as VehicleType)) redirect("/admin");
  }
}
