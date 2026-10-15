import "server-only";
import { randomUUID } from "node:crypto";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  WaLeadRow,
  WaStaffRow,
  WaTestimonialRow,
} from "@/lib/supabase/database.types";
import { effectiveSections, effectiveVehicleTypes } from "@/lib/permissions";
import {
  COST_CATEGORIES,
  LEAD_STATUS_TARGETS,
  PendingActionSchema,
  buildAssignLead,
  buildCarStatus,
  buildCost,
  buildCreateCar,
  buildHours,
  buildLeadNote,
  buildLeadStatus,
  buildRegister,
  buildTestimonial,
  buildUpdateCar,
  canUseCategory,
  type CarSnapshot,
  type CostCategory,
  type LeadRef,
  type PendingAction,
  type TestimonialRef,
} from "@/lib/whatsapp/actions";
import { isUsable, readConfirmation } from "@/lib/whatsapp/confirm";
import {
  LEAD_STATUS_LABEL,
  confirmationMessage,
  excerpt,
  formatMoney,
  receiptMessage,
  vehicleLabel,
} from "@/lib/whatsapp/describe";
import { formatPlate } from "@/lib/plate";
import { vehicleSlug } from "@/lib/slug";
import { rankVehicles, type Candidate } from "@/lib/whatsapp/match";
import { previewUrl } from "@/lib/whatsapp/preview-link";
import { REPLIES, SECTION_LABEL } from "@/lib/whatsapp/replies";
import { WA_RULES, buildActorContext, buildSchemaContext } from "@/lib/whatsapp/prompt";
import { PROPOSAL_SCHEMA, PROPOSAL_TOOLS, TOOL, WA_TOOLS } from "@/lib/whatsapp/tools";
import { describeSchema, loadSchema, runQuery, type Schema } from "@/lib/whatsapp/data";
import { loadMemory, remember } from "@/lib/whatsapp/memory";
import {
  isSiteKind,
  proposeSiteChange,
  readSite,
  siteFailureReply,
  writeSiteChange,
} from "@/lib/whatsapp/site";

/**
 * O percurso completo de uma mensagem, com as dependências injectadas.
 *
 * As dependências entram por parâmetro (base de dados, cliente do modelo, hora)
 * por uma razão prática: é o que permite ao simulador do backoffice e aos testes
 * correrem EXACTAMENTE este código, em vez de uma imitação dele. Sem isto, o que
 * se demonstra e o que se testa não é o que vai para produção.
 */

const MODEL = "claude-haiku-5-5";
// O Haiku 5.5 pensa por defeito e o pensamento conta para o limite.
const MAX_TOKENS = 1024;
/**
 * Uma consulta pode precisar de duas ou três leituras (procurar, depois somar);
 * 5 dá folga sem permitir um ciclo caro nem passar o tempo da função.
 */
const MAX_TOOL_ROUNDS = 5;
/** Curto, mas uma lista de viaturas tem de caber (o WhatsApp aceita 4096). */
const MAX_REPLY = 1500;
const TIMEOUT_MS = 8000;
/** Quantas candidatas se mostram quando há ambiguidade. */
const MAX_CANDIDATES = 5;

/** O estado da viatura como aparece no backoffice, não o valor interno. */
const STATUS_LABEL: Record<string, string> = {
  workshop: "na oficina",
  draft: "rascunho",
  prepared: "preparada",
  published: "publicada",
  reserved: "reservada",
  sold: "vendida",
};

/**
 * Que separador cada ferramenta exige. Verificado ANTES de tudo, para quem não
 * tem acesso ler logo a nossa frase — e não ser primeiro interrogado sobre o
 * ano e os quilómetros de uma viatura que nunca ia poder criar. Os construtores
 * (actions.ts) e o SQL voltam a verificar.
 */
const TOOL_SECTION: Record<string, string> = {
  [TOOL.searchLead]: "leads",
  [TOOL.searchStaff]: "leads",
  [TOOL.searchTestimonial]: "testemunhos",
  [TOOL.createCar]: "carros",
  [TOOL.updateCar]: "carros",
  [TOOL.carStatus]: "carros",
  [TOOL.leadStatus]: "leads",
  [TOOL.assignLead]: "leads",
  [TOOL.leadNote]: "leads",
  [TOOL.testimonial]: "testemunhos",
};

