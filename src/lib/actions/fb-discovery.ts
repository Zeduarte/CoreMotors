"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/guard";
import { cleanFoundGroups, cleanKeywords, isValidTime, JOIN_COUNTED, JOIN_DAILY_LIMIT } from "@/lib/fb-discovery";
import { SHARE_DAILY_LIMIT } from "@/lib/fb-shares";
import type { FbJoinStatus } from "@/lib/supabase/database.types";

export interface DiscoveryResult {
  ok: boolean;
  error?: string;
  id?: string;
  /** Adesões que ainda se podem fazer hoje nesta conta. */
  remaining?: number;
}

const PATH = "/admin/partilhas";
const uuid = z.string().uuid();

function dbError(where: string, message: string, fallback: string): DiscoveryResult {
  console.error(`${where}:`, message);
  if (/fb_categories|fb_group_joins|fb_schedules|does not exist|schema cache/i.test(message))
    return { ok: false, error: "Falta aplicar a migração 0056 no Supabase." };
  if (/fb_categories_profile_name_idx|duplicate key/i.test(message)) return { ok: false, error: "Já tem uma categoria com esse nome." };
  return { ok: false, error: fallback };
}

// ---------------------------------------------------------------------------
// Categorias
// ---------------------------------------------------------------------------

/** Cria (sem `id`) ou altera uma categoria com as suas palavras-chave. */
export async function saveCategory(input: { id?: string | null; name: string; keywords: string }): Promise<DiscoveryResult> {
  await requireSection("partilhas");
  const name = String(input.name ?? "").replace(/\s+/g, " ").trim();
  if (!name || name.length > 60) return { ok: false, error: "Dê um nome à categoria (até 60 caracteres)." };
  const keywords = cleanKeywords(String(input.keywords ?? ""));
  if (!keywords.length) return { ok: false, error: "Escreva pelo menos uma palavra-chave (ex.: carros, automóveis)." };
  const supabase = await createClient();
  if (input.id) {
    if (!uuid.safeParse(input.id).success) return { ok: false, error: "Categoria inválida." };
    const { data, error } = await supabase.from("fb_categories").update({ name, keywords }).eq("id", input.id).select("id");
    if (error) return dbError("saveCategory update", error.message, "Não foi possível gravar a categoria.");
    if (!data.length) return { ok: false, error: "Categoria não encontrada." };
    revalidatePath(PATH);
    return { ok: true, id: input.id };
  }
  const { data, error } = await supabase.from("fb_categories").insert({ name, keywords }).select("id").single();
  if (error) return dbError("saveCategory insert", error.message, "Não foi possível criar a categoria.");
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

export async function deleteCategory(id: string): Promise<DiscoveryResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Categoria inválida." };
  const supabase = await createClient();
  const { error } = await supabase.from("fb_categories").delete().eq("id", id);
  if (error) return dbError("deleteCategory", error.message, "Não foi possível apagar a categoria.");
  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Adesões
// ---------------------------------------------------------------------------

/**
 * Quantas adesões ainda se podem fazer nesta conta nas próximas 24 horas,
 * contadas na base de dados (vale mesmo com a página aberta em dois sítios).
 */
export async function joinQuota(accountId: string): Promise<DiscoveryResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(accountId).success) return { ok: false, error: "Conta inválida." };
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count, error } = await supabase
    .from("fb_group_joins")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .in("status", [...JOIN_COUNTED])
    .gt("created_at", since);
  if (error) return dbError("joinQuota", error.message, "Não foi possível ler o limite diário.");
  return { ok: true, remaining: Math.max(0, JOIN_DAILY_LIMIT - (count ?? 0)) };
}

/**
 * Uma conta nova do Facebook ainda não está em grupos nenhuns, por isso não se
 * associa pela leitura dos grupos: associa-se na primeira pesquisa. Só se a
 * conta do separador ainda não estiver associada a outra.
 */
export async function bindAccountIfNew(accountId: string, fbUserId: string): Promise<DiscoveryResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(accountId).success) return { ok: false, error: "Conta inválida." };
  if (!/^[0-9]{1,30}$/.test(fbUserId)) return { ok: false, error: "Conta do Facebook inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fb_accounts").select("fb_user_id").eq("id", accountId).maybeSingle();
  if (error) return dbError("bindAccountIfNew", error.message, "Não foi possível ler a conta.");
  if (!data) return { ok: false, error: "Conta não encontrada." };
  if (data.fb_user_id && data.fb_user_id !== fbUserId)
    return { ok: false, error: "O Chrome está ligado a outra conta do Facebook. Troque de conta ou escolha o separador certo." };
  if (!data.fb_user_id) {
    const { error: upError } = await supabase.from("fb_accounts").update({ fb_user_id: fbUserId }).eq("id", accountId);
    if (upError) return dbError("bindAccountIfNew update", upError.message, "Não foi possível associar a conta.");
    revalidatePath(PATH);
  }
  return { ok: true };
}

const JOIN_STATUSES: readonly FbJoinStatus[] = ["joined", "requested", "questions", "member", "limited", "failed"];

