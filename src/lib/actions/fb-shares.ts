"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireSection } from "@/lib/guard";
import {
  cleanScannedGroups,
  isFacebookUrl,
  isFbUserId,
  manualGroupKey,
  normalizeName,
  parseManualGroups,
  SHARE_COUNTED,
  SHARE_DAILY_LIMIT,
} from "@/lib/fb-shares";
import type { FbShareStatus } from "@/lib/supabase/database.types";

export interface SharesResult {
  ok: boolean;
  error?: string;
  /** O id criado (conta ou anúncio). */
  id?: string;
  /** Quantos grupos ficaram na lista / quantos são novos. */
  count?: number;
  added?: number;
}

const PATH = "/admin/partilhas";
const uuid = z.string().uuid();

function dbError(where: string, message: string, fallback: string): SharesResult {
  console.error(`${where}:`, message);
  if (/fb_accounts|fb_groups|fb_share|does not exist|schema cache/i.test(message))
    return { ok: false, error: "Falta aplicar a migração 0052 no Supabase." };
  if (/fb_accounts_profile_name_idx|duplicate key/i.test(message))
    return { ok: false, error: "Já tem uma conta com esse nome." };
  return { ok: false, error: fallback };
}

const accountName = z.string().trim().min(1, "Dê um nome à conta").max(80, "Nome demasiado longo");

// ---------------------------------------------------------------------------
// Contas do Facebook
// ---------------------------------------------------------------------------

/** Cria uma conta (um separador de grupos) com o nome que o utilizador escolher. */
export async function createFbAccount(name: string): Promise<SharesResult> {
  await requireSection("partilhas");
  const parsed = accountName.safeParse(name);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fb_accounts").insert({ name: parsed.data }).select("id").single();
  if (error) return dbError("createFbAccount", error.message, "Não foi possível criar a conta.");
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

export async function renameFbAccount(id: string, name: string): Promise<SharesResult> {
  await requireSection("partilhas");
  const parsed = accountName.safeParse(name);
  if (!uuid.safeParse(id).success) return { ok: false, error: "Conta inválida." };
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fb_accounts").update({ name: parsed.data }).eq("id", id).select("id");
  if (error) return dbError("renameFbAccount", error.message, "Não foi possível mudar o nome.");
  if (!data.length) return { ok: false, error: "Conta não encontrada." };
  revalidatePath(PATH);
  return { ok: true };
}

/** Apaga a conta, os grupos dela e o histórico dessas partilhas. */
export async function deleteFbAccount(id: string): Promise<SharesResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Conta inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fb_accounts").delete().eq("id", id).select("id");
  if (error) return dbError("deleteFbAccount", error.message, "Não foi possível apagar a conta.");
  if (!data.length) return { ok: false, error: "Conta não encontrada." };
  revalidatePath(PATH);
  return { ok: true };
}

/** Esquece a conta do Facebook associada (para a voltar a associar na próxima leitura). */
export async function unbindFbAccount(id: string): Promise<SharesResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Conta inválida." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fb_accounts").update({ fb_user_id: null }).eq("id", id).select("id");
  if (error) return dbError("unbindFbAccount", error.message, "Não foi possível desassociar.");
  if (!data.length) return { ok: false, error: "Conta não encontrada." };
  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Grupos
// ---------------------------------------------------------------------------

/**
 * Grava a lista de grupos lida no Facebook pela extensão: atualiza nomes e a
 * ordem, acrescenta os novos e tira da fila os que deixaram de aparecer (sem
 * apagar o histórico). A escolha «incluir/excluir» de cada grupo mantém-se.
 * Na primeira leitura a conta fica associada à conta do Facebook do Chrome.
 */