export interface Actor {
  id: string;
  nome: string;
  papel: string;
  secoes: string[];
  tipos: string[];
}

export interface HandleDeps {
  /** Cliente com a chave de serviço: é ele que chama as RPCs `wa_*`. */
  db: SupabaseClient<Database>;
  /** `null` quando a chave da Anthropic não está configurada. */
  anthropic: Anthropic | null;
  now?: Date;
  /** As tabelas que se podem consultar. Por defeito lidas da base (data.ts). */
  schema?: () => Promise<Schema | null>;
  /**
   * De onde se serve a imagem da proposta: a origem do pedido do webhook
   * (`new URL(request.url).origin`), ou "" no simulador (caminho relativo).
   * Sem isto não há imagem — só o texto, como antes.
   */
  origin?: string;
}

export interface Inbound {
  /** Número do remetente, ou a chave do simulador. */
  from: string;
  text: string;
  type: string;
}

export interface HandleResult {
  /** O que responder. `null` = não responder nada. */
  reply: string | null;
  /** Houve escrita na base de dados? */
  wrote: boolean;
  /**
   * A proposta como imagem (o formulário preenchido). `reply` continua a ser o
   * texto completo: vai como legenda e é o recurso se a imagem falhar.
   */
  image?: { url: string; pendingId: string };
  /** O que a escrita mudou: quem chama limpa as caches e avisa o OLX. */
  changed?: { kind: PendingAction["kind"]; carId?: string };
}

/** Perfil → o que o assistente precisa de saber sobre quem está a escrever. */
export function toActor(profile: {
  id: string;
  full_name?: string | null;
  role: string;
  allowed_sections?: string[] | null;
  allowed_vehicle_types?: string[] | null;
}): Actor {
  return {
    id: profile.id,
    nome: profile.full_name?.trim() || "Colaborador",
    papel: profile.role,
    secoes: effectiveSections(profile.role, profile.allowed_sections),
    tipos: effectiveVehicleTypes(profile.role, profile.allowed_vehicle_types),
  };
}

/**
 * Pode dar alguma ordem de escrita? Perguntar, qualquer colaborador
 * reconhecido pode; escrever exige uma destas secções, e cada acção volta a
 * verificar a sua em actions.ts e no SQL.
 */
export function actorCanOrder(actor: Actor): boolean {
  return ["oficina", "financeiro", "carros", "leads", "testemunhos", "pagina-inicial", "definicoes"].some((s) =>
    actor.secoes.includes(s),
  );
}

export async function handleInbound(
  msg: Inbound,
  actor: Actor,
  deps: HandleDeps,
): Promise<HandleResult> {
  const result = await respond(msg, actor, deps);
  // A memória guarda o que a pessoa escreveu e o que leu — nada mais.
  if (result.reply && msg.type === "text" && msg.text.trim()) {
    await remember(deps.db, msg.from, msg.text.trim(), result.reply);
  }
  return result;
}

async function respond(
  msg: Inbound,
  actor: Actor,
  deps: HandleDeps,
): Promise<HandleResult> {
  const now = deps.now ?? new Date();

  if (msg.type !== "text" || !msg.text.trim()) {
    return { reply: REPLIES.soTexto, wrote: false };
  }

  const pending = await openPending(deps.db, msg.from);
  const resposta = readConfirmation(msg.text);

  if (pending) {
    if (!isUsable(pending, now)) {
      await settle(deps.db, pending.id, "expired");
      // Um «sim» a uma proposta caduca não grava nada, e diz-se porquê — senão a
      // pessoa ficava a pensar que tinha ficado registado.
      if (resposta === "yes") return { reply: REPLIES.expirou, wrote: false };
    } else if (resposta === "yes") {
      return executePending(pending, actor, deps);
    } else if (resposta === "no") {
      await settle(deps.db, pending.id, "cancelled");
      return { reply: REPLIES.cancelado, wrote: false };
    } else {
      // Qualquer outra coisa é um pedido novo — incluindo "sim, mas muda para
      // 500", que é exactamente o caso que não se pode tratar como confirmação.
      await settle(deps.db, pending.id, "superseded");
    }
  } else if (resposta === "yes" || resposta === "no") {
    return { reply: REPLIES.nadaPendente, wrote: false };
  }

  return interpret(msg, actor, deps, now);
}

