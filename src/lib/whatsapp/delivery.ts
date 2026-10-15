import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import type { WhatsAppNumber } from "./account";
import { MAX_CAPTION, sendWhatsAppImage, sendWhatsAppText, type SendResult } from "./send";

/**
 * Entregar a resposta: a proposta vai como imagem (o formulário preenchido)
 * com o texto de confirmação como legenda; tudo o resto vai em texto.
 *
 * A regra que manda aqui: a pessoa recebe SEMPRE a pergunta. A imagem é uma
 * ajuda para ler, não uma condição — se não puder ir, ou não chegar, vai o
 * texto, que tem tudo o que vai ser gravado.
 */

type Db = SupabaseClient<Database>;

export interface Delivery {
  /** O que chegou à Meta: a imagem, ou o texto. */
  sent: SendResult;
  /** Porque é que a imagem não foi, quando se recorreu ao texto. */
  imageError?: string;
}

export async function deliverReply(
  db: Db,
  to: string,
  reply: string,
  image: { url: string; pendingId: string } | undefined,
  number: WhatsAppNumber | null,
): Promise<Delivery> {
  // Uma legenda cortada era uma proposta que a pessoa não leu inteira: nesse
  // caso vai só o texto (as propostas são curtas, mas a regra não depende disso).
  if (image && reply.length <= MAX_CAPTION) {
    const asImage = await sendWhatsAppImage(to, image.url, reply, number);
    if (asImage.ok) {
      if (asImage.id) {
        // Para um recibo «failed» posterior encontrar a proposta e mandá-la em
        // texto. Sem a 0038 aplicada isto falha em silêncio — fica só sem esse recurso.
        await db
          .from("wa_pending_actions")
          .update({ image_wamid: asImage.id })
          .eq("id", image.pendingId);
      }
      return { sent: asImage };
    }
    const sent = await sendWhatsAppText(to, reply, number);
    return { sent, imageError: asImage.error ?? "falha no envio" };
  }
  return { sent: await sendWhatsAppText(to, reply, number) };
}

/**
 * A Meta aceitou a imagem mas não a conseguiu entregar (recibo «failed»): a
 * proposta segue em texto — `summary` é exactamente a frase de confirmação.
 *
 * O `update … select` limpa `image_wamid` e devolve a linha numa só operação:
 * é a reclamação. Uma reentrega do mesmo recibo já não encontra nada, por isso
 * a pessoa não recebe a pergunta duas vezes. Nunca lança.
 */
export async function recoverFailedImages(
  db: Db,
  failures: { id: string; error: string }[],
  number: WhatsAppNumber | null,
  now: Date = new Date(),
): Promise<number> {
  let resent = 0;
  for (const failure of failures) {
    try {
      const { data } = await db
        .from("wa_pending_actions")
        .update({ image_wamid: null })
        .eq("image_wamid", failure.id)
        .select("from_phone,summary,status,expires_at")
        .maybeSingle();
      if (!data) continue;
      // Já respondida, cancelada ou caducada: a pergunta agora só confundia.
      if (data.status !== "pending" || Date.parse(data.expires_at) <= now.getTime()) continue;
      console.warn(`api/whatsapp: imagem da proposta não entregue (${failure.error || "sem motivo"}); enviada em texto`);
      const sent = await sendWhatsAppText(data.from_phone, data.summary, number);
      if (sent.ok) resent++;
    } catch (error) {
      console.error("recoverFailedImages:", error);
    }
  }
  return resent;
}