export async function saveScannedGroups(accountId: string, fbUserId: string, input: unknown): Promise<SharesResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(accountId).success) return { ok: false, error: "Conta inválida." };
  if (!isFbUserId(fbUserId)) return { ok: false, error: "Não foi possível saber que conta do Facebook está aberta no Chrome." };
  const scanned = cleanScannedGroups(input);
  if (!scanned.length) return { ok: false, error: "A extensão não encontrou grupos. Nada foi alterado." };

  const supabase = await createClient();
  const { data: account, error: accError } = await supabase
    .from("fb_accounts")
    .select("id, fb_user_id")
    .eq("id", accountId)
    .maybeSingle();
  if (accError) return dbError("saveScannedGroups account", accError.message, "Não foi possível ler a conta.");
  if (!account) return { ok: false, error: "Conta não encontrada." };
  if (account.fb_user_id && account.fb_user_id !== fbUserId)
    return {
      ok: false,
      error: "O Chrome está ligado a outra conta do Facebook. Troque de conta no Facebook ou escolha o separador certo.",
    };

  const { data: existing, error: exError } = await supabase
    .from("fb_groups")
    .select("id, group_key, name, position")
    .eq("account_id", accountId);
  if (exError) return dbError("saveScannedGroups groups", exError.message, "Não foi possível ler os grupos.");

  // Um grupo acrescentado à mão (chave «nome:…») passa a ter a chave verdadeira
  // quando aparece na leitura com o mesmo nome: mantém o histórico e a escolha.
  const byKey = new Map(existing.map((g) => [g.group_key, g]));
  for (const g of scanned) {
    if (byKey.has(g.key)) continue;
    const manual = byKey.get(manualGroupKey(g.name));
    if (!manual) continue;
    const { error } = await supabase.from("fb_groups").update({ group_key: g.key }).eq("id", manual.id);
    if (error) return dbError("saveScannedGroups adopt", error.message, "Não foi possível gravar os grupos.");
    byKey.delete(manual.group_key);
    byKey.set(g.key, { ...manual, group_key: g.key });
  }

  const added = scanned.filter((g) => !byKey.has(g.key)).length;
  const { error: upError } = await supabase.from("fb_groups").upsert(
    scanned.map((g, i) => ({ account_id: accountId, group_key: g.key, name: g.name, url: g.url, position: i + 1 })),
    { onConflict: "account_id,group_key" },
  );
  if (upError) return dbError("saveScannedGroups upsert", upError.message, "Não foi possível gravar os grupos.");

  const seen = new Set(scanned.map((g) => g.key));
  const gone = [...byKey.values()].filter((g) => !seen.has(g.group_key) && g.position !== null).map((g) => g.id);
  if (gone.length) {
    const { error } = await supabase.from("fb_groups").update({ position: null }).in("id", gone);
    if (error) return dbError("saveScannedGroups gone", error.message, "Não foi possível gravar os grupos.");
  }

  const { error: bindError } = await supabase
    .from("fb_accounts")
    .update({ fb_user_id: fbUserId, groups_read_at: new Date().toISOString() })
    .eq("id", accountId);
  if (bindError) return dbError("saveScannedGroups bind", bindError.message, "Não foi possível gravar a conta.");

  revalidatePath(PATH);
  return { ok: true, count: scanned.length, added };
}

/** Acrescenta grupos à mão (um nome ou endereço por linha), no fim da lista. */
export async function addManualGroups(accountId: string, text: string): Promise<SharesResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(accountId).success) return { ok: false, error: "Conta inválida." };
  const groups = parseManualGroups(text);
  if (!groups.length) return { ok: false, error: "Escreva um grupo por linha." };
  const supabase = await createClient();
  const { data: existing, error } = await supabase.from("fb_groups").select("group_key, name, position").eq("account_id", accountId);
  if (error) return dbError("addManualGroups", error.message, "Não foi possível ler os grupos.");
  const keys = new Set(existing.map((g) => g.group_key));
  const names = new Set(existing.map((g) => normalizeName(g.name)));
  const fresh = groups.filter((g) => !keys.has(g.key) && !names.has(normalizeName(g.name)));
  if (!fresh.length) return { ok: true, added: 0 };
  let last = Math.max(0, ...existing.map((g) => g.position ?? 0));
  const { error: insError } = await supabase
    .from("fb_groups")
    .insert(fresh.map((g) => ({ account_id: accountId, group_key: g.key, name: g.name, url: g.url, position: ++last })));
  if (insError) return dbError("addManualGroups insert", insError.message, "Não foi possível acrescentar os grupos.");
  revalidatePath(PATH);
  return { ok: true, added: fresh.length };
}

/** «auto» = pela sugestão do nome; «sim»/«nao» = escolha do utilizador. */
export async function setGroupInclude(groupId: string, choice: "auto" | "sim" | "nao"): Promise<SharesResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(groupId).success) return { ok: false, error: "Grupo inválido." };
  if (!["auto", "sim", "nao"].includes(choice)) return { ok: false, error: "Escolha inválida." };
  const supabase = await createClient();
  const include = choice === "auto" ? null : choice === "sim";
  const { data, error } = await supabase.from("fb_groups").update({ include }).eq("id", groupId).select("id");
  if (error) return dbError("setGroupInclude", error.message, "Não foi possível gravar.");
  if (!data.length) return { ok: false, error: "Grupo não encontrado." };
  revalidatePath(PATH);
  return { ok: true };
}

/** A mesma escolha para vários grupos de uma vez (ex.: todos os «Motas» filtrados). */
export async function setGroupsInclude(groupIds: string[], choice: "auto" | "sim" | "nao"): Promise<SharesResult> {
  await requireSection("partilhas");
  const ids = z.array(uuid).min(1).max(2000).safeParse(groupIds);
  if (!ids.success) return { ok: false, error: "Grupos inválidos." };
  if (!["auto", "sim", "nao"].includes(choice)) return { ok: false, error: "Escolha inválida." };
  const supabase = await createClient();
  const include = choice === "auto" ? null : choice === "sim";
  const { data, error } = await supabase.from("fb_groups").update({ include }).in("id", ids.data).select("id");
  if (error) return dbError("setGroupsInclude", error.message, "Não foi possível gravar.");
  revalidatePath(PATH);
  return { ok: true, count: data.length };
}