// ---------------------------------------------------------------------------
// Propostas guardadas
// ---------------------------------------------------------------------------

interface PendingRow {
  id: string;
  kind: string;
  payload: unknown;
  summary: string;
  status: string;
  expires_at: string;
}

async function openPending(
  db: HandleDeps["db"],
  from: string,
): Promise<PendingRow | null> {
  const { data } = await db
    .from("wa_pending_actions")
    .select("id,kind,payload,summary,status,expires_at")
    .eq("from_phone", from)
    .eq("status", "pending")
    .maybeSingle();
  return (data as PendingRow | null) ?? null;
}

async function settle(
  db: HandleDeps["db"],
  id: string,
  status: "confirmed" | "cancelled" | "expired" | "superseded",
  resultId?: string,
): Promise<void> {
  await db
    .from("wa_pending_actions")
    .update({
      status,
      settled_at: new Date().toISOString(),
      ...(resultId ? { result_id: resultId } : {}),
    })
    .eq("id", id);
}

/** As acções sobre uma viatura que já existe (para a frase «a viatura deixou de existir»). */
const ON_EXISTING_VEHICLE = new Set<PendingAction["kind"]>([
  "add_cost",
  "log_hours",
  "update_car",
  "set_car_status",
]);

/**
 * O Postgres recusou ao confirmar — porque algo mudou entre a proposta e o
 * «sim» (a viatura foi reservada, o contacto foi apagado, a permissão mudou).
 * A pessoa lê uma frase nossa, nunca o erro do SQL.
 */
function failureReply(action: PendingAction, message: string): string {
  if (isSiteKind(action.kind)) return siteFailureReply(message);
  if (/Termine a reserva/i.test(message)) return REPLIES.reservaAtiva;
  if (/Já está nesse estado/i.test(message)) return REPLIES.jaEstava;
  if (/A venda já está concluída/i.test(message))
    return "A venda deste contacto já está concluída. Isso já não se altera.";
  if (/Ficha incompleta|Preço em falta|Estado atual não se altera/i.test(message))
    return "Já não foi possível: a viatura mudou entretanto. Veja-a no backoffice.";
  if (/inexistente|Sem acesso|Sem permissão/i.test(message))
    return ON_EXISTING_VEHICLE.has(action.kind) ? REPLIES.jaNaoDa : REPLIES.registoSumiu;
  return REPLIES.falhou;
}

/** Executa a proposta confirmada — e só ela, tal como foi guardada. */
async function executePending(
  pending: PendingRow,
  actor: Actor,
  deps: HandleDeps,
): Promise<HandleResult> {
  const parsed = PendingActionSchema.safeParse(pending.payload);
  if (!parsed.success) {
    await settle(deps.db, pending.id, "cancelled");
    return { reply: REPLIES.falhou, wrote: false };
  }
  const action = parsed.data as PendingAction;

  const { data, error } = await callWrite(deps.db, actor.id, action);
  if (error) {
    console.error("whatsapp executePending:", error.message);
    await settle(deps.db, pending.id, "cancelled");
    return { reply: failureReply(action, error.message), wrote: false };
  }

  const resultId = typeof data === "string" ? data : undefined;
  await settle(deps.db, pending.id, "confirmed", resultId);
  const carId =
    "carId" in action
      ? action.carId
      : action.kind === "create_draft_car" || action.kind === "register_vehicle"
        ? resultId
        : undefined;
  return {
    reply: receiptMessage(action),
    wrote: true,
    changed: { kind: action.kind, ...(carId ? { carId } : {}) },
  };
}

/** Só as chaves que mudam, com os nomes das colunas (ver `wa_update_car`). */
function carChanges(novo: Extract<PendingAction, { kind: "update_car" }>["novo"]) {
  return {
    ...(novo.preco !== undefined ? { price: novo.preco } : {}),
    ...(novo.km !== undefined ? { mileage: novo.km } : {}),
    ...(novo.tagline !== undefined ? { tagline: novo.tagline } : {}),
    ...(novo.descricao !== undefined ? { description: novo.descricao } : {}),
  };
}

