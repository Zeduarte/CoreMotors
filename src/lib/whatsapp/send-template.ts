import "server-only";
import { graphBase, graphVersion } from "./graph";
import type { WhatsAppNumber } from "./account";
import type { TemplateFamily } from "@/lib/notification-events";

/**
 * Envio de mensagens por MODELO (template) pelo WhatsApp Cloud API.
 *
 * As respostas do assistente (send.ts) saem dentro da janela de 24 horas que a
 * pessoa abriu ao escrever. Um aviso é a empresa a iniciar a conversa, e aí a
 * Meta só aceita modelos aprovados no WhatsApp Manager (categoria «utility»).
 * O texto fixo vive no modelo, aprovado uma vez; aqui vão só as variáveis.
 *
 * Os modelos são da conta do WhatsApp Business de cada stand: o administrador
 * de cada cliente submete-os na sua conta (docs/WHATSAPP_TEMPLATES.md). Os
 * nomes podem ser trocados por variáveis de ambiente — a Meta não deixa voltar
 * a usar o nome de um modelo apagado durante 30 dias, e um stand pode já ter
 * modelos seus com outro nome.
 *
 * Nunca lança, como send.ts: um aviso que não sai não pode estragar nada.
 */

export interface TemplateDefinition {
  /** O nome por defeito, a submeter no WhatsApp Manager. */
  name: string;
  /** A variável de ambiente que o substitui. */
  env: string;
  /** O texto exato do corpo, com {{1}}, {{2}}, … */
  body: string;
  /** Valores de exemplo, que a Meta pede ao submeter. */
  example: string[];
  /** Botões de resposta rápida (texto de cada um), se o modelo os tiver. */
  buttons?: string[];
}

export const NOTIFICATION_TEMPLATES: Record<TemplateFamily, TemplateDefinition> = {
  lead: {
    // «engineline_lead» (com link) ficou na Meta; este leva os dados do contacto.
    name: "engineline_contacto",
    env: "WHATSAPP_TEMPLATE_LEAD",
    body:
      "Novo pedido no backoffice: {{1}}.\n\nCliente: {{2}}\nTelemóvel: {{3}}\nEmail: {{4}}\n" +
      "Viatura: {{5}}\nMensagem: {{6}}\n\nResponda ao cliente o mais depressa possível.",
    example: [
      "proposta de preço de 18 500 €",
      "Maria Silva",
      "+351 912 345 678",
      "maria.silva@exemplo.pt",
      "BMW 320d Touring",
      "Gostava de ver a viatura no sábado de manhã.",
    ],
  },
  viatura: {
    // «engineline_viatura» (com link) ficou na Meta; este já não o leva.
    name: "engineline_novidade",
    env: "WHATSAPP_TEMPLATE_VIATURA",
    body: "Novidade nas viaturas do backoffice: {{1}}.\n\nViatura: {{2}}\n\nTrate disto no backoffice quando puder.",
    example: ["viatura publicada no site", "Honda CB500F · AA-00-BB"],
  },
  testemunho: {
    // «engineline_testemunho» (com link) ficou na Meta; este já não o leva.
    name: "engineline_testemunho_novo",
    env: "WHATSAPP_TEMPLATE_TESTEMUNHO",
    body:
      "Chegou um testemunho novo pelo site, à espera de aprovação.\n\nAutor: {{1}}\nClassificação: {{2}} em 5\n\n" +
      "Aprove-o ou recuse-o no backoffice: só aparece no site depois de aprovado.",
    example: ["João Pereira", "5"],
  },
  visita_equipa: {
    name: "engineline_visita_equipa",
    env: "WHATSAPP_TEMPLATE_VISITA_EQUIPA",
    body:
      "Pedido de visita ao stand para {{1}}.\n\nCliente: {{2}}\nTelemóvel: {{3}}\nViatura: {{4}}\nMensagem: {{5}}\n\n" +
      "Pode receber esta visita? Escolha uma opção abaixo.",
    example: [
      "terça-feira, 27 de outubro, às 10:30",
      "Maria Silva",
      "+351 912 345 678",
      "Honda CB500F 2021",
      "Gostava de ver a mota ao fim da tarde.",
    ],
    buttons: ["Confirmar visita", "Não posso nessa hora"],
  },
  aviso: {
    // «engineline_aviso»(com link) ficou na Meta; este já não o leva.
    name: "engineline_aviso_geral",
    env: "WHATSAPP_TEMPLATE_AVISO",
    body: "Aviso do backoffice: {{1}}.\n\nTrate disto no backoffice logo que possível.",
    example: ["o acesso ao WhatsApp dado pela Meta expira a 12/12/2026; volte a ligar o número em «Trocar de número»"],
  },
};

export const DEFAULT_TEMPLATE_LANGUAGE = "pt_PT";

export function templateName(family: TemplateFamily): string {
  const def = NOTIFICATION_TEMPLATES[family];
  return process.env[def.env]?.trim() || def.name;
}

export function templateLanguage(): string {
  return process.env.WHATSAPP_TEMPLATE_LANGUAGE?.trim() || DEFAULT_TEMPLATE_LANGUAGE;
}

