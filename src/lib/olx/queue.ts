import "server-only";
import { after } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getConnection, olxConfigured, olxFetch } from "@/lib/olx/client";
import { markPending, syncListing } from "@/lib/olx/sync";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

type Db = SupabaseClient<Database>;

/**
 * Ponte entre o backoffice e a sincronização com o OLX.
 *
 * Quem grava uma viatura não pode ficar à espera do OLX (que pode demorar ou
 * estar em baixo), nem ver a gravação falhar por causa dele. Por isso aqui só
 * se marca como pendente, e a sincronização corre depois de a resposta sair
 * (`after`). O que falhar fica pendente e o /api/maintenance repete.
 */
export async function queueOlxSync(carIds: string[]): Promise<void> {
  if (!olxConfigured() || !carIds.length) return;
  const db = createAdminClient();
  if (!db) return;
  try {
    for (const id of carIds) await markPending(db, id);
  } catch (e) {
    console.error("queueOlxSync:", e);
    return;
  }
  after(async () => {
    const conn = await getConnection(db);
    if (!conn) return;
    for (const id of carIds) await syncListing(db, id);
  });
}

/**
 * Os anúncios do OLX destas viaturas, lidos ANTES de as apagar: ao apagar, a
 * linha de `channel_listings` desaparece em cascata e o id do anúncio perde-se.
 */
export async function olxAdvertIds(carIds: string[]): Promise<string[]> {
  if (!olxConfigured() || !carIds.length) return [];
  const db = createAdminClient();
  if (!db) return [];
  const { data } = await db
    .from("channel_listings")
    .select("external_id")
    .eq("channel", "olx")
    .in("car_id", carIds)
    .not("external_id", "is", null);
  return (data ?? []).flatMap((row) => (row.external_id ? [row.external_id] : []));
}

/**
 * Tira do OLX os anúncios de viaturas que JÁ foram apagadas (ids lidos com
 * `olxAdvertIds` antes de apagar). Só depois de o apagar correr bem: se
 * falhasse, a viatura ficava no site e o anúncio desaparecia do OLX, com o
 * backoffice a dizê-lo ainda publicado.
 */
export async function retireOlxAdverts(externalIds: string[]): Promise<void> {
  if (!olxConfigured() || !externalIds.length) return;
  const db = createAdminClient();
  if (!db || !(await getConnection(db))) return;
  for (const id of externalIds) {
    const r = await olxFetch(db, `/adverts/${id}/commands`, {
      method: "POST",
      body: { command: "deactivate", is_success: false },
    });
    if (!r.ok) console.error("retireOlxAdverts:", id, r.error);
  }
}

/**
 * Viaturas com reservas ativas já fora do prazo — lidas antes de
 * `expire_reservations`, que só devolve quantas expirou. Voltam a «publicada»
 * e o anúncio do OLX tem de as acompanhar.
 */
export async function carsWithExpiredReservations(db: Db): Promise<string[]> {
  const { data } = await db
    .from("reservations")
    .select("car_id")
    .eq("status", "active")
    .lte("expires_at", new Date().toISOString());
  return [...new Set((data ?? []).map((r) => r.car_id))];
}
