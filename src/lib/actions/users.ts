"use server";

import { requireAdmin } from "@/lib/guard";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { newUserSchema } from "@/lib/schemas";
import {
  ADMIN_ONLY,
  ALL_SECTIONS,
  ALWAYS,
  assignableRoles,
  canManage,
  NEW_USER_ROLE,
  type Role,
  type Section,
} from "@/lib/permissions";
import { internalEmail } from "@/lib/usernames";
import { INVITE_TTL_MS, invitePath, newInviteToken } from "@/lib/user-invites";
import { VEHICLE_TYPES, type VehicleType } from "@/lib/vehicle-categories";
import type { ProfileRow, UserRole } from "@/lib/supabase/database.types";

/**
 * Gestão de utilizadores do backoffice: só administradores (requireAdmin), e
 * outro administrador só pelo dono da conta. Nenhuma ação mexe em
 * palavras-passe: cada pessoa define a sua no link de convite.
 */

export interface UserResult {
  ok: boolean;
  error?: string;
}

/** Resultado de criar uma conta ou um link novo: o caminho do convite. */
export interface InviteResult extends UserResult {
  /** `/admin/convite/<token>` — o browser junta-lhe o domínio. */
  path?: string;
  expiresAt?: string;
}

type AdminClient = NonNullable<ReturnType<typeof createAdminClient>>;

const NO_SERVICE_KEY =
  "Falta a chave SUPABASE_SERVICE_ROLE_KEY no servidor para gerir utilizadores.";

/** Papel atual de um utilizador e se é o dono da conta. */
async function targetOf(
  admin: AdminClient,
  id: string,
): Promise<{ role: Role; isOwner: boolean } | null> {
  const { data } = await admin
    .from("profiles")
    .select("role, is_owner")
    .eq("id", id)
    .maybeSingle();
  return data ? { role: data.role as Role, isOwner: !!data.is_owner } : null;
}

/**
 * Pode `me` mexer neste alvo? Devolve a razão da recusa, ou null. O dono nunca
 * é alvo de ninguém; outro admin só é gerível pelo dono.
 */
function refusal(
  me: Pick<ProfileRow, "role" | "is_owner">,
  target: { role: Role; isOwner: boolean },
  verbo = "gerir",
): string | null {
  if (target.isOwner) return "O dono da conta não pode ser alterado por outro utilizador.";
  if (canManage(me.role, target.role, !!me.is_owner)) return null;
  return target.role === "admin"
    ? `Só o dono da conta pode ${verbo} outros administradores.`
    : `Só administradores podem ${verbo} utilizadores.`;
}

/**
 * Separadores que se concedem: os que existem, nunca os só de administrador,
 * e o Dashboard fica sempre incluído.
 */
function grantableSections(requested: string[] | undefined): Section[] {
  const set = new Set<Section>(
    (requested ?? []).filter(
      (s): s is Section =>
        (ALL_SECTIONS as string[]).includes(s) && !(ADMIN_ONLY as string[]).includes(s),
    ),
  );
  set.add(ALWAYS);
  return [...set];
}

/**
 * Tipos de viatura concedidos. Devolve `null` quando fica com os dois (é o
 * valor "sem restrição" na BD).
 */
function grantableVehicleTypes(
  requested: string[] | undefined,
  targetRole: string,
): string[] | null {
  // O admin acede sempre aos dois — guardar uma restrição seria ignorado.
  if (targetRole === "admin") return null;
  const picked = (requested ?? []).filter((t): t is VehicleType =>
    (VEHICLE_TYPES as readonly string[]).includes(t),
  );
  return picked.length === 0 || picked.length === VEHICLE_TYPES.length ? null : picked;
}

/** Grava um convite novo (os anteriores por usar deixam de valer). */
async function issueInvite(
  admin: AdminClient,
  userId: string,
  createdBy: string,
): Promise<InviteResult> {
  const { token, hash } = newInviteToken();
  const expiresAt = new Date(Date.now() + INVITE_TTL_MS).toISOString();
  const { error } = await admin.rpc("create_user_invite", {
    p_user: userId,
    p_token_hash: hash,
    p_created_by: createdBy,
    p_expires_at: expiresAt,
  });
  if (error) {
    console.warn(`convite: não gravado (${error.code ?? "sem código"})`);
    return { ok: false, error: "Não foi possível gerar o link de convite. Tente novamente." };
  }
  return { ok: true, path: invitePath(token), expiresAt };
}

/**
 * Cria uma conta só com o nome de utilizador e devolve o link de convite. A
 * conta nasce sem palavra-passe (ninguém entra nela até o convite ser usado),
 * como vendedor e com os acessos por omissão desse papel.
 */
