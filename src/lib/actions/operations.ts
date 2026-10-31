"use server";
import { z } from "zod";
import { revalidatePublic } from "@/lib/public-cache";
import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/guard";
import { worklogHours } from "@/lib/operations";
import { deliverNotificationsSoon } from "@/lib/notifications-kick";

const uuid = z.string().uuid();
const optionalId = z.union([uuid, z.literal("")]).transform(v => v || null);
const optionalDate = z.union([z.string().date(), z.literal("")]).transform(v => v || null);
const optionalMoney = z.preprocess(v => v === "" ? null : v, z.coerce.number().min(0).max(9999999999).nullable());
const result = (error: {message: string} | null) => error ? {ok: false, error: error.message} : {ok: true};
function refresh() {
  revalidatePublic("/admin", "layout");
  revalidatePublic("/", "layout");
}
const crmSchema = z.object({
  id: uuid, assigned_to: optionalId, car_id: optionalId,
  next_action: z.string().trim().max(500), next_action_at: z.string().max(40),
  status: z.enum(["new","contacted","proposal","won","lost","closed"]), loss_reason: z.string().trim().max(1000),
}).refine(v => v.status !== "lost" || v.loss_reason.length > 0, "Indique o motivo de perda")
.refine(v => (!v.next_action && !v.next_action_at) || (v.next_action && v.next_action_at), "Preencha a próxima ação e a data");
export async function saveLeadFollowup(data: FormData) {
  await requireSection("leads");
  const parsed = crmSchema.safeParse(Object.fromEntries(data));
  if (!parsed.success) return {ok: false, error: parsed.error.issues[0]?.message};
  const {id, ...v} = parsed.data;
  if (v.next_action_at && !Number.isFinite(Date.parse(v.next_action_at))) return {ok: false, error: "Data inválida"};
  const db = await createClient();
  if (v.assigned_to) {
    const {data: staff} = await db.rpc("staff_directory");
    if (!staff?.some(p => p.id === v.assigned_to && p.role !== "mecanico")) return {ok: false, error: "Responsável inválido"};
  }
  const {error} = await db.from("leads").update({...v, next_action: v.next_action || null,
    next_action_at: v.next_action_at ? new Date(v.next_action_at).toISOString() : null,
    loss_reason: v.status === "lost" ? v.loss_reason : null }).eq("id",id).select("id").single();
  // Contacto atribuído a alguém, ou ganho/perdido: o responsável é avisado (0041).
  if (!error) deliverNotificationsSoon();
  refresh(); return result(error);
}
export async function addLeadActivity(data: FormData) {
  const me = await requireSection("leads");
  const parsed = z.object({lead_id: uuid, kind: z.enum(["call","message","proposal","visit","note"]), body: z.string().trim().min(1).max(4000)}).safeParse(Object.fromEntries(data));
  if (!parsed.success) return {ok:false,error:"Preencha o tipo e o texto da atividade."};
  const db = await createClient();
  const {error} = await db.from("lead_activities").insert({...parsed.data, created_by: me.id});
  refresh(); return result(error);
}
export async function saveFinancials(data: FormData) {
  await requireSection("financeiro");
  const parsed = z.object({car_id: uuid, acquired_on: optionalDate, purchase_price: optionalMoney}).safeParse(Object.fromEntries(data));
  if (!parsed.success) return {ok:false,error:"Verifique a data e o preço de aquisição."};
  const db = await createClient();
  const {error} = await db.from("vehicle_financials").upsert({...parsed.data, updated_at: new Date().toISOString()});
  refresh(); return result(error);
}
/**
 * Valor/hora só para esta viatura. Se a caixa "alterar" vier desligada, grava
 * NULL — e a viatura volta a usar o valor por defeito de Custos e margens.
 */
