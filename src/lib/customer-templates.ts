import type { TemplateDefinition } from "@/lib/whatsapp/send-template";

/**
 * Modelos de WhatsApp das mensagens aos CLIENTES (alertas de stock e visitas).
 *
 * São diferentes dos avisos à equipa (send-template.ts): vão para quem deixou
 * o contacto no site e pediu para ser avisado por WhatsApp. Como esses, são a
 * empresa a iniciar a conversa, por isso a Meta só os aceita depois de
 * aprovados no WhatsApp Manager do número ligado (docs/WHATSAPP_TEMPLATES.md).
 *
 * A Meta não aceita modelos que comecem ou acabem numa variável: há sempre
 * texto antes de {{1}} e depois da última.
 */
export type CustomerTemplate = "alerta" | "visita" | "visita_cancelada" | "visita_pedido";

export const CUSTOMER_TEMPLATES: Record<CustomerTemplate, TemplateDefinition> = {
  alerta: {
    name: "engineline_alerta_stock",
    env: "WHATSAPP_TEMPLATE_ALERTA",
    body:
      "Olá {{1}}! Entrou na {{2}} uma viatura compatível com o alerta que criou no nosso site:\n\n{{3}}\n\n" +
      "Veja as fotos e os detalhes em {{4}}\n\n" +
      "Se já não está à procura, pode cancelar o alerta em {{5}} a qualquer momento.",
    example: [
      "Maria",
      "Supermotas",
      "Yamaha MT-07 · 2021 · 12 000 km · 6 900 €",
      "https://www.exemplo.pt/viaturas/yamaha-mt-07-2021",
      "https://www.exemplo.pt/alertas/cancelar/3f2a9c1e",
    ],
  },
  visita: {
    name: "engineline_visita",
    env: "WHATSAPP_TEMPLATE_VISITA",
    body:
      "Olá {{1}}! A sua visita à {{2}} está marcada para {{3}}.\n\n" +
      "Viatura: {{4}}\nMorada: {{5}}\n\n" +
      "Se precisar de mudar a hora, responda a esta mensagem.",
    example: [
      "Maria",
      "Supermotas",
      "terça-feira, 21 de outubro, às 10:30",
      "Yamaha MT-07 · 2021",
      "Av. da Liberdade 100, 1250-096 Lisboa",
    ],
  },
  visita_cancelada: {
    name: "engineline_visita_cancelada",
    env: "WHATSAPP_TEMPLATE_VISITA_CANCELADA",
    body:
      "Olá {{1}}! Infelizmente não conseguimos receber a sua visita à {{2}} em {{3}}.\n\n" +
      "Entraremos em contacto consigo para combinar outra hora que lhe convenha.",
    example: ["Maria", "Supermotas", "terça-feira, 21 de outubro, às 10:30"],
  },
  visita_pedido: {
    name: "engineline_visita_pedido",
    env: "WHATSAPP_TEMPLATE_VISITA_PEDIDO",
    body:
      "Olá {{1}}! Recebemos o seu pedido de visita à {{2}} para {{3}}.\n\n" +
      "Vamos confirmar a hora consigo em breve.",
    example: ["Maria", "Supermotas", "terça-feira, 21 de outubro, às 10:30"],
  },
};

export function customerTemplateName(key: CustomerTemplate): string {
  const def = CUSTOMER_TEMPLATES[key];
  return process.env[def.env]?.trim() || def.name;
}

/** O primeiro nome, para «Olá Maria!» (o modelo precisa de texto: nunca vazio). */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0]?.slice(0, 40) || "cliente";
}
