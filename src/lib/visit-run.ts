import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, LeadRow } from "@/lib/supabase/database.types";
import { whatsAppNumber } from "@/lib/whatsapp/account";
import { sendWhatsAppTemplate, templateLanguage, type TemplateSendResult } from "@/lib/whatsapp/send-template";
import { customerTemplateName, firstName } from "@/lib/customer-templates";
import { customerPhone } from "@/lib/stock-alerts";
import { templateParam } from "@/lib/notification-events";
import { site } from "@/lib/site";
import { DEFAULT_VISIT_SCHEDULE, parseVisitSchedule, slotKey, visitWhenLabel, type VisitSchedule } from "@/lib/visits";

type Db = SupabaseClient<Database>;

export const CUSTOMER_SETTINGS_TAG = "customer-settings";

/**
 * Visitas ao stand — o que precisa da base de dados e do WhatsApp: ler o
 * horário, contar as vagas ocupadas e mandar a confirmação e o lembrete.
 */

export interface CustomerSettings {
  visitsEnabled: boolean;
  schedule: VisitSchedule;
  customerWhatsApp: boolean;
  /** A migração 0042 ainda não foi aplicada. */
  missing: boolean;
}

export async function getCustomerSettings(db: Db): Promise<CustomerSettings> {
  const { data, error } = await db
    .from("customer_settings")
    .select("visits_enabled, visit_schedule, customer_whatsapp")
    .eq("id", 1)
    .maybeSingle();
  if (error || !data) {
    return { visitsEnabled: false, schedule: DEFAULT_VISIT_SCHEDULE, customerWhatsApp: false, missing: true };
  }
  return {
    visitsEnabled: data.visits_enabled,
    schedule: parseVisitSchedule(data.visit_schedule),
    customerWhatsApp: data.customer_whatsapp,
    missing: false,
  };
}

/** Quantas visitas (pedidas ou confirmadas) há em cada vaga, entre duas datas. */
export async function takenSlots(db: Db, from: Date, to: Date): Promise<Record<string, number>> {
  const { data } = await db
    .from("leads")
    .select("visit_at")
    .in("visit_status", ["requested", "confirmed"])
    .gte("visit_at", from.toISOString())
    .lte("visit_at", to.toISOString())
    .limit(2000);
  const taken: Record<string, number> = {};
  for (const row of data ?? []) {
    if (!row.visit_at) continue;
    const key = slotKey(row.visit_at);
    taken[key] = (taken[key] ?? 0) + 1;
  }
  return taken;
}

/** "Av. da Liberdade 100, 1250-096 Lisboa". */
export function addressLine(a: { street: string; postalCode: string; city: string }): string {
  return [a.street, [a.postalCode, a.city].filter(Boolean).join(" ")].filter(Boolean).join(", ");
}

export interface VisitContext {
  companyName: string;
  address: string;
}

export async function visitContext(): Promise<VisitContext> {
  // Importada aqui: as consultas públicas criam o cliente do Supabase ao
  // carregar, e a agenda do backoffice não precisa delas para mais nada.
  const branding = await import("@/lib/queries")
    .then((q) => q.getBranding())
    .catch(() => null);
  return {
    companyName: branding?.companyName || site.name,
    address: branding ? addressLine(branding.company.address) : addressLine(site.address),
  };
}

type VisitLead = Pick<LeadRow, "id" | "name" | "phone" | "car_label" | "car_details" | "visit_at">;

export type VisitMessageKind = "visita" | "visita_cancelada" | "visita_pedido";

/**
 * Envia ao cliente uma mensagem sobre a visita — a confirmação (e o lembrete),
 * o «pedido recebido» ou o «não podemos receber» — se ele a pediu e o stand
 * ligou as mensagens aos clientes. `null` = não se tentou.
 */
