import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { effectiveVehicleTypes } from "@/lib/permissions";
import { VEHICLE_TYPES, type VehicleType } from "./vehicle-categories";

/** O tipo escolhido no site público (cookie), ou null se ainda não escolheu. */
export async function getVehicleSelection(): Promise<VehicleType | null> {
  const value = (await cookies()).get("coremotors_public_type")?.value;
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

/** O valor de `?tipo=` nos ecrãs do backoffice. */
export type AdminTypeParam = "carros" | "motas";

export const ADMIN_TYPE_PARAM: Record<VehicleType, AdminTypeParam> = {
  car: "carros",
  motorcycle: "motas",
};

/**
 * O backoffice é um só: mostra carros e motas juntos. Devolve os tipos que o
 * ecrã deve mostrar — todos os que o utilizador pode gerir, ou só um, se a
 * página tiver o filtro `?tipo=carros|motas` (e ele tiver acesso a esse).
 */
export async function getAdminVehicleTypes(
  tipo?: string | null,
): Promise<VehicleType[]> {
  const allowed = await getAllowedVehicleTypes();
  const picked =
    tipo === "carros" ? "car" : tipo === "motas" ? "motorcycle" : null;
  return picked && allowed.includes(picked) ? [picked] : allowed;
}

/**
 * Filtro PostgREST para tabelas com `vehicle_type` que pode ser nulo
 * (contactos e oficina): os tipos pedidos e, opcionalmente, os sem tipo.
 */
export function vehicleTypeOr(types: VehicleType[], includeNull = true): string {
  const list = `vehicle_type.in.(${types.join(",")})`;
  return includeNull ? `${list},vehicle_type.is.null` : list;
}

type TypeFilterable<Q> = {
  or(filters: string): Q;
  in(column: "vehicle_type", values: VehicleType[]): Q;
  is(column: "vehicle_type", value: null): Q;
};

/**
 * Aplica o filtro de tipo a uma consulta de contactos (onde o tipo pode ser
 * nulo). Com todos os tipos e os sem tipo, não filtra nada; evita-se o `or`
 * sempre que possível, para não se cruzar com o `or` da pesquisa.
 */
export function filterByVehicleType<Q extends TypeFilterable<Q>>(
  query: Q,
  types: VehicleType[],
  { includeNull = true, onlyNull = false }: { includeNull?: boolean; onlyNull?: boolean } = {},
): Q {
  if (onlyNull) return query.is("vehicle_type", null);
  if (!includeNull) return query.in("vehicle_type", types);
  if (types.length >= VEHICLE_TYPES.length) return query;
  return query.or(vehicleTypeOr(types));
}
