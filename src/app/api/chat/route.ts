import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { z } from "zod";
import { publicSubmissionClient } from "@/lib/public-submissions";
import { getBranding, getVehicleBySlug } from "@/lib/queries";
import { getPublicVehicleType } from "@/lib/vehicle-context";
import { CHAT_RULES, buildContextBlock } from "@/lib/chat/prompt";
import { SEARCH_TOOL, SEARCH_TOOL_NAME, SearchInput, runSearch } from "@/lib/chat/tools";
import { resolveActions, splitActionMarker } from "@/lib/chat/actions";
import { MarkerBuffer } from "@/lib/chat/stream-marker";
import { chatSecret, signReply, validateHistory } from "@/lib/chat/history";
import {
  ASSISTANT_MAX_CHARS,
  HISTORY_MAX_MESSAGES,
  USER_MAX_CHARS,
} from "@/lib/chat/conversation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Assistente virtual do site público.
 *
 * O cliente envia só o histórico da conversa e a página onde está; é aqui que
 * se decide o que o modelo sabe. A chave da API nunca sai do servidor.
 *
 * Resposta: NDJSON (uma linha JSON por evento) —
 *   {"type":"text","value":"…"}      pedaço de texto
 *   {"type":"actions","value":[…]}   botões de encaminhamento
 *   {"type":"sig","value":"…"}       assinatura da resposta (ver chat/history.ts)
 *   {"type":"error","value":"…"}     falha depois de o stream ter começado
 */

// O mesmo modelo e configuração do assistente do WhatsApp. O Haiku 5.5 pensa
// por defeito e o pensamento conta para o limite de tokens: esforço baixo
// (respostas curtas, uma pesquisa) e folga para o texto não ser cortado.
const MODEL = "claude-haiku-5-5";
const EFFORT = "low";
const MAX_TOKENS = 2048;
/** Uma resposta precisa de 1 pesquisa; 3 dá folga sem permitir um ciclo caro. */
const MAX_TOOL_ROUNDS = 3;

const Body = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(Math.max(USER_MAX_CHARS, ASSISTANT_MAX_CHARS)),
        sig: z.string().max(100).optional(),
      }),
    )
    .min(1)
    .max(HISTORY_MAX_MESSAGES),
  pathname: z.string().max(300).default("/"),
});