function callWrite(db: HandleDeps["db"], actor: string, action: PendingAction) {
  switch (action.kind) {
    case "register_vehicle":
      return db.rpc("wa_create_workshop_vehicle", {
        actor,
        vehicle_name: action.nome,
        plate: formatPlate(action.matricula),
        selected_type: action.tipo,
      });
    case "add_cost":
      return db.rpc("wa_add_cost", {
        actor,
        car: action.carId,
        kind: action.categoria,
        note: action.descricao,
        value: action.valor,
        incurred: action.data,
      });
    case "log_hours":
      return db.rpc("wa_log_hours", {
        actor,
        car: action.carId,
        work_day: action.data,
        starts: action.inicio,
        ends: action.fim,
        note: action.descricao || null,
      });
    case "create_draft_car": {
      // O slug sai da mesma função que o formulário usa (`createCar`); o SQL
      // só garante que é único.
      const base = vehicleSlug(
        action.marca,
        `${action.modelo}${action.versao ? ` ${action.versao}` : ""}`,
        action.ano,
      )
        .slice(0, 100)
        .replace(/-+$/, "");
      return db.rpc("wa_create_draft_car", {
        actor,
        selected_type: action.tipo,
        vehicle_make: action.marca,
        vehicle_model: action.modelo,
        vehicle_variant: action.versao || null,
        vehicle_year: action.ano,
        km: action.km,
        fuel_kind: action.combustivel,
        gearbox: action.caixa,
        body_kind: action.segmento,
        asking_price: action.preco,
        on_request: action.preco === null,
        plate: action.matricula ? formatPlate(action.matricula) : null,
        paint: action.cor || null,
        door_count: action.portas,
        seat_count: action.lugares,
        slug_base: base || "viatura",
      });
    }
    case "update_car":
      return db.rpc("wa_update_car", { actor, car: action.carId, changes: carChanges(action.novo) });
    case "set_car_status":
      return db.rpc("wa_set_car_status", { actor, car: action.carId, new_status: action.para });
    case "set_lead_status":
      return db.rpc("wa_set_lead_status", {
        actor,
        lead: action.leadId,
        new_status: action.para,
        reason: action.motivo || null,
      });
    case "assign_lead":
      return db.rpc("wa_assign_lead", { actor, lead: action.leadId, assignee: action.responsavelId });
    case "add_lead_note":
      return db.rpc("wa_add_lead_note", {
        actor,
        lead: action.leadId,
        note_kind: action.tipo,
        note: action.texto,
      });
    case "set_testimonial":
      return db.rpc("wa_set_testimonial", {
        actor,
        testimonial: action.testimonialId,
        publish: action.publicar,
      });
    case "update_homepage":
    case "update_showroom":
    case "update_site_settings":
    case "update_badges":
      // Volta a ler e a validar o formulário antes de gravar (site.ts).
      return writeSiteChange(db, actor, action);
  }
}

// ---------------------------------------------------------------------------
// Interpretação
// ---------------------------------------------------------------------------

/** Categorias de despesa que ESTA pessoa pode usar (vai no contexto do modelo). */
function allowedCategories(actor: Actor): CostCategory[] {
  return COST_CATEGORIES.filter((c) => canUseCategory(c, actor.secoes));
}

function isoDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Lisbon" }).format(now);
}

/**
 * Os identificadores curtos desta mensagem → registos reais. O modelo só pode
 * referir o que está aqui, e aqui só entra o que uma procura devolveu.
 */
interface Refs {
  vehicles: Map<string, Candidate>;
  leads: Map<string, LeadRef>;
  testimonials: Map<string, TestimonialRef>;
  staff: Map<string, { id: string; nome: string }>;
}

