"use server";

import Anthropic from "@anthropic-ai/sdk";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSection } from "@/lib/guard";
import { site } from "@/lib/site";
import { createAdminClient } from "@/lib/supabase/admin";
import { connectAccount, disconnectAccount, type ConnectResult } from "@/lib/whatsapp/account";
import { afterWrite } from "@/lib/whatsapp/after-write";
import { handleInbound, toActor } from "@/lib/whatsapp/handle";
import { whatsAppNumber } from "@/lib/whatsapp/account";
import { syncBusinessProfile, type ProfileResult } from "@/lib/whatsapp/profile";

/**
 * Simulador das ordens por WhatsApp, para o backoffice.
 *
 * Corre EXACTAMENTE o mesmo `handleInbound` que o webhook vai correr, e grava a
 * sério — é esse o objectivo: demonstrar o produto antes de existir o número da
 * Meta, e ao mesmo tempo ser um teste de integração e não uma imitação.
 *
 * Duas coisas que fazem isto ser seguro, e que não se devem mexer:
 *  - não há rota nova sem autenticação; isto é uma Server Action atrás de
 *    `requireSection("integracoes")`;
 *  - o actor é FORÇADO ao utilizador com sessão. Não vem do formulário, por isso
 *    ninguém pode simular uma ordem em nome de outra pessoa.
 *
 * Deliberadamente NÃO se cria uma rota `/api/whatsapp/simular` com um segredo
 * partilhado, nem um desvio `?dev=1` dentro do webhook real: são as duas formas
 * de isto ir para produção por distracção.
 */

export interface SimulationResult {
  ok: boolean;
  error?: string;
  reply?: string;
  wrote?: boolean;
  /** A imagem da proposta (caminho relativo, assinado e com prazo). */
  image?: string;
}

export async function simulateInbound(data: FormData): Promise<SimulationResult> {
  const me = await requireSection("integracoes");

  const parsed = z
    .object({ text: z.string().trim().min(1, "Escreva a mensagem.").max(1000) })
    .safeParse({ text: data.get("text") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Mensagem inválida." };
  }

  const db = createAdminClient();
  if (!db) return { ok: false, error: "A chave de serviço do Supabase não está configurada." };

  const anthropic = process.env.ANTHROPIC_API_KEY
    ? new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
        ...(process.env.ANTHROPIC_BASE_URL
          ? { baseURL: process.env.ANTHROPIC_BASE_URL }
          : {}),
      })
    : null;

  // A conversa do simulador é separada da do telefone da pessoa, para uma
  // proposta de teste nunca poder ser confirmada por engano a partir do WhatsApp.
  const from = `sim:${me.id}`;

  try {
    const result = await handleInbound(
      { from, text: parsed.data.text, type: "text" },
      toActor(me),
      // Origem vazia → o link da imagem é um caminho relativo: abre no próprio
      // backoffice, sem depender de saber o domínio.
      { db, anthropic, origin: "" },
    );
    if (result.changed) await afterWrite(result.changed);
    revalidatePath("/admin/integracoes");
    return {
      ok: true,
      reply: result.reply ?? "",
      wrote: result.wrote,
      ...(result.image ? { image: result.image.url } : {}),
    };
  } catch (error) {
    console.error("simulateInbound:", error);
    return { ok: false, error: "Não foi possível simular. Veja os registos do servidor." };
  }
}

/**
 * «Ligar número do WhatsApp»: recebe o que a janela da Meta devolveu ao
 * browser e faz a ligação no servidor (ver `connectAccount`).
 *
 * Não há `state` como no OLX porque não há retorno por URL: o `code` chega por
 * esta Server Action, que o Next só aceita da mesma origem e que exige a sessão
 * de um administrador. Um link forjado não a consegue chamar.
 */
export async function connectWhatsApp(input: {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}): Promise<ConnectResult> {
  const me = await requireSection("integracoes");

  const parsed = z
    .object({
      code: z.string().trim().min(1).max(2000),
      wabaId: z.string().trim().regex(/^[0-9]{1,30}$/),
      phoneNumberId: z.string().trim().regex(/^[0-9]{1,30}$/),
    })
    .safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: "A Meta não devolveu a conta e o número escolhidos. Tente outra vez." };
  }

  const db = createAdminClient();
  if (!db) return { ok: false, error: "A chave de serviço do Supabase não está configurada." };

  // O mesmo endereço que o painel mostra: é para lá que a Meta vai entregar.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || site.url;
  const result = await connectAccount(db, parsed.data, me.id, siteUrl);
  if (result.ok) revalidatePath("/admin/integracoes");
  return result;
}

export async function disconnectWhatsApp(): Promise<{ ok: boolean; error?: string }> {
  await requireSection("integracoes");
  const db = createAdminClient();
  if (!db) return { ok: false, error: "A chave de serviço do Supabase não está configurada." };
  const result = await disconnectAccount(db);
  if (result.ok) revalidatePath("/admin/integracoes");
  return result;
}

/** «Aplicar a marca»: nome «Core Motors» e logótipo no perfil do número (profile.ts). */
export async function syncWhatsAppProfile(): Promise<ProfileResult> {
  await requireSection("integracoes");
  const db = createAdminClient();
  if (!db) return { ok: false, error: "A chave de serviço do Supabase não está configurada.", done: [] };
  // A imagem do perfil é fixa: public/whatsapp-profile.png, só se muda no código.
  // Não vem de Definições → Marca, que é o logótipo do site e a equipa pode alterar.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || site.url;
  return syncBusinessProfile(await whatsAppNumber(db), `${siteUrl}/whatsapp-profile.png`);
}
