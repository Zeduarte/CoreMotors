import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { supabasePublic } from "@/lib/supabase/public";
import { cachedPublic, safely } from "@/lib/public-cache";
import { toFields, type OlxField } from "@/lib/olx/fields";
import type { VehicleType } from "@/lib/vehicle-categories";

export type FieldsByType = Partial<Record<VehicleType, OlxField[]>>;

const TYPES: VehicleType[] = ["car", "motorcycle"];

/**
 * Campos do OLX para a ficha: os da categoria padrão de cada tipo e, se a
 * viatura tiver categoria própria, os dessa no lugar dos do seu tipo.
 * As tabelas do OLX só se leem com o cliente de serviço.
 */
export async function getOlxFieldsForForm(own?: { categoryId: number | null; type: VehicleType }): Promise<FieldsByType> {
  const db = createAdminClient();
  if (!db) return {};
  const [{ data: cache }, ownRow] = await Promise.all([
    db.from("olx_category_cache").select("vehicle_type, attributes"),
    own?.categoryId
      ? db.from("olx_category_details").select("attributes").eq("category_id", own.categoryId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const out: FieldsByType = {};
  for (const t of TYPES) {
    const row = (cache ?? []).find((c) => c.vehicle_type === t);
    if (row) out[t] = toFields(row.attributes);
  }
  if (own?.categoryId && ownRow.data) out[own.type] = toFields(ownRow.data.attributes);
  return out;
}

/**
 * Os campos do OLX de todas as categorias, numa só consulta e em cache (como
 * as outras leituras públicas): antes, cada visita ao stock fazia uma consulta
 * por tipo à base de dados.
 */
const fetchOlxCategoryFields = cachedPublic(async () => {
  const { data, error } = await supabasePublic.rpc("olx_category_fields");
  // Sem a migração 0032 a função não existe: a pesquisa fica com os filtros do site.
  if (error) return [];
  return (data ?? []).map((r) => ({ vehicle_type: r.vehicle_type, attributes: r.attributes }));
}, "olx-category-fields");

/** Campos do OLX de um tipo, para os filtros da pesquisa pública. */
export async function getPublicOlxFields(type: VehicleType | null): Promise<OlxField[]> {
  if (!type) return [];
  const rows = await safely("getPublicOlxFields", fetchOlxCategoryFields, []);
  const row = rows.find((r) => r.vehicle_type === type);
  return row ? toFields(row.attributes) : [];
}
