"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/admin-queries";

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