// ---------------------------------------------------------------------------
// Anúncios
// ---------------------------------------------------------------------------

const adSchema = z.object({
  title: z.string().trim().min(1, "Dê um título ao anúncio").max(160, "Título demasiado longo"),
  url: z
    .string()
    .trim()
    .max(500, "Link demasiado longo")
    .refine(isFacebookUrl, "Cole o link do anúncio no Facebook (https://www.facebook.com/marketplace/item/…)"),
  price: z
    .string()
    .trim()
    .transform((v) => (v ? Number(v.replace(/\s/g, "").replace(",", ".")) : null))
    .refine((v) => v === null || (Number.isFinite(v) && v >= 0 && v < 1e10), "Preço inválido"),
  vehicle_type: z.enum(["car", "motorcycle"]),
  car_id: z.string().uuid().nullable(),
});

export async function createShareAd(formData: FormData): Promise<SharesResult> {
  await requireSection("partilhas");
  const parsed = adSchema.safeParse({
    title: formData.get("title") ?? "",
    url: formData.get("url") ?? "",
    price: formData.get("price") ?? "",
    vehicle_type: formData.get("vehicle_type") || "car",
    car_id: formData.get("car_id") || null,
  });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fb_share_ads").insert(parsed.data).select("id").single();
  if (error) return dbError("createShareAd", error.message, "Não foi possível guardar o anúncio.");
  revalidatePath(PATH);
  return { ok: true, id: data.id };
}

/** Tira o anúncio da lista (o histórico fica). */
export async function archiveShareAd(id: string): Promise<SharesResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(id).success) return { ok: false, error: "Anúncio inválido." };
  const supabase = await createClient();
  const { data, error } = await supabase.from("fb_share_ads").update({ archived: true }).eq("id", id).select("id");
  if (error) return dbError("archiveShareAd", error.message, "Não foi possível arquivar.");
  if (!data.length) return { ok: false, error: "Anúncio não encontrado." };
  revalidatePath(PATH);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Histórico
// ---------------------------------------------------------------------------

const RECORDABLE: FbShareStatus[] = ["confirmed", "pending", "uncertain", "rate_limited", "failed"];

const attemptSchema = z.object({
  accountId: z.string().uuid(),
  groupId: z.string().uuid(),
  adId: z.string().uuid(),
  status: z.enum(["confirmed", "pending", "uncertain", "rate_limited", "failed"]),
  reason: z
    .string()
    .trim()
    .max(5000)
    .transform((v) => v.slice(0, 1000) || null),
});

/**
 * Quantas partilhas ainda se podem fazer nesta conta nas próximas 24 horas
 * (máximo SHARE_DAILY_LIMIT), contadas na base de dados.
 */
export async function shareQuota(accountId: string): Promise<SharesResult> {
  await requireSection("partilhas");
  if (!uuid.safeParse(accountId).success) return { ok: false, error: "Conta inválida." };
  const supabase = await createClient();
  const since = new Date(Date.now() - 24 * 3600_000).toISOString();
  const { count, error } = await supabase
    .from("fb_share_attempts")
    .select("id", { count: "exact", head: true })
    .eq("account_id", accountId)
    .in("status", [...SHARE_COUNTED])
    .gt("created_at", since);
  if (error) return dbError("shareQuota", error.message, "Não foi possível ler o limite diário.");
  return { ok: true, count: Math.max(0, SHARE_DAILY_LIMIT - (count ?? 0)) };
}

/** Grava o resultado de uma tentativa (o que a extensão disse). */
export async function recordShareAttempt(input: {
  accountId: string;
  groupId: string;
  adId: string;
  status: FbShareStatus;
  reason: string;
}): Promise<SharesResult> {
  await requireSection("partilhas");
  const parsed = attemptSchema.safeParse(input);
  if (!parsed.success || !RECORDABLE.includes(parsed.data.status)) return { ok: false, error: "Resultado inválido." };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("fb_share_attempts")
    .insert({ account_id: v.accountId, group_id: v.groupId, ad_id: v.adId, status: v.status, reason: v.reason });
  if (error) return dbError("recordShareAttempt", error.message, "Não foi possível gravar o resultado.");
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Desbloqueia um grupo para este anúncio (depois de verificar no Facebook que
 * a partilha não ficou feita). Fica no histórico.
 */
export async function resetShareGroup(input: { accountId: string; groupId: string; adId: string }): Promise<SharesResult> {
  await requireSection("partilhas");
  const parsed = attemptSchema.pick({ accountId: true, groupId: true, adId: true }).safeParse(input);
  if (!parsed.success) return { ok: false, error: "Dados inválidos." };
  const v = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase.from("fb_share_attempts").insert({
    account_id: v.accountId,
    group_id: v.groupId,
    ad_id: v.adId,
    status: "reset",
    reason: "Desbloqueado no backoffice para voltar a tentar.",
  });
  if (error) return dbError("resetShareGroup", error.message, "Não foi possível desbloquear.");
  revalidatePath(PATH);
  return { ok: true };
}
