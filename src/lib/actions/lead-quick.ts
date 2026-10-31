"use server";

import { z } from "zod";
import { requireSection } from "@/lib/guard";
import { effectiveVehicleTypes } from "@/lib/permissions";
import { revalidatePublic } from "@/lib/public-cache";
import { createClient } from "@/lib/supabase/server";
import { deliverNotificationsSoon } from "@/lib/notifications-kick";
import { getAllowedVehicleTypes } from "@/lib/vehicle-context";
import { zonedParts, zonedToUtc } from "@/lib/visits";

/**
 * Ações rápidas da lista de contactos: resolver sem abrir o contacto. Cada uma
 * faz uma coisa pequena; o que pede mais (venda, perda, reserva) continua na
 * página do contacto.
 */

const uuid = z.string().uuid();
type Result = { ok: boolean; error?: string };
type Db = Awaited<ReturnType<typeof createClient>>;

const OPEN = ["new", "contacted", "proposal"];
/** As ações de uma visita: adiar o contacto não pode mexer na hora da visita. */
const VISIT_ACTIONS = ["Visita ao stand", "Confirmar a visita ao stand"];

function refresh() {
  revalidatePublic("/admin", "layout");
}

/**
 * Lê o contacto e confirma que quem pede pode trabalhar neste tipo de viatura:
 * a RLS só olha à secção «leads», o filtro por carros/motas era só da interface.
 */
async function loadLead(db: Db, id: string) {
  if (!uuid.safeParse(id).success) return { error: "Contacto inválido." } as const;
  const { data: lead } = await db.from("leads").select("status, vehicle_type, next_action").eq("id", id).maybeSingle();
  if (!lead) return { error: "Contacto não encontrado." } as const;
  if (lead.vehicle_type && !(await getAllowedVehicleTypes()).includes(lead.vehicle_type as "car" | "motorcycle"))
    return { error: "Sem acesso a este contacto." } as const;
  return { lead } as const;
}

/** «Já contactei»: regista a nota e passa o contacto de «Novo» a «Em contacto». */
export async function quickContacted(id: string): Promise<Result> {
  const me = await requireSection("leads");
  const db = await createClient();
  const found = await loadLead(db, id);
  if ("error" in found) return { ok: false, error: found.error };
  if (found.lead.status !== "new") return { ok: false, error: "O contacto já não está novo." };
  // O gatilho da base de dados preenche `first_contacted_at` ao sair de «novo».
  const { error } = await db.from("leads").update({ status: "contacted" }).eq("id", id).eq("status", "new");
  if (error) return { ok: false, error: error.message };
  await db.from("lead_activities").insert({ lead_id: id, kind: "note", body: "Contactado (marcado na lista de contactos).", created_by: me.id });
  refresh();
  return { ok: true };
}

/** Atribui o contacto a alguém da equipa (ou tira o responsável com ""). */
export async function quickAssign(id: string, assignedTo: string): Promise<Result> {
  await requireSection("leads");
  const db = await createClient();
  const found = await loadLead(db, id);
  if ("error" in found) return { ok: false, error: found.error };
  let responsible: string | null = null;
  if (assignedTo) {
    if (!uuid.safeParse(assignedTo).success) return { ok: false, error: "Responsável inválido." };
    if (!OPEN.includes(found.lead.status)) return { ok: false, error: "O contacto já está fechado." };
    const { data: staff } = await db.rpc("staff_directory");
    if (!staff?.some((p) => p.id === assignedTo && p.role !== "mecanico")) return { ok: false, error: "Responsável inválido." };
    // Quem recebe é avisado por WhatsApp: tem de trabalhar este tipo de viatura.
    if (found.lead.vehicle_type) {
      const { data: person } = await db.from("profiles").select("role, allowed_vehicle_types").eq("id", assignedTo).maybeSingle();
      if (!person || !effectiveVehicleTypes(person.role, person.allowed_vehicle_types).includes(found.lead.vehicle_type as "car" | "motorcycle"))
        return { ok: false, error: "Essa pessoa não trabalha este tipo de viatura." };
    }
    responsible = assignedTo;
  }
  const { error } = await db.from("leads").update({ assigned_to: responsible }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  deliverNotificationsSoon();
  refresh();
  return { ok: true };
}

const SNOOZE = z.enum(["1h", "tomorrow", "3d"]);
export type Snooze = z.infer<typeof SNOOZE>;

/** Quando se volta a pegar no contacto: daqui a 1 hora, amanhã às 10:00 ou daqui a 3 dias às 10:00 (Lisboa). */
function snoozeUntil(kind: Snooze, now = new Date()): Date {
  if (kind === "1h") return new Date(now.getTime() + 60 * 60 * 1000);
  const [y, m, d] = zonedParts(now).date.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1, d + (kind === "tomorrow" ? 1 : 3), 12));
  return zonedToUtc(target.toISOString().slice(0, 10), "10:00");
}

/** Marca (ou adia) a próxima ação do contacto; mantém o texto que lá estava. */
export async function quickSnooze(id: string, kind: Snooze): Promise<Result> {
  await requireSection("leads");
  const when = SNOOZE.safeParse(kind);
  if (!when.success) return { ok: false, error: "Pedido inválido." };
  const db = await createClient();
  const found = await loadLead(db, id);
  if ("error" in found) return { ok: false, error: found.error };
  if (!OPEN.includes(found.lead.status)) return { ok: false, error: "O contacto já está fechado." };
  // Se a próxima ação é a própria visita, não se muda a hora dela: marca-se um contacto novo.
  const keep = found.lead.next_action && !VISIT_ACTIONS.includes(found.lead.next_action) ? found.lead.next_action : "Contactar o cliente";
  const { error } = await db.from("leads").update({ next_action: keep, next_action_at: snoozeUntil(when.data).toISOString() }).eq("id", id);
  if (error) return { ok: false, error: error.message };
  refresh();
  return { ok: true };
}