export async function createUser(input: unknown): Promise<InviteResult> {
  const me = await requireAdmin();

  const parsed = newUserSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const username = parsed.data.username;
  const duplicate = `Já existe um utilizador «${username}».`;

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: NO_SERVICE_KEY };

  // O índice único da BD também o recusa; aqui é para a mensagem ser clara.
  const { data: taken } = await admin.rpc("login_email", { p_username: username });
  if (taken) return { ok: false, error: duplicate };

  const email = internalEmail(username);
  const { data, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
    user_metadata: { full_name: username, role: NEW_USER_ROLE },
  });
  if (error || !data.user) {
    console.warn(`criar utilizador: recusado pelo Auth (${error?.code ?? error?.status ?? "sem código"})`);
    return {
      ok: false,
      error: error?.code === "email_exists" || error?.code === "user_already_exists"
        ? duplicate
        : "Não foi possível criar o utilizador. Tente novamente.",
    };
  }

  const { error: profileError } = await admin.from("profiles").upsert({
    id: data.user.id,
    email,
    username,
    full_name: username,
    role: NEW_USER_ROLE,
    allowed_sections: null,
    allowed_vehicle_types: null,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(data.user.id);
    return {
      ok: false,
      error: profileError.code === "23505" ? duplicate : "Não foi possível criar o perfil. Tente novamente.",
    };
  }

  const invite = await issueInvite(admin, data.user.id, me.id);
  revalidatePath("/admin/utilizadores");
  if (!invite.ok) {
    return {
      ok: false,
      error: "O utilizador foi criado, mas o link falhou. Use «Link de acesso» na lista para gerar outro.",
    };
  }
  return invite;
}

/**
 * Gera um link de acesso novo para alguém que já existe: para quem não usou o
 * convite a tempo, ou esqueceu a palavra-passe. A palavra-passe atual continua
 * a valer até o link ser usado.
 *
 * Para si próprio, só o dono da conta (o acesso core): é quem não tem ninguém
 * acima a quem pedir o link. Os outros pedem-no a um administrador.
 */
export async function createInviteLink(id: string): Promise<InviteResult> {
  const me = await requireAdmin();
  const self = me.id === id;
  if (self && !me.is_owner) {
    return { ok: false, error: "Não pode gerar um link de acesso para si próprio. Peça-o a outro administrador." };
  }

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: NO_SERVICE_KEY };

  const target = await targetOf(admin, id);
  if (!target) return { ok: false, error: "Utilizador não encontrado." };
  const recusa = self ? null : refusal(me, target);
  if (recusa) return { ok: false, error: recusa };

  const invite = await issueInvite(admin, id, me.id);
  revalidatePath("/admin/utilizadores");
  return invite;
}

/** Atualiza o papel, os separadores e os tipos de viatura de um utilizador. */
export async function updateUserAccess(
  id: string,
  role: UserRole,
  sections: string[],
  vehicleTypes?: string[],
): Promise<UserResult> {
  const me = await requireAdmin();
  if (me.id === id) {
    return { ok: false, error: "Não pode alterar as suas próprias permissões." };
  }

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: NO_SERVICE_KEY };

  const target = await targetOf(admin, id);
  if (!target) return { ok: false, error: "Utilizador não encontrado." };
  const recusa = refusal(me, target);
  if (recusa) return { ok: false, error: recusa };
  if (!assignableRoles(me.role).includes(role)) {
    return { ok: false, error: "Sem permissão para atribuir esse papel." };
  }

  const { error } = await admin
    .from("profiles")
    .update({
      role,
      allowed_sections: role === "admin" ? null : grantableSections(sections),
      allowed_vehicle_types: grantableVehicleTypes(vehicleTypes, role),
    })
    .eq("id", id);
  if (error) return { ok: false, error: "Não foi possível guardar. Tente novamente." };

  revalidatePath("/admin/utilizadores");
  return { ok: true };
}

/** Apaga um utilizador (a conta de Auth, o perfil e os convites). */
export async function deleteUser(id: string): Promise<UserResult> {
  const me = await requireAdmin();
  if (me.id === id) {
    return { ok: false, error: "Não pode apagar a sua própria conta." };
  }

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: NO_SERVICE_KEY };

  const target = await targetOf(admin, id);
  if (!target) return { ok: false, error: "Utilizador não encontrado." };
  const recusa = refusal(me, target, "apagar");
  if (recusa) return { ok: false, error: recusa };

  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) return { ok: false, error: "Não foi possível apagar o utilizador. Tente novamente." };

  revalidatePath("/admin/utilizadores");
  return { ok: true };
}

const detailsSchema = z.object({
  full_name: z.string().trim().min(2, "Indique o nome.").max(80),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d\s()-]*$/, "Telefone inválido: só números, espaços e +.")
    .optional()
    .default(""),
});

/**
 * Utilizadores → Editar dados: o nome e o telemóvel de um colaborador. Só o
 * dono da conta (o acesso core). O telemóvel é o que recebe os avisos por
 * WhatsApp e identifica a pessoa quando dá ordens por WhatsApp.
 */
export async function updateUserDetails(id: string, input: unknown): Promise<UserResult> {
  const me = await requireAdmin();
  if (!me.is_owner) return { ok: false, error: "Só o dono da conta (acesso core) pode editar os dados de outra pessoa." };
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Utilizador inválido." };
  const parsed = detailsSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };

  const admin = createAdminClient();
  if (!admin) return { ok: false, error: NO_SERVICE_KEY };
  const { data, error } = await admin
    .from("profiles")
    .update({ full_name: parsed.data.full_name, phone: parsed.data.phone || null })
    .eq("id", id)
    .select("id");
  if (error) {
    if (error.code === "23505") return { ok: false, error: "Esse telemóvel já está associado a outro utilizador." };
    console.warn(`updateUserDetails: não gravado (${error.code ?? "sem código"})`);
    return { ok: false, error: "Não foi possível guardar os dados." };
  }
  if (!data?.length) return { ok: false, error: "Utilizador não encontrado." };
  revalidatePath("/admin/utilizadores");
  revalidatePath("/admin", "layout");
  return { ok: true };
}