/**
 * Grava o resultado de um pedido de adesão. Quem entrou logo (grupo público)
 * vai também para a lista de grupos da conta, para já poder receber partilhas.
 */
export async function recordGroupJoin(input: {
  accountId: string;
  categoryId: string | null;
  group: unknown;
  keyword: string | null;
  status: FbJoinStatus;
  reason: string;
}): Promise<DiscoveryResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(input.accountId).success) return { ok: false, error: "Conta inválida." };
  if (input.categoryId !== null && !uuid.safeParse(input.categoryId).success) return { ok: false, error: "Categoria inválida." };
  if (!JOIN_STATUSES.includes(input.status)) return { ok: false, error: "Resultado inválido." };
  const [group] = cleanFoundGroups([input.group]);
  if (!group) return { ok: false, error: "Grupo inválido." };
  const supabase = await createClient();
  const { error } = await supabase.from("fb_group_joins").insert({
    account_id: input.accountId,
    category_id: input.categoryId,
    group_key: group.key,
    name: group.name,
    url: group.url,
    keyword: input.keyword ? String(input.keyword).slice(0, 60) : null,
    privacy: group.privacy,
    status: input.status,
    reason: String(input.reason ?? "").slice(0, 1000) || null,
  });
  if (error) return dbError("recordGroupJoin", error.message, "Não foi possível gravar no histórico.");

  if (input.status === "joined" || input.status === "member") {
    const { data: existing } = await supabase.from("fb_groups").select("group_key, position").eq("account_id", input.accountId);
    if (existing && !existing.some((g) => g.group_key === group.key)) {
      const last = Math.max(0, ...existing.map((g) => g.position ?? 0));
      const { error: gError } = await supabase
        .from("fb_groups")
        .insert({ account_id: input.accountId, group_key: group.key, name: group.name, url: group.url, position: last + 1 });
      if (gError) console.error("recordGroupJoin fb_groups:", gError.message);
    }
  }
  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Horários automáticos
// ---------------------------------------------------------------------------

const scheduleSchema = z
  .object({
    accountId: uuid,
    kind: z.enum(["join", "share"]),
    categoryId: uuid.nullable(),
    adId: uuid.nullable(),
    count: z.coerce.number().int().min(1).max(100),
    weekdays: z.array(z.coerce.number().int().min(0).max(6)).min(1, "Escolha pelo menos um dia").max(7),
    atTime: z.string().refine(isValidTime, "Hora inválida (HH:MM)"),
  })
  .refine((s) => s.kind === "share" || s.categoryId !== null, { message: "Escolha a categoria a procurar." })
  .refine((s) => s.kind === "join" || s.adId !== null, { message: "Escolha o anúncio a partilhar." })
  .refine((s) => s.kind === "share" || s.count <= JOIN_DAILY_LIMIT, {
    message: `No máximo ${JOIN_DAILY_LIMIT} grupos por dia em cada conta (para o Facebook não bloquear as adesões).`,
  })
  .refine((s) => s.kind === "join" || s.count <= SHARE_DAILY_LIMIT, {
    message: `No máximo ${SHARE_DAILY_LIMIT} partilhas em grupos por dia em cada conta.`,
  });

export async function createSchedule(input: z.input<typeof scheduleSchema>): Promise<DiscoveryResult> {
  await requireSection("partilhas");
  const parsed = scheduleSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Horário inválido." };
  const s = parsed.data;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("fb_schedules")
    .insert({
      account_id: s.accountId,
      kind: s.kind,
      category_id: s.categoryId,
      ad_id: s.kind === "share" ? s.adId : null,
      count: s.count,
      weekdays: [...new Set(s.weekdays)].sort(),
      at_time: s.atTime,
    })
    .select("id")
    .single();
  if (error) return dbError("createSchedule", error.message, "Não foi possível criar o horário.");
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

export async function setScheduleEnabled(id: string, enabled: boolean): Promise<DiscoveryResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Horário inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fb_schedules").update({ enabled: !!enabled }).eq("id", id).select("id");
  if (error) return dbError("setScheduleEnabled", error.message, "Não foi possível gravar.");
  if (!data.length) return { ok: false, error: "Horário não encontrado." };
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteSchedule(id: string): Promise<DiscoveryResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Horário inválido." };
  const supabase = await createClient();
  const { error } = await supabase.from("fb_schedules").delete().eq("id", id);
  if (error) return dbError("deleteSchedule", error.message, "Não foi possível apagar.");
  revalidatePath(PATH);
  return { ok: true };
}

/** Marca que um horário correu agora (a página que o executou chama no fim). */
export async function markScheduleRun(id: string): Promise<DiscoveryResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Horário inválido." };
  const supabase = await createClient();
  const { error } = await supabase.from("fb_schedules").update({ last_run_at: new Date().toISOString() }).eq("id", id);
  if (error) return dbError("markScheduleRun", error.message, "Não foi possível gravar.");
  revalidatePath(PATH);
  return { ok: true };
}
