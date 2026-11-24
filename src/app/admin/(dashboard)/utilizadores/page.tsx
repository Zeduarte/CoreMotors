import { getProfiles } from "@/lib/admin-queries";
import { requireAdmin } from "@/lib/guard";
import { UsersManager, type UserItem, type UserInvite } from "@/components/admin/UsersManager";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteState } from "@/lib/user-invites";
import { isInternalEmail } from "@/lib/usernames";

export const dynamic = "force-dynamic";

/**
 * Convite por usar de cada utilizador: só conta o mais recente, e só se ainda
 * não foi usado (usado = a pessoa já definiu a palavra-passe).
 */
async function openInvites(): Promise<Map<string, UserInvite>> {
  const open = new Map<string, UserInvite>();
  const admin = createAdminClient();
  if (!admin) return open;
  const { data } = await admin
    .from("user_invites")
    .select("user_id, expires_at, used_at, created_at")
    .order("created_at", { ascending: false });
  const seen = new Set<string>();
  for (const invite of data ?? []) {
    if (seen.has(invite.user_id)) continue;
    seen.add(invite.user_id);
    const state = inviteState(invite);
    if (state !== "used") open.set(invite.user_id, { state, expiresAt: invite.expires_at });
  }
  return open;
}

export default async function UsersPage() {
  const me = await requireAdmin();

  const [profiles, invites] = await Promise.all([getProfiles(), openInvites()]);
  const users: UserItem[] = profiles.map((p) => ({
    id: p.id,
    username: p.username,
    // O email interno das contas novas não é contacto de ninguém.
    email: isInternalEmail(p.email) ? null : p.email,
    full_name: p.full_name,
    phone: p.phone ?? null,
    role: p.role,
    allowed_sections: p.allowed_sections,
    allowed_vehicle_types: p.allowed_vehicle_types,
    is_owner: !!p.is_owner,
    created_at: p.created_at,
    invite: invites.get(p.id) ?? null,
  }));

  const canManageAuth = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-paper">Utilizadores</h1>
        <p className="mt-1 text-sm text-paper/50">
          Quem entra no backoffice e a que separadores. Para criar alguém basta o
          nome de utilizador: recebe um link para copiar e enviar à pessoa, que
          define lá a palavra-passe. Outros administradores só são geridos pelo
          dono da conta.
        </p>
      </div>
      <UsersManager
        users={users}
        currentUser={{ id: me.id, role: me.role, is_owner: !!me.is_owner }}
        canManageAuth={canManageAuth}
      />
    </>
  );
}
