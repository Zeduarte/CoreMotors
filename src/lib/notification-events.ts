import { describeRange } from "@/lib/leave";
import type { Role, Section } from "@/lib/permissions";

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
 *
 * A migração 0041 acrescentou os avisos do que acontece DEPOIS (contactos
 * atribuídos, vendas, reservas que terminam, preços, viaturas que saem da
 * oficina) e os das férias — todos nos mesmos quatro modelos.
 */

export type TemplateFamily = "lead" | "viatura" | "testemunho" | "aviso";

/**
 * Separador do backoffice a que o aviso pertence: só o recebe quem o tem.
 * «perfil» é a área pessoal (as férias), que toda a gente tem.
 */
export type NotificationSection = Section | "perfil";

export interface NotificationEventInfo {
  key: string;
  section: NotificationSection;
  family: TemplateFamily;
  /** Como aparece no perfil, para ligar e desligar. */
  label: string;
  /** Ligado para quem nunca mexeu nas escolhas (`notification_event_default`). */
  defaultOn: boolean;
  /** Só faz sentido para estes papéis (ex.: decidir férias). Sem isto, todos. */
  roles?: readonly Role[];
}

export const NOTIFICATION_EVENTS = [
  { key: "lead_contact", section: "leads", family: "lead", label: "Pedidos de contacto e de financiamento", defaultOn: true },
  { key: "lead_test_drive", section: "leads", family: "lead", label: "Pedidos de test drive", defaultOn: true },
  { key: "lead_offer", section: "leads", family: "lead", label: "Propostas de preço", defaultOn: true },
  { key: "lead_reservation", section: "leads", family: "lead", label: "Pedidos de reserva com sinal", defaultOn: true },
  { key: "lead_trade_in", section: "leads", family: "lead", label: "Pedidos de venda ou retoma", defaultOn: true },
  { key: "lead_order", section: "leads", family: "lead", label: "Encomendas de viatura", defaultOn: true },
  { key: "lead_alert", section: "leads", family: "lead", label: "Alertas de stock («avise-me quando entrar»)", defaultOn: true },
  { key: "lead_assigned", section: "leads", family: "lead", label: "Contactos atribuídos a mim", defaultOn: true },
  { key: "lead_outcome", section: "leads", family: "viatura", label: "Contactos meus dados como ganhos ou perdidos por um colega", defaultOn: true },
  { key: "vehicle_reserved", section: "leads", family: "viatura", label: "Viaturas reservadas por um colega", defaultOn: true },
  { key: "vehicle_sold", section: "leads", family: "viatura", label: "Viaturas vendidas", defaultOn: true },
  { key: "reservation_ended", section: "leads", family: "viatura", label: "Reservas canceladas ou expiradas (a viatura volta a estar disponível)", defaultOn: true },
  { key: "testimonial_pending", section: "testemunhos", family: "testemunho", label: "Testemunhos à espera de aprovação", defaultOn: true },
  { key: "vehicle_workshop", section: "oficina", family: "viatura", label: "Viaturas novas na oficina", defaultOn: true },
  { key: "vehicle_created", section: "carros", family: "viatura", label: "Viaturas novas criadas em Viaturas", defaultOn: true },
  { key: "vehicle_prepared", section: "carros", family: "viatura", label: "Viaturas que saem da oficina e ficam prontas no stand", defaultOn: true },
  { key: "vehicle_published", section: "carros", family: "viatura", label: "Viaturas publicadas no site", defaultOn: true },
  { key: "vehicle_price_changed", section: "carros", family: "viatura", label: "Preço alterado numa viatura à venda", defaultOn: false },
  { key: "leave_requested", section: "perfil", family: "aviso", label: "Pedidos de férias à espera da minha decisão", defaultOn: true, roles: ["admin", "chefe"] },
  { key: "leave_decided", section: "perfil", family: "aviso", label: "Decisões sobre os meus pedidos de férias", defaultOn: true, roles: ["chefe", "vendedor", "mecanico"] },
  { key: "leave_upcoming", section: "perfil", family: "aviso", label: "Colegas que vão de férias nos próximos 7 dias", defaultOn: true },
  { key: "whatsapp_expiring", section: "integracoes", family: "aviso", label: "Acesso ao WhatsApp prestes a expirar", defaultOn: true },
] as const satisfies readonly NotificationEventInfo[];

export type NotificationEvent = (typeof NOTIFICATION_EVENTS)[number]["key"];

const BY_KEY = new Map<string, NotificationEventInfo>(NOTIFICATION_EVENTS.map((e) => [e.key, e]));

export function notificationEvent(key: string): NotificationEventInfo | null {
  return BY_KEY.get(key) ?? null;
}

/**
 * Os avisos que podem chegar a quem tem este papel e estes separadores: os dos
 * separadores que tem, os das férias (toda a gente tem perfil) e, destes, só os
 * do seu papel — o pedido de férias só chega a quem decide, a decisão só a quem
 * pede (o administrador aprova o próprio plano ao submetê-lo).
 */
export function eventsForProfile(role: string, sections: readonly Section[]): NotificationEventInfo[] {
  return NOTIFICATION_EVENTS.filter(
    (e: NotificationEventInfo) =>
      (e.section === "perfil" || sections.includes(e.section)) &&
      (!e.roles || e.roles.includes(role as Role)),
  );
}

/** O nome do grupo dos avisos das férias, no perfil. */
export const PERSONAL_GROUP_LABEL = "Férias";

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
  vehicle_published: "viatura publicada no site",
};

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** A ficha da viatura: o id vem no aviso (0041) ou é o próprio registo (0036). */
function carPath(payload: Payload, subject: string): string {
  return `/admin/carros/${text(payload.car_id) || subject}`;
}

