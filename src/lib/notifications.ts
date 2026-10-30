import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import type { Database, WhatsAppNotificationClaimRow } from "@/lib/supabase/database.types";
import { site } from "@/lib/site";
import { webhookUrlProblem } from "@/lib/webhook-url";
import {
  buildDigest,
  buildNotification,
  canDigest,
  DIGEST_FROM,
  type NotificationMessage,
} from "@/lib/notification-events";
import { whatsAppNumber } from "@/lib/whatsapp/account";
import { sendWhatsAppTemplate, templateLanguage, templateName } from "@/lib/whatsapp/send-template";

type Db = SupabaseClient<Database>;

/** Deliver queued jobs with durable retry state. Called only by the protected worker or an admin. */
export async function processNotificationJobs() {
  const db = createAdminClient();
  if (!db) return {ok:false,error:"Chave de administração não configurada."};
  // Os dois canais são independentes: um webhook mal configurado não pode
  // calar os avisos por WhatsApp, nem o contrário.
  const webhook = await processWebhookJobs(db);
  const whatsapp = await processWhatsAppNotifications(db).catch((e: unknown) => {
    console.error("Avisos por WhatsApp:", e);
    return {ok:false,error:"Falha ao enviar os avisos por WhatsApp."};
  });
  if (!webhook.ok) return webhook;
  if (!whatsapp.ok) return {ok:false,error:whatsapp.error};
  return {ok:true};
}

async function processWebhookJobs(db: Db) {
  const {data: config,error: configError} = await db.from("integration_secrets").select("data").eq("id",1).single();
  if (configError) return {ok:false,error:"Não foi possível ler a configuração."};
  const webhook = config.data.lead_webhook;
  if (typeof webhook !== "string" || !webhook) return {ok:true};
  // A mesma verificação de quando se grava nas Integrações (webhook-url.ts).
  const problem = webhookUrlProblem(webhook);
  if (problem) return {ok:false,error:problem};
  const url = new URL(webhook);
  const {data: jobs,error} = await db.rpc("claim_notification_jobs");
  if (error) return {ok:false,error:"Não foi possível obter notificações pendentes."};
  for (const job of jobs ?? []) {
    try {
      if (!job.lead_id) throw new Error("Contacto indisponível");
      const {data: lead,error: readError} = await db.from("leads").select("name,kind,car_label").eq("id",job.lead_id).single();
      if (readError) throw new Error("Contacto indisponível");
      const text = `Novo contacto: ${lead.name} (${lead.kind})${lead.car_label ? ` — ${lead.car_label}` : ""}. Consulte o backoffice.`;
      const response = await fetch(url, {method:"POST",headers:{"Content-Type":"application/json","Idempotency-Key":job.id},body:JSON.stringify({text,content:text}),signal:AbortSignal.timeout(5000),redirect:"error"});
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const {error: saveError} = await db.from("notification_jobs").update({delivered_at:new Date().toISOString(),last_error:null}).eq("id",job.id);
      if (saveError) throw new Error("Falha ao guardar confirmação");
    } catch (e) {
      const message = e instanceof Error ? e.message : "Falha no envio";
      await db.from("notification_jobs").update({last_error:message.slice(0,200),next_attempt_at:new Date(Date.now()+Math.min(3600,30*2**job.attempts)*1000).toISOString()}).eq("id",job.id);
    }
  }
  return {ok:true};
}

// ---------------------------------------------------------------------------
// Avisos por WhatsApp aos colaboradores (migração 0036)
// ---------------------------------------------------------------------------

/**
 * O endereço do site, para os links dos avisos. Cada cliente tem o seu
 * (NEXT_PUBLIC_SITE_URL); o `URL` é o que o Netlify dá ao site publicado.
 */
export function backofficeBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_SITE_URL || process.env.URL || site.url).replace(/\/$/, "");
}

export interface WhatsAppRun {
  ok: boolean;
  error?: string;
  /** Avisos entregues à Meta e avisos que falharam, nesta volta. */
  sent: number;
  failed: number;
  /** Porque é que não se tentou nada. */
  skipped?: string;
}

/** Uma linha devolvida por `claim_whatsapp_notifications`. */
export type ClaimedNotification = WhatsAppNotificationClaimRow;

