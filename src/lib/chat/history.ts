import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  ASSISTANT_MAX_CHARS,
  HISTORY_MAX_CHARS,
  HISTORY_MAX_MESSAGES,
  USER_MAX_CHARS,
  type ClientMessage,
} from "./conversation";

/**
 * Histórico da conversa que o browser devolve a cada pergunta.
 *
 * O browser guarda a conversa e manda-a de volta; sem verificação, qualquer
 * pessoa podia escrever respostas "do assistente" à medida (para o convencer a
 * quebrar as regras) ou mandar históricos enormes (para encarecer cada pedido).
 * Por isso:
 *  - cada resposta do assistente sai do servidor com uma assinatura (HMAC do
 *    texto); só as respostas assinadas são aceites de volta;
 *  - a conversa tem de alternar pessoa/assistente, começar e acabar na pessoa;
 *  - há tetos de mensagens e de caracteres (o browser só manda as últimas).
 */

export function signReply(text: string, secret: string): string {
  return createHmac("sha256", secret).update(`chat-reply:v1\n${text}`).digest("base64url");
}

function validSignature(text: string, sig: string | undefined, secret: string): boolean {
  if (!sig) return false;
  const expected = Buffer.from(signReply(text, secret));
  const given = Buffer.from(sig);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * A chave das assinaturas. Um segredo próprio se existir; senão um dos que o
 * servidor já tem (nunca sai do servidor e o HMAC não o revela).
 */
export function chatSecret(): string | null {
  return (
    process.env.CHAT_SIGNING_SECRET ||
    process.env.SUBMISSION_HASH_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.ANTHROPIC_API_KEY ||
    null
  );
}

/** A conversa pronta para o modelo, ou `null` se o histórico for inválido. */
export function validateHistory(
  messages: ClientMessage[],
  secret: string,
): { role: "user" | "assistant"; content: string }[] | null {
  if (!messages.length || messages.length > HISTORY_MAX_MESSAGES) return null;
  let total = 0;
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    // pessoa, assistente, pessoa, …, pessoa
    if (m.role !== (i % 2 === 0 ? "user" : "assistant")) return null;
    const text = m.content;
    if (!text.trim()) return null;
    if (text.length > (m.role === "user" ? USER_MAX_CHARS : ASSISTANT_MAX_CHARS)) return null;
    if (m.role === "assistant" && !validSignature(text, m.sig, secret)) return null;
    total += text.length;
  }
  if (total > HISTORY_MAX_CHARS) return null;
  if (messages[messages.length - 1]!.role !== "user") return null;
  return messages.map(({ role, content }) => ({ role, content }));
}
