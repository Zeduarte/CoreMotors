import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, LeadRow } from "@/lib/supabase/database.types";
import { firstName } from "@/lib/customer-templates";
import { visitWhenLabel } from "@/lib/visits";
import type { TemplateSendResult } from "./send-template";

/**
 * A resposta do vendedor aos botões do aviso «Pedido de visita ao stand»
 * (`visit:ok:<id>` e `visit:no:<id>`).
 *
 * Tudo o que decide vive na base de dados (`wa_set_visit`, que confere a
 * secção «leads» e o tipo de viatura de quem carregou e só muda uma visita
 * ainda por tratar). Aqui só se escreve ao cliente e se devolve o texto da
 * resposta ao vendedor. Nunca lança: a rota do webhook tem de responder 200.
 */

type Db = SupabaseClient<Database>;

export type VisitMessageKind = "visita" | "visita_cancelada" | "visita_pedido";
export type VisitLead = Pick<LeadRow, "id" | "name" | "phone" | "car_label" | "car_details" | "visit_at">;

/** As dependências que falam com o exterior (a Meta e as definições do stand). */
export interface VisitButtonDeps {
  /** Envia ao cliente o modelo da visita. `null` = não se tentou (opt-in, definições, sem número). */
  sendToCustomer(db: Db, kind: VisitMessageKind, lead: VisitLead): Promise<TemplateSendResult | null>;
}

const PAYLOAD = /^visit:(ok|no):[0-9a-f-]{36}$/;
export const VISIT_BUTTON_FALLBACK = "Não consegui tratar esse pedido; abra o backoffice.";

/** Uma resposta à rota do webhook começa por «visit:»? */
export function isVisitPayload(payload: string | undefined): boolean {
  return typeof payload === "string" && payload.startsWith("visit:");
}

async function defaultDeps(): Promise<VisitButtonDeps> {
  // Importado aqui: este módulo é testado sem o resto do servidor.
  const run = await import("@/lib/visit-run");
  return {
    async sendToCustomer(db, kind, lead) {
      return run.sendVisitTemplate(db, kind, lead, await run.visitContext());
    },
  };
}

export async function handleVisitButton(input: {
  db: Db;
  actorId: string;
  /** O telemóvel de quem carregou (só para o registo). */
  phone?: string;
  payload: string;
  now?: Date;
  deps?: VisitButtonDeps;
}): Promise<string> {
  try {
    return await run(input);
  } catch (e) {
    console.error("whatsapp visit-button:", e instanceof Error ? e.message : e);
    return VISIT_BUTTON_FALLBACK;
  }
}

async function run(input: Parameters<typeof handleVisitButton>[0]): Promise<string> {
  const { db, actorId, payload } = input;
  if (!PAYLOAD.test(payload)) return VISIT_BUTTON_FALLBACK;
  const [, which, id] = payload.split(":") as [string, "ok" | "no", string];
  const confirm = which === "ok";

  const { data: outcome, error } = await db.rpc("wa_set_visit", {
    actor: actorId,
    lead: id,
    outcome: confirm ? "confirm" : "decline",
  });
  if (error || typeof outcome !== "string") {
    console.error("wa_set_visit:", error?.message);
    return VISIT_BUTTON_FALLBACK;
  }

  const { data: lead } = await db
    .from("leads")
    .select("id, name, phone, car_label, car_details, visit_at")
    .eq("id", id)
    .maybeSingle();
  const who = lead ? firstName(lead.name) : "o cliente";
  const when = lead?.visit_at ? visitWhenLabel(lead.visit_at) : "";
  const contact = lead?.phone ? ` (${lead.phone})` : "";

  switch (outcome) {
    case "confirmed": {
      if (!lead) return "Visita confirmada.";
      const sent = await sendToCustomer(input, "visita", lead);
      const details: Record<string, unknown> = { ...(lead.car_details ?? {}) };
      if (sent?.ok || sent?.uncertain) details.visit_message_sent_at = (input.now ?? new Date()).toISOString();
      details.visit_message_error = sent && !sent.ok && !sent.uncertain ? sent.error ?? "Falha no envio" : null;
      await db.from("leads").update({ car_details: details }).eq("id", id);
      await log(db, id, actorId, `Visita confirmada por WhatsApp pelo vendedor${when ? ` para ${when}` : ""}.${sent?.ok ? " Confirmação enviada ao cliente." : ""}`);
      return (
        `Visita de ${who} confirmada${when ? ` para ${when}` : ""}.` +
        (sent?.ok
          ? " Enviei-lhe a confirmação por WhatsApp."
          : " O cliente não tem mensagens automáticas ligadas: avise-o por telefone ou WhatsApp.")
      );
    }
    case "declined": {
      if (lead) {
        const sent = await sendToCustomer(input, "visita_cancelada", lead);
        await log(db, id, actorId, `Visita recusada por WhatsApp pelo vendedor${when ? ` (${when})` : ""}.${sent?.ok ? " Cliente avisado por WhatsApp." : ""}`);
      }
      return `Visita de ${who} recusada. Combine outra hora com o cliente${contact}.`;
    }
    case "already_confirmed":
      return `A visita de ${who} já estava confirmada${when ? ` para ${when}` : ""}.`;
    case "already_declined":
      return `A visita de ${who} já tinha sido recusada. Combine outra hora com o cliente${contact}.`;
    case "already_handled":
      return `O pedido de visita de ${who} já foi tratado no backoffice.`;
    case "past":
      return `Esse pedido de visita já passou da hora. Fale com o cliente${contact} para combinar outra.`;
    case "not_found":
      return "Não encontrei esse pedido de visita, ou não tem permissão para o tratar.";
    default:
      return VISIT_BUTTON_FALLBACK;
  }
}

/** Envia ao cliente; uma falha da Meta nunca estraga a resposta ao vendedor. */
async function sendToCustomer(
  input: Parameters<typeof handleVisitButton>[0],
  kind: VisitMessageKind,
  lead: VisitLead,
): Promise<TemplateSendResult | null> {
  try {
    const deps = input.deps ?? (await defaultDeps());
    return await deps.sendToCustomer(input.db, kind, lead);
  } catch (e) {
    console.error("whatsapp visit-button (cliente):", e instanceof Error ? e.message : e);
    return null;
  }
}

async function log(db: Db, leadId: string, actorId: string, body: string): Promise<void> {
  try {
    await db.from("lead_activities").insert({ lead_id: leadId, kind: "visit", body: body.slice(0, 4000), created_by: actorId });
  } catch {
    /* o registo é um extra */
  }
}
