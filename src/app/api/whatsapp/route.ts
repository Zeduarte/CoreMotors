import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { publicSubmissionClient } from "@/lib/public-submissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { whatsAppNumber, type WhatsAppNumber } from "@/lib/whatsapp/account";
import { handleExternal } from "@/lib/whatsapp/contact";
import { afterWrite } from "@/lib/whatsapp/after-write";
import { deliverReply, recoverFailedImages } from "@/lib/whatsapp/delivery";
import { handleInbound, toActor, type HandleResult } from "@/lib/whatsapp/handle";
import { extractFailedStatuses, extractMessages, type InboundMessage } from "@/lib/whatsapp/payload";
import { REPLIES } from "@/lib/whatsapp/replies";
import { handleVisitButton, isVisitPayload } from "@/lib/whatsapp/visit-button";
import { markReadAndTyping } from "@/lib/whatsapp/send";
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

  // A maioria das entregas são recibos (entregue, lido): não há nada a fazer —
  // excepto quando a Meta não conseguiu entregar a imagem de uma proposta.
  const messages = extractMessages(payload);
  const failed = extractFailedStatuses(payload);
  if (!messages.length && !failed.length) return NextResponse.json({ ok: true });

  const db = createAdminClient();
  if (!db) {
    console.error("api/whatsapp: SUPABASE_SERVICE_ROLE_KEY em falta");
    return NextResponse.json({ ok: true });
  }

  // O número ligado em Integrações; sem ele, o das variáveis do Netlify.
  const number = await whatsAppNumber(db);

  if (failed.length) await recoverFailedImages(db, failed, number);

  // A imagem da proposta é servida por este mesmo site, no endereço a que a
  // Meta acabou de chegar. Não se usa NEXT_PUBLIC_SITE_URL: um valor errado lá
  // (já aconteceu em produção) dava imagens num domínio que não as serve.
  const origin = new URL(request.url).origin;

  const one = async (msg: InboundMessage) => {
    try {
      await processOne(db, msg, number, origin);
    } catch (error) {
      // Uma mensagem que falha não pode impedir as outras nem mudar o 200.
      console.error("api/whatsapp:", error);
    }
  };
  // As fotografias de uma rajada podem vir no mesmo pedido: cada uma espera
  // um instante para ver se é a última (photos.ts), por isso correm ao mesmo
  // tempo — em fila, a espera somava-se. O texto continua por ordem.
  const photos = messages.filter((m) => m.media);
  await Promise.all([
    (async () => {
      for (const msg of messages) if (!msg.media) await one(msg);
    })(),
    ...photos.map(one),
  ]);
  return NextResponse.json({ ok: true });
}

type Db = NonNullable<ReturnType<typeof createAdminClient>>;

async function processOne(
  db: Db,
  msg: InboundMessage,
  number: WhatsAppNumber | null,
  origin: string,
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

  // Quem é. Um colaborador (telefone de um perfil) fala com o assistente. Todos
  // os outros são contactos da marca: ficam registados com a empresa e o cargo
  // (contact.ts) e recebem só as frases fixas da apresentação — nunca o
  // assistente, que escreve na base de dados.
  const { data: actorId } = await db.rpc("wa_actor_for_phone", { raw_phone: msg.from });
  // Os botões do aviso de visita só valem para colaboradores: de um número
  // desconhecido ignoram-se (não são um contacto externo a registar).
  const visitButton = isVisitPayload(msg.button?.payload) ? msg.button!.payload : null;
  if (!actorId && visitButton) {
    await finish({ actor_id: null, last_error: "botão de visita de um número que não é de colaborador" });
    return;
  }
  if (!actorId) {
    const reply = await handleExternal(db, {
      from: msg.from,
      text: msg.text,
      type: msg.type,
      ...(msg.profileName ? { profileName: msg.profileName } : {}),
    });
    if (!reply) {
      await finish({ actor_id: null });
      return;
    }
    const { sent } = await deliverReply(db, msg.from, reply, undefined, number);
    await finish({
      actor_id: null,
      reply_sent_at: sent.ok ? new Date().toISOString() : null,
      last_error: sent.ok ? null : `resposta não enviada: ${sent.error}`,
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

  // Resposta a um botão do aviso de visita: não passa pelo assistente. A base
  // de dados confere as permissões do colaborador; aqui só se responde.
  if (visitButton) {
    const reply = await handleVisitButton({
      db,
      actorId,
      phone: msg.from,
      payload: visitButton,
      now: new Date(),
    });
    const { sent } = await deliverReply(db, msg.from, reply, undefined, number);
    await finish({
      actor_id: actorId,
      reply_sent_at: sent.ok ? new Date().toISOString() : null,
      last_error: sent.ok ? null : `resposta não enviada: ${sent.error}`,
    });
    return;
  }

  // Lida e «a escrever…» enquanto o assistente pensa. Só depois de se saber
  // quem é: a um número desconhecido não se mostra nem os vistos.
  await markReadAndTyping(msg.wamId, number);

  let result: HandleResult;
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
    result = await handleInbound(
      { from: msg.from, text: msg.text, type: msg.type, ...(msg.media ? { media: msg.media } : {}) },
      toActor(profile),
      // O número também serve para descarregar as fotografias (photos.ts).
      { db, anthropic, origin, number },
    );
  } catch (error) {
    // `publicSubmissionClient` lança quando a quota se esgota.
    const quota = error instanceof Error && /Demasiados pedidos/.test(error.message);
    if (!quota) console.error("api/whatsapp handleInbound:", error);
    result = { reply: quota ? REPLIES.demasiadas : REPLIES.falhou, wrote: false };
  }

  if (result.changed) await afterWrite(result.changed);

  if (!result.reply) {
    await finish({ actor_id: actorId });
    return;
  }
  // A proposta vai como imagem com o texto por legenda; se a imagem não
  // puder ir, vai o texto (deliverReply).
  const { sent, imageError } = await deliverReply(db, msg.from, result.reply, result.image, number);
  await finish({
    actor_id: actorId,
    reply_sent_at: sent.ok ? new Date().toISOString() : null,
    // Visível no painel de Integrações: uma escrita que correu bem cuja
    // resposta se perdeu é a única lacuna deste canal, e tem de se ver. Uma
    // imagem que não foi também — a pessoa recebeu o texto, mas algo está mal.
    last_error: !sent.ok
      ? `resposta não enviada: ${sent.error}`
      : imageError
        ? `imagem não enviada (respondida em texto): ${imageError}`
        : null,
  });
}