export interface TemplateMessage {
  name: string;
  language: string;
  /** As variáveis do corpo, por ordem. */
  params: string[];
  /** Botões de resposta rápida, por ordem: o `payload` volta no webhook. */
  buttons?: { payload: string }[];
}

/** O que se aceita num payload de botão (a Meta deixa até 256 caracteres). */
const BUTTON_PAYLOAD = /^[A-Za-z0-9:_-]{1,256}$/;

export interface TemplateSendResult {
  ok: boolean;
  /** O id da mensagem na Meta (wamid). */
  messageId?: string;
  error?: string;
  /** Repetir não adianta: o modelo não existe ou está parado, as variáveis não
   *  batem certo, o número não tem WhatsApp. Fica para o administrador. */
  permanent?: boolean;
  /** A Meta não respondeu a tempo: a mensagem pode ter chegado, por isso não se
   *  repete sozinha. */
  uncertain?: boolean;
}

/**
 * Códigos da Meta para os quais repetir o mesmo envio dá o mesmo erro.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const PERMANENT_CODES = new Set([
  100, // parâmetro inválido (nome ou idioma do modelo mal escritos)
  131021, // o destinatário é o próprio número da empresa
  131026, // mensagem impossível de entregar (o número não tem WhatsApp)
  131030, // número fora da lista de teste (app da Meta em modo de desenvolvimento)
  131051, // tipo de mensagem não suportado
  132000, // o número de variáveis não bate com o modelo
  132001, // o modelo não existe (ou não foi aprovado) nesse idioma
  132005, // texto demasiado longo depois de preenchido
  132007, // o texto viola a política de formatação
  132012, // formato das variáveis errado
  132015, // modelo pausado pela Meta
  132016, // modelo desativado pela Meta
  132018, // problema nas variáveis
]);

/**
 * O motivo que a Meta dá, no mesmo formato do painel das respostas
 * (`graphError` em send.ts). O corpo de erro da Graph API nunca traz o token.
 */
function graphFailure(status: number, data: unknown): { message: string; code?: number } {
  const e = (data as { error?: { code?: number; message?: string; error_data?: { details?: string } } } | null)
    ?.error;
  const prefix = `HTTP ${status}`;
  if (!e) return { message: prefix };
  const motivo = [e.code ? `(#${e.code})` : "", e.message ?? "", e.error_data?.details ?? ""]
    .filter(Boolean)
    .join(" ");
  return { message: `${prefix} — ${motivo}`.slice(0, 300), code: typeof e.code === "number" ? e.code : undefined };
}

export async function sendWhatsAppTemplate(
  to: string,
  template: TemplateMessage,
  number: WhatsAppNumber | null,
): Promise<TemplateSendResult> {
  if (!number?.accessToken) return { ok: false, error: "WhatsApp não configurado" };
  // Só algarismos, com indicativo: é o formato que a Meta espera, e nada mais
  // entra no pedido.
  if (!/^\d{9,15}$/.test(to)) return { ok: false, permanent: true, error: "Número de destino inválido" };
  if (!/^[a-z0-9_]{1,512}$/.test(template.name)) {
    return { ok: false, permanent: true, error: `Nome de modelo inválido: ${template.name.slice(0, 60)}` };
  }

  const buttons = template.buttons ?? [];
  if (buttons.length > 3 || buttons.some((b) => !BUTTON_PAYLOAD.test(b.payload))) {
    return { ok: false, permanent: true, error: "Payload de botão inválido" };
  }
  const components: unknown[] = [];
  if (template.params.length) {
    components.push({ type: "body", parameters: template.params.map((text) => ({ type: "text", text })) });
  }
  buttons.forEach((b, i) =>
    components.push({
      type: "button",
      sub_type: "quick_reply",
      index: String(i),
      parameters: [{ type: "payload", payload: b.payload }],
    }),
  );

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
          type: "template",
          template: {
            name: template.name,
            language: { code: template.language },
            components,
          },
        }),
        // Como em send.ts: tempo limite curto e sem seguir redireccionamentos,
        // que num pedido com o token seriam uma fuga.
        signal: AbortSignal.timeout(8000),
        redirect: "error",
      },
    );
    const data = (await response.json().catch(() => null)) as { messages?: { id?: string }[] } | null;
    if (!response.ok) {
      const { message, code } = graphFailure(response.status, data);
      return { ok: false, error: message, permanent: code !== undefined && PERMANENT_CODES.has(code) };
    }
    const id = data?.messages?.[0]?.id;
    return { ok: true, messageId: typeof id === "string" ? id : undefined };
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    // O pedido saiu e a resposta não chegou: a Meta pode tê-lo enviado.
    if (name === "TimeoutError" || name === "AbortError") {
      return { ok: false, uncertain: true, error: "A Meta não respondeu a tempo — a mensagem pode ter chegado" };
    }
    return { ok: false, error: e instanceof Error ? e.message.slice(0, 200) : "Falha no envio" };
  }
}
