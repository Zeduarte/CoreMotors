import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Memória curta da conversa de cada número (tabela wa_conversation, 0037).
 *
 * Só texto — o que a pessoa escreveu e o que leu como resposta. Nunca lança:
 * sem a migração aplicada, ou se a base falhar, o assistente funciona como
 * antes, mensagem a mensagem.
 */

/** Mensagens anteriores que voltam ao modelo (perguntas e respostas). */
export const MEMORY_MESSAGES = 8;
/** Uma conversa parada há mais do que isto já não é a mesma conversa. */
const MEMORY_WINDOW_MS = 6 * 60 * 60 * 1000;
const MAX_STORED = 4000;

export interface MemoryRow {
  role: string;
  content: string;
}

/**
 * Linhas → mensagens para a API: a primeira tem de ser da pessoa e a última do
 * assistente (a mensagem nova é acrescentada a seguir). Mensagens seguidas do
 * mesmo lado juntam-se numa só.
 */
export function toConversation(rows: MemoryRow[]): Anthropic.MessageParam[] {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const row of rows) {
    if (row.role !== "user" && row.role !== "assistant") continue;
    const text = row.content.trim();
    if (!text) continue;
    const last = out[out.length - 1];
    if (last && last.role === row.role) last.content += `\n${text}`;
    else out.push({ role: row.role, content: text });
  }
  while (out.length && out[0]?.role !== "user") out.shift();
  while (out.length && out[out.length - 1]?.role !== "assistant") out.pop();
  return out;
}

export async function loadMemory(
  db: SupabaseClient<never> | SupabaseClient,
  from: string,
  now: Date,
): Promise<Anthropic.MessageParam[]> {
  try {
    const client = db as unknown as SupabaseClient;
    const { data, error } = await client
      .from("wa_conversation")
      .select("role,content,created_at")
      .eq("from_phone", from)
      .gte("created_at", new Date(now.getTime() - MEMORY_WINDOW_MS).toISOString())
      .order("created_at", { ascending: false })
      // A pergunta e a resposta entram no mesmo insert, com a mesma hora: o id
      // (sequência) é que diz qual veio primeiro.
      .order("id", { ascending: false })
      .limit(MEMORY_MESSAGES);
    if (error || !data) return [];
    return toConversation((data as MemoryRow[]).slice().reverse());
  } catch {
    return [];
  }
}

export async function remember(
  db: SupabaseClient<never> | SupabaseClient,
  from: string,
  userText: string,
  reply: string,
): Promise<void> {
  try {
    const client = db as unknown as SupabaseClient;
    await client.from("wa_conversation").insert([
      { from_phone: from, role: "user", content: userText.slice(0, MAX_STORED) },
      { from_phone: from, role: "assistant", content: reply.slice(0, MAX_STORED) },
    ]);
  } catch {
    // Sem memória a conversa continua; não vale a pena falhar a resposta por isso.
  }
}