async function interpret(
  msg: Inbound,
  actor: Actor,
  deps: HandleDeps,
  now: Date,
): Promise<HandleResult> {
  if (!deps.anthropic) return { reply: REPLIES.semAssistente, wrote: false };
  const hoje = isoDay(now);
  const schema = await (deps.schema ?? loadSchema)();

  // Regras e esquema mudam raramente: ficam antes do ponto de cache. O contexto
  // da pessoa (nome, data de hoje) muda e vai depois.
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: WA_RULES },
    {
      type: "text",
      text: buildSchemaContext(describeSchema(schema)),
      cache_control: { type: "ephemeral" },
    },
    {
      type: "text",
      text: buildActorContext({
        nome: actor.nome,
        papel: actor.papel,
        secoes: actor.secoes,
        tipos: actor.tipos,
        hoje,
        categorias: allowedCategories(actor),
      }),
    },
  ];

  // As mensagens anteriores (só texto) e depois a nova.
  const conversation: Anthropic.MessageParam[] = [
    ...(await loadMemory(deps.db, msg.from, now)),
    { role: "user", content: msg.text },
  ];

  const refs: Refs = {
    vehicles: new Map(),
    leads: new Map(),
    testimonials: new Map(),
    staff: new Map(),
  };
  let frota: Candidate[] | null = null;
  let proposal: PendingAction | null = null;
  /** Recusa determinística: a pessoa lê a nossa frase, não uma paráfrase. */
  let refusal: string | null = null;
  let text = "";

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const message = await deps.anthropic.messages.create(
        { model: MODEL, max_tokens: MAX_TOKENS, system, tools: WA_TOOLS, messages: conversation, output_config: { effort: "low" } },
        { signal: AbortSignal.timeout(TIMEOUT_MS) },
      );

      text = message.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join(" ")
        .trim();

      const uses = message.content.filter(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
      );
      if (!uses.length || message.stop_reason === "refusal") break;
      // Um input cortado a meio pode parecer válido — não se corre.
      if (message.stop_reason === "max_tokens") break;
      if (round === MAX_TOOL_ROUNDS) break;

      conversation.push({ role: "assistant", content: message.content });
      const results: Anthropic.ToolResultBlockParam[] = [];

      for (const use of uses) {
        const needed = TOOL_SECTION[use.name];
        if (needed && !actor.secoes.includes(needed)) {
          refusal = REPLIES.semSecao(SECTION_LABEL[needed] ?? needed);
          continue;
        }
        if (use.name === TOOL.siteRead) {
          // A permissão depende da área pedida: verifica-a o site.ts, que
          // recusa com as nossas palavras (como o TOOL_SECTION).
          const lido = await readSite(deps.db, actor, use.input);
          if ("refusal" in lido) refusal = lido.refusal;
          else results.push({ type: "tool_result", tool_use_id: use.id, ...lido });
          continue;
        }
        if (PROPOSAL_TOOLS.includes(use.name)) {
          const outcome = await runProposal(use, actor, refs, hoje, deps);
          if ("action" in outcome) proposal = outcome.action;
          else if ("refusal" in outcome) refusal = outcome.refusal;
          else results.push({ type: "tool_result", tool_use_id: use.id, ...outcome.result });
          continue;
        }
        if (use.name === TOOL.query) {
          results.push({
            type: "tool_result",
            tool_use_id: use.id,
            ...(await runQuery(deps.db, use.input, schema)),
          });
          continue;
        }
        if ((use.name === TOOL.search || use.name === TOOL.summary) && frota === null)
          frota = await loadFleet(deps.db, actor.id);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          ...(await runRead(use, deps, actor, frota ?? [], refs)),
        });
      }

      // Uma proposta (ou uma recusa) termina o turno: o que o modelo escrevesse
      // depois disto seria uma confirmação que não é dele para dar.
      if (proposal || refusal) break;
      if (!results.length) break;
      conversation.push({ role: "user", content: results });
    }
  } catch (error) {
    console.error("whatsapp interpret:", error);
    return { reply: REPLIES.falhou, wrote: false };
  }

  if (refusal) return { reply: refusal, wrote: false };

  if (proposal) {
    const id = await storePending(deps.db, actor.id, msg.from, proposal);
    if (!id) return { reply: REPLIES.falhou, wrote: false };
    const url = deps.origin === undefined ? null : previewUrl(deps.origin, id, now);
    return {
      reply: confirmationMessage(proposal),
      wrote: false,
      ...(url ? { image: { url, pendingId: id } } : {}),
    };
  }

  return { reply: tidy(text) || REPLIES.falhou, wrote: false };
}

/** Sem links e sem parágrafos: o modelo não tem nada para ligar aqui. */
function tidy(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/g, "")
    .replace(/\s*\n\s*\n\s*/g, "\n")
    .trim()
    .slice(0, MAX_REPLY);
}