export async function saveVehicleRate(data: FormData) {
  await requireSection("financeiro");
  const parsed = z.object({
    car_id: uuid,
    override: z.union([z.literal("on"), z.literal("")]).optional(),
    hourly_rate_override: z.union([z.string(), z.literal("")]).optional(),
  }).safeParse(Object.fromEntries(data));
  if (!parsed.success) return {ok:false,error:"Verifique o valor por hora."};

  let value: number | null = null;
  if (parsed.data.override === "on") {
    // Campo vazio não é 0 €/h: sem isto a margem ficava sem mão de obra sem ninguém reparar.
    if (!String(parsed.data.hourly_rate_override ?? "").trim()) return {ok:false,error:"Indique o valor por hora."};
    const n = Number(parsed.data.hourly_rate_override);
    if (!Number.isFinite(n) || n < 0 || n > 1000) {
      return {ok:false,error:"Indique um valor por hora entre 0 e 1000 €."};
    }
    value = Math.round(n * 100) / 100;
  }

  const db = await createClient();
  const {error} = await db.from("vehicle_financials").upsert({
    car_id: parsed.data.car_id, hourly_rate_override: value,
    updated_at: new Date().toISOString(),
  });
  refresh(); return result(error);
}
export async function addVehicleCost(data: FormData) {
  const me = await requireSection("financeiro");
  const parsed = z.object({car_id: uuid, category: z.enum(["transport","parts","labour","preparation","other"]), description: z.string().trim().min(1).max(500), amount: z.coerce.number().positive().max(9999999999), incurred_on: z.string().date()}).safeParse(Object.fromEntries(data));
  if (!parsed.success) return {ok:false,error:"Preencha a descrição, data e um custo positivo."};
  const db = await createClient();
  const {error} = await db.from("vehicle_costs").insert({...parsed.data,created_by:me.id});
  refresh(); return result(error);
}
export async function deleteVehicleCost(data: FormData) {
  await requireSection("financeiro");
  const id = uuid.safeParse(data.get("id")); if (!id.success) return {ok:false,error:"Registo inválido"};
  const db = await createClient();
  const {error} = await db.from("vehicle_costs").delete().eq("id",id.data).select("id").single();
  refresh(); return result(error);
}
export async function savePreparationTask(data: FormData) {
  const db = await createClient();
  const {data: allowed} = await db.rpc("has_section", {section:"oficina"});
  if (!allowed) await requireSection("carros");
  const parsed = z.object({id: optionalId, car_id:uuid, title:z.string().trim().min(1).max(200), stage:z.enum(["preparation","delivery"]), status:z.enum(["pending","in_progress","waiting_parts","done"]), assigned_to:optionalId, parts:z.string().max(1000), due_on:optionalDate}).safeParse(Object.fromEntries(data));
  if (!parsed.success) return {ok:false,error:"Verifique os campos da tarefa."};
  const {id, ...v} = parsed.data;
  const query = id ? db.from("preparation_tasks").update({...v,updated_at:new Date().toISOString()}).eq("id",id).eq("car_id",v.car_id) : db.from("preparation_tasks").insert(v);
  const {error} = await query.select("id").single(); refresh(); return result(error);
}
export async function finishWorklog(data: FormData) {
  await requireSection("oficina");
  const parsed = z.object({id:uuid,end_time:z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),overnight:z.coerce.boolean().default(false)}).safeParse({...Object.fromEntries(data),overnight:data.get("overnight")==="on"});
  if (!parsed.success) return {ok:false,error:"Hora inválida"};
  const db = await createClient();
  // As horas TÊM de ser recalculadas aqui: antes só se gravava o fim, e o
  // turno fechado ficava a 0 h — a mão de obra dessa viatura nunca entrava nos
  // custos.
  const {data:registo} = await db.from("vehicle_tasks").select("start_time").eq("id",parsed.data.id).is("end_time",null).maybeSingle();
  if (!registo) return {ok:false,error:"Registo não encontrado ou já fechado."};
  const duracao = worklogHours(String(registo.start_time).slice(0,5),parsed.data.end_time,parsed.data.overnight);
  if ("error" in duracao) return {ok:false,error:duracao.error};
  const {error} = await db.from("vehicle_tasks").update({end_time:parsed.data.end_time,hours:duracao.hours}).eq("id",parsed.data.id).is("end_time",null).select("id").single();
  refresh(); return result(error);
}
export async function reserveVehicle(data: FormData) {
  await requireSection("leads"); await requireSection("carros");
  const parsed = z.object({lead:uuid,expiry:z.string().min(1),deposit:z.coerce.number().min(0).max(9999999999)}).safeParse(Object.fromEntries(data));
  if (!parsed.success || !Number.isFinite(Date.parse(parsed.data.expiry))) return {ok:false,error:"Verifique o prazo e o sinal."};
  const db = await createClient();
  const {error} = await db.rpc("reserve_vehicle", {...parsed.data,expiry:new Date(parsed.data.expiry).toISOString()});
  // Os outros vendedores deixam de oferecer a viatura (aviso agendado pela base de dados).
  if (!error) deliverNotificationsSoon();
  refresh(); return result(error);
}
export async function releaseReservation(data: FormData) {
  await requireSection("leads"); await requireSection("carros");
  const id = uuid.safeParse(data.get("id")); if (!id.success) return {ok:false,error:"Reserva inválida"};
  const db = await createClient(); const {error} = await db.rpc("release_reservation",{reservation_id:id.data});
  // A viatura volta a estar disponível: quem vende fica a saber (0041).
  if (!error) deliverNotificationsSoon();
  refresh(); return result(error);
}
export async function confirmDeposit(data: FormData) {
  await requireSection("leads");
  const id = uuid.safeParse(data.get("id")); if (!id.success) return {ok:false,error:"Reserva inválida"};
  const db = await createClient(); const {error} = await db.rpc("confirm_reservation_deposit",{reservation_id:id.data}); refresh(); return result(error);
}
export async function closeSale(data: FormData) {
  await requireSection("leads"); await requireSection("carros"); await requireSection("financeiro");
  const parsed = z.object({lead:uuid,amount:z.coerce.number().positive().max(9999999999),sale_date:z.string().date()}).safeParse(Object.fromEntries(data));
  if (!parsed.success) return {ok:false,error:"Verifique o preço de venda e a data."};
  const db = await createClient(); const {error} = await db.rpc("close_vehicle_sale",parsed.data);
  // Viatura vendida e contacto ganho (0041).
  if (!error) deliverNotificationsSoon();
  refresh(); return result(error);
}

