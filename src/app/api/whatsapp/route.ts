import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { publicSubmissionClient } from "@/lib/public-submissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsAppNumber, type WhatsAppNumber } from "@/lib/whatsapp/account";
import { handleInbound, toActor } from "@/lib/whatsapp/handle";
import { extractMessages, type InboundMessage } from "@/lib/whatsapp/payload";
import { REPLIES } from "@/lib/whatsapp/replies";
import { sendWhatsAppText } from "@/lib/whatsapp/send";
import { verifyChallenge, verifySignature } from "@/lib/whatsapp/signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Webhook do WhatsApp Cloud API.
 *
 * Fino de propósito: toda a lógica vive em `src/lib/whatsapp/`, onde é testada.
 * Aqui só se garante o contrato com a Meta, e esse contrato tem duas regras que
 * mandam em tudo o resto:
 *
 *  1. A um pedido bem assinado responde-se SEMPRE 200, aconteça o que acontecer
 *     a jusante (modelo em baixo, quota esgotada, erro de base de dados). Um
 *     não-200 faz a Meta reentregar, e a pessoa recebe respostas duplicadas.
 *     Os únicos não-200 são assinatura errada (403) e corpo ilegível (400).
 *
 *  2. Cada mensagem é "reclamada" pelo seu id antes de ser processada. Uma
 *     reentrega da mesma mensagem encontra a reclamação e pára — sem isto, um
 *     custo podia ser lançado duas vezes.
 */

/** Aperto de mão de subscrição: a Meta chama uma vez, ao configurar o URL. */
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const token = process.env.WHATSAPP_VERIFY_TOKEN ?? "";
  const challenge = verifyChallenge(params, token);
  // Texto simples e não JSON: a Meta compara o corpo em bruto com o desafio.
  if (challenge === null) {
    // Quando o «Verify and save» da Meta falha, é aqui que se vê porquê — nos
    // logs das funções do Netlify. O token nunca é escrito.
    console.warn(
      `api/whatsapp: verificação recusada — ${
        !token
          ? "WHATSAPP_VERIFY_TOKEN não está definido (falta o deploy depois de o criar?)"
          : "o token da Meta não é igual ao WHATSAPP_VERIFY_TOKEN"
      }`,
    );
    return new NextResponse(null, { status: 403 });
  }
  return new NextResponse(challenge, {
    status: 200,
    headers: { "Content-Type": "text/plain" },
  });
}

