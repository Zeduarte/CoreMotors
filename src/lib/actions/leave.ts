"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/admin-queries";
import { companyCalendar, isSelectable, summarise, type LeaveDay } from "@/lib/leave";
import { canAccess, leaveSelfApproves } from "@/lib/permissions";
import { getBalance, getCompanyDays, getLeaveDays } from "@/lib/leave-queries";
import { deliverNotificationsSoon } from "@/lib/notifications-kick";

/**
 * Marcação e aprovação de férias.
 *
 * O servidor volta a verificar tudo o que o calendário já impede no ecrã: um
 * cliente adulterado não deve conseguir marcar um feriado nem passar do saldo.
 */

export interface LeaveResult {
  ok: boolean;
  error?: string;
}

const dia = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const toggleSchema = z.object({ day: dia, half: z.boolean() });

/**
 * Aplica de uma vez as alterações feitas no modo de edição: os dias a
 * acrescentar (verdes) e os dias a retirar (vermelhos).
 *
 * É tudo ou nada do ponto de vista do utilizador — se o saldo não chega para
 * o conjunto, nada é gravado, em vez de ficar meio aplicado.
 */
export async function applyLeaveChanges(input: {
  year: number;
  add: { day: string; half: boolean }[];
  remove: string[];
}): Promise<LeaveResult & { approved?: boolean }> {
  const me = await getCurrentProfile();
  if (!me) return { ok: false, error: "Sessão expirada. Volte a entrar." };

  const parsed = z
    .object({
      year: z.number().int().min(2000).max(2100),
      add: z.array(toggleSchema).max(400),
      remove: z.array(dia).max(400),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Alterações inválidas." };
  const { year, add, remove } = parsed.data;
  if (!add.length && !remove.length) {
    return { ok: false, error: "Não há alterações para guardar." };
  }

  const db = await createClient();
  const [extras, atuais, saldo] = await Promise.all([
    getCompanyDays(year),
    getLeaveDays(me.id, year),
    getBalance(me.id, year),
  ]);
  const calendar = companyCalendar(year, extras);
  const porDia = new Map(atuais.map((d) => [d.day, d]));

  // Quem está no topo aprova o próprio plano; os restantes pedem aprovação.
  const aprovaSozinho = leaveSelfApproves(me.role);
  const status = aprovaSozinho ? "approved" : "pending";

  for (const d of add) {
    if (!d.day.startsWith(String(year))) {
      return { ok: false, error: "Há dias fora do ano selecionado." };
    }
    if (!isSelectable(d.day, calendar)) {
      return { ok: false, error: "Há dias que não são dias de trabalho." };
    }
    // Um dia aprovado não se volta a pedir por cima (o recusado, sim).
    if (porDia.get(d.day)?.status === "approved" && !aprovaSozinho) {
      return { ok: false, error: "Há dias que já estão aprovados." };
    }
  }

  // O que se pode retirar: o que ainda não foi decidido. Um dia aprovado é um
  // compromisso com a equipa — sai por quem o aprovou, não pelo calendário.
  const recusa = removalRefusal(remove.map((day) => porDia.get(day)), aprovaSozinho);
  if (recusa) return { ok: false, error: recusa };

  // Saldo depois de aplicar tudo: só se recusa se o resultado final passar. O
  // dia que se junta conta já no estado com que vai ficar — um recusado que se
  // volta a pedir passa a contar.
  const restantes = atuais.filter(
    (d) => !remove.includes(d.day) && !add.some((a) => a.day === d.day),
  );
  const finais = [
    ...restantes,
    ...add.map((a): LeaveDay => ({ day: a.day, half: a.half, status })),
  ];
  if (summarise(saldo, finais).available < 0) {
    return { ok: false, error: "As alterações passam o saldo disponível." };
  }

  if (remove.length) {
    const { data, error } = await db
      .from("leave_days")
      .delete()
      .eq("profile_id", me.id)
      .in("day", remove)
      .select("day");
    if (error) {
      console.error("applyLeaveChanges (remover):", error.message);
      return { ok: false, error: "Não foi possível retirar os dias." };
    }
    // Nada de "guardado" quando nada mudou: a base de dados pode ter recusado
    // (um dia decidido entretanto, por exemplo).
    if ((data ?? []).length !== remove.length) {
      revalidatePath("/admin/perfil", "layout");
      return {
        ok: false,
        error: "Alguns dias não foram retirados — foram decididos entretanto. Atualize a página.",
      };
    }
  }

  if (add.length) {
    const { data, error } = await db
      .from("leave_days")
      .upsert(
        add.map((a) => ({
          profile_id: me.id,
          day: a.day,
          half: a.half,
          status,
          // Um pedido não traz decisão; um plano do administrador traz a dele.
          decided_by: aprovaSozinho ? me.id : null,
          decided_at: aprovaSozinho ? new Date().toISOString() : null,
        })),
        { onConflict: "profile_id,day" },
      )
      .select("day");
    if (error) {
      console.error("applyLeaveChanges (juntar):", error.message);
      const repedido = add.some((a) => porDia.get(a.day)?.status === "rejected");
      return {
        ok: false,
        error:
          repedido && /row-level security/i.test(error.message)
            ? "Para voltar a pedir um dia recusado falta aplicar a migração 0046 no Supabase."
            : missingTable(error),
      };
    }
    if ((data ?? []).length !== add.length) {
      return { ok: false, error: "Não foi possível guardar todos os dias. Atualize a página." };
    }
  }

  revalidatePath("/admin/perfil", "layout");
  // Um pedido novo: quem o decide é avisado (agendado pela base de dados, 0041).
  if (!aprovaSozinho && add.length) deliverNotificationsSoon();
  return { ok: true, approved: aprovaSozinho };
}

/**
 * Porque é que estes dias não podem ser retirados (ou null, se podem).
 * Pendentes e rascunhos saem; aprovados só quem aprova o próprio plano; os
 * recusados já não contam, por isso não há nada a retirar.
 */
function removalRefusal(
  dias: (LeaveDay | undefined)[],
  aprovaSozinho: boolean,
): string | null {
  if (dias.some((d) => !d)) {
    return "Há dias que já não estão marcados. Atualize a página.";
  }
  if (dias.some((d) => d!.status === "approved") && !aprovaSozinho) {
    return "Dias já aprovados não se retiram aqui: peça a quem os aprovou para os cancelar.";
  }
  if (dias.some((d) => d!.status === "rejected")) {
    return "Um dia recusado já não conta — não é preciso retirá-lo.";
  }
  return null;
}

/** Mensagem útil quando a migração ainda não foi aplicada. */
function missingTable(error: { code?: string; message: string }): string {
  const falta =
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    /relation .* does not exist|schema cache/i.test(error.message);
  return falta
    ? "A base de dados ainda não tem as tabelas de férias. Aplique as migrações 0021 e 0022."
    : "Não foi possível guardar as alterações.";
}

/** Aprova ou recusa dias de um colaborador. Só chefes e administradores. */
export async function decideLeave(input: {
  profileId: string;
  days: string[];
  approve: boolean;
}): Promise<LeaveResult> {
  const me = await getCurrentProfile();
  if (!me) return { ok: false, error: "Sessão expirada. Volte a entrar." };

  const parsed = z
    .object({
      profileId: z.string().uuid(),
      days: z.array(dia).min(1).max(400),
      approve: z.boolean(),
    })
    .safeParse(input);
  if (!parsed.success) return { ok: false, error: "Pedido inválido." };

  const db = await createClient();
  // A hierarquia decide, e quem a conhece é a base de dados: o chefe nem
  // sempre pode ler o papel dos colegas em `profiles`.
  if (!(await canDecideFor(db, parsed.data.profileId))) {
    return { ok: false, error: "Só pode decidir pedidos de quem está abaixo de si." };
  }

  const { data, error } = await db
    .from("leave_days")
    .update({
      status: parsed.data.approve ? "approved" : "rejected",
      decided_by: me.id,
      decided_at: new Date().toISOString(),
    })
    .eq("profile_id", parsed.data.profileId)
    .eq("status", "pending")
    .in("day", parsed.data.days)
    .select("day");
  if (error) {
    console.error("decideLeave:", error.message);
    return { ok: false, error: "Não foi possível registar a decisão." };
  }
  if (!data?.length) {
    revalidatePath("/admin/perfil", "layout");
    return { ok: false, error: "Estes dias já não estão à espera de decisão. Atualize a página." };
  }
  // Quem pediu fica a saber da decisão (agendado pela base de dados, 0041).
  deliverNotificationsSoon();

  revalidatePath("/admin/perfil", "layout");
  return { ok: true };
}

/** A base de dados diz se `me` decide as férias de `target` (0022/0041). */
async function canDecideFor(
  db: Awaited<ReturnType<typeof createClient>>,
  target: string,
): Promise<boolean> {
  const { data, error } = await db.rpc("can_decide_leave_for", { target });
  if (error) console.error("can_decide_leave_for:", error.message);
  return !error && data === true;
}

const diasSaldo = (campo: string) =>
  z.coerce
    .number({ invalid_type_error: `${campo}: indique um número.` })
    .min(0, `${campo}: não pode ser negativo.`)
    .max(60, `${campo}: no máximo 60 dias.`)
    .refine((n) => Number.isInteger(n * 2), `${campo}: use dias inteiros ou meios dias.`);

/**
 * Ajusta o saldo de um colaborador (dias do ano, transitados, aniversário).
 * Quem pode é quem decide as férias dessa pessoa — a mesma regra da base de
 * dados, que é quem a aplica.
 */
export async function saveBalance(data: FormData): Promise<LeaveResult> {
  const me = await getCurrentProfile();
  if (!me) return { ok: false, error: "Sessão expirada. Volte a entrar." };

  const parsed = z
    .object({
      profile_id: z.string().uuid(),
      year: z.coerce.number().int().min(2000).max(2100),
      base_days: diasSaldo("Férias do ano"),
      carried_days: diasSaldo("Dias transitados"),
      birthday_day: z.coerce.number().min(0).max(1),
    })
    .safeParse({
      profile_id: data.get("profile_id"),
      year: data.get("year"),
      base_days: data.get("base_days"),
      carried_days: data.get("carried_days"),
      birthday_day: data.get("birthday_day") === "on" ? 1 : 0,
    });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }

  const db = await createClient();
  if (!(await canDecideFor(db, parsed.data.profile_id))) {
    return { ok: false, error: "Só pode alterar o saldo de quem está abaixo de si." };
  }
  const { data: gravado, error } = await db
    .from("leave_balances")
    .upsert(
      { ...parsed.data, updated_at: new Date().toISOString() },
      { onConflict: "profile_id,year" },
    )
    .select("profile_id");
  if (error || !gravado?.length) {
    if (error) console.error("saveBalance:", error.message);
    return { ok: false, error: "Não foi possível guardar o saldo." };
  }
  revalidatePath("/admin/perfil", "layout");
  return { ok: true };
}

const companyDaySchema = z.object({
  day: dia,
  kind: z.enum(["holiday", "tolerance", "mandatory"], {
    errorMap: () => ({ message: "Escolha o tipo de dia." }),
  }),
  label: z.string().trim().max(80, "Descrição demasiado longa."),
});

/**
 * Dias especiais da empresa (feriado municipal, tolerância, fecho
 * obrigatório). A escrita é de quem tem Definições — é o RLS da 0021.
 */
export async function addCompanyDay(data: FormData): Promise<LeaveResult> {
  const me = await getCurrentProfile();
  if (!me) return { ok: false, error: "Sessão expirada. Volte a entrar." };
  if (!canAccess(me.role, me.allowed_sections, "definicoes")) {
    return { ok: false, error: "Sem permissão para alterar o calendário da empresa." };
  }
  const parsed = companyDaySchema.safeParse({
    day: data.get("day"),
    kind: data.get("kind"),
    label: data.get("label") ?? "",
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Dados inválidos." };
  }
  const db = await createClient();
  const { data: gravado, error } = await db
    .from("company_days")
    .upsert(parsed.data, { onConflict: "day,kind" })
    .select("id");
  if (error || !gravado?.length) {
    if (error) console.error("addCompanyDay:", error.message);
    return { ok: false, error: "Não foi possível guardar o dia." };
  }
  revalidatePath("/admin/perfil", "layout");
  return { ok: true };
}

export async function removeCompanyDay(id: string): Promise<LeaveResult> {
  const me = await getCurrentProfile();
  if (!me) return { ok: false, error: "Sessão expirada. Volte a entrar." };
  if (!canAccess(me.role, me.allowed_sections, "definicoes")) {
    return { ok: false, error: "Sem permissão para alterar o calendário da empresa." };
  }
  if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Dia inválido." };
  const db = await createClient();
  const { data, error } = await db.from("company_days").delete().eq("id", id).select("id");
  if (error || !data?.length) {
    if (error) console.error("removeCompanyDay:", error.message);
    return { ok: false, error: "Não foi possível retirar o dia." };
  }
  revalidatePath("/admin/perfil", "layout");
  return { ok: true };
}