/** O contacto: o id vem no aviso (0041) ou é o próprio registo (0036). */
function leadPath(payload: Payload, subject: string): string {
  return `/admin/leads/${text(payload.lead_id) || subject}`;
}

/**
 * «a mota Honda CB650R saiu da oficina e está pronta no stand». O nome sem a
 * matrícula: a matrícula vai na linha da viatura.
 */
function leftWorkshop(payload: Payload): string {
  const name = vehicleLabel({ ...payload, plate: null });
  const [artigo, tipo, pronta] =
    payload.vehicle_type === "motorcycle"
      ? ["a", "mota", "pronta"]
      : payload.vehicle_type === "car"
        ? ["o", "carro", "pronto"]
        : ["a", "viatura", "pronta"];
  return payload.status === "published"
    ? `${artigo} ${tipo} ${name} saiu da oficina e está outra vez à venda no site`
    : `${artigo} ${tipo} ${name} saiu da oficina e está ${pronta} no stand`;
}

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** «de 13 a 17 de julho (5 dias)», «a 24 de dezembro (meio dia)». */
function leavePeriod(payload: Payload): string {
  const from = text(payload.start);
  const to = text(payload.end) || from;
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return "";
  const range = describeRange(from, to);
  const days = Number(payload.days);
  const count = !Number.isFinite(days) || days <= 0
    ? ""
    : days === 0.5
      ? " (meio dia)"
      : ` (${String(days).replace(".", ",")} ${days === 1 ? "dia" : "dias"})`;
  return `${from === to ? "a" : "de"} ${range}${count}`;
}

function withPeriod(base: string, payload: Payload): string {
  const period = leavePeriod(payload);
  return period ? `${base} ${period}` : base;
}

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
    case "lead_assigned":
      return {
        family: "lead",
        params: [
          templateParam(`contacto atribuído a si (${leadLabel(payload)})`),
          templateParam(payload.name, 60),
          templateParam(text(payload.car_label) || "sem viatura associada", 80),
          templateParam(link(baseUrl, leadPath(payload, subject)), 300),
        ],
      };
    case "lead_outcome": {
      const name = text(payload.name) || "um cliente";
      const reason = text(payload.loss_reason);
      const what =
        payload.status === "won"
          ? "foi dado como ganho"
          : `foi dado como perdido${reason ? ` (motivo: ${templateParam(reason, 60)})` : ""}`;
      return {
        family: "viatura",
        params: [
          templateParam(`o contacto de ${templateParam(name, 60)}, atribuído a si, ${what}`, 160),
          templateParam(text(payload.car_label) || "sem viatura associada", 80),
          templateParam(link(baseUrl, leadPath(payload, subject)), 300),
        ],
      };
    }
    case "vehicle_sold":
      return {
        family: "viatura",
        params: [
          templateParam("viatura vendida, já não está disponível"),
          templateParam(vehicleLabel(payload), 80),
          templateParam(link(baseUrl, carPath(payload, subject)), 300),
        ],
      };
    case "reservation_ended": {
      const customer = text(payload.customer);
      const how = payload.outcome === "expired" ? "expirada sem venda" : "cancelada";
      return {
        family: "viatura",
        params: [
          templateParam(
            `reserva${customer ? ` de ${templateParam(customer, 60)}` : ""} ${how}; a viatura voltou a estar disponível`,
            160,
          ),
          templateParam(vehicleLabel(payload), 80),
          templateParam(link(baseUrl, carPath(payload, subject)), 300),
        ],
      };
    }
    case "vehicle_price_changed":
      return {
        family: "viatura",
        params: [
          templateParam(
            `preço alterado de ${money(payload.old_price) ?? "sob consulta"} para ${money(payload.new_price) ?? "sob consulta"}`,
          ),
          templateParam(vehicleLabel(payload), 80),
          templateParam(link(baseUrl, carPath(payload, subject)), 300),
        ],
      };
    case "vehicle_prepared":
      return {
        family: "viatura",
        params: [
          templateParam(leftWorkshop(payload), 160),
          templateParam(vehicleLabel(payload), 80),
          templateParam(link(baseUrl, carPath(payload, subject)), 300),
        ],
      };
    case "leave_requested":
      return {
        family: "aviso",
        params: [
          templateParam(
            `${withPeriod(`${templateParam(text(payload.name) || "Um colaborador", 60)} pediu férias`, payload)} e aguarda a sua decisão`,
            200,
          ),
          templateParam(link(baseUrl, "/admin/perfil/pedidos"), 300),
        ],
      };
    case "leave_decided": {
      const by = text(payload.decided_by);
      const decision = payload.decision === "rejected" ? "recusado" : "aprovado";
      return {
        family: "aviso",
        params: [
          templateParam(
            `${withPeriod("o seu pedido de férias", payload)} foi ${decision}${by ? ` por ${templateParam(by, 60)}` : ""}`,
            200,
          ),
          templateParam(link(baseUrl, "/admin/perfil/ferias"), 300),
        ],
      };
    }
    case "leave_upcoming":
      return {
        family: "aviso",
        params: [
          templateParam(
            withPeriod(`${templateParam(text(payload.name) || "Um colega", 60)} vai estar de férias`, payload),
            200,
          ),
          templateParam(link(baseUrl, "/admin/perfil/colegas"), 300),
        ],
      };
    case "vehicle_workshop":
    case "vehicle_created":
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
  vehicle_prepared: { label: (n) => `${n} viaturas saíram da oficina e estão prontas no stand`, path: "/admin/carros" },
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