export async function POST(request: Request) {
  // O corpo tem de ser lido em bruto ANTES de qualquer JSON.parse: a assinatura
  // é sobre os bytes exactos, e um JSON reserializado nunca bateria.
  const raw = await request.text();
  const secret = process.env.WHATSAPP_APP_SECRET ?? "";
  const header = request.headers.get("x-hub-signature-256");
  if (!verifySignature(raw, header, secret)) {
    // Nada se grava — o pedido não está autenticado, e gravá-lo deixaria
    // qualquer pessoa encher a base de dados. Mas regista-se nos logs: sem
    // isto, um App Secret errado era uma falha totalmente silenciosa.
    console.warn(
      `api/whatsapp: pedido recusado — ${
        !secret
          ? "WHATSAPP_APP_SECRET não está definido"
          : !header
            ? "sem assinatura (não veio da Meta)"
            : "a assinatura não confere: confirme o App Secret em App settings → Basic"
      }`,
    );
    return new NextResponse(null, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return new NextResponse(null, { status: 400 });
  }

  // A maioria das entregas são recibos (entregue, lido): não há nada a fazer.
  const messages = extractMessages(payload);
  if (!messages.length) return NextResponse.json({ ok: true });

  const db = createAdminClient();
  if (!db) {
    console.error("api/whatsapp: SUPABASE_SERVICE_ROLE_KEY em falta");
    return NextResponse.json({ ok: true });
  }

  // O número ligado em Integrações; sem ele, o das variáveis do Netlify.
  const number = await whatsAppNumber(db);

  for (const msg of messages) {
    try {
      await processOne(db, msg, number);
    } catch (error) {
      // Uma mensagem que falha não pode impedir as outras nem mudar o 200.
      console.error("api/whatsapp:", error);
    }
  }
  return NextResponse.json({ ok: true });
}

type Db = NonNullable<ReturnType<typeof createAdminClient>>;

async function processOne(
  db: Db,
  msg: InboundMessage,
  number: WhatsAppNumber | null,
): Promise<void> {
  // Reclamação. Falha (chave duplicada) = já vista = reentrega: pára aqui. Vem
  // ANTES da quota, senão as reentregas da Meta gastavam a quota da pessoa.
  const { error: claimError } = await db
    .from("wa_messages")
    .insert({ wam_id: msg.wamId, from_phone: msg.from });
  if (claimError) return;

  const finish = (patch: {
    actor_id?: string | null;
    reply_sent_at?: string | null;
    last_error?: string | null;
  }) =>
    db
      .from("wa_messages")
      .update({ processed_at: new Date().toISOString(), ...patch })
      .eq("wam_id", msg.wamId);

  // Uma mensagem para outro número de empresa não é processada — um URL vazado
  // não pode ser accionado a partir de outra conta. Mas fica registada, com o
  // porquê: um Phone number ID mal copiado para o Netlify era o erro de
  // configuração mais provável, e antes não deixava rasto nenhum. É também o
  // que o botão «Test» da Meta produz, porque usa um número fictício — por isso
  // uma linha destas no painel prova que a Meta chega cá e que o App Secret
  // está certo.
  const esperado = number?.phoneNumberId;
  if (!esperado || (msg.phoneNumberId && msg.phoneNumberId !== esperado)) {
    await finish({
      actor_id: null,
      last_error: !esperado
        ? "nenhum número ligado — ligue-o em Integrações (ou defina WHATSAPP_PHONE_NUMBER_ID)"
        : `mensagem para o número com ID ${msg.phoneNumberId}, mas o ligado é ${esperado}`,
    });
    return;
  }

  // Quem é. Número desconhecido: silêncio para quem escreveu — não se confirma
  // a um estranho que este número é um assistente. Para o administrador, fica
  // escrito porquê.
  const { data: actorId } = await db.rpc("wa_actor_for_phone", { raw_phone: msg.from });
  if (!actorId) {
    await finish({
      actor_id: null,
      last_error:
        "número sem perfil associado — confirme o telefone em O meu perfil (ou há dois perfis com o mesmo número)",
    });
    return;
  }
  const { data: profile } = await db
    .from("profiles")
    .select("id,full_name,role,allowed_sections,allowed_vehicle_types")
    .eq("id", actorId)
    .maybeSingle();
  if (!profile) {
    await finish({ actor_id: null, last_error: "perfil não encontrado" });
    return;
  }

  let reply: string | null;
  try {
    await publicSubmissionClient("whatsapp", msg.from);
    const anthropic = process.env.ANTHROPIC_API_KEY
      ? new Anthropic({
          apiKey: process.env.ANTHROPIC_API_KEY,
          ...(process.env.ANTHROPIC_BASE_URL
            ? { baseURL: process.env.ANTHROPIC_BASE_URL }
            : {}),
        })
      : null;
    const result = await handleInbound(
      { from: msg.from, text: msg.text, type: msg.type },
      toActor(profile),
      { db, anthropic },
    );
    reply = result.reply;
  } catch (error) {
    // `publicSubmissionClient` lança quando a quota se esgota.
    const quota = error instanceof Error && /Demasiados pedidos/.test(error.message);
    if (!quota) console.error("api/whatsapp handleInbound:", error);
    reply = quota ? REPLIES.demasiadas : REPLIES.falhou;
  }

  if (!reply) {
    await finish({ actor_id: actorId });
    return;
  }
  const sent = await sendWhatsAppText(msg.from, reply, number);
  await finish({
    actor_id: actorId,
    reply_sent_at: sent.ok ? new Date().toISOString() : null,
    // Visível no painel de Integrações: uma escrita que correu bem cuja
    // resposta se perdeu é a única lacuna deste canal, e tem de se ver.
    last_error: sent.ok ? null : `resposta não enviada: ${sent.error}`,
  });
}
