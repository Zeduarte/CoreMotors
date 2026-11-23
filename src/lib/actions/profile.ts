"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/admin-queries";
import { passwordProblem } from "@/lib/usernames";

/**
 * Dados pessoais do próprio utilizador.
 *
 * O papel e os acessos NÃO se editam aqui — isso é de quem gere pessoas, em
 * Utilizadores. Aqui cada um só mexe no que é seu.
 */

const schema = z.object({
  full_name: z.string().trim().min(2, "Indique o nome.").max(80),
  phone: z
    .string()
    .trim()
    .max(30)
    .regex(/^[+\d\s()-]*$/, "Telefone inválido.")
    .optional()
    .default(""),
  job_title: z.string().trim().max(80).optional().default(""),
  birth_date: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida.")
    .optional()
    .or(z.literal("")),
});

export async function saveMyProfile(
  data: FormData,
): Promise<{ ok: boolean; error?: string }> {
  const me = await getCurrentProfile();
  if (!me) return { ok: false, error: "Sessão expirada. Volte a entrar." };

  const parsed = schema.safeParse({
    full_name: data.get("full_name"),
    phone: data.get("phone"),
    job_title: data.get("job_title"),
    birth_date: data.get("birth_date"),
  });
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Dados inválidos.",
    };
  }

  const db = await createClient();
  const { error } = await db
    .from("profiles")
    .update({
      full_name: parsed.data.full_name,
      phone: parsed.data.phone || null,
      job_title: parsed.data.job_title || null,
      birth_date: parsed.data.birth_date || null,
    })
    .eq("id", me.id);

  if (error) {
    console.error("saveMyProfile:", error.message);
    // Índice único do telefone (0044): o assistente de WhatsApp identifica a pessoa por ele.
    if (error.code === "23505") return { ok: false, error: "Esse telefone já está associado a outro utilizador." };
    // Sem a migração aplicada, as colunas novas não existem. Dizer só "não
    // foi possível" deixava o utilizador sem saber o que fazer.
    const faltaMigracao =
      error.code === "PGRST204" ||
      /column .* does not exist|schema cache/i.test(error.message);
    // As colunas existem mas o Postgres recusa escrevê-las: falta o grant
    // por coluna da 0023. Sem esta distinção, a 0021 era apontada em vão.
    const faltaGrant =
      error.code === "42501" || /permission denied/i.test(error.message);
    return {
      ok: false,
      error: faltaMigracao
        ? "A base de dados ainda não tem os campos do perfil. Aplique a migração 0021_profile_and_leave.sql."
        : faltaGrant
          ? "A base de dados não autoriza gravar estes campos. Aplique a migração 0023_profile_write_grants.sql."
          : "Não foi possível guardar os seus dados.",
    };
  }

  revalidatePath("/admin/perfil", "layout");
  revalidatePath("/admin", "layout");
  return { ok: true };
}

/**
 * Mudar a própria palavra-passe (Perfil → Conta). Confirma primeiro a atual
 * (entrando de novo com ela) e só depois grava a nova. As palavras-passe nunca
 * se registam nem se devolvem.
 */
export async function changeMyPassword(data: FormData): Promise<{ ok: boolean; error?: string }> {
  const current = String(data.get("current_password") ?? "");
  const password = String(data.get("new_password") ?? "");
  const confirm = String(data.get("confirm_password") ?? "");
  if (!current) return { ok: false, error: "Escreva a palavra-passe atual." };
  const problem = passwordProblem(password, confirm);
  if (problem) return { ok: false, error: problem };
  if (password === current) return { ok: false, error: "A nova palavra-passe tem de ser diferente da atual." };

  const db = await createClient();
  const {
    data: { user },
  } = await db.auth.getUser();
  if (!user?.email) return { ok: false, error: "Sessão expirada. Volte a entrar." };

  try {
    const { error: wrong } = await db.auth.signInWithPassword({ email: user.email, password: current });
    if (wrong) {
      if (wrong.status === 429) return { ok: false, error: "Demasiadas tentativas seguidas. Aguarde alguns minutos." };
      return { ok: false, error: "A palavra-passe atual não está certa." };
    }
    const { error } = await db.auth.updateUser({ password });
    if (error) {
      console.warn(`changeMyPassword: recusada (${error.code ?? error.status ?? "sem código"})`);
      return {
        ok: false,
        error:
          error.code === "weak_password"
            ? "Essa palavra-passe é demasiado fraca. Escolha uma mais longa, com letras e números."
            : error.code === "same_password"
              ? "A nova palavra-passe tem de ser diferente da atual."
              : "Não foi possível mudar a palavra-passe. Tente outra vez.",
      };
    }
  } catch {
    return { ok: false, error: "Não foi possível contactar o serviço de autenticação. Tente outra vez." };
  }
  return { ok: true };
}
