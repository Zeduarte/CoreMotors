/**
 * Leitura do que a Meta entrega.
 *
 * O webhook recebe muito mais recibos de entrega (`statuses`) do que mensagens,
 * e as listas podem trazer mais de um elemento. Por isso isto é tolerante por
 * desenho: o que não se reconhece é ignorado em vez de estourar — um erro aqui
 * faria a rota devolver 500 e a Meta reentregar em ciclo.
 */

export interface InboundMessage {
  wamId: string;
  from: string;
  /** "text" ou o tipo que a Meta indicou (image, audio, button, …). */
  type: string;
  /** Só preenchido quando `type === "text"`. */
  text: string;
  phoneNumberId: string;
  /** O nome do perfil de WhatsApp de quem escreveu, se a Meta o entregar. */
  profileName?: string;
  /**
   * Uma fotografia: `image`, ou `document` cujo tipo é de imagem (quem a manda
   * «como documento», para não perder qualidade). O ficheiro em si é
   * descarregado depois, pelo id (src/lib/whatsapp/photos.ts).
   */
  media?: InboundMedia;
  /**
   * A resposta a um botão: `button` (botão de resposta rápida de um modelo) ou
   * `interactive.button_reply`. O `payload` é o que o site pôs no botão ao enviar.
   */
  button?: { payload: string; text: string };
  /** O id da mensagem nossa a que a resposta se refere (`context.id`). */
  contextId?: string;
}

export interface InboundMedia {
  id: string;
  /** O tipo que a Meta indicou (ex.: image/jpeg). Verificado outra vez nos bytes. */
  mime: string;
  /** A legenda, se houver. Texto de quem escreveu: dado, nunca instrução. */
  caption: string;
}

/** A fotografia de uma mensagem `image` ou `document`, se for uma. */
function mediaOf(type: string, m: Record<string, unknown>): InboundMedia | undefined {
  if (type !== "image" && type !== "document") return undefined;
  const raw = asRecord(m[type]);
  const id = typeof raw.id === "string" ? raw.id : "";
  const mime = typeof raw.mime_type === "string" ? raw.mime_type.toLowerCase().split(";")[0]!.trim() : "";
  if (!id) return undefined;
  // Um PDF ou uma folha de cálculo não são fotografias: seguem como até aqui.
  if (type === "document" && !mime.startsWith("image/")) return undefined;
  const caption = typeof raw.caption === "string" ? raw.caption.slice(0, 1024) : "";
  return { id, mime, caption };
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

/**
 * Os recibos de mensagens NOSSAS que a Meta não conseguiu entregar
 * (`status: "failed"`). Interessam por um motivo: a imagem da proposta é
 * enviada por link e a Meta só a vai buscar depois de aceitar o envio — se
 * falhar, é por aqui que se sabe, e a proposta segue em texto. Nunca lança.
 */
export function extractFailedStatuses(payload: unknown): { id: string; error: string }[] {
  const out: { id: string; error: string }[] = [];
  for (const entry of asArray(asRecord(payload).entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const value = asRecord(asRecord(change).value);
      for (const raw of asArray(value.statuses)) {
        const s = asRecord(raw);
        if (s.status !== "failed" || typeof s.id !== "string" || !s.id) continue;
        const first = asRecord(asArray(s.errors)[0]);
        const error = [first.code ? `(#${String(first.code)})` : "", typeof first.title === "string" ? first.title : ""]
          .filter(Boolean)
          .join(" ");
        out.push({ id: s.id, error: error.slice(0, 200) });
      }
    }
  }
  return out;
}

/** O botão carregado, em `button` (modelos) ou `interactive.button_reply`. */
function buttonOf(type: string, m: Record<string, unknown>): { payload: string; text: string } | undefined {
  if (type === "button") {
    const b = asRecord(m.button);
    const payload = typeof b.payload === "string" ? b.payload.slice(0, 256) : "";
    return payload ? { payload, text: typeof b.text === "string" ? b.text.slice(0, 200) : "" } : undefined;
  }
  if (type === "interactive") {
    const reply = asRecord(asRecord(m.interactive).button_reply);
    const payload = typeof reply.id === "string" ? reply.id.slice(0, 256) : "";
    return payload ? { payload, text: typeof reply.title === "string" ? reply.title.slice(0, 200) : "" } : undefined;
  }
  return undefined;
}

/** Extrai as mensagens de um corpo da Meta. Nunca lança. */
export function extractMessages(payload: unknown): InboundMessage[] {
  const out: InboundMessage[] = [];
  for (const entry of asArray(asRecord(payload).entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const value = asRecord(asRecord(change).value);
      const phoneNumberId = String(asRecord(value.metadata).phone_number_id ?? "");
      // Nome do perfil por número (wa_id), para o contacto externo.
      const names = new Map<string, string>();
      for (const c of asArray(value.contacts)) {
        const contact = asRecord(c);
        const name = asRecord(contact.profile).name;
        if (typeof contact.wa_id === "string" && typeof name === "string") names.set(contact.wa_id, name);
      }
      for (const raw of asArray(value.messages)) {
        const m = asRecord(raw);
        const wamId = typeof m.id === "string" ? m.id : "";
        const from = typeof m.from === "string" ? m.from : "";
        if (!wamId || !from) continue;
        const type = typeof m.type === "string" ? m.type : "unknown";
        const body = asRecord(m.text).body;
        const media = mediaOf(type, m);
        const button = buttonOf(type, m);
        const contextId = asRecord(m.context).id;
        out.push({
          wamId,
          from,
          type,
          text: type === "text" && typeof body === "string" ? body : "",
          phoneNumberId,
          ...(names.get(from) ? { profileName: names.get(from) } : {}),
          ...(media ? { media } : {}),
          ...(button ? { button } : {}),
          ...(typeof contextId === "string" && contextId ? { contextId } : {}),
        });
      }
    }
  }
  return out;
}
