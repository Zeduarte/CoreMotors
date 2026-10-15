import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { effectiveSections, effectiveVehicleTypes } from "@/lib/permissions";
import { COST_CATEGORIES, PendingActionSchema, buildCost, buildHours, buildRegister, canUseCategory, type CostCategory, type PendingAction } from "@/lib/whatsapp/actions";
import { isUsable, readConfirmation } from "@/lib/whatsapp/confirm";
import { confirmationMessage, formatMoney, receiptMessage, vehicleLabel } from "@/lib/whatsapp/describe";
import { formatPlate } from "@/lib/plate";
import { rankVehicles, type Candidate } from "@/lib/whatsapp/match";
import { REPLIES, SECTION_LABEL } from "@/lib/whatsapp/replies";
import { WA_RULES, buildActorContext, buildSchemaContext } from "@/lib/whatsapp/prompt";
import { PROPOSAL_SCHEMA, PROPOSAL_TOOLS, TOOL, WA_TOOLS } from "@/lib/whatsapp/tools";
import { describeSchema, loadSchema, runQuery, type Schema } from "@/lib/whatsapp/data";
import { loadMemory, remember } from "@/lib/whatsapp/memory";

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
 * Pode dar ordens de escrita (oficina, custos, horas)? Perguntar, qualquer
 * colaborador reconhecido pode; escrever exige uma das duas secções, e cada
 * acção volta a verificar a sua em actions.ts e no SQL.
 */
export function actorCanOrder(actor: Actor): boolean {
  return actor.secoes.includes("oficina") || actor.secoes.includes("financeiro");
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
  const action = parsed.data;

  const { data, error } = await callWrite(deps.db, actor.id, action);
  if (error) {
    console.error("whatsapp executePending:", error.message);
    await settle(deps.db, pending.id, "cancelled");
    // O Postgres pode recusar por a viatura ter desaparecido entretanto, ou por
    // a permissão ter mudado. A pessoa lê uma frase nossa, nunca o erro do SQL.
    const sumiu = /inexistente|Sem acesso|Sem permissão/i.test(error.message);
    return { reply: sumiu ? REPLIES.jaNaoDa : REPLIES.falhou, wrote: false };
  }

  await settle(deps.db, pending.id, "confirmed", typeof data === "string" ? data : undefined);
  return { reply: receiptMessage(action), wrote: true };
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

  /** V1..Vn → viatura. O modelo só pode referir o que está aqui. */
  const handles = new Map<string, Candidate>();
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
        if (PROPOSAL_TOOLS.includes(use.name)) {
          const outcome = await runProposal(use, actor, handles, hoje);
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
        if (frota === null) frota = await loadFleet(deps.db, actor.id);
        results.push({
          type: "tool_result",
          tool_use_id: use.id,
          ...(await runRead(use, deps, actor, frota, handles)),
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
    const guardado = await storePending(deps.db, actor.id, msg.from, proposal);
    if (!guardado) return { reply: REPLIES.falhou, wrote: false };
    return { reply: confirmationMessage(proposal), wrote: false };
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

type ReadOutcome = { content: string; is_error?: boolean };

async function runRead(
  use: Anthropic.ToolUseBlock,
  deps: HandleDeps,
  actor: Actor,
  frota: Candidate[],
  handles: Map<string, Candidate>,
): Promise<ReadOutcome> {
  if (use.name === TOOL.search) {
    const input = (use.input ?? {}) as Record<string, string | undefined>;
    const found = rankVehicles(
      {
        matricula: input.matricula,
        marca: input.marca,
        modelo: input.modelo,
        cor: input.cor,
        texto: input.texto,
      },
      frota,
    );
    if (!found.length) return { content: "Nenhuma viatura corresponde." };
    const shown = found.slice(0, MAX_CANDIDATES);
    const lines = shown.map((v, i) => {
      const key = `V${handles.size + i + 1}`;
      handles.set(key, v);
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
    const handle = String((use.input as { viatura?: string })?.viatura ?? "");
    const car = handles.get(handle);
    if (!car) return { content: unknownHandle(handle), is_error: true };
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

  return { content: "Ferramenta desconhecida.", is_error: true };
}

function unknownHandle(handle: string): string {
  return `A viatura ${handle || "(vazio)"} não existe nesta conversa. Usa ${TOOL.search} e só depois um identificador que ela devolva.`;
}

type ProposalOutcome =
  | { action: PendingAction }
  | { refusal: string }
  | { result: ReadOutcome };

async function runProposal(
  use: Anthropic.ToolUseBlock,
  actor: Actor,
  handles: Map<string, Candidate>,
  hoje: string,
): Promise<ProposalOutcome> {
  const schema = PROPOSAL_SCHEMA[use.name as keyof typeof PROPOSAL_SCHEMA];
  const parsed = schema.safeParse(use.input ?? {});
  if (!parsed.success) {
    // Recuperável: o modelo pode corrigir e voltar a propor.
    return {
      result: {
        content: `Proposta inválida: ${parsed.error.issues[0]?.message ?? "dados em falta"}.`,
        is_error: true,
      },
    };
  }

  if (use.name === TOOL.register) {
    const built = buildRegister(parsed.data as never, actor.secoes);
    return built.ok ? { action: built.action } : { refusal: built.error };
  }

  const input = parsed.data as { viatura: string };
  const car = handles.get(input.viatura);
  // Um identificador que não venha de uma procura não existe: é isto que impede
  // o modelo de inventar uma viatura e lançar-lhe uma despesa.
  if (!car) return { result: { content: unknownHandle(input.viatura), is_error: true } };
  const vehicle = { carId: car.id, veiculo: vehicleLabel(car) };

  const built =
    use.name === TOOL.cost
      ? buildCost(parsed.data as never, vehicle, actor.secoes, hoje)
      : buildHours(parsed.data as never, vehicle, actor.secoes, hoje);
  return built.ok ? { action: built.action } : { refusal: built.error };
}

async function storePending(
  db: HandleDeps["db"],
  actorId: string,
  from: string,
  action: PendingAction,
): Promise<boolean> {
  const { error } = await db.from("wa_pending_actions").insert({
    actor_id: actorId,
    from_phone: from,
    kind: action.kind,
    payload: action,
    summary: confirmationMessage(action),
  });
  if (error) {
    console.error("storePending:", error.message);
    return false;
  }
  return true;
}

export { SECTION_LABEL };