async function loadFleet(db: HandleDeps["db"], actor: string): Promise<Candidate[]> {
  const { data, error } = await db.rpc("wa_vehicles_for_actor", { actor });
  if (error) {
    console.error("wa_vehicles_for_actor:", error.message);
    return [];
  }
  return (data ?? []) as Candidate[];
}

/** O que está gravado na viatura agora — para o «antes» e para as regras de estado. */
async function loadCar(db: HandleDeps["db"], carId: string): Promise<CarSnapshot | null> {
  const { data } = await db
    .from("cars")
    .select("status,price,price_on_request,mileage,tagline,description,year,fuel,transmission,body,model")
    .eq("id", carId)
    .maybeSingle();
  if (!data) return null;
  const { data: reserva } = await db
    .from("reservations")
    .select("id")
    .eq("car_id", carId)
    .eq("status", "active")
    .maybeSingle();
  return { ...(data as Omit<CarSnapshot, "reservaAtiva">), reservaAtiva: Boolean(reserva) };
}

type ReadOutcome = { content: string; is_error?: boolean };

function totalLine(total: number, shown: number, one: string, many: string): string {
  return total > shown
    ? `\n${total} correspondem; mostro ${shown === 1 ? `o mais recente` : `os ${shown} mais recentes`}.`
    : `\n${total} ${total === 1 ? `${one} corresponde` : `${many} correspondem`}.`;
}