export async function POST(request: Request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { error: "O assistente não está configurado." },
      { status: 503 },
    );
  }

  let parsed;
  try {
    parsed = Body.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const secret = chatSecret()!;
  // Só respostas assinadas por este servidor, a alternar com as perguntas.
  const history = validateHistory(parsed.data.messages, secret);
  if (!history) {
    return NextResponse.json({ error: "Pedido inválido." }, { status: 400 });
  }
  const { pathname } = parsed.data;

  try {
    await publicSubmissionClient("chat");
  } catch {
    return NextResponse.json(
      {
        error:
          "Demasiadas mensagens em pouco tempo. Aguarde uns minutos ou fale connosco por telefone.",
      },
      { status: 429 },
    );
  }

  const branding = await getBranding();
  const world = await getPublicVehicleType();
  const slug = vehicleSlug(pathname);
  const vehicle = slug ? await getVehicleBySlug(slug) : undefined;

  // `baseURL` explícito: o bundler do Next não garante que o SDK veja as
  // variáveis de ambiente sozinho. Vazio = API da Anthropic.
  const client = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    ...(process.env.ANTHROPIC_BASE_URL
      ? { baseURL: process.env.ANTHROPIC_BASE_URL }
      : {}),
  });

  // As regras vão num bloco próprio com cache: são iguais em todos os pedidos,
  // por isso a partir da segunda mensagem são lidas da cache (~90% mais baratas).
  // Ferramenta + regras passam o mínimo que o Haiku 5.5 guarda em cache (512
  // tokens; no Haiku 4.5 eram 4096 e a marca não tinha efeito).
  const system: Anthropic.TextBlockParam[] = [
    { type: "text", text: CHAT_RULES, cache_control: { type: "ephemeral" } },
    {
      type: "text",
      text: buildContextBlock({
        branding,
        vehicle,
        pageLabel: pageLabel(pathname, slug, !!vehicle),
        world,
      }),
    },
  ];

  const conversation: Anthropic.MessageParam[] = history;

  // Slugs que o servidor realmente devolveu — só estes podem virar links.
  const knownSlugs = new Map<string, string>();
  if (vehicle) knownSlugs.set(vehicle.slug, `${vehicle.make} ${vehicle.model}`);

  const encoder = new TextEncoder();
  const marker = new MarkerBuffer();

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));

      try {
        for (let round = 0; ; round++) {
          const stream = client.messages.stream({
            model: MODEL,
            max_tokens: MAX_TOKENS,
            output_config: { effort: EFFORT },
            system,
            tools: [SEARCH_TOOL],
            messages: conversation,
          });

          stream.on("text", (delta) => {
            const chunk = marker.push(delta);
            if (chunk) send({ type: "text", value: chunk });
          });

          const message = await stream.finalMessage();

          if (message.stop_reason === "refusal") break;
          if (round >= MAX_TOOL_ROUNDS) break;
          if (message.stop_reason === "pause_turn") {
            conversation.push({ role: "assistant", content: message.content });
            continue;
          }

          const toolUses = message.content.filter(
            (b): b is Anthropic.ToolUseBlock => b.type === "tool_use",
          );
          if (toolUses.length === 0) break;

          // Um input cortado a meio ainda pode parecer válido — não o corremos.
          if (message.stop_reason === "max_tokens") break;

          conversation.push({ role: "assistant", content: message.content });

          const results: Anthropic.ToolResultBlockParam[] = [];
          for (const use of toolUses) {
            results.push({
              type: "tool_result",
              tool_use_id: use.id,
              ...(await executeTool(use, knownSlugs)),
            });
          }
          conversation.push({ role: "user", content: results });
        }

        // Retira o marcador e entrega o que ficou retido no buffer.
        const { text, keys } = splitActionMarker(marker.raw);
        if (text.length > marker.emittedLength) {
          send({ type: "text", value: text.slice(marker.emittedLength) });
        }
        const actions = resolveActions(keys, branding, knownSlugs, !!vehicle);
        if (actions.length) send({ type: "actions", value: actions });
        // A assinatura deixa o browser devolver esta resposta no histórico.
        if (text.trim() && text.length <= ASSISTANT_MAX_CHARS) {
          send({ type: "sig", value: signReply(text, secret) });
        }
      } catch (error) {
        // A mensagem real fica no log do servidor; o visitante vê texto neutro.
        console.error("api/chat:", error);
        send({
          type: "error",
          value:
            "Houve um problema a responder. Tente de novo ou fale connosco por telefone.",
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

/** Corre a ferramenta pedida, validando o input antes de lhe tocar. */
async function executeTool(
  use: Anthropic.ToolUseBlock,
  knownSlugs: Map<string, string>,
): Promise<{ content: string; is_error?: boolean }> {
  if (use.name !== SEARCH_TOOL_NAME) {
    return { content: "Ferramenta desconhecida.", is_error: true };
  }
  const input = SearchInput.safeParse(use.input);
  if (!input.success) {
    return { content: "Filtros inválidos. Tente outros critérios.", is_error: true };
  }
  try {
    const outcome = await runSearch(input.data);
    for (const [slug, label] of outcome.slugs) knownSlugs.set(slug, label);
    return { content: outcome.content };
  } catch (error) {
    console.error("api/chat pesquisa:", error);
    return { content: "Não foi possível consultar o stock agora.", is_error: true };
  }
}

/** Slug da viatura quando o visitante está numa ficha (`/viaturas/<slug>`). */
function vehicleSlug(pathname: string): string | null {
  const match = /^\/viaturas\/([a-z0-9-]{1,200})\/?$/i.exec(pathname);
  return match?.[1] ?? null;
}

const PAGE_LABELS: Record<string, string> = {
  "/": "Página inicial do site.",
  "/inventario": "Lista de viaturas em stock, com filtros.",
  "/vendidos": "Lista de viaturas já vendidas.",
  "/vender": "Página de venda/retoma: o visitante quer vender o carro dele.",
  "/contactos": "Página de contactos, com morada e mapa.",
  "/sobre": "Página sobre o stand.",
  "/servicos": "Página de serviços do stand.",
  "/favoritos": "Viaturas que o visitante guardou como favoritas.",
  "/comparar": "Comparação lado a lado de viaturas.",
  "/quiz": "Questionário que sugere uma viatura ao visitante.",
};

function pageLabel(
  pathname: string,
  slug: string | null,
  hasVehicle: boolean,
): string {
  if (hasVehicle) return "Ficha de uma viatura — os dados estão abaixo.";
  if (slug) return "Ficha de uma viatura que já não está disponível no site.";
  const clean = pathname.replace(/\/+$/, "") || "/";
  return PAGE_LABELS[clean] ?? `Página ${clean} do site.`;
}
