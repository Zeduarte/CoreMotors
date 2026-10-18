import "server-only";
import { CUSTOMER_TEMPLATES, customerTemplateName, type CustomerTemplate } from "@/lib/customer-templates";
import type { TemplateFamily } from "@/lib/notification-events";
import { graphRequest } from "./graph";
import type { WhatsAppNumber } from "./account";
import { NOTIFICATION_TEMPLATES, templateLanguage, templateName, type TemplateDefinition } from "./send-template";

/**
 * Submete à Meta os modelos de mensagem do site (os quatro avisos à equipa e os
 * dois dos clientes), em vez de os criar à mão no WhatsApp Manager. É o mesmo
 * que docs/WHATSAPP_TEMPLATES.md descreve: categoria Utility, só corpo, texto e
 * exemplos de src/lib/whatsapp/send-template.ts e customer-templates.ts.
 *
 * Continua a ser a Meta a aprová-los (minutos a horas). Um modelo que já existe
 * não se repete nem conta como falha.
 */

export interface CreateTemplatesResult {
  ok: boolean;
  error?: string;
  /** Uma linha por modelo, para o administrador ver o que aconteceu. */
  lines: string[];
}

function definitions(): { name: string; def: TemplateDefinition }[] {
  const staff = (Object.keys(NOTIFICATION_TEMPLATES) as TemplateFamily[]).map((f) => ({
    name: templateName(f),
    def: NOTIFICATION_TEMPLATES[f],
  }));
  const customers = (Object.keys(CUSTOMER_TEMPLATES) as CustomerTemplate[]).map((k) => ({
    name: customerTemplateName(k),
    def: CUSTOMER_TEMPLATES[k],
  }));
  return [...staff, ...customers];
}

export async function createMessageTemplates(
  number: WhatsAppNumber | null,
  wabaId: string | null,
): Promise<CreateTemplatesResult> {
  const lines: string[] = [];
  if (!number?.accessToken) {
    return { ok: false, error: "Ligue primeiro o número do WhatsApp em Integrações.", lines };
  }
  // O ID da conta vem da ligação feita no backoffice (Embedded Signup) ou da
  // variável WHATSAPP_BUSINESS_ACCOUNT_ID do Netlify.
  if (!wabaId || !/^[0-9]+$/.test(wabaId)) {
    return {
      ok: false,
      error:
        "Falta o ID da conta do WhatsApp Business. Defina WHATSAPP_BUSINESS_ACCOUNT_ID no Netlify (WhatsApp Manager → Definições da conta) e faça um novo deploy, ou ligue o número em Integrações («Trocar de número»).",
      lines,
    };
  }
  const language = templateLanguage();
  const falhas: string[] = [];
  for (const { name, def } of definitions()) {
    const r = await graphRequest(`${wabaId}/message_templates`, {
      method: "POST",
      token: number.accessToken,
      body: {
        name,
        language,
        category: "UTILITY",
        components: [{ type: "BODY", text: def.body, example: { body_text: [def.example] } }],
      },
    });
    if (r.ok) lines.push(`${name}: enviado para aprovação.`);
    else if (/already exist|já existe/i.test(r.error)) lines.push(`${name}: já existia.`);
    else {
      lines.push(`${name}: recusado (${r.error}).`);
      falhas.push(name);
    }
  }
  return falhas.length
    ? { ok: false, error: `A Meta recusou ${falhas.length} de ${definitions().length}: ${falhas.join(", ")}.`, lines }
    : { ok: true, lines };
}
