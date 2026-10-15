import "server-only";
import { revalidatePath, revalidateTag } from "next/cache";
import { deliverNotificationsSoon } from "@/lib/notifications-kick";
import { queueOlxSync } from "@/lib/olx/queue";
import { PUBLIC_DATA_TAG } from "@/lib/public-cache";
import type { HandleResult } from "@/lib/whatsapp/handle";

/**
 * Depois de uma escrita confirmada pelo WhatsApp, o mesmo que o backoffice faz
 * depois de gravar: limpar as caches das páginas afectadas e, numa viatura
 * publicada, avisar o OLX (como `setCarStatus`/`updateCar`).
 *
 * Fica fora do `handleInbound` de propósito: este usa `next/cache`, que só
 * existe dentro de um pedido do Next, e o `handleInbound` corre também nos
 * testes. Nunca lança — a escrita já está feita e confirmada à pessoa; uma
 * cache por limpar não a pode desfazer.
 */
export async function afterWrite(changed: NonNullable<HandleResult["changed"]>): Promise<void> {
  try {
    switch (changed.kind) {
      case "register_vehicle":
      case "log_hours":
        revalidatePath("/admin/oficina", "layout");
        break;
      case "add_cost":
        revalidatePath("/admin/financeiro", "layout");
        revalidatePath("/admin/oficina", "layout");
        break;
      case "create_draft_car":
        // Em rascunho não está no site: só o backoffice muda.
        revalidatePath("/admin/carros", "layout");
        break;
      case "update_car":
      case "set_car_status":
        // Preço, km, texto e estado aparecem no site e nos portais.
        revalidateTag(PUBLIC_DATA_TAG);
        revalidatePath("/", "layout");
        if (changed.carId) await queueOlxSync([changed.carId]);
        break;
      case "set_lead_status":
      case "assign_lead":
      case "add_lead_note":
        revalidatePath("/admin/leads", "layout");
        revalidatePath("/admin");
        break;
      case "set_testimonial":
        revalidateTag(PUBLIC_DATA_TAG);
        revalidatePath("/", "layout");
        break;
    }
    // Uma viatura criada, publicada ou dada como pronta agenda avisos à
    // equipa (migração 0036): seguem já, como depois de gravar no backoffice.
    deliverNotificationsSoon();
  } catch (error) {
    console.error("whatsapp afterWrite:", error);
  }
}
