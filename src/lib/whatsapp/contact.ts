import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { normalizeWhatsApp } from "@/lib/phone";

/**
 * Quem escreve para o número da marca e não é colaborador.
 *
 * O número é de toda a gente. Um telefone sem perfil é um contacto, e um
 * contacto identifica-se SEMPRE pela empresa e pelo cargo: na primeira conversa
 * pergunta-se uma coisa de cada vez, com frases fixas (nada de modelo aqui — é
 * um estranho a escrever, e o que ele diz é dado, nunca instrução). Depois de
 * apresentado, as mensagens seguintes ficam registadas para a equipa e não se
 * responde automaticamente.
 */

type Db = SupabaseClient<Database>;

export const CONTACT_REPLIES = {
  empresa:
    "Olá! Fala com a Core Motors. Para o identificarmos, diga-nos por favor o nome da sua empresa.",
  cargo: (empresa: string) => `Obrigado. E qual é o seu cargo na ${empresa}?`,
  feito: "Obrigado! Já ficou registado e a nossa equipa responde-lhe em breve.",
} as const;

interface ContactRow {
  phone: string;
  step: "company" | "role" | "done";
  company: string | null;
  messages: number;
}

/** Texto de um estranho: uma linha, sem controlo, com limite. */
export function cleanAnswer(raw: string, max = 80): string {
  return raw
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export interface ExternalInbound {
  from: string;
  text: string;
  type: string;
  profileName?: string;
}

/** Regista a mensagem e devolve a resposta fixa que cabe, ou `null`. */
export async function handleExternal(db: Db, msg: ExternalInbound, now = new Date()): Promise<string | null> {
  const phone = normalizeWhatsApp(msg.from) || msg.from;
  const text = msg.type === "text" ? cleanAnswer(msg.text, 1000) : "";
  const stamp = now.toISOString();

  const { data } = await db
    .from("wa_contacts")
    .select("phone,step,company,messages")
    .eq("phone", phone)
    .maybeSingle();
  const row = data as ContactRow | null;

  if (!row) {
    await db.from("wa_contacts").insert({
      phone,
      profile_name: msg.profileName ? cleanAnswer(msg.profileName) : null,
      name: msg.profileName ? cleanAnswer(msg.profileName) : null,
      step: "company",
      messages: 1,
      first_message: text || null,
      last_message: text || `[${msg.type}]`,
      last_message_at: stamp,
    });
    return CONTACT_REPLIES.empresa;
  }

  const patch: Database["public"]["Tables"]["wa_contacts"]["Update"] = {
    last_message: text || `[${msg.type}]`,
    last_message_at: stamp,
    messages: row.messages + 1,
  };
  let reply: string | null = null;

  if (row.step === "company") {
    const company = cleanAnswer(text);
    if (company) {
      patch.company = company;
      patch.step = "role";
      reply = CONTACT_REPLIES.cargo(company);
    } else reply = CONTACT_REPLIES.empresa;
  } else if (row.step === "role") {
    const role = cleanAnswer(text);
    if (role) {
      patch.role = role;
      patch.step = "done";
      reply = CONTACT_REPLIES.feito;
    } else reply = CONTACT_REPLIES.cargo(row.company ?? "empresa");
  }

  await db.from("wa_contacts").update(patch).eq("phone", phone);
  return reply;
}
