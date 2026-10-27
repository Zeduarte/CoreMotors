"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/admin-queries";
import { requireSection } from "@/lib/guard";
import { eventsForProfile, type TemplateFamily } from "@/lib/notification-events";
import { backofficeBaseUrl } from "@/lib/notifications";
import { deliverNotificationsSoon } from "@/lib/notifications-kick";
import { effectiveSections } from "@/lib/permissions";
import { normalizeWhatsApp } from "@/lib/phone";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { createMessageTemplates } from "@/lib/whatsapp/templates-create";
import { whatsAppNumber } from "@/lib/whatsapp/account";
import {
  NOTIFICATION_TEMPLATES,
  sendWhatsAppTemplate,
  templateLanguage,
  templateName,
} from "@/lib/whatsapp/send-template";

/**
 * Avisos por WhatsApp: as escolhas de cada pessoa (O meu perfil) e o
 * interruptor geral, o teste e a fila (Integrações, só administradores).
 */

type Result = { ok: boolean; error?: string };

/** Sem a migração 0036 as tabelas não existem: dizer o que fazer. */
function migrationHint(error: { code?: string; message: string }): string | null {
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message)
    ? "A base de dados ainda não tem os avisos por WhatsApp. Aplique a migração 0036_whatsapp_notifications.sql."
    : null;
}

/**
 * As escolhas do próprio. Cada caixa marcada é um aviso ligado; uma caixa
 * desmarcada não vem no formulário, por isso percorre-se o catálogo dos avisos
 * que a pessoa pode receber, e não o que chegou.
 */
export async function saveMyNotificationPreferences(data: FormData): Promise<Result> {
  const me = await getCurrentProfile();
  if (!me) return { ok: false, error: "Sessão expirada. Volte a entrar." };
  const events = eventsForProfile(me.role, effectiveSections(me.role, me.allowed_sections));
  if (events.length === 0) return { ok: true };

  const now = new Date().toISOString();
  const db = await createClient();
  const { error } = await db.from("notification_preferences").upsert(
    events.map((e) => ({ profile_id: me.id, event: e.key, enabled: data.get(e.key) === "on", updated_at: now })),
    { onConflict: "profile_id,event" },
  );
  if (error) {
    console.error("saveMyNotificationPreferences:", error.message);
    return { ok: false, error: migrationHint(error) ?? "Não foi possível guardar os avisos." };
  }
  revalidatePath("/admin/perfil");
  return { ok: true };
}

async function requireAdmin() {
  const me = await requireSection("integracoes");
  return me.role === "admin" ? me : null;
}

/** Liga ou desliga o envio de avisos por WhatsApp para toda a equipa. */
export async function saveWhatsAppNotificationSettings(data: FormData): Promise<Result> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Apenas administradores." };
  const db = await createClient();
  const { error } = await db
    .from("notification_settings")
    .update({
      whatsapp_enabled: data.get("whatsapp_enabled") === "on",
      updated_by: me.id,
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1)
    .select("id")
    .single();
  if (error) {
    console.error("saveWhatsAppNotificationSettings:", error.message);
    return { ok: false, error: migrationHint(error) ?? "Não foi possível guardar." };
  }
  revalidatePath("/admin/integracoes");
  revalidatePath("/admin/perfil");
  return { ok: true };
}

/**
 * Envia os cinco modelos, com os valores de exemplo, para o telefone de quem
 * carrega no botão. É a forma de saber se a Meta já os aprovou ANTES de ligar
 * os avisos — por isso não depende do interruptor nem passa pela fila: o
 * resultado (e o motivo da Meta, se recusar) vem logo.
 */
export async function sendWhatsAppTestNotification(): Promise<Result> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Apenas administradores." };
  const to = me.phone ? normalizeWhatsApp(me.phone) : "";
  if (!/^\d{9,15}$/.test(to)) {
    return { ok: false, error: "Preencha o seu telefone em «O meu perfil» para receber o teste." };
  }
  const number = await whatsAppNumber(createAdminClient());
  if (!number?.accessToken) return { ok: false, error: "Ligue primeiro o número do WhatsApp da empresa." };

  // Os exemplos levam um endereço fictício: no teste vai o do próprio site.
  const base = backofficeBaseUrl();
  const falhas: string[] = [];
  for (const [family, def] of Object.entries(NOTIFICATION_TEMPLATES) as [TemplateFamily, (typeof NOTIFICATION_TEMPLATES)[TemplateFamily]][]) {
    const params = def.example.map((v) => v.replace(/^https:\/\/www\.exemplo\.pt/, base));
    const result = await sendWhatsAppTemplate(
      to,
      {
        name: templateName(family),
        language: templateLanguage(),
        params,
        // Os botões do teste não correspondem a nenhuma visita: o payload não é tratado.
        ...(def.buttons ? { buttons: def.buttons.map((_, i) => ({ payload: `visit:teste:${i}` })) } : {}),
      },
      number,
    );
    if (!result.ok) falhas.push(`${templateName(family)}: ${result.error}`);
  }
  if (falhas.length) return { ok: false, error: `A Meta recusou ${falhas.length} de ${Object.keys(NOTIFICATION_TEMPLATES).length} modelos — ${falhas.join(" · ")}` };
  return { ok: true };
}

/**
 * Submete à Meta os modelos de mensagem (templates.ts), com a conta do WhatsApp
 * Business guardada ao ligar o número. Só administradores.
 */
export async function createWhatsAppTemplates(): Promise<Result> {
  const me = await requireAdmin();
  if (!me) return { ok: false, error: "Apenas administradores." };
  const db = createAdminClient();
  const number = await whatsAppNumber(db);
  const { data } = db
    ? await db.from("whatsapp_connection").select("waba_id").eq("id", 1).maybeSingle()
    : { data: null };
  // A conta vem da ligação feita no backoffice; num site que só usa as variáveis
  // do Netlify, vem de WHATSAPP_BUSINESS_ACCOUNT_ID.
  const wabaId = data?.waba_id ?? (process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() || null);
  const result = await createMessageTemplates(number, wabaId);
  revalidatePath("/admin/integracoes");
  return result.ok ? { ok: true } : { ok: false, error: [result.error, ...result.lines].filter(Boolean).join(" · ") };
}

/** Volta a pôr na fila um aviso que falhou ou cujo envio ficou por confirmar. */
export async function requeueWhatsAppNotification(data: FormData): Promise<Result> {
  const me = await requireAdmin();
  const id = z.string().uuid().safeParse(data.get("id"));
  if (!me || !id.success) return { ok: false, error: "Sem permissão." };
  const db = createAdminClient();
  if (!db) return { ok: false, error: "Chave de administração não configurada." };
  const { error } = await db
    .from("notification_jobs")
    .update({ attempts: 0, claimed_at: null, last_error: null, next_attempt_at: new Date().toISOString() })
    .eq("id", id.data)
    .eq("channel", "whatsapp")
    .is("delivered_at", null)
    .is("cancelled_at", null)
    .select("id")
    .single();
  if (error) return { ok: false, error: "Não foi possível voltar a pôr o aviso na fila." };
  deliverNotificationsSoon();
  revalidatePath("/admin/integracoes");
  return { ok: true };
}