/** Uma mensagem a enviar: um aviso, ou vários juntos num resumo. */
interface Delivery {
  jobs: ClaimedNotification[];
  event: string;
  to: string | null;
  message: NotificationMessage | null;
  /** Botões de resposta rápida do modelo (o aviso de visita), por ordem. */
  buttons?: { payload: string }[];
  /** Porque é que este aviso não se envia (não é uma falha a repetir). */
  skip?: string;
}

const UUID = /^[0-9a-f-]{36}$/i;

/** Os botões «Confirmar visita» / «Não posso nessa hora», com o contacto no payload. */
function visitButtons(details: Record<string, unknown> | null): { payload: string }[] | null {
  const id = details?.lead_id;
  return typeof id === "string" && UUID.test(id)
    ? [{ payload: `visit:ok:${id.toLowerCase()}` }, { payload: `visit:no:${id.toLowerCase()}` }]
    : null;
}

/**
 * Junta os avisos reclamados em mensagens. Três ou mais avisos do mesmo tipo
 * para a mesma pessoa (publicar viaturas em lote) vão numa mensagem só: vinte
 * mensagens seguidas são ruído, e quem as recebe deixa de as ler.
 */
export function planDeliveries(jobs: ClaimedNotification[]): Delivery[] {
  const groups = new Map<string, ClaimedNotification[]>();
  for (const job of jobs) {
    const key = `${job.to_phone ?? ""}|${job.event_kind}`;
    const list = groups.get(key);
    if (list) list.push(job);
    else groups.set(key, [job]);
  }
  const out: Delivery[] = [];
  for (const group of groups.values()) {
    const first = group[0]!;
    if (canDigest(first.event_kind) && group.length >= DIGEST_FROM) {
      out.push({
        jobs: group,
        event: first.event_kind,
        to: first.to_phone,
        message: buildDigest(first.event_kind, group.map((j) => j.details ?? {})),
      });
      continue;
    }
    // Os pedidos de visita nunca se juntam (não estão em DIGEST): cada um leva
    // os seus botões, ligados ao seu contacto.
    for (const job of group) {
      const delivery: Delivery = {
        jobs: [job],
        event: job.event_kind,
        to: job.to_phone,
        message: buildNotification(job.event_kind, job.subject, job.details ?? {}),
      };
      if (job.event_kind === "lead_visit") {
        const buttons = visitButtons(job.details);
        if (buttons) delivery.buttons = buttons;
        else delivery.skip = "Pedido de visita sem identificação do contacto: os botões não funcionariam";
      }
      out.push(delivery);
    }
  }
  return out;
}

/**
 * O aviso de contacto leva os dados do cliente (telemóvel, email, mensagem,
 * data pretendida). Não vão no aviso guardado — lê-se o contacto ao enviar, o
 * que também mostra a versão atual. Se o contacto já não existir ou a leitura
 * falhar, o aviso sai na mesma, com «não indicado».
 */
const LEAD_EVENTS = new Set([
  "lead_contact", "lead_test_drive", "lead_offer", "lead_reservation",
  "lead_trade_in", "lead_order", "lead_alert", "lead_assigned", "lead_visit",
]);

export async function enrichLeadDetails(db: Db, jobs: ClaimedNotification[]): Promise<void> {
  const idOf = (job: ClaimedNotification) => {
    const fromPayload = job.details?.lead_id;
    return typeof fromPayload === "string" && fromPayload ? fromPayload : job.subject;
  };
  const wanted = jobs.filter((job) => LEAD_EVENTS.has(job.event_kind));
  const ids = [...new Set(wanted.map(idOf))].filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (ids.length === 0) return;
  let data;
  try {
    const res = await db.from("leads").select("id,phone,email,message,preferred_date,visit_at,visit_status").in("id", ids);
    if (res.error || !res.data) return;
    data = res.data;
  } catch {
    return; // um aviso nunca deixa de sair por não se ter conseguido ler o contacto
  }
  const byId = new Map(data.map((lead) => [lead.id, lead]));
  for (const job of wanted) {
    const lead = byId.get(idOf(job));
    if (!lead) continue;
    job.details = {
      ...(job.details ?? {}),
      phone: lead.phone,
      email: lead.email,
      message: lead.message,
      preferred_date: lead.preferred_date,
      visit_at: lead.visit_at ?? (job.details ?? {}).visit_at ?? null,
      visit_status: lead.visit_status ?? (job.details ?? {}).visit_status ?? null,
    };
  }
}

