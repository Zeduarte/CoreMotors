import type { Metadata } from "next";
import Link from "next/link";
import { InviteForm } from "@/components/admin/InviteForm";
import { createAdminClient } from "@/lib/supabase/admin";
import { hashInviteToken, inviteState, isInviteToken } from "@/lib/user-invites";

export const dynamic = "force-dynamic";

// O token está no endereço: não o passar a outros sites pelo Referer.
export const metadata: Metadata = {
  title: "Definir palavra-passe",
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};

type View =
  | { kind: "form"; username: string; expiresAt: string }
  | { kind: "message"; title: string; text: string };

/** O que mostrar para este token (lido com a chave de serviço). */
async function viewFor(token: string): Promise<View> {
  const invalid: View = {
    kind: "message",
    title: "Link inválido",
    text: "Este link de convite não existe. Confirme que o copiou inteiro, ou peça um novo ao administrador.",
  };
  if (!isInviteToken(token)) return invalid;
  const admin = createAdminClient();
  if (!admin) {
    return { kind: "message", title: "Indisponível", text: "O servidor não está configurado para convites. Avise o administrador." };
  }
  const { data: invite } = await admin
    .from("user_invites")
    .select("user_id, expires_at, used_at")
    .eq("token_hash", hashInviteToken(token))
    .maybeSingle();
  if (!invite) return invalid;

  const state = inviteState(invite);
  if (state === "used") {
    return {
      kind: "message",
      title: "Link já usado",
      text: "Este link só serve uma vez e já foi usado (ou foi substituído por um mais recente). Se precisar de uma palavra-passe nova, peça outro link ao administrador.",
    };
  }
  if (state === "expired") {
    return { kind: "message", title: "Link expirado", text: "Este link já passou da validade. Peça um novo ao administrador." };
  }
  const { data: profile } = await admin
    .from("profiles")
    .select("username")
    .eq("id", invite.user_id)
    .maybeSingle();
  if (!profile?.username) return invalid;
  return { kind: "form", username: profile.username, expiresAt: invite.expires_at };
}

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await viewFor(token);

  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <p className="text-2xl font-bold tracking-tight text-paper">
            Super<span className="text-accent">motas</span>
          </p>
          <p className="mt-2 text-sm text-paper/50">Backoffice · acesso restrito</p>
        </div>
        {view.kind === "form" ? (
          <InviteForm token={token} username={view.username} />
        ) : (
          <div className="card space-y-3 p-6">
            <h1 className="text-lg font-semibold text-paper">{view.title}</h1>
            <p className="text-sm text-paper/60">{view.text}</p>
            <Link href="/admin/login" className="inline-block text-sm text-accent hover:underline">
              Ir para o login
            </Link>
          </div>
        )}
      </div>
    </main>
  );
}
