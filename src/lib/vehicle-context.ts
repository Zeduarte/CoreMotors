import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { effectiveVehicleTypes } from "@/lib/permissions";
import type { VehicleType } from "./vehicle-categories";

export async function getVehicleSelection(
  area: "public" | "admin" = "public",
): Promise<VehicleType | null> {
  const value = (await cookies()).get(`coremotors_${area}_type`)?.value;
  return value === "car" || value === "motorcycle" ? value : null;
}

export async function getPublicVehicleType(): Promise<VehicleType> {
  return (await getVehicleSelection()) ?? "car";
}

/**
 * Tipos de viatura que o utilizador autenticado pode gerir. Sem sessão ou sem
 * perfil, devolve apenas carros — quem não está autenticado não vê nada de
 * qualquer forma, e assim nunca se assume acesso a mais do que o devido.
 *
 * `cache` deduplica a leitura dentro do mesmo pedido: o layout e a página
 * chamam isto várias vezes.
 */
export const getAllowedVehicleTypes = cache(
  async (): Promise<VehicleType[]> => {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return ["car"];
    const { data } = await supabase
      .from("profiles")
      .select("role,allowed_vehicle_types")
      .eq("id", user.id)
      .maybeSingle();
    if (!data) return ["car"];
    return effectiveVehicleTypes(data.role, data.allowed_vehicle_types);
  },
);

/**
 * Tipo de viatura ativo no backoffice, limitado ao que o utilizador pode ver.
 * Se o cookie apontar para um mundo a que perdeu acesso, cai no primeiro
 * permitido em vez de mostrar dados que não devia.
 */
export async function getAdminVehicleType(): Promise<VehicleType> {
  const [selected, allowed] = await Promise.all([
    getVehicleSelection("admin"),
    getAllowedVehicleTypes(),
  ]);
  if (selected && allowed.includes(selected)) return selected;
  return allowed[0] ?? "car";
}
