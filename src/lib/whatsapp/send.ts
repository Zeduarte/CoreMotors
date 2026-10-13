import "server-only";
import { graphBase, graphVersion } from "./graph";
import type { WhatsAppNumber } from "./account";

/**
 * Envio de mensagens pelo WhatsApp Cloud API da Meta.
 *
 * É o ÚNICO sítio do projecto que envia mensagens (o resto só gera links
 * `wa.me`). Nunca lança: uma resposta que não chega não pode fazer a rota
 * devolver erro à Meta, senão ela reentrega a mensagem e a pessoa recebe tudo
 * em duplicado.
 *
 * O número e o token vêm de `whatsAppNumber()`: o ligado no backoffice, ou as
 * variáveis do Netlify quando não há nenhum.
 */

/** O WhatsApp aceita mais, mas uma ordem nunca precisa de tanto. */
const MAX_BODY = 4000;

export interface SendResult {
  ok: boolean;
  error?: string;
}

export async function sendWhatsAppText(
  to: string,
  body: string,
  number: WhatsAppNumber | null,
): Promise<SendResult> {
  if (!number?.accessToken) return { ok: false, error: "WhatsApp não configurado" };

  try {
    const response = await fetch(
      `${graphBase()}/${graphVersion()}/${encodeURIComponent(number.phoneNumberId)}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${number.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to,
          type: "text",
          text: { preview_url: false, body: body.slice(0, MAX_BODY) },
        }),
        // Como em src/lib/notifications.ts: tempo limite curto e sem seguir
        // redireccionamentos, que num pedido com o token seriam uma fuga.
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      },
    );
    if (!response.ok) return { ok: false, error: `HTTP ${response.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Falha no envio" };
  }
}