/** A base de dados ainda não tem a migração 0036. */
function missingMigration(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    error.code === "42P01" ||
    /does not exist|could not find the function|schema cache/i.test(error.message ?? "")
  );
}

/** Corre `task` sobre cada item, no máximo `limit` de cada vez. */
async function inPool<T>(items: T[], limit: number, task: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const item = items[next++]!;
      await task(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
}

/**
 * Envia os avisos por WhatsApp pendentes. Chamada pela manutenção (de 15 em 15
 * minutos), pelo botão em Integrações e logo a seguir a cada ação que agenda
 * avisos (`deliverNotificationsSoon`). Pode correr em paralelo consigo mesma: a
 * base de dados entrega cada aviso a um processo só.
 *
 * Quem recebe e o texto já foram decididos ao agendar; aqui só se envia e se
 * regista o resultado — de forma que um aviso nunca chega duas vezes: um envio
 * de resultado incerto fica parado no painel, à espera do administrador.
 */
export async function processWhatsAppNotifications(
  db: Db,
  options: { budgetMs?: number; batch?: number } = {},
): Promise<WhatsAppRun> {
  const started = Date.now();
  const budgetMs = options.budgetMs ?? 10_000;
  const run: WhatsAppRun = { ok: true, sent: 0, failed: 0 };

  // Desligado em Integrações: não se envia nada (o que ficou na fila expira).
  const { data: settings, error: settingsError } = await db
    .from("notification_settings")
    .select("whatsapp_enabled")
    .eq("id", 1)
    .maybeSingle();
  if (settingsError) {
    if (missingMigration(settingsError)) return { ...run, skipped: "Migração 0036 por aplicar." };
    return { ...run, ok: false, error: "Não foi possível ler a configuração dos avisos." };
  }
  if (!settings?.whatsapp_enabled) return { ...run, skipped: "Avisos por WhatsApp desligados." };

  const number = await whatsAppNumber(db);
  if (!number?.accessToken) return { ...run, skipped: "WhatsApp não configurado." };

  // Antes de reclamar, para o aviso sair já nesta volta. Se falhar, os outros
  // avisos seguem na mesma.
  await db.rpc("queue_whatsapp_expiry_warning");
  // Colegas que vão de férias nos próximos 7 dias (0041). A base de dados só
  // agenda entre as 9h e as 20h de Lisboa, e uma vez por período.
  await db.rpc("queue_whatsapp_leave_upcoming");

  while (Date.now() - started < budgetMs) {
    const { data, error } = await db.rpc("claim_whatsapp_notifications", { batch: options.batch ?? 25 });
    if (error) {
      if (missingMigration(error)) return { ...run, skipped: "Migração 0036 por aplicar." };
      return { ...run, ok: false, error: "Não foi possível obter os avisos por WhatsApp pendentes." };
    }
    const jobs: ClaimedNotification[] = data ?? [];
    if (jobs.length === 0) break;

    await enrichLeadDetails(db, jobs);
    await inPool(planDeliveries(jobs), 5, async (delivery) => {
      const finish = (outcome: string, detail?: string | null, messageId?: string | null) =>
        Promise.all(
          delivery.jobs.map((job) =>
            db.rpc("finish_whatsapp_notification", {
              job: job.job_id,
              outcome,
              detail: detail ?? null,
              message_id: messageId ?? null,
            }),
          ),
        );
      if (!delivery.to) {
        await finish("skipped", "Sem telefone válido no perfil");
        return;
      }
      if (delivery.skip) {
        await finish("skipped", delivery.skip);
        return;
      }
      if (!delivery.message) {
        await finish("skipped", `Aviso desconhecido: ${delivery.event}`);
        return;
      }
      const result = await sendWhatsAppTemplate(
        delivery.to,
        {
          name: templateName(delivery.message.family),
          language: templateLanguage(),
          params: delivery.message.params,
          ...(delivery.buttons ? { buttons: delivery.buttons } : {}),
        },
        number,
      );
      if (result.ok) {
        run.sent += delivery.jobs.length;
        await finish("sent", null, result.messageId);
      } else {
        run.failed += delivery.jobs.length;
        await finish(result.uncertain ? "uncertain" : result.permanent ? "permanent" : "failed", result.error);
      }
    });
  }
  return run;
}
