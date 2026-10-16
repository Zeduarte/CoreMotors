import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { whatsAppNumber } from "@/lib/whatsapp/account";
import { sendWhatsAppTemplate, templateLanguage } from "@/lib/whatsapp/send-template";
import { customerTemplateName, firstName } from "@/lib/customer-templates";
import { alertCancelToken } from "@/lib/alert-token";
import { backofficeBaseUrl } from "@/lib/notifications";
import { site } from "@/lib/site";
import {
  ALERT_MAX_AGE_DAYS,
  alertCarLabel,
  arrivedAfter,
  customerPhone,
  carMatches,
  type AlertCar,
} from "@/lib/stock-alerts";
import { parseCriteria } from "@/lib/stock-alert-schema";

type Db = SupabaseClient<Database>;

/**
 * Alertas de stock automáticos.
 *
 * Corre na manutenção (de 15 em 15 minutos) e logo a seguir a cada gravação de
 * viatura (`deliverNotificationsSoon`). Duas fases:
 *
 *  1. Correspondências: cada viatura publicada DEPOIS de um alerta, e que bate
 *     com os critérios dele, fica registada uma vez (índice único). Correr duas
 *     vezes, ou em paralelo, não duplica nada.
 *  2. Avisos: se o cliente pediu WhatsApp e o stand ligou as mensagens aos
 *     clientes, envia-se o modelo aprovado — no máximo um por cliente a cada 20
 *     horas (as outras ficam para a volta seguinte). Senão, a correspondência
 *     fica «para a equipa» e o contacto ganha a próxima ação, para aparecer no
 *     painel de quem trata dele.
 *
 * Nunca lança: um alerta que não sai não pode fazer falhar a manutenção.
 */

export interface StockAlertRun {
  matched: number;
  sent: number;
  manual: number;
  failed: number;
  skipped?: string;
}

const CAR_COLUMNS =
  "id, slug, vehicle_type, make, model, variant, body, fuel, price, price_on_request, year, mileage, published_at, status";
const RESEND_AFTER_MS = 20 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const OPEN = ["new", "contacted", "proposal"] as const;

function missingMigration(error: { code?: string; message?: string }): boolean {
  return error.code === "42P01" || /does not exist|schema cache/i.test(error.message ?? "");
}

