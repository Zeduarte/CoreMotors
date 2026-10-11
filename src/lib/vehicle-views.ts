import "server-only";
import { unstable_cache } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Visitas à ficha de uma viatura nos últimos 7 dias (só visitantes reais —
 * ver `view-filter.ts`). Usado na ficha como prova social; os números são os
 * verdadeiros, nunca inventados. Lê com a chave de serviço porque o público
 * não pode ler `car_views`. Em cache 10 minutos.
 */
export const getRecentViews = unstable_cache(
  async (carId: string): Promise<number | null> => {
    const db = createAdminClient();
    if (!db) return null;
    const since = new Date(Date.now() - 7 * 864e5).toISOString();
    const { count, error } = await db
      .from("car_views")
      .select("id", { count: "exact", head: true })
      .eq("car_id", carId)
      .gte("created_at", since);
    if (error) return null;
    return count ?? null;
  },
  ["car-views-7d"],
  { revalidate: 600 },
);
