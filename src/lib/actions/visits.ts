"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { publicSubmissionClient } from "@/lib/public-submissions";
import { deliverNotificationsSoon } from "@/lib/notifications-kick";
import { requireSection } from "@/lib/guard";
import { compactPhone, isValidPhone } from "@/lib/phone";
import { getAdminVehicleType } from "@/lib/vehicle-context";
import { getCustomerSettings, sendVisitMessage, sendVisitTemplate, takenSlots, visitContext } from "@/lib/visit-run";
import { isBookable, visitDays, visitWhenLabel, zonedParts, type VisitDay } from "@/lib/visits";
import type { VisitStatus } from "@/lib/supabase/database.types";

/** O que o formulário da ficha precisa para mostrar os dias e as horas. */
export interface VisitAvailability {
  enabled: boolean;
  slotMinutes: number;
  days: VisitDay[];
}

/**
 * Vagas livres para marcar visita. Lê com o cliente de serviço: os contactos
 * não são públicos, e daqui só sai quantas vagas há, nunca quem as ocupa.
 */
export async function getVisitAvailability(): Promise<VisitAvailability> {
  const db = createAdminClient();
  if (!db) return { enabled: false, slotMinutes: 30, days: [] };
  const settings = await getCustomerSettings(db);
  if (!settings.visitsEnabled) return { enabled: false, slotMinutes: settings.schedule.slot, days: [] };
  const now = new Date();
  const taken = await takenSlots(db, now, new Date(now.getTime() + (settings.schedule.max_days + 1) * 86_400_000));
  return { enabled: true, slotMinutes: settings.schedule.slot, days: visitDays(settings.schedule, now, taken) };
}

export interface VisitRequestState {
  ok: boolean;
  error?: string;
  at?: string;
}

const requestSchema = z.object({
  car_id: z.string().uuid(),
  at: z.string().min(10).max(40),
  name: z.string().trim().min(2, "Indique o seu nome").max(120),
  phone: z
    .string()
    .trim()
    .max(40)
    .refine(isValidPhone, "Indique um telefone válido, para confirmarmos a visita")
    .transform(compactPhone),
  email: z.string().trim().email("Email inválido").optional().or(z.literal("")),
  message: z.string().trim().max(1000).optional().or(z.literal("")),
});

