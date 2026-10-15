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

/**
 * O motivo que a Meta dá, para o painel de Integrações. Só "HTTP 403" não diz
 * se é o token, a permissão ou o destinatário; o código e a mensagem da Meta
 * dizem. O corpo de erro da Graph API nunca traz o token, por isso pode ser
 * mostrado.
 */
async function graphError(response: Response): Promise<string> {
  const status = `HTTP ${response.status}`;
  try {
    const data = (await response.json()) as {
      error?: { code?: number; message?: string; error_data?: { details?: string } };
    };
    const e = data.error;
    if (!e) return status;
    const motivo = [e.code ? `(#${e.code})` : "", e.message ?? "", e.error_data?.details ?? ""]
      .filter(Boolean)
      .join(" ");
    return `${status} — ${motivo}`.slice(0, 300);
  } catch {
    return status;
  }
}

/**
 * Os dois vistos azuis e o «a escrever…» na conversa da pessoa, enquanto o
 * assistente pensa — como numa conversa com alguém que está a responder. A Meta
 * mostra o indicador até chegar a resposta (ou 25 segundos). Nunca lança: sem
 * indicador, a resposta chega na mesma.
 */
export async function markReadAndTyping(
  messageId: string,
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
          status: "read",
          message_id: messageId,
          typing_indicator: { type: "text" },
        }),
        // Curto: é só um sinal, não pode atrasar a resposta.
        signal: AbortSignal.timeout(3000),
        redirect: "error",
      },
    );
    if (!response.ok) return { ok: false, error: await graphError(response) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Falha no envio" };
  }
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
    if (!response.ok) return { ok: false, error: await graphError(response) };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Falha no envio" };
  }
}
