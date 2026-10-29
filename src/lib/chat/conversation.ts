/**
 * Regras do histórico da conversa partilhadas pelo browser (`ChatWidget`) e
 * pelo servidor (`history.ts`, que verifica as assinaturas). Sem dependências
 * do Node: entra no bundle do browser.
 */

/** Pares pergunta/resposta que o browser reenvia (mais a pergunta nova). */
export const HISTORY_MAX_PAIRS = 10;
export const HISTORY_MAX_MESSAGES = HISTORY_MAX_PAIRS * 2 + 1;
export const USER_MAX_CHARS = 1000;
/** Respostas são curtas (2 a 4 frases); 4000 dá folga a uma lista. */
export const ASSISTANT_MAX_CHARS = 4000;
export const HISTORY_MAX_CHARS = 20000;

export interface ClientMessage {
  role: "user" | "assistant";
  content: string;
  /** Assinatura da resposta do assistente, devolvida pelo servidor. */
  sig?: string;
}

/**
 * Do lado do browser: as últimas trocas completas (pergunta + resposta
 * assinada) e a pergunta nova. Respostas que falharam (sem assinatura) ficam
 * no ecrã, mas não voltam ao servidor — com a pergunta que as originou.
 */
export function historyPayload(
  messages: ClientMessage[],
  question: string,
): ClientMessage[] {
  const pairs: ClientMessage[][] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const q = messages[i]!;
    const a = messages[i + 1]!;
    if (q.role === "user" && a.role === "assistant" && a.sig && a.content.trim()) {
      pairs.push([
        { role: "user", content: q.content },
        { role: "assistant", content: a.content, sig: a.sig },
      ]);
      i++;
    }
  }
  return [
    ...pairs.slice(-HISTORY_MAX_PAIRS).flat(),
    { role: "user", content: question },
  ];
}
