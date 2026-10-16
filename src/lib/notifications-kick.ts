import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { processWhatsAppNotifications } from "@/lib/notifications";
import { runStockAlerts } from "@/lib/stock-alert-run";

/**
 * Envia já os avisos por WhatsApp que a ação acabou de agendar.
 *
 * Os avisos são agendados pela base de dados (migração 0036), na mesma
 * transação da ação; a manutenção envia-os de 15 em 15 minutos. Quinze minutos
 * é tempo demais para um cliente à espera de resposta, por isso as ações do
 * site e do backoffice chamam isto no fim: o envio corre DEPOIS de a resposta
 * seguir para o browser (`after`), e quem submeteu o formulário não espera pela
 * Meta. Se falhar — ou se o alojamento não suportar `after` — a manutenção
 * apanha o que ficou.
 *
 * Nunca lança.
 */
export function deliverNotificationsSoon(): void {
  try {
    after(async () => {
      try {
        const db = createAdminClient();
        if (db) await processWhatsAppNotifications(db, { budgetMs: 8000 });
        // Uma viatura acabada de publicar pode ser a que um cliente espera.
        if (db) await runStockAlerts(db);
      } catch (e) {
        console.error("Avisos por WhatsApp:", e);
      }
    });
  } catch (e) {
    console.error("Avisos por WhatsApp:", e);
  }
}
