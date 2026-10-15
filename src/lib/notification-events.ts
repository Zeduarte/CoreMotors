import type { Section } from "@/lib/permissions";

/**
 * Os avisos por WhatsApp aos colaboradores: o catálogo e o texto de cada um.
 *
 * Sem `server-only`: o perfil (para ligar e desligar cada aviso) e o envio usam
 * o mesmo catálogo. QUEM recebe decide-se na base de dados (migração 0036,
 * `notification_event_section`), com as mesmas permissões do backoffice; aqui
 * vivem só os nomes e o texto. Um teste garante que os dois catálogos têm
 * exatamente os mesmos avisos.
 *
 * A Meta só deixa a empresa iniciar uma conversa com modelos aprovados, por
 * isso o texto fixo está nos modelos (src/lib/whatsapp/send-template.ts e
 * docs/WHATSAPP_TEMPLATES.md) e aqui só se calculam as variáveis. Há quatro
 * modelos para todos os avisos — cada modelo novo é mais um pedido de
 * aprovação para o administrador de cada stand.
 */

export type TemplateFamily = "lead" | "viatura" | "testemunho" | "aviso";

export interface NotificationEventInfo {
  key: string;
  /** Separador do backoffice a que o aviso pertence: só o recebe quem o tem. */
  section: Section;
  family: TemplateFamily;
  /** Como aparece no perfil, para ligar e desligar. */
  label: string;
}

export const NOTIFICATION_EVENTS = [
  { key: "lead_contact", section: "leads", family: "lead", label: "Pedidos de contacto e de financiamento" },
  { key: "lead_test_drive", section: "leads", family: "lead", label: "Pedidos de test drive" },
  { key: "lead_offer", section: "leads", family: "lead", label: "Propostas de preço" },
  { key: "lead_reservation", section: "leads", family: "lead", label: "Pedidos de reserva com sinal" },
  { key: "lead_trade_in", section: "leads", family: "lead", label: "Pedidos de venda ou retoma" },
  { key: "lead_order", section: "leads", family: "lead", label: "Encomendas de viatura" },
  { key: "lead_alert", section: "leads", family: "lead", label: "Alertas de stock («avise-me quando entrar»)" },
  { key: "vehicle_reserved", section: "leads", family: "viatura", label: "Viaturas reservadas por um colega" },
  { key: "testimonial_pending", section: "testemunhos", family: "testemunho", label: "Testemunhos à espera de aprovação" },
  { key: "vehicle_workshop", section: "oficina", family: "viatura", label: "Viaturas novas na oficina" },
  { key: "vehicle_created", section: "carros", family: "viatura", label: "Viaturas novas criadas em Viaturas" },
  { key: "vehicle_prepared", section: "carros", family: "viatura", label: "Viaturas dadas como preparadas pela oficina" },
  { key: "vehicle_published", section: "carros", family: "viatura", label: "Viaturas publicadas no site" },
  { key: "whatsapp_expiring", section: "integracoes", family: "aviso", label: "Acesso ao WhatsApp prestes a expirar" },
] as const satisfies readonly NotificationEventInfo[];

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]["key"];

const BY_KEY = new Map<string, NotificationEventInfo>(NOTIFICATION_EVENTS.map((e) => [e.key, e]));

export function notificationEvent(key: string): NotificationEventInfo | null {
  return BY_KEY.get(key) ?? null;
}

/** Os avisos que fazem sentido para quem tem estes separadores. */
export function eventsForSections(sections: readonly Section[]): NotificationEventInfo[] {
  return NOTIFICATION_EVENTS.filter((e) => sections.includes(e.section));
}

/** As variáveis de um modelo, por ordem ({{1}}, {{2}}, …). */
export interface NotificationMessage {
  family: TemplateFamily;
  params: string[];
}

type Payload = Record<string, unknown>;

/**
 * Uma variável de modelo aceitável pela Meta. A Graph API recusa a mensagem
 * inteira (#132018) se uma variável tiver mudanças de linha, tabulações ou mais
 * de quatro espaços seguidos, e não aceita variáveis vazias. O nome de um
 * cliente vem de um formulário público: pode trazer qualquer uma das três.
 */
export function templateParam(value: unknown, max = 120): string {
  const raw = value === null || value === undefined ? "" : String(value);
  const text = Array.from(raw, (ch) => {
    const code = ch.charCodeAt(0);
    return code < 32 || code === 127 ? " " : ch;
  })
    .join("")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!text) return "—";
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