function asText(value: unknown, max = 120): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function runRead(
  use: Anthropic.ToolUseBlock,
  deps: HandleDeps,
  actor: Actor,
  frota: Candidate[],
  refs: Refs,
): Promise<ReadOutcome> {
  const input = (use.input ?? {}) as Record<string, unknown>;

  if (use.name === TOOL.search) {
    const found = rankVehicles(
      {
        matricula: asText(input.matricula) || undefined,
        marca: asText(input.marca) || undefined,
        modelo: asText(input.modelo) || undefined,
        cor: asText(input.cor) || undefined,
        texto: asText(input.texto, 300) || undefined,
      },
      frota,
    );
    if (!found.length) return { content: "Nenhuma viatura corresponde." };
    const shown = found.slice(0, MAX_CANDIDATES);
    const lines = shown.map((v) => {
      const key = `V${refs.vehicles.size + 1}`;
      refs.vehicles.set(key, v);
      const cor = v.color ? ` ${v.color.toLowerCase()}` : "";
      const mat = v.license_plate ? ` · ${formatPlate(v.license_plate)}` : " · sem matrícula";
      return `- ${key} · ${v.make} ${v.model}${cor}${mat} · ${STATUS_LABEL[v.status ?? ""] ?? v.status ?? ""}`;
    });
    const total =
      found.length > shown.length
        ? `\n${found.length} correspondem; mostro as ${shown.length} mais recentes.`
        : `\n${found.length} ${found.length === 1 ? "corresponde" : "correspondem"}.`;
    return { content: lines.join("\n") + total };
  }

  if (use.name === TOOL.summary) {
    const handle = asText(input.viatura, 10);
    const car = refs.vehicles.get(handle);
    if (!car) return { content: unknownHandle(handle, "V", TOOL.search), is_error: true };
    const { data, error } = await deps.db.rpc("wa_vehicle_summary", {
      actor: actor.id,
      car: car.id,
    });
    if (error || !data) return { content: "Não consegui ler essa viatura.", is_error: true };
    const s = data as { costs: number; cost_count: number; hours: number; status: string };
    // Já formatado em pt-PT: o modelo repete o que recebe, e "12.5" com ponto
    // chegaria assim ao colaborador.
    const lancamentos = `${s.cost_count} ${Number(s.cost_count) === 1 ? "lançamento" : "lançamentos"}`;
    return {
      content:
        `${vehicleLabel(car)} · custos: ${formatMoney(Number(s.costs))} em ${lancamentos} · ` +
        `horas: ${Number(s.hours).toLocaleString("pt-PT")} h · estado: ${STATUS_LABEL[s.status] ?? s.status}`,
    };
  }

  if (use.name === TOOL.searchLead) {
    const texto = asText(input.texto);
    const estado =
      typeof input.estado === "string" &&
      (LEAD_STATUS_TARGETS as readonly string[]).includes(input.estado)
        ? input.estado
        : null;
    if (!texto && !estado)
      return { content: "Indica o nome, o telefone ou o estado do contacto.", is_error: true };
    const { data, error } = await deps.db.rpc("wa_leads_for_actor", {
      actor: actor.id,
      search: texto || null,
      only_status: estado,
    });
    if (error) return { content: "Não consegui procurar contactos.", is_error: true };
    const rows = (data ?? []) as WaLeadRow[];
    if (!rows.length) return { content: "Nenhum contacto corresponde." };
    const lines = rows.map((l) => {
      const key = `C${refs.leads.size + 1}`;
      const label = excerpt(`${l.name}${l.car_label ? ` (${l.car_label})` : ""}`, 120);
      refs.leads.set(key, {
        id: l.id,
        label,
        status: l.status,
        assigned_to: l.assigned_to,
        assigned_name: l.assigned_name,
        active_reservation: Boolean(l.active_reservation),
      });
      const contacto = l.phone ?? l.email ?? "sem telefone nem email";
      const reserva = l.active_reservation ? " · com reserva ativa" : "";
      return `- ${key} · ${label} · ${contacto} · ${LEAD_STATUS_LABEL[l.status] ?? l.status} · responsável: ${l.assigned_name ?? "por atribuir"}${reserva}`;
    });
    return {
      content: lines.join("\n") + totalLine(Number(rows[0]?.total ?? rows.length), rows.length, "contacto", "contactos"),
    };
  }

  if (use.name === TOOL.searchStaff) {
    const nome = asText(input.nome, 80);
    if (!nome) return { content: "Indica o nome do colaborador.", is_error: true };
    const { data, error } = await deps.db.rpc("wa_staff_for_actor", { actor: actor.id, search: nome });
    if (error) return { content: "Não consegui procurar colaboradores.", is_error: true };
    const rows = (data ?? []) as WaStaffRow[];
    if (!rows.length) return { content: "Nenhum colaborador corresponde (o mecânico não pode ser responsável)." };
    const lines = rows.map((p) => {
      const key = `P${refs.staff.size + 1}`;
      refs.staff.set(key, { id: p.id, nome: p.full_name });
      return `- ${key} · ${p.full_name}`;
    });
    return { content: lines.join("\n") };
  }

  if (use.name === TOOL.searchTestimonial) {
    const texto = asText(input.texto);
    const pendentes = input.por_aprovar === true;
    if (!texto && !pendentes)
      return { content: "Indica o nome do autor, parte do texto, ou por_aprovar.", is_error: true };
    const { data, error } = await deps.db.rpc("wa_testimonials_for_actor", {
      actor: actor.id,
      search: texto || null,
      only_pending: pendentes,
    });
    if (error) return { content: "Não consegui procurar testemunhos.", is_error: true };
    const rows = (data ?? []) as WaTestimonialRow[];
    if (!rows.length) return { content: "Nenhum testemunho corresponde." };
    const lines = rows.map((t) => {
      const key = `T${refs.testimonials.size + 1}`;
      refs.testimonials.set(key, {
        id: t.id,
        name: t.name,
        rating: Number(t.rating),
        body: t.body,
        published: Boolean(t.published),
      });
      // O texto é de um visitante: vai entre aspas, como dado, e curto.
      return `- ${key} · ${excerpt(t.name, 60)} · ${t.rating}/5 · «${excerpt(t.body, 100)}» · ${t.published ? "publicado" : "por aprovar"}`;
    });
    return {
      content: lines.join("\n") + totalLine(Number(rows[0]?.total ?? rows.length), rows.length, "testemunho", "testemunhos"),
    };
  }

  return { content: "Ferramenta desconhecida.", is_error: true };
}

function unknownHandle(handle: string, prefix: string, tool: string): string {
  return `${handle || "(vazio)"} não existe nesta mensagem. Usa ${tool} e só depois um identificador ${prefix}… que ela devolva.`;
}

type ProposalOutcome =
  | { action: PendingAction }
  | { refusal: string }
  | { result: ReadOutcome };

const fromBuild = (built: ReturnType<typeof buildRegister>): ProposalOutcome =>
  built.ok ? { action: built.action } : { refusal: built.error };

