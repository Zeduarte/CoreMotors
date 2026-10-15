"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/admin-queries";
import { companyCalendar, isSelectable, summarise } from "@/lib/leave";
import { canDecideLeaveFor, leaveSelfApproves } from "@/lib/permissions";
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

  for (const d of add) {
    if (!d.day.startsWith(String(year))) {
      return { ok: false, error: "Há dias fora do ano selecionado." };
    }
    if (!isSelectable(d.day, calendar)) {
      return { ok: false, error: "Há dias que não são dias de trabalho." };
    }
  }

  // Saldo depois de aplicar tudo: só se recusa se o resultado final passar.
  const restantes = atuais.filter(
    (d) => !remove.includes(d.day) && !add.some((a) => a.day === d.day),
  );
  const finais = [
    ...restantes,
    ...add.map((a) => ({
      day: a.day,
      half: a.half,
      status: porDia.get(a.day)?.status ?? ("draft" as const),
    })),
  ];
  if (summarise(saldo, finais).available < 0) {
    return { ok: false, error: "As alterações passam o saldo disponível." };
  }

  // Quem está no topo aprova o próprio plano; os restantes pedem aprovação.
  const aprovaSozinho = leaveSelfApproves(me.role);
  const status = aprovaSozinho ? "approved" : "pending";

  if (remove.length) {
    const { error } = await db
      .from("leave_days")
      .delete()
      .eq("profile_id", me.id)
      .in("day", remove);
    if (error) {
      console.error("applyLeaveChanges (remover):", error.message);
      return { ok: false, error: "Não foi possível retirar os dias." };
    }
  }

  if (add.length) {
    const { error } = await db.from("leave_days").upsert(
      add.map((a) => ({
        profile_id: me.id,
        day: a.day,
        half: a.half,
        status,
        ...(aprovaSozinho
          ? { decided_by: me.id, decided_at: new Date().toISOString() }
          : {}),
      })),
      { onConflict: "profile_id,day" },
    );
    if (error) {
      console.error("applyLeaveChanges (juntar):", error.message);
      return { ok: false, error: missingTable(error) };
    }
  }

  revalidatePath("/admin/perfil", "layout");
  // Um pedido novo: quem o decide é avisado (agendado pela base de dados, 0041).
  if (!aprovaSozinho && add.length) deliverNotificationsSoon();
  return { ok: true, approved: aprovaSozinho };
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
  // A hierarquia decide: só aprova quem está acima do colaborador.
  const { data: alvo } = await db
    .from("profiles")
    .select("role")
    .eq("id", parsed.data.profileId)
    .maybeSingle();
  if (!alvo || !canDecideLeaveFor(me.role, alvo.role)) {
    return { ok: false, error: "Só pode decidir pedidos de quem está abaixo de si." };
  }

  const { error } = await db
    .from("leave_days")
    .update({
      status: parsed.data.approve ? "approved" : "rejected",
      decided_by: me.id,
      decided_at: new Date().toISOString(),
    })
    .eq("profile_id", parsed.data.profileId)
    .eq("status", "pending")
    .in("day", parsed.data.days);
  if (error) {
    console.error("decideLeave:", error.message);
    return { ok: false, error: "Não foi possível registar a decisão." };
  }
  // Quem pediu fica a saber da decisão (agendado pela base de dados, 0041).
  deliverNotificationsSoon();

  revalidatePath("/admin/perfil", "layout");
  return { ok: true };
}

/** Ajusta o saldo de um colaborador (dias transitados, aniversário). */
export async function saveBalance(data: FormData): Promise<LeaveResult> {
  const me = await getCurrentProfile();
  if (!me) return { ok: false, error: "Sessão expirada. Volte a entrar." };
  if (me.role !== "admin" && me.role !== "chefe") {
    return { ok: false, error: "Sem permissão para alterar saldos." };
  }

  const parsed = z
    .object({
      profile_id: z.string().uuid(),
      year: z.coerce.number().int().min(2000).max(2100),
      base_days: z.coerce.number().min(0).max(60),
      carried_days: z.coerce.number().min(0).max(60),
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
  const { error } = await db
    .from("leave_balances")
    .upsert(
      { ...parsed.data, updated_at: new Date().toISOString() },
      { onConflict: "profile_id,year" },
    );
  if (error) {
    console.error("saveBalance:", error.message);
    return { ok: false, error: "Não foi possível guardar o saldo." };
  }
  revalidatePath("/admin/perfil", "layout");
  return { ok: true };
}