const eur = new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const day = new Intl.DateTimeFormat("pt-PT", {
  timeZone: "Europe/Lisbon",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

function money(value: unknown): string | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? eur.format(n) : null;
}

function date(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : day.format(d);
}

/** "BMW 320d Touring · AA-00-BB". O modelo «—» é o das entradas da oficina. */
export function vehicleLabel(payload: Payload): string {
  const parts = [payload.make, payload.model, payload.variant]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter((p) => p && p !== "—");
  const name = parts.join(" ") || "Viatura sem nome";
  const plate = typeof payload.plate === "string" && payload.plate.trim() ? payload.plate.trim() : "";
  return plate ? `${name} · ${plate}` : name;
}

/** O que se pede, como fica depois de «Novo pedido no backoffice:». */
const LEAD_LABEL: Record<string, string> = {
  contact: "pedido de contacto",
  finance: "pedido de financiamento",
  test_drive: "pedido de test drive",
  offer: "proposta de preço",
  reservation: "pedido de reserva com sinal",
  trade_in: "pedido de venda / retoma",
  order: "encomenda de viatura",
  alert: "alerta de stock («avise-me quando entrar»)",
};

function leadLabel(payload: Payload): string {
  const kind = typeof payload.kind === "string" ? payload.kind : "contact";
  const base = LEAD_LABEL[kind] ?? LEAD_LABEL.contact!;
  if (kind === "offer") {
    const value = money(payload.offer_amount);
    return value ? `${base} de ${value}` : base;
  }
  if (kind === "reservation") {
    const value = money(payload.deposit);
    return value ? `${base} de ${value}` : base;
  }
  return base;
}

const VEHICLE_LABEL: Record<string, string> = {
  vehicle_workshop: "viatura nova na oficina",
  vehicle_created: "viatura nova criada em Viaturas",
  vehicle_prepared: "viatura preparada pela oficina, pronta a completar e publicar",
  vehicle_published: "viatura publicada no site",
};

function link(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/$/, "")}${path}`;
}

/**
 * As variáveis do modelo para um aviso. `null` = aviso desconhecido (um
 * registo antigo de uma versão que já não existe): não se envia.
 */
export function buildNotification(
  event: string,
  subject: string,
  payload: Payload,
  baseUrl: string,
): NotificationMessage | null {
  const info = notificationEvent(event);
  if (!info) return null;
  switch (info.key) {
    case "lead_contact":
    case "lead_test_drive":
    case "lead_offer":
    case "lead_reservation":
    case "lead_trade_in":
    case "lead_order":
    case "lead_alert":
      return {
        family: "lead",
        params: [
          templateParam(leadLabel(payload)),
          templateParam(payload.name, 60),
          templateParam(
            typeof payload.car_label === "string" && payload.car_label.trim()
              ? payload.car_label
              : "sem viatura associada",
            80,
          ),
          templateParam(link(baseUrl, `/admin/leads/${subject}`), 300),
        ],
      };
    case "testimonial_pending": {
      const rating = Number(payload.rating);
      return {
        family: "testemunho",
        params: [
          templateParam(payload.name, 60),
          templateParam(Number.isInteger(rating) && rating >= 1 && rating <= 5 ? rating : "—"),
          templateParam(link(baseUrl, "/admin/testemunhos"), 300),
        ],
      };
    }
    case "vehicle_reserved": {
      const until = date(payload.expires_at);
      const deposit = money(payload.deposit);
      const label = [
        until ? `viatura reservada até ${until}` : "viatura reservada",
        deposit ? `com sinal de ${deposit}` : null,
      ]
        .filter(Boolean)
        .join(", ");
      const lead = typeof payload.lead_id === "string" ? payload.lead_id : "";
      return {
        family: "viatura",
        params: [
          templateParam(label),
          templateParam(vehicleLabel(payload), 80),
          templateParam(link(baseUrl, lead ? `/admin/leads/${lead}` : "/admin/leads"), 300),
        ],
      };
    }
    case "vehicle_workshop":
    case "vehicle_created":
    case "vehicle_prepared":
    case "vehicle_published":
      return {
        family: "viatura",
        params: [
          templateParam(VEHICLE_LABEL[info.key]),
          templateParam(vehicleLabel(payload), 80),
          templateParam(
            link(baseUrl, info.key === "vehicle_workshop" ? `/admin/oficina/${subject}` : `/admin/carros/${subject}`),
            300,
          ),
        ],
      };
    case "whatsapp_expiring": {
      const until = date(payload.expires_at);
      return {
        family: "aviso",
        params: [
          templateParam(
            `o acesso ao WhatsApp dado pela Meta expira${until ? ` a ${until}` : " em breve"}; volte a ligar o número em «Trocar de número»`,
            200,
          ),
          templateParam(link(baseUrl, "/admin/integracoes"), 300),
        ],
      };
    }
  }
  return null;
}

/**
 * Avisos que podem chegar aos montes de uma vez (publicar 20 viaturas numa ação
 * em lote): a partir de três para a mesma pessoa, vai uma mensagem só.
 */
const DIGEST: Record<string, { label: (n: number) => string; path: string }> = {
  vehicle_workshop: { label: (n) => `${n} viaturas novas na oficina`, path: "/admin/oficina" },
  vehicle_created: { label: (n) => `${n} viaturas novas criadas em Viaturas`, path: "/admin/carros" },
  vehicle_prepared: { label: (n) => `${n} viaturas preparadas pela oficina`, path: "/admin/carros" },
  vehicle_published: { label: (n) => `${n} viaturas publicadas no site`, path: "/admin/carros" },
};
export const DIGEST_FROM = 3;

export function canDigest(event: string): boolean {
  return event in DIGEST;
}

export function buildDigest(event: string, payloads: Payload[], baseUrl: string): NotificationMessage | null {
  const digest = DIGEST[event];
  if (!digest || payloads.length === 0) return null;
  const names = payloads.slice(0, 3).map((p) => vehicleLabel({ ...p, plate: null }));
  const rest = payloads.length - names.length;
  return {
    family: "viatura",
    params: [
      templateParam(digest.label(payloads.length)),
      templateParam(`${names.join(", ")}${rest > 0 ? ` e mais ${rest}` : ""}`, 160),
      templateParam(link(baseUrl, digest.path), 300),
    ],
  };
}