/** Pedido de visita feito na ficha da viatura. Entra como contacto 'visit'. */
export async function requestVisit(_prev: VisitRequestState, formData: FormData): Promise<VisitRequestState> {
  if (formData.get("privacy_acknowledged") !== "yes")
    return { ok: false, error: "Confirme que leu a informação de privacidade antes de enviar." };
  const parsed = requestSchema.safeParse({
    car_id: formData.get("car_id"),
    at: formData.get("at"),
    name: formData.get("name") ?? "",
    phone: formData.get("phone") ?? "",
    email: formData.get("email") ?? "",
    message: formData.get("message") ?? "",
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const v = parsed.data;
  if (!Number.isFinite(Date.parse(v.at))) return { ok: false, error: "Escolha o dia e a hora." };

  let db;
  try {
    db = await publicSubmissionClient("lead", v.phone);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Tente novamente." };
  }
  const settings = await getCustomerSettings(db);
  if (!settings.visitsEnabled) return { ok: false, error: "A marcação de visitas não está disponível. Contacte-nos por telefone." };

  const { data: car } = await db
    .from("cars")
    .select("make, model, year, vehicle_type, status")
    .eq("id", v.car_id)
    .in("status", ["published", "reserved"])
    .maybeSingle();
  if (!car) return { ok: false, error: "Esta viatura já não está disponível." };

  // A vaga volta a verificar-se aqui: pode ter sido ocupada desde que a
  // página abriu.
  const now = new Date();
  const at = new Date(v.at);
  const taken = await takenSlots(db, new Date(at.getTime() - 60_000), new Date(at.getTime() + 60_000));
  if (!isBookable(settings.schedule, now, v.at, taken))
    return { ok: false, error: "Essa hora acabou de ficar ocupada. Escolha outra, por favor." };

  const optIn = formData.get("whatsapp_opt_in") === "yes";
  const { error } = await db.from("leads").insert({
    kind: "visit",
    vehicle_type: car.vehicle_type,
    car_id: v.car_id,
    car_label: `${car.make} ${car.model} ${car.year}`,
    name: v.name,
    email: v.email || "",
    phone: v.phone,
    message: v.message || null,
    preferred_date: zonedParts(at).date,
    visit_at: at.toISOString(),
    visit_status: "requested",
    // Fica no painel de quem trata dos contactos até alguém confirmar.
    next_action: "Confirmar a visita ao stand",
    next_action_at: now.toISOString(),
    car_details: {
      privacy_acknowledged_at: now.toISOString(),
      privacy_notice_version: "2026-09-16",
      ...(optIn ? { whatsapp_opt_in_at: now.toISOString() } : {}),
    },
  });
  if (error) {
    console.error("requestVisit:", error.message);
    return { ok: false, error: "Não foi possível marcar. Tente novamente ou ligue-nos." };
  }
  deliverNotificationsSoon();
  await acknowledgeRequest(settings, {
    id: "",
    name: v.name,
    phone: v.phone,
    car_label: `${car.make} ${car.model} ${car.year}`,
    car_details: optIn ? { whatsapp_opt_in_at: now.toISOString() } : {},
    visit_at: at.toISOString(),
  });
  return { ok: true, at: at.toISOString() };
}

/**
 * «Recebemos o seu pedido»: o cliente sabe logo que o pedido chegou e que a
 * hora ainda vai ser confirmada. Só sai se ele aceitou o WhatsApp e o stand
 * ligou as mensagens aos clientes; uma falha nunca estraga o pedido. Lê o
 * número da empresa, por isso usa o cliente de serviço (o visitante é anónimo).
 */
async function acknowledgeRequest(
  settings: Awaited<ReturnType<typeof getCustomerSettings>>,
  lead: Parameters<typeof sendVisitTemplate>[2],
): Promise<void> {
  try {
    const admin = createAdminClient();
    if (!admin) return;
    const result = await sendVisitTemplate(admin, "visita_pedido", lead, await visitContext(), settings);
    if (result && !result.ok) console.error("requestVisit (pedido recebido):", result.error);
  } catch (e) {
    console.error("requestVisit (pedido recebido):", e instanceof Error ? e.message : e);
  }
}

// ---- Agenda (equipa) --------------------------------------------------------

const uuid = z.string().uuid();
const PAST_ERROR = "Escolha uma hora que ainda não passou.";
type Result = { ok: boolean; error?: string };

function refresh(id?: string) {
  revalidatePath("/admin/leads/agenda");
  revalidatePath("/admin/leads");
  if (id) revalidatePath(`/admin/leads/${id}`);
  revalidatePath("/admin");
}

async function logActivity(db: Awaited<ReturnType<typeof createClient>>, leadId: string, me: string, body: string) {
  await db.from("lead_activities").insert({ lead_id: leadId, kind: "visit", body: body.slice(0, 4000), created_by: me });
}

/**
 * Confirma a visita (ou volta a mandar a confirmação) e envia a mensagem ao
 * cliente por WhatsApp, se ele a pediu e o stand ligou as mensagens aos
 * clientes. Senão, a agenda mostra o botão para a enviar do WhatsApp da equipa.
 */
async function confirmAndNotify(id: string, me: string, activity: string): Promise<Result> {
  const db = await createClient();
  const { data: lead } = await db
    .from("leads")
    .select("id, name, phone, car_label, car_details, visit_at, next_action")
    .eq("id", id)
    .maybeSingle();
  if (!lead?.visit_at) return { ok: false, error: "Contacto sem visita marcada." };
  const result = await sendVisitMessage(db, lead, await visitContext());
  const details: Record<string, unknown> = { ...(lead.car_details ?? {}) };
  if (result?.ok || result?.uncertain) details.visit_message_sent_at = new Date().toISOString();
  details.visit_message_error = result && !result.ok && !result.uncertain ? result.error ?? "Falha no envio" : null;
  const { error } = await db
    .from("leads")
    .update({
      visit_status: "confirmed",
      car_details: details,
      // A próxima ação passa a ser a própria visita, à hora marcada.
      next_action: "Visita ao stand",
      next_action_at: lead.visit_at,
    })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  await logActivity(db, id, me, `${activity} ${visitWhenLabel(lead.visit_at)}.${result?.ok ? " Confirmação enviada por WhatsApp." : ""}`);
  refresh(id);
  return { ok: true };
}

export async function confirmVisit(data: FormData): Promise<Result> {
  const me = await requireSection("leads");
  const id = uuid.safeParse(data.get("id"));
  if (!id.success) return { ok: false, error: "Visita inválida." };
  return confirmAndNotify(id.data, me.id, "Visita confirmada para");
}

/**
 * Marca ou muda a visita de um contacto (o cliente ligou, ou a equipa combinou
 * outra hora). Fica confirmada: foi a equipa que a combinou.
 */
export async function scheduleVisit(data: FormData): Promise<Result> {
  const me = await requireSection("leads");
  const parsed = z.object({ id: uuid, at: z.string().min(10).max(40) }).safeParse(Object.fromEntries(data));
  if (!parsed.success || !Number.isFinite(Date.parse(parsed.data.at))) return { ok: false, error: "Escolha o dia e a hora." };
  if (Date.parse(parsed.data.at) < Date.now()) return { ok: false, error: PAST_ERROR };
  const db = await createClient();
  const { error } = await db
    .from("leads")
    .update({ visit_at: new Date(parsed.data.at).toISOString(), visit_status: "confirmed", visit_reminded_at: null })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };
  return confirmAndNotify(parsed.data.id, me.id, "Visita marcada para");
}

const OUTCOME_LABEL: Partial<Record<VisitStatus, string>> = {
  done: "Visita realizada.",
  no_show: "O cliente não compareceu à visita.",
  cancelled: "Visita cancelada.",
};

export async function setVisitOutcome(data: FormData): Promise<Result> {
  const me = await requireSection("leads");
  const parsed = z
    .object({ id: uuid, status: z.enum(["done", "no_show", "cancelled"]) })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) return { ok: false, error: "Escolha o resultado da visita." };
  const db = await createClient();
  const { data: lead } = await db
    .from("leads")
    .select("name, phone, car_label, car_details, visit_at, visit_status, next_action, status")
    .eq("id", parsed.data.id)
    .maybeSingle();
  if (!lead) return { ok: false, error: "Contacto não encontrado." };
  const wasOpen = lead.visit_status === "requested" || lead.visit_status === "confirmed";
  const visitAction = lead.next_action === "Visita ao stand" || lead.next_action === "Confirmar a visita ao stand";
  const { error } = await db
    .from("leads")
    .update({
      visit_status: parsed.data.status,
      // Um contacto novo que veio ao stand já foi contactado.
      ...(parsed.data.status === "done" && lead.status === "new" ? { status: "contacted" as const } : {}),
      ...(visitAction ? { next_action: null, next_action_at: null } : {}),
    })
    .eq("id", parsed.data.id);
  if (error) return { ok: false, error: error.message };
  let notified = false;
  // Recusada ou cancelada pela equipa: o cliente sabe que tem de combinar outra hora.
  if (parsed.data.status === "cancelled" && wasOpen && lead.visit_at && Date.parse(lead.visit_at) > Date.now()) {
    try {
      const sent = await sendVisitTemplate(
        db,
        "visita_cancelada",
        { id: parsed.data.id, name: lead.name, phone: lead.phone, car_label: lead.car_label, car_details: lead.car_details, visit_at: lead.visit_at },
        await visitContext(),
      );
      notified = Boolean(sent?.ok);
    } catch (e) {
      console.error("setVisitOutcome (cancelada):", e instanceof Error ? e.message : e);
    }
  }
  await logActivity(
    db,
    parsed.data.id,
    me.id,
    `${parsed.data.status === "cancelled" && lead.visit_status === "requested" ? "Pedido de visita recusado." : OUTCOME_LABEL[parsed.data.status]!}${notified ? " Cliente avisado por WhatsApp." : ""}`,
  );
  refresh(parsed.data.id);
  return { ok: true };
}

