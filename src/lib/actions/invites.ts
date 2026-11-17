"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { passwordProblem } from "@/lib/usernames";
import { hashInviteToken, isInviteToken } from "@/lib/user-invites";

export interface InviteFormState {
  error?: string;
}

const GONE = "Este link já foi usado ou expirou. Peça um link novo ao administrador.";

/**
 * Usa o convite: define a palavra-passe e entra logo no backoffice.
 *
 * O convite é marcado como usado ANTES de se gravar a palavra-passe (um só
 * UPDATE na BD), para dois envios ao mesmo tempo não o usarem os dois. Se a
 * palavra-passe não se gravar, o convite é devolvido e o link volta a servir.
 * A palavra-passe nunca se regista nem se devolve.
 */
export async function acceptInvite(
  _prev: InviteFormState,
  formData: FormData,
): Promise<InviteFormState> {
  const token = String(formData.get("token") ?? "");
  const password = String(formData.get("password") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (!isInviteToken(token)) return { error: "Este link de convite não é válido." };
  const problem = passwordProblem(password, confirm);
  if (problem) return { error: problem };

  const admin = createAdminClient();
  if (!admin) {
    return { error: "O servidor não está configurado para convites. Avise o administrador." };
  }

  const hash = hashInviteToken(token);
  const { data: userId, error: claimError } = await admin.rpc("claim_user_invite", {
    p_token_hash: hash,
  });
  if (claimError) {
    console.warn(`convite: não validado (${claimError.code ?? "sem código"})`);
    return { error: "Não foi possível validar o convite. Tente outra vez." };
  }
  if (!userId) return { error: GONE };

  const { data: updated, error: pwError } = await admin.auth.admin.updateUserById(userId, {
    password,
  });
  const email = updated?.user?.email;
  if (pwError || !email) {
    await admin.rpc("release_user_invite", { p_token_hash: hash });
    console.warn(`convite: palavra-passe recusada (${pwError?.code ?? pwError?.status ?? "sem email"})`);
    return {
      error:
        pwError?.code === "weak_password"
          ? "Essa palavra-passe é demasiado fraca. Escolha uma mais longa, com letras e números."
          : pwError?.code === "same_password"
            ? "Escolha uma palavra-passe diferente da anterior."
            : "Não foi possível guardar a palavra-passe. Tente outra vez.",
    };
  }

  // Entra já com a palavra-passe nova. Se falhar, a conta está pronta na mesma:
  // vai para o login com um aviso.
  const supabase = await createClient();
  let signedIn = false;
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    signedIn = !error;
  } catch {
    signedIn = false;
  }
  // Fora do try: o redirect do Next funciona lançando uma exceção.
  redirect(signedIn ? "/admin" : "/admin/login?convite=ok");
}
