"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export interface AuthState {
  error?: string;
}

/**
 * A mensagem para cada recusa do Supabase Auth. Decide-se pelo código e pelo
 * estado HTTP, nunca pelo texto do erro: esse texto não se mostra nem se regista,
 * porque pode trazer o email ou outros dados de quem tentou entrar.
 */
function loginErrorMessage(error: { code?: string; status?: number }): string {
  switch (error.code) {
    case "invalid_credentials":
      return "Email ou password incorretos.";
    case "email_not_confirmed":
      return "Confirme o seu email antes de entrar — veja a caixa de entrada.";
    case "user_banned":
      return "O acesso desta conta está suspenso. Fale com o administrador.";
  }
  if (error.status === 429) {
    return "Demasiadas tentativas seguidas. Aguarde alguns minutos e tente outra vez.";
  }
  if (error.status && error.status >= 500) {
    return "O serviço de autenticação não está disponível. Tente daqui a pouco.";
  }
  return "Email ou password incorretos.";
}

/** Login com email/password via Supabase Auth. */
export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const redirectTo = String(formData.get("redirect") ?? "/admin");

  if (!email || !password) {
    return { error: "Preencha email e password." };
  }

  const supabase = await createClient();
  let error: { code?: string; status?: number } | null;
  try {
    ({ error } = await supabase.auth.signInWithPassword({ email, password }));
  } catch {
    // Sem resposta do Supabase (rede, DNS, tempo esgotado): não é a password.
    console.warn("login: sem ligação ao serviço de autenticação");
    return {
      error: "Não foi possível contactar o serviço de autenticação. Verifique a ligação e tente outra vez.",
    };
  }

  if (error) {
    // Só o código, para diagnóstico: nunca o email nem o texto do erro.
    console.warn(`login: recusado (${error.code ?? error.status ?? "sem código"})`);
    return { error: loginErrorMessage(error) };
  }

  // Fora do try: o redirect do Next funciona lançando uma exceção.
  redirect(redirectTo.startsWith("/admin") ? redirectTo : "/admin");
}

/** Termina a sessão e volta ao login. */
export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/admin/login");
}