export async function processStockAlerts(
  db: Db,
  options: { baseUrl: string; companyName: string; now?: Date },
): Promise<StockAlertRun> {
  const run: StockAlertRun = { matched: 0, sent: 0, manual: 0, failed: 0 };
  const now = options.now ?? new Date();
  const since = new Date(now.getTime() - ALERT_MAX_AGE_DAYS * 86_400_000).toISOString();

  const { data: settings, error: settingsError } = await db
    .from("customer_settings")
    .select("customer_whatsapp")
    .eq("id", 1)
    .maybeSingle();
  if (settingsError) {
    return { ...run, skipped: missingMigration(settingsError) ? "Migração 0042 por aplicar." : settingsError.message };
  }

  const { data: leads, error: leadsError } = await db
    .from("leads")
    .select("id, name, phone, created_at, car_details, next_action")
    .eq("kind", "alert")
    .in("status", [...OPEN])
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(1000);
  if (leadsError) return { ...run, skipped: leadsError.message };
  const alerts = (leads ?? []).flatMap((l) => {
    const criteria = parseCriteria((l.car_details ?? {}).criteria);
    return criteria ? [{ ...l, criteria }] : [];
  });
  if (!alerts.length) return run;

  // ---- 1. Correspondências --------------------------------------------------
  const { data: cars } = await db
    .from("cars")
    .select(CAR_COLUMNS)
    .eq("status", "published")
    .gte("published_at", alerts[0]!.created_at)
    .order("published_at", { ascending: false })
    .limit(500);
  const fresh: { lead_id: string; car_id: string }[] = [];
  for (const alert of alerts) {
    for (const car of (cars ?? []) as AlertCar[]) {
      if (arrivedAfter(car, alert.created_at) && carMatches(car, alert.criteria)) {
        fresh.push({ lead_id: alert.id, car_id: car.id });
      }
    }
  }
  if (fresh.length) {
    const { data: inserted } = await db
      .from("stock_alert_matches")
      .upsert(fresh, { onConflict: "lead_id,car_id", ignoreDuplicates: true })
      .select("id");
    run.matched = inserted?.length ?? 0;
  }

  // ---- 2. Avisos ------------------------------------------------------------
  const { data: pending } = await db
    .from("stock_alert_matches")
    .select("id, lead_id, car_id, attempts, created_at")
    .eq("status", "pending")
    .in("lead_id", alerts.map((a) => a.id))
    .order("created_at", { ascending: true })
    .limit(100);
  if (!pending?.length) return run;

  const number = settings?.customer_whatsapp ? await whatsAppNumber(db) : null;
  const canSend = Boolean(number?.accessToken);
  const { data: pendingCars } = await db
    .from("cars")
    .select(CAR_COLUMNS)
    .in("id", [...new Set(pending.map((p) => p.car_id))]);
  const carById = new Map(((pendingCars ?? []) as (AlertCar & { status: string })[]).map((c) => [c.id, c]));
  const { data: recent } = await db
    .from("stock_alert_matches")
    .select("lead_id, sent_at")
    .eq("status", "sent")
    .in("lead_id", [...new Set(pending.map((p) => p.lead_id))])
    .gte("sent_at", new Date(now.getTime() - RESEND_AFTER_MS).toISOString());
  const sentRecently = new Set((recent ?? []).map((r) => r.lead_id));

  for (const match of pending) {
    const alert = alerts.find((a) => a.id === match.lead_id)!;
    const car = carById.get(match.car_id);
    if (!car || car.status !== "published") {
      await db.from("stock_alert_matches").update({ status: "cancelled" }).eq("id", match.id).eq("status", "pending");
      continue;
    }
    const phone = customerPhone(alert.phone);
    const optIn = Boolean((alert.car_details ?? {}).whatsapp_opt_in_at);
    if (!canSend || !phone || !optIn) {
      // Fica para a equipa: o contacto mostra a viatura e o botão do WhatsApp.
      const { data: claimed } = await db
        .from("stock_alert_matches")
        .update({ status: "manual" })
        .eq("id", match.id)
        .eq("status", "pending")
        .select("id");
      if (claimed?.length) {
        run.manual++;
        if (!alert.next_action) {
          await db
            .from("leads")
            .update({
              next_action: `Avisar o cliente: entrou ${car.make} ${car.model}`.slice(0, 500),
              next_action_at: now.toISOString(),
            })
            .eq("id", alert.id)
            .is("next_action", null);
          alert.next_action = "…";
        }
      }
      continue;
    }
    if (sentRecently.has(alert.id)) continue;

    // Reclama antes de enviar: dois processos em paralelo não enviam os dois.
    const { data: claimed } = await db
      .from("stock_alert_matches")
      .update({ status: "sending", attempts: match.attempts + 1 })
      .eq("id", match.id)
      .eq("status", "pending")
      .select("id");
    if (!claimed?.length) continue;

    const token = alertCancelToken(alert.id);
    const result = await sendWhatsAppTemplate(
      phone,
      {
        name: customerTemplateName("alerta"),
        language: templateLanguage(),
        params: [
          firstName(alert.name),
          options.companyName,
          alertCarLabel(car),
          `${options.baseUrl}/viaturas/${car.slug}`,
          token ? `${options.baseUrl}/alertas/cancelar/${token}` : `${options.baseUrl}/contactos`,
        ],
      },
      number,
    );
    if (result.ok || result.uncertain) {
      // Incerto conta como enviado: pode ter chegado, e não se repete.
      sentRecently.add(alert.id);
      run.sent++;
      await db
        .from("stock_alert_matches")
        .update({
          status: "sent",
          sent_at: now.toISOString(),
          wa_message_id: result.messageId ?? null,
          error: result.uncertain ? result.error ?? null : null,
        })
        .eq("id", match.id);
    } else {
      const giveUp = result.permanent || match.attempts + 1 >= MAX_ATTEMPTS;
      if (giveUp) run.failed++;
      await db
        .from("stock_alert_matches")
        .update({ status: giveUp ? "failed" : "pending", error: (result.error ?? "Falha no envio").slice(0, 300) })
        .eq("id", match.id);
    }
  }
  return run;
}

/** Para a manutenção e para depois das gravações: com o endereço e o nome do stand. */
export async function runStockAlerts(db: Db): Promise<StockAlertRun> {
  try {
    // Importada aqui: as consultas públicas criam o cliente do Supabase ao
    // carregar, e este módulo também serve páginas do backoffice.
    const { getBranding } = await import("@/lib/queries");
    const branding = await getBranding().catch(() => null);
    return await processStockAlerts(db, {
      baseUrl: backofficeBaseUrl(),
      companyName: branding?.companyName || site.name,
    });
  } catch (e) {
    console.error("Alertas de stock:", e);
    return { matched: 0, sent: 0, manual: 0, failed: 0, skipped: "Falha ao processar os alertas." };
  }
}
