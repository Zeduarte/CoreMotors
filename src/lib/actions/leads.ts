"use server";

import { getPublicVehicleType } from "@/lib/vehicle-context";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { publicSubmissionClient } from "@/lib/public-submissions";
import { deliverNotificationsSoon } from "@/lib/notifications-kick";
import { requireSection } from "@/lib/guard";
import { z } from "zod";
import { leadSchema } from "@/lib/schemas";
import { criteriaLabel } from "@/lib/stock-alerts";
import { alertCriteriaSchema } from "@/lib/stock-alert-schema";
import type { LeadStatus } from "@/lib/supabase/database.types";

export interface LeadActionState {
  ok: boolean;
  error?: string;
}

/**
 * Cria um lead a partir de um formulário público (contacto / test drive).
 *
 * Chamada por Client Components via `useActionState`. A RLS permite `insert`
 * anónimo na tabela `leads`; leitura/gestão fica reservada ao staff.
 */
export async function submitLead(
  _prev: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  if (formData.get("privacy_acknowledged") !== "yes")
    return {
      ok: false,
      error: "Confirme que leu a informação de privacidade antes de enviar.",
    };
  const parsed = leadSchema.safeParse({
    kind: formData.get("kind") ?? "contact",
    car_id: (formData.get("car_id") as string) || null,
    car_label: formData.get("car_label") ?? "",
    name: formData.get("name") ?? "",
    email: formData.get("email") ?? "",
    phone: formData.get("phone") ?? "",
    message: formData.get("message") ?? "",
    preferred_date: formData.get("preferred_date") ?? "",
    details: formData.get("details") ?? "",
  });

  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const v = parsed.data;

  // Detalhes estruturados (retoma/encomenda) chegam como JSON.
  let carDetails: Record<string, unknown> = {};
  if (v.details) {
    try {
      const parsedDetails = JSON.parse(v.details);
      if (parsedDetails && typeof parsedDetails === "object") {
        carDetails = parsedDetails as Record<string, unknown>;
      }
    } catch {
      // ignora JSON inválido — a lead entra na mesma sem detalhes.
    }
  }

  let supabase;
  try {
    // Limite por pessoa: o email, ou o telefone quando só deixam o telefone.
    supabase = await publicSubmissionClient("lead", v.email || v.phone || undefined);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Tente novamente.",
    };
  }
  const formType = formData.get("vehicle_type");
  // As páginas por marca (/motas/yamaha) dizem o tipo; o resto segue o mundo escolhido.
  let vehicleType =
    v.kind === "alert" && (formType === "car" || formType === "motorcycle")
      ? formType
      : await getPublicVehicleType();
  let message = v.message || null;
  if (v.kind === "alert") {
    // O alerta guarda o que a pessoa procura, para ser avisada sozinha quando
    // entrar uma viatura compatível (stock-alert-run.ts).
    const criteria = alertCriteriaSchema.safeParse({
      vehicle_type: vehicleType,
      make: formData.get("alert_make"),
      model: formData.get("alert_model"),
      body: formData.get("alert_body"),
      fuel: formData.get("alert_fuel"),
      max_price: formData.get("alert_max_price"),
      min_year: formData.get("alert_min_year"),
      max_km: formData.get("alert_max_km"),
    });
    if (!criteria.success)
      return { ok: false, error: criteria.error.issues[0]?.message ?? "Diga-nos o que procura." };
    carDetails = { ...carDetails, criteria: criteria.data };
    message = [criteriaLabel(criteria.data), v.message].filter(Boolean).join("\n\n");
    if (formData.get("whatsapp_opt_in") === "yes" && v.phone)
      carDetails.whatsapp_opt_in_at = new Date().toISOString();
  }
  let carLabel = v.car_label || null;
  if (v.car_id) {
    // A viatura diz o tipo, não o mundo guardado no browser: quem está nos
    // carros e pergunta por uma mota (link partilhado, favoritos) não pode
    // ficar com «já não está disponível».
    const { data: car } = await supabase
      .from("cars")
      .select("make,model,status,vehicle_type")
      .eq("id", v.car_id)
      .in("status", ["published", "reserved"])
      .maybeSingle();
    if (!car || (v.kind === "reservation" && car.status !== "published"))
      return {
        ok: false,
        error: "Esta viatura já não está disponível para este pedido.",
      };
    carLabel = `${car.make} ${car.model}`;
    if (car.vehicle_type === "car" || car.vehicle_type === "motorcycle") vehicleType = car.vehicle_type;
  }
  if (v.kind === "reservation") {
    const { data: settings } = await supabase
      .from("site_settings")
      .select("reservation_enabled,deposit_amount")
      .eq("id", 1)
      .single();
    if (!settings?.reservation_enabled || !v.car_id)
      return { ok: false, error: "Reservas indisponíveis." };
    carDetails = { deposit: settings.deposit_amount };
  }
  const { error } = await supabase.from("leads").insert({
    kind: v.kind,
    vehicle_type: vehicleType,
    car_id: v.car_id ?? null,
    car_label: carLabel,
    name: v.name,
    // A coluna não aceita nulo: sem email fica vazio (o contacto é o telefone).
    email: v.email || "",
    phone: v.phone || null,
    message,
    preferred_date: v.preferred_date || null,
    car_details: {
      ...carDetails,
      privacy_acknowledged_at: new Date().toISOString(),
      privacy_notice_version: "2026-09-16",
    },
  });

  if (error) {
    console.error("submitLead:", error.message);
    return { ok: false, error: "Não foi possível enviar. Tente novamente." };
  }

  // Os avisos por WhatsApp à equipa já foram agendados pela base de dados, na
  // mesma gravação; saem depois de o cliente ter a resposta, sem o fazer
  // esperar — e se o WhatsApp falhar, o contacto já está gravado.
  deliverNotificationsSoon();
  return { ok: true };
}

// ---- Gestão (staff) -------------------------------------------------------
export async function setLeadStatus(id: string, status: LeadStatus) {
  if (
    !z.string().uuid().safeParse(id).success ||
    !z.enum(["new", "contacted", "proposal", "closed"]).safeParse(status)
      .success
  )
    return {
      ok: false,
      error: "Abra o contacto para registar a venda ou o motivo de perda.",
    };
  await requireSection("leads");
  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ status })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/leads");
  revalidatePath("/admin");
  return { ok: true };
}

export async function deleteLead(id: string) {
  await requireSection("leads");
  const supabase = await createClient();
  const { error } = await supabase.from("leads").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/leads");
  return { ok: true };
}

export async function saveLeadNotes(id: string, notes: string) {
  await requireSection("leads");
  const supabase = await createClient();
  const { error } = await supabase
    .from("leads")
    .update({ notes: notes || null })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/leads");
  return { ok: true };
}