/** Visita marcada pela equipa (o cliente ligou ou apareceu no stand). */
export async function createVisit(data: FormData): Promise<Result> {
  const me = await requireSection("leads");
  const parsed = z
    .object({
      name: z.string().trim().min(2, "Indique o nome do cliente").max(120),
      phone: z.string().trim().regex(/^[\d\s+]{9,}$/, "Telefone inválido"),
      car_id: z.string().uuid().optional().or(z.literal("")),
      at: z.string().min(10).max(40),
      whatsapp_opt_in: z.literal("yes").optional(),
    })
    .safeParse(Object.fromEntries(data));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const v = parsed.data;
  if (!Number.isFinite(Date.parse(v.at))) return { ok: false, error: "Escolha o dia e a hora." };
  if (Date.parse(v.at) < Date.now()) return { ok: false, error: PAST_ERROR };
  const db = await createClient();
  let carLabel: string | null = null;
  let vehicleType: "car" | "motorcycle" = await getAdminVehicleType();
  if (v.car_id) {
    const { data: car } = await db.from("cars").select("make, model, year, vehicle_type").eq("id", v.car_id).maybeSingle();
    if (!car) return { ok: false, error: "Viatura não encontrada." };
    carLabel = `${car.make} ${car.model} ${car.year}`;
    vehicleType = car.vehicle_type ?? vehicleType;
  }
  const at = new Date(v.at);
  const now = new Date().toISOString();
  const { data: lead, error } = await db
    .from("leads")
    .insert({
      kind: "visit",
      vehicle_type: vehicleType,
      car_id: v.car_id || null,
      car_label: carLabel,
      name: v.name,
      email: "",
      phone: v.phone,
      preferred_date: zonedParts(at).date,
      visit_at: at.toISOString(),
      visit_status: "confirmed",
      assigned_to: me.id,
      status: "contacted",
      // O cliente disse que sim ao telefone: a equipa regista-o aqui.
      car_details: v.whatsapp_opt_in ? { whatsapp_opt_in_at: now } : {},
    })
    .select("id")
    .single();
  if (error || !lead) return { ok: false, error: error?.message ?? "Não foi possível marcar." };
  return confirmAndNotify(lead.id, me.id, "Visita marcada para");
}
