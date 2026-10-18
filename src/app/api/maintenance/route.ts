import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { PUBLIC_DATA_TAG } from "@/lib/public-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { processNotificationJobs } from "@/lib/notifications";
import { refreshIfNeeded } from "@/lib/olx/client";
import { refreshStats, syncPending } from "@/lib/olx/sync";
import { pruneWaMedia } from "@/lib/whatsapp/photos";
import { runStockAlerts } from "@/lib/stock-alert-run";
import { runVisitReminders } from "@/lib/visit-run";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const secret = process.env.MAINTENANCE_SECRET;
  const token = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  if (!secret || Buffer.byteLength(token) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(token),Buffer.from(expected))) return NextResponse.json({error:"Unauthorized"},{status:401});
  const db = createAdminClient();
  if (!db) return NextResponse.json({error:"Unavailable"},{status:503});
  const {data: expired, error} = await db.rpc("expire_reservations");
  if (error) return NextResponse.json({error:"Maintenance failed"},{status:503});
  // Reservas expiradas voltam a "publicada": o site tem de o mostrar já. Só
  // quando alguma expirou — limpar sempre apagava as páginas guardadas na CDN
  // de 15 em 15 minutos, e a visita seguinte esperava pela função.
  if (expired) revalidateTag(PUBLIC_DATA_TAG);
  // Webhook dos contactos e avisos por WhatsApp à equipa (os que não saíram
  // logo a seguir à ação, os que falharam e os do assistente do WhatsApp).
  const result = await processNotificationJobs();
  // Alertas de stock e lembretes das visitas aos clientes (0042). Nunca lançam.
  await runStockAlerts(db);
  await runVisitReminders(db);
  await db.rpc("prune_submission_limits");
  // Avisos por WhatsApp com mais de 30 dias (0036). Sem a migração, falha
  // em silêncio, como as outras limpezas.
  await db.rpc("prune_notification_jobs");
  // Mensagens do WhatsApp já vistas (7 dias) e propostas resolvidas (1 dia).
  // A expiração das propostas é decidida no código; isto só recupera espaço.
  await db.rpc("prune_whatsapp");
  // Fotografias do WhatsApp por juntar há mais de dois dias, com os ficheiros
  // (0039). Nunca lança.
  await pruneWaMedia(db);
  // OLX: mantém o token vivo, repete as sincronizações que falharam e
  // atualiza as estatísticas dos anúncios. Uma falha do OLX não pode fazer
  // falhar a manutenção do resto.
  try {
    await refreshIfNeeded(db);
    await syncPending(db);
    await refreshStats(db);
  } catch (e) {
    console.error("maintenance olx:", e);
  }
  return NextResponse.json(result,{status:result.ok ? 200 : 503});
}