export async function retryNotifications() {
  const me = await requireSection("integracoes");
  if(me.role!=="admin")return {ok:false,error:"Apenas administradores."};
  const { processNotificationJobs }=await import("@/lib/notifications");
  const res=await processNotificationJobs();refresh();return res;
}
export async function expireReservationsNow() {
  const me = await requireSection("integracoes");
  if(me.role!=="admin")return {ok:false,error:"Apenas administradores."};
  const {createAdminClient}=await import("@/lib/supabase/admin");
  const db=createAdminClient();if(!db)return {ok:false,error:"Chave de administração não configurada."};
  const {error}=await db.rpc("expire_reservations");
  // Reservas expiradas: a viatura volta a estar disponível (0041).
  if(!error)deliverNotificationsSoon();
  refresh();return result(error);
}

export async function saveLeadNotesForm(data: FormData) {
  await requireSection("leads");
  const parsed=z.object({id:uuid,notes:z.string().max(5000)}).safeParse(Object.fromEntries(data));
  if(!parsed.success)return {ok:false,error:"Notas inválidas."};
  const db=await createClient();
  const {error}=await db.from("leads").update({notes:parsed.data.notes||null}).eq("id",parsed.data.id).select("id").single();
  refresh();return result(error);
}
export async function requeueNotification(data: FormData) {
  const me=await requireSection("integracoes");
  const id=uuid.safeParse(data.get("id"));
  if(me.role!=="admin"||!id.success)return {ok:false,error:"Sem permissão."};
  const {createAdminClient}=await import("@/lib/supabase/admin");
  const db=createAdminClient();if(!db)return {ok:false,error:"Chave de administração não configurada."};
  const {error}=await db.from("notification_jobs").update({attempts:0,next_attempt_at:new Date().toISOString(),last_error:null}).eq("id",id.data).is("delivered_at",null).select("id").single();
  refresh();return result(error);
}
