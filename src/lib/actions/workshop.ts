"use server";

import { getAdminVehicleType } from "@/lib/vehicle-context";
import { revalidatePublic } from "@/lib/public-cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/guard";
import { worklogHours } from "@/lib/operations";
import { getCurrentProfile } from "@/lib/admin-queries";
import { canAccess } from "@/lib/permissions";

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const logSchema = z.object({
  car_id: z.string().uuid(),
  work_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
  start_time: z.string().regex(HHMM, "Hora de início inválida"),
  end_time: z.string().regex(HHMM, "Hora de fim inválida").optional().or(z.literal("")),
  description: z.string().trim().max(2000).optional().or(z.literal("")),
  /** Marcado quando o trabalho passou da meia-noite. */
  overnight: z.boolean().default(false),
});

/** Cria um registo de horas para uma viatura. */
export async function createWorklog(formData: FormData): Promise<ActionResult> {
  const profile = await requireSection("oficina");
  const parsed = logSchema.safeParse({
    car_id: formData.get("car_id"),
    work_date: formData.get("work_date"),
    start_time: formData.get("start_time"),
    end_time: formData.get("end_time") ?? "",
    description: formData.get("description") ?? "",
    overnight: formData.get("overnight") === "on",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const v = parsed.data;

  const duracao = worklogHours(v.start_time, v.end_time || "", v.overnight);
  if ("error" in duracao) return { ok: false, error: duracao.error };
  const hours = duracao.hours;

  const supabase = await createClient();
  const { error } = await supabase.from("vehicle_tasks").insert({
    car_id: v.car_id,
    work_date: v.work_date,
    start_time: v.start_time,
    end_time: v.end_time || null,
    description: v.description || null,
    hours,
    created_by: profile.id,
  });
  if (error) {
    console.error("createWorklog:", error.message);
    return {
      ok: false,
      error:
        error.message.includes("vehicle_tasks") ||
        error.message.includes("does not exist") ||
        error.message.includes("column")
          ? "A tabela de registos ainda não está atualizada. Aplique a migração 0012 no Supabase."
          : `Não foi possível registar: ${error.message}`,
    };
  }
  revalidatePublic(`/admin/oficina/${v.car_id}`);
  revalidatePublic("/admin/oficina");
  return { ok: true };
}

/** Apaga um registo de horas. */
export async function deleteWorklog(id: string): Promise<ActionResult> {
  await requireSection("oficina");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_tasks")
    .delete()
    .eq("id", id)
    .select("car_id")
    .maybeSingle();
  if (error) return { ok: false, error: "Erro ao apagar." };
  if (data?.car_id) revalidatePublic(`/admin/oficina/${data.car_id}`);
  return { ok: true };
}

/**
 * Custos lançados pela oficina (peças/material). Vão para a mesma tabela dos
 * custos, por isso aparecem logo em Custos e margens. O mecânico só pode as
 * categorias de material — nunca mão de obra (essa vem das horas).
 */
const workshopCostSchema = z.object({
  car_id: z.string().uuid(),
  category: z.enum(["parts", "other"]).default("parts"),
  description: z.string().trim().min(1, "Descreva o material").max(500),
  amount: z.coerce.number().positive("Indique um valor maior que zero").max(9999999),
  incurred_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida"),
});

export async function addWorkshopCost(formData: FormData): Promise<ActionResult> {
  const profile = await requireSection("oficina");
  const parsed = workshopCostSchema.safeParse({
    car_id: formData.get("car_id"),
    category: formData.get("category") || "parts",
    description: formData.get("description"),
    amount: formData.get("amount"),
    incurred_on: formData.get("incurred_on"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("vehicle_costs")
    .insert({ ...parsed.data, created_by: profile.id });
  if (error) {
    const hint = /row-level security|permission/i.test(error.message)
      ? "Sem permissão para registar custos. Aplique a migração 0017 no Supabase."
      : `Não foi possível registar: ${error.message}`;
    return { ok: false, error: hint };
  }
  revalidatePublic(`/admin/oficina/${parsed.data.car_id}`);
  revalidatePublic(`/admin/financeiro/${parsed.data.car_id}`);
  revalidatePublic("/admin/financeiro");
  return { ok: true };
}

/** Apaga um custo lançado pela oficina (a RLS só deixa apagar os próprios). */
export async function deleteWorkshopCost(id: string): Promise<ActionResult> {
  await requireSection("oficina");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("vehicle_costs")
    .delete()
    .eq("id", id)
    .select("car_id")
    .maybeSingle();
  if (error) return { ok: false, error: "Não foi possível apagar." };
  if (!data) return { ok: false, error: "Só pode apagar custos que você registou." };
  revalidatePublic(`/admin/oficina/${data.car_id}`);
  revalidatePublic("/admin/financeiro");
  return { ok: true };
}

const newVehicleSchema = z.object({
  name: z.string().trim().min(1, "Indique o nome/viatura").max(120),
  plate: z.string().trim().min(2, "Indique a matrícula").max(20),
});

/**
 * O mecânico cria uma viatura mínima (só nome + matrícula). Os restantes campos
 * obrigatórios recebem valores por defeito; fica "Na oficina" (só aparece na
 * Oficina) até ser dada como preparada.
 */
export async function createWorkshopVehicle(
  formData: FormData,
): Promise<ActionResult> {
  await requireSection("oficina");
  const parsed = newVehicleSchema.safeParse({
    name: formData.get("name"),
    plate: formData.get("plate"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("create_workshop_intake_for_type", {
    selected_type: await getAdminVehicleType(),
    vehicle_name: parsed.data.name,
    plate: parsed.data.plate.toUpperCase().replace(/\s+/g, ""),
  });
  if (error || !data) return { ok: false, error: "Não foi possível criar a viatura." };
  revalidatePublic("/admin/oficina");
  return { ok: true, id: data };
}

/**
 * Oficina → Preparado: a viatura sai da oficina e passa a aparecer em
 * Viaturas, para o vendedor completar a ficha e publicar.
 */
export async function markVehiclePrepared(id: string): Promise<ActionResult> {
  await requireSection("oficina");
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Viatura inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_vehicle_prepared", { vehicle: id });
  if (error) return { ok: false, error: rpcMessage(error.message, "Não foi possível dar a viatura como preparada.") };
  revalidateVehicle(id);
  return { ok: true };
}

/** Preparado (ou rascunho) → volta para a oficina e sai de Viaturas. */
export async function returnVehicleToWorkshop(id: string): Promise<ActionResult> {
  const profile = await getCurrentProfile();
  if (!profile) return { ok: false, error: "Sem sessão." };
  if (!canAccess(profile.role, profile.allowed_sections, "oficina") && !canAccess(profile.role, profile.allowed_sections, "carros"))
    return { ok: false, error: "Sem permissão." };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Viatura inválida." };
  const supabase = await createClient();
  const { error } = await supabase.rpc("return_vehicle_to_workshop", { vehicle: id });
  if (error) return { ok: false, error: rpcMessage(error.message, "Não foi possível devolver a viatura à oficina.") };
  revalidateVehicle(id);
  return { ok: true };
}

/** As mensagens das funções da BD já estão em português; o resto não se mostra. */
function rpcMessage(message: string, fallback: string): string {
  return /oficina|preparada|rascunho|permissão|não encontrada/i.test(message) ? message : fallback;
}

function revalidateVehicle(id: string) {
  revalidatePublic("/admin/oficina");
  revalidatePublic(`/admin/oficina/${id}`);
  revalidatePublic("/admin/carros");
  revalidatePublic(`/admin/carros/${id}`);
}
