import "server-only";
import { randomInt } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { graphRequest, graphVersion } from "./graph";

/**
 * O número de WhatsApp da empresa: qual responde, e como se liga no backoffice.
 *
 * Há duas origens, por esta ordem:
 *  1. o número ligado em Integrações (tabela `whatsapp_connection`);
 *  2. as variáveis WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN do Netlify,
 *     como antes — para um site que já funcionava assim não parar no deploy.
 *
 * A ligação usa o Embedded Signup da Meta: o administrador escolhe a conta e o
 * número numa janela da própria Meta, e o browser recebe um `code` de uso único
 * e os IDs escolhidos. Aqui troca-se o `code` por um token, confirma-se que o
 * número pertence mesmo à conta (os IDs vêm do browser, o token não mente),
 * subscrevem-se as mensagens da conta e regista-se o número na Cloud API.
 *
 * O engineLine é instalado um site por cliente, e todos usam a MESMA app da
 * Meta (a do fornecedor). Uma app só tem um endereço de webhook, por isso a
 * subscrição de cada conta leva o endereço do site do cliente
 * (`override_callback_uri`): as mensagens do número de cada stand chegam ao
 * site desse stand, e a nenhum outro.
 */

type Db = SupabaseClient<Database>;

export interface WhatsAppNumber {
  phoneNumberId: string;
  /** Pode faltar quando só a variável do ID está definida: recebe, não responde. */
  accessToken: string | null;
  source: "backoffice" | "variaveis";
}

export async function whatsAppNumber(db: Db | null): Promise<WhatsAppNumber | null> {
  if (db) {
    // Sem a migração 0035 a leitura falha e cai-se nas variáveis, como antes.
    const { data } = await db
      .from("whatsapp_connection")
      .select("phone_number_id,access_token")
      .eq("id", 1)
      .maybeSingle();
    if (data) {
      return { phoneNumberId: data.phone_number_id, accessToken: data.access_token, source: "backoffice" };
    }
  }
  const id = process.env.WHATSAPP_PHONE_NUMBER_ID?.trim();
  if (!id) return null;
  return {
    phoneNumberId: id,
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN?.trim() || null,
    source: "variaveis",
  };
}

/**
 * O que o browser precisa para abrir a janela da Meta. Os dois IDs são
 * públicos (aparecem no código da página de qualquer site que use o Embedded
 * Signup); o App Secret e o Verify Token não saem do servidor, mas sem eles não
 * se troca o `code` nem se encaminha o webhook, por isso o botão só aparece
 * quando os quatro existem.
 */
export interface EmbeddedSignup {
  appId: string;
  configId: string;
  graphVersion: string;
}

export function embeddedSignup(): EmbeddedSignup | null {
  const appId = process.env.WHATSAPP_APP_ID?.trim();
  const configId = process.env.WHATSAPP_CONFIG_ID?.trim();
  if (!appId || !configId || !process.env.WHATSAPP_APP_SECRET || !process.env.WHATSAPP_VERIFY_TOKEN) {
    return null;
  }
  return { appId, configId, graphVersion: graphVersion() };
}

export interface ConnectInput {
  code: string;
  wabaId: string;
  phoneNumberId: string;
}

export interface ConnectResult {
  ok: boolean;
  error?: string;
  number?: string;
  name?: string;
  /** Só quando o número foi registado agora. Mostra-se uma vez ao administrador. */
  pin?: string;
  warning?: string;
}

interface PhoneRow {
  id: string;
  display_phone_number?: string;
  verified_name?: string;
  /** "CLOUD_API" quando o número já está registado na Cloud API. */
  platform_type?: string;
}

const DIGITS = /^[0-9]+$/;

