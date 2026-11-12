"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/guard";
import { verifyAlertCancelToken } from "@/lib/alert-token";
import { leadTypeError } from "@/lib/vehicle-access";

/**
 * O cliente cancela o alerta de stock pelo link da mensagem. O contacto fica
 * fechado (deixa de receber avisos) e a equipa vê o porquê nas notas.
 */
export async function cancelStockAlert(token: string): Promise<{ ok: boolean; error?: string }> {
  const leadId = verifyAlertCancelToken(token);
  if (!leadId) return { ok: false, error: "Este link não é válido." };
  const db = createAdminClient();
  if (!db) return { ok: false, error: "Indisponível de momento. Tente mais tarde." };
  const { data: lead } = await db.from("leads").select("kind, car_details, status").eq("id", leadId).maybeSingle();
  if (!lead || lead.kind !== "alert") return { ok: false, error: "Alerta não encontrado." };
  if (lead.status === "closed") return { ok: true };
  const { error } = await db
    .from("leads")
    .update({
      status: "closed",
      car_details: { ...(lead.car_details ?? {}), alert_cancelled_at: new Date().toISOString() },
    })
    .eq("id", leadId);
  if (error) return { ok: false, error: "Não foi possível cancelar. Tente novamente." };
  await db.from("stock_alert_matches").update({ status: "cancelled" }).eq("lead_id", leadId).in("status", ["pending", "manual"]);
  return { ok: true };
}

/** A equipa avisou o cliente do seu WhatsApp (ou por telefone). */
export async function markAlertMatchSent(data: FormData): Promise<{ ok: boolean; error?: string }> {
  const me = await requireSection("leads");
  const parsed = z.object({ id: z.string().uuid(), lead_id: z.string().uuid() }).safeParse(Object.fromEntries(data));
  if (!parsed.success) return { ok: false, error: "Correspondência inválida." };
  const db = await createClient();
  // As correspondências só pedem o separador: o tipo vê-se pelo contacto, e a
  // correspondência tem de ser desse contacto.
  const denied = await leadTypeError(db, me, parsed.data.lead_id);
  if (denied) return { ok: false, error: denied };
  const { data: match, error } = await db
    .from("stock_alert_matches")
    .update({ status: "sent", sent_at: new Date().toISOString(), error: null })
    .eq("id", parsed.data.id)
    .eq("lead_id", parsed.data.lead_id)
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!match) return { ok: false, error: "Correspondência não encontrada." };
  // Avisado: a ação «Avisar o cliente» deixa de estar pendente.
  const { data: lead } = await db.from("leads").select("next_action").eq("id", parsed.data.lead_id).maybeSingle();
  if (lead?.next_action?.startsWith("Avisar o cliente")) {
    await db.from("leads").update({ next_action: null, next_action_at: null }).eq("id", parsed.data.lead_id);
  }
  revalidatePath(`/admin/leads/${parsed.data.lead_id}`);
  revalidatePath("/admin");
  return { ok: true };
}