async function runProposal(
  use: Anthropic.ToolUseBlock,
  actor: Actor,
  refs: Refs,
  hoje: string,
  deps: HandleDeps,
): Promise<ProposalOutcome> {
  const schema = PROPOSAL_SCHEMA[use.name as keyof typeof PROPOSAL_SCHEMA];
  const parsed = schema.safeParse(use.input ?? {});
  if (!parsed.success) {
    // Recuperável: o modelo pode corrigir (ou perguntar) e voltar a propor.
    return {
      result: {
        content: `Proposta inválida: ${parsed.error.issues[0]?.message ?? "dados em falta"}.`,
        is_error: true,
      },
    };
  }
  // Cada esquema corresponde à sua ferramenta (PROPOSAL_SCHEMA); o `never`
  // evita repetir aqui os dez tipos de entrada.
  const data = parsed.data as never;
  const input = parsed.data as Record<string, string>;

  switch (use.name) {
    case TOOL.register:
      return fromBuild(buildRegister(data, actor.secoes));
    case TOOL.createCar:
      return fromBuild(buildCreateCar(data, actor.secoes, actor.tipos));
    case TOOL.leadStatus:
    case TOOL.assignLead:
    case TOOL.leadNote: {
      // Um identificador que não venha de uma procura não existe: é isto que
      // impede o modelo de inventar um contacto.
      const lead = refs.leads.get(input.contacto ?? "");
      if (!lead)
        return { result: { content: unknownHandle(input.contacto ?? "", "C", TOOL.searchLead), is_error: true } };
      if (use.name === TOOL.leadStatus) return fromBuild(buildLeadStatus(data, lead, actor.secoes));
      if (use.name === TOOL.leadNote) return fromBuild(buildLeadNote(data, lead, actor.secoes));
      const staff = refs.staff.get(input.responsavel ?? "");
      if (!staff)
        return {
          result: { content: unknownHandle(input.responsavel ?? "", "P", TOOL.searchStaff), is_error: true },
        };
      return fromBuild(buildAssignLead(lead, staff, actor.secoes));
    }
    case TOOL.siteChange:
      return proposeSiteChange(deps.db, actor, data);
    case TOOL.testimonial: {
      const t = refs.testimonials.get(input.testemunho ?? "");
      if (!t)
        return {
          result: { content: unknownHandle(input.testemunho ?? "", "T", TOOL.searchTestimonial), is_error: true },
        };
      return fromBuild(buildTestimonial(data, t, actor.secoes));
    }
  }

  // O resto é sobre uma viatura já existente.
  const car = refs.vehicles.get(input.viatura ?? "");
  // Um identificador que não venha de uma procura não existe: é isto que impede
  // o modelo de inventar uma viatura e lançar-lhe uma despesa.
  if (!car)
    return { result: { content: unknownHandle(input.viatura ?? "", "V", TOOL.search), is_error: true } };
  const vehicle = { carId: car.id, veiculo: vehicleLabel(car) };

  if (use.name === TOOL.cost) return fromBuild(buildCost(data, vehicle, actor.secoes, hoje));
  if (use.name === TOOL.hours) return fromBuild(buildHours(data, vehicle, actor.secoes, hoje));

  const current = await loadCar(deps.db, car.id);
  if (!current) return { refusal: REPLIES.jaNaoDa };
  if (use.name === TOOL.updateCar)
    return fromBuild(buildUpdateCar(data, vehicle, current, actor.secoes));
  return fromBuild(buildCarStatus(data, vehicle, current, actor.secoes));
}

/** Guarda a proposta e devolve o id (que vai no link da imagem), ou `null`. */
async function storePending(
  db: HandleDeps["db"],
  actorId: string,
  from: string,
  action: PendingAction,
): Promise<string | null> {
  // O id é gerado aqui, e não pela base, para o link da imagem poder ser
  // assinado logo a seguir sem mais uma ida à base.
  const id = randomUUID();
  const { error } = await db.from("wa_pending_actions").insert({
    id,
    actor_id: actorId,
    from_phone: from,
    kind: action.kind,
    payload: action,
    summary: confirmationMessage(action),
  });
  if (error) {
    console.error("storePending:", error.message);
    return null;
  }
  return id;
}

export { SECTION_LABEL };