export async function connectAccount(
  db: Db,
  input: ConnectInput,
  actorId: string,
  siteUrl: string,
): Promise<ConnectResult> {
  const appId = process.env.WHATSAPP_APP_ID?.trim();
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (!appId || !secret || !verifyToken) {
    return {
      ok: false,
      error: "Faltam WHATSAPP_APP_ID, WHATSAPP_APP_SECRET e WHATSAPP_VERIFY_TOKEN nas variáveis do Netlify.",
    };
  }
  // A Meta só entrega webhooks em HTTPS, e chama este endereço para o validar.
  const callback = `${siteUrl.replace(/\/$/, "")}/api/whatsapp`;
  if (!/^https:\/\/[^/]+\/api\/whatsapp$/.test(callback)) {
    return { ok: false, error: `O endereço do site tem de ser HTTPS (NEXT_PUBLIC_SITE_URL), não ${siteUrl}.` };
  }
  // Os IDs entram em caminhos do Graph API: só algarismos, nunca `../`.
  if (!DIGITS.test(input.wabaId) || !DIGITS.test(input.phoneNumberId)) {
    return { ok: false, error: "A Meta devolveu identificadores inválidos. Tente outra vez." };
  }

  // 1. O `code` é de uso único e expira em segundos: troca-se já.
  const exchange = await graphRequest<{ access_token?: string }>("oauth/access_token", {
    query: { client_id: appId, client_secret: secret, code: input.code },
  });
  if (!exchange.ok || !exchange.data.access_token) {
    return {
      ok: false,
      error: `A Meta não aceitou a autorização (${exchange.ok ? "sem token" : exchange.error}). Tente outra vez.`,
    };
  }
  const token = exchange.data.access_token;

  // 2. O número pertence à conta, e o token vê os dois. Sem isto, um browser
  //    adulterado podia apontar o site para um número que não é da empresa.
  const numbers = await graphRequest<{ data?: PhoneRow[] }>(
    `${input.wabaId}/phone_numbers`,
    { token, query: { fields: "id,display_phone_number,verified_name,platform_type", limit: "100" } },
  );
  if (!numbers.ok) {
    return { ok: false, error: `Não foi possível ler os números da conta (${numbers.error}).` };
  }
  const phone = numbers.data.data?.find((p) => p.id === input.phoneNumberId);
  if (!phone) {
    return { ok: false, error: "O número escolhido não pertence a essa conta do WhatsApp Business." };
  }

  // 3. Sem a subscrição, a Meta não entrega as mensagens desta conta à app; e
  //    sem o endereço próprio, entregava-as ao webhook geral da app, que é o
  //    de outro site. A Meta valida o endereço na hora (GET com o Verify
  //    Token), por isso um site mal configurado falha aqui e não em silêncio.
  const subscribe = await graphRequest(`${input.wabaId}/subscribed_apps`, {
    method: "POST",
    token,
    body: { override_callback_uri: callback, verify_token: verifyToken },
  });
  if (!subscribe.ok) {
    return {
      ok: false,
      error: `A Meta não deixou encaminhar as mensagens para ${callback} (${subscribe.error}).`,
    };
  }

  // 4. Um número acabado de ligar ainda não envia: é preciso registá-lo na
  //    Cloud API, com um PIN de verificação em dois passos. Um que já está
  //    registado não se regista outra vez — o PIN dele é outro e falharia.
  let pin: string | undefined;
  let warning: string | undefined;
  if (phone.platform_type !== "CLOUD_API") {
    const novo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    const register = await graphRequest(`${input.phoneNumberId}/register`, {
      method: "POST",
      token,
      body: { messaging_product: "whatsapp", pin: novo },
    });
    if (register.ok) pin = novo;
    else {
      warning = `O número ficou ligado, mas o registo na Cloud API falhou (${register.error}). Se as respostas não saírem, confirme o número no WhatsApp Manager.`;
    }
  }

  // 5. Só agora se grava: um erro a meio não deixa uma ligação a meias.
  const now = new Date().toISOString();
  const { error } = await db.from("whatsapp_connection").upsert({
    id: 1,
    waba_id: input.wabaId,
    phone_number_id: input.phoneNumberId,
    access_token: token,
    display_phone_number: phone.display_phone_number ?? null,
    verified_name: phone.verified_name ?? null,
    registration_pin: pin ?? null,
    register_warning: warning ?? null,
    connected_by: actorId,
    connected_at: now,
    updated_at: now,
  });
  if (error) {
    return { ok: false, error: "Não foi possível guardar a ligação — aplicou a migração 0035?" };
  }

  return {
    ok: true,
    number: phone.display_phone_number,
    name: phone.verified_name,
    pin,
    warning,
  };
}

/**
 * Desliga no site, não na Meta: a app continua subscrita à conta, por isso as
 * mensagens que chegarem ficam registadas no painel como sendo para um número
 * que já não está ligado — é um diagnóstico, não um problema. Se as variáveis
 * do Netlify existirem, voltam a ser elas a responder.
 */
export async function disconnectAccount(db: Db): Promise<{ ok: boolean; error?: string }> {
  const { error } = await db.from("whatsapp_connection").delete().eq("id", 1);
  return error ? { ok: false, error: error.message } : { ok: true };
}
