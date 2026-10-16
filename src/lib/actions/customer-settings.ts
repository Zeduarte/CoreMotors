"use server";

import { revalidatePath, revalidateTag } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/admin-queries";
import { parseVisitSchedule } from "@/lib/visits";
import { CUSTOMER_SETTINGS_TAG } from "@/lib/visit-run";

/**
 * Visitas ao stand e mensagens aos clientes (Integrações). Só o administrador:
 * ligar as mensagens automáticas é decidir que o stand escreve aos clientes.
 */
export async function saveCustomerSettings(input: {
  visits_enabled: boolean;
  visit_schedule: unknown;
  customer_whatsapp: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const profile = await getCurrentProfile();
  if (profile?.role !== "admin") return { ok: false, error: "Sem permissão. Apenas administradores." };
  const schedule = parseVisitSchedule(input.visit_schedule);
  const db = await createClient();
  const { data, error } = await db
    .from("customer_settings")
    .update({
      visits_enabled: Boolean(input.visits_enabled),
      visit_schedule: schedule as unknown as never,
      customer_whatsapp: Boolean(input.customer_whatsapp),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
    .select("id");
  if (error) {
    return {
      ok: false,
      error: /customer_settings|schema cache|does not exist/i.test(error.message)
        ? "Falta aplicar a migração 0042 na base de dados."
        : error.message,
    };
  }
  if (!data?.length) return { ok: false, error: "Falta aplicar a migração 0042 na base de dados." };
  revalidateTag(CUSTOMER_SETTINGS_TAG);
  revalidatePath("/admin/integracoes");
  revalidatePath("/admin/leads/agenda");
  return { ok: true };
}