export async function sendVisitTemplate(
  db: Db,
  kind: VisitMessageKind,
  lead: VisitLead,
  ctx: VisitContext,
  settings?: CustomerSettings,
): Promise<TemplateSendResult | null> {
  const s = settings ?? (await getCustomerSettings(db));
  const phone = customerPhone(lead.phone);
  const optIn = Boolean((lead.car_details ?? {}).whatsapp_opt_in_at);
  if (!s.customerWhatsApp || !phone || !optIn || !lead.visit_at) return null;
  const number = await whatsAppNumber(db);
  if (!number?.accessToken) return null;
  const when = visitWhenLabel(lead.visit_at);
  const params =
    kind === "visita"
      ? [
          firstName(lead.name),
          // Sem quebras de linha nem espaços a mais: a Meta recusa-os nos parâmetros (#132018).
          templateParam(ctx.companyName, 80),
          when,
          templateParam(lead.car_label || "a combinar no stand", 80),
          templateParam(ctx.address || "a indicar", 120),
        ]
      : [firstName(lead.name), templateParam(ctx.companyName, 80), when];
  return sendWhatsAppTemplate(
    phone,
    { name: customerTemplateName(kind), language: templateLanguage(), params },
    number,
  );
}

/** A confirmação da visita (e o lembrete). */
export function sendVisitMessage(
  db: Db,
  lead: VisitLead,
  ctx: VisitContext,
  settings?: CustomerSettings,
): Promise<TemplateSendResult | null> {
  return sendVisitTemplate(db, "visita", lead, ctx, settings);
}

/**
 * Lembrete na véspera: visitas confirmadas que começam nas próximas 26 horas
 * (e daqui a mais de 2), uma vez cada. Quem recebeu a confirmação há menos de
 * 12 horas não precisa de outra mensagem igual.
 */
export async function runVisitReminders(db: Db, now = new Date()): Promise<{ sent: number; skipped?: string }> {
  try {
    const settings = await getCustomerSettings(db);
    if (settings.missing) return { sent: 0, skipped: "Migração 0042 por aplicar." };
    if (!settings.customerWhatsApp) return { sent: 0, skipped: "Mensagens aos clientes desligadas." };
    const { data: visits } = await db
      .from("leads")
      .select("id, name, phone, car_label, car_details, visit_at")
      .eq("visit_status", "confirmed")
      .is("visit_reminded_at", null)
      .gte("visit_at", new Date(now.getTime() + 2 * 3_600_000).toISOString())
      .lte("visit_at", new Date(now.getTime() + 26 * 3_600_000).toISOString())
      .limit(50);
    if (!visits?.length) return { sent: 0 };
    const ctx = await visitContext();
    let sent = 0;
    for (const lead of visits) {
      // Marca antes de enviar: dois processos em paralelo não lembram duas vezes.
      const { data: claimed } = await db
        .from("leads")
        .update({ visit_reminded_at: now.toISOString() })
        .eq("id", lead.id)
        .is("visit_reminded_at", null)
        .select("id");
      if (!claimed?.length) continue;
      const confirmedAt = (lead.car_details ?? {}).visit_message_sent_at;
      if (typeof confirmedAt === "string" && now.getTime() - Date.parse(confirmedAt) < 12 * 3_600_000) continue;
      const result = await sendVisitMessage(db, lead, ctx, settings);
      if (result?.ok) sent++;
    }
    return { sent };
  } catch (e) {
    console.error("Lembretes das visitas:", e);
    return { sent: 0, skipped: "Falha ao enviar os lembretes." };
  }
}

/**
 * A marcação de visitas está ligada? Para a ficha da viatura (que é estática e
 * não pode ler a tabela a cada visita). Gravar as definições limpa a cache.
 */
export const getVisitsEnabled = unstable_cache(
  async (): Promise<boolean> => {
    const db = createAdminClient();
    if (!db) return false;
    return (await getCustomerSettings(db)).visitsEnabled;
  },
  ["visits-enabled"],
  { tags: [CUSTOMER_SETTINGS_TAG], revalidate: 300 },
);
