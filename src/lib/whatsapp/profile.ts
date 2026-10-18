import "server-only";
import { graphBase, graphRequest, graphVersion } from "./graph";
import type { WhatsAppNumber } from "./account";

/**
 * O perfil do número no WhatsApp: o nome «Core Motors» e o logótipo da marca,
 * que é o que qualquer pessoa vê ao receber ou enviar uma mensagem.
 *
 * Duas coisas que a Meta decide, não o site:
 *  - o NOME passa por uma revisão da Meta (costuma demorar horas ou dias) e tem
 *    de corresponder à marca; o pedido aqui só o submete;
 *  - o LOGÓTIPO tem de ser JPEG ou PNG (a Meta recusa SVG), de preferência
 *    quadrado e com pelo menos 640×640.
 */

export const BRAND_NAME = "Core Motors";
export const BRAND_ABOUT = "Core Motors — automóveis e motas.";

export interface ProfileResult {
  ok: boolean;
  error?: string;
  /** O que ficou feito, em frases para o administrador. */
  done: string[];
}

const LOGO_TYPES = new Set(["image/jpeg", "image/png"]);
const LOGO_MAX_BYTES = 5 * 1024 * 1024;

/** Descarrega o logótipo da marca. Só HTTPS, sem redireccionamentos, com limite. */
async function fetchLogo(url: string): Promise<{ bytes: Buffer; mime: string } | string> {
  if (!/^https:\/\//.test(url)) return "O logótipo tem de estar num endereço HTTPS.";
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000), redirect: "error" });
    if (!res.ok) return `Não foi possível ler o logótipo (HTTP ${res.status}).`;
    const mime = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!LOGO_TYPES.has(mime)) {
      return "O logótipo tem de ser JPEG ou PNG (a Meta não aceita SVG). Carregue um em Definições → Marca.";
    }
    const bytes = Buffer.from(await res.arrayBuffer());
    if (!bytes.length || bytes.length > LOGO_MAX_BYTES) return "O logótipo tem de ter menos de 5 MB.";
    return { bytes, mime };
  } catch {
    return "Não foi possível descarregar o logótipo.";
  }
}

/**
 * Envio em dois passos da API de carregamento retomável da Meta: abre-se uma
 * sessão na app e enviam-se os bytes; a resposta é o «handle» que o perfil usa.
 */
async function uploadPicture(
  appId: string,
  token: string,
  logo: { bytes: Buffer; mime: string },
): Promise<{ ok: true; handle: string } | { ok: false; error: string }> {
  const session = await graphRequest<{ id?: string }>(`${appId}/uploads`, {
    method: "POST",
    token,
    query: {
      file_length: String(logo.bytes.length),
      file_type: logo.mime,
      file_name: logo.mime === "image/png" ? "logo.png" : "logo.jpg",
    },
  });
  if (!session.ok || !session.data.id) {
    return { ok: false, error: `A Meta não abriu o carregamento do logótipo (${session.ok ? "sem id" : session.error}).` };
  }
  // O id da sessão entra num caminho: só o que a Meta devolve, sem `../`.
  if (!/^upload:[A-Za-z0-9_=:%.-]+$/.test(session.data.id)) {
    return { ok: false, error: "A Meta devolveu um identificador de carregamento inesperado." };
  }
  try {
    const res = await fetch(`${graphBase()}/${graphVersion()}/${session.data.id}`, {
      method: "POST",
      headers: { Authorization: `OAuth ${token}`, file_offset: "0" },
      body: new Uint8Array(logo.bytes),
      signal: AbortSignal.timeout(20000),
      redirect: "error",
    });
    const data = (await res.json().catch(() => null)) as { h?: string; error?: { message?: string } } | null;
    if (!res.ok || !data?.h) {
      return { ok: false, error: `A Meta não aceitou o logótipo (${data?.error?.message?.slice(0, 200) ?? `HTTP ${res.status}`}).` };
    }
    return { ok: true, handle: data.h };
  } catch {
    return { ok: false, error: "Falhou o envio do logótipo à Meta." };
  }
}

/**
 * Põe o perfil do número com a marca: descrição e logótipo de imediato, e o
 * pedido de mudança do nome para «Core Motors» (a Meta revê-o).
 */
export async function syncBusinessProfile(
  number: WhatsAppNumber | null,
  logoUrl: string | null,
): Promise<ProfileResult> {
  const done: string[] = [];
  if (!number?.accessToken) {
    return { ok: false, error: "Ligue primeiro o número do WhatsApp em Integrações.", done };
  }
  if (!/^[0-9]+$/.test(number.phoneNumberId)) {
    return { ok: false, error: "Identificador do número inválido.", done };
  }
  const token = number.accessToken;
  const errors: string[] = [];

  // Logótipo (opcional se não houver nenhum carregado).
  let handle: string | undefined;
  const appId = process.env.WHATSAPP_APP_ID?.trim();
  if (!logoUrl) {
    errors.push("Ainda não há logótipo carregado em Definições → Marca.");
  } else if (!appId) {
    errors.push("Falta WHATSAPP_APP_ID nas variáveis do Netlify para enviar o logótipo.");
  } else {
    const logo = await fetchLogo(logoUrl);
    if (typeof logo === "string") errors.push(logo);
    else {
      const up = await uploadPicture(appId, token, logo);
      if (up.ok) handle = up.handle;
      else errors.push(up.error);
    }
  }

  const profile = await graphRequest(`${number.phoneNumberId}/whatsapp_business_profile`, {
    method: "POST",
    token,
    body: {
      messaging_product: "whatsapp",
      about: BRAND_ABOUT,
      ...(handle ? { profile_picture_handle: handle } : {}),
    },
  });
  if (profile.ok) {
    done.push(handle ? "Logótipo e descrição atualizados." : "Descrição atualizada.");
  } else errors.push(`Perfil: ${profile.error}`);

  const name = await graphRequest(number.phoneNumberId, {
    method: "POST",
    token,
    body: { new_display_name: BRAND_NAME },
  });
  if (name.ok) done.push(`Nome «${BRAND_NAME}» submetido à Meta para aprovação.`);
  else errors.push(`Nome: ${name.error}`);

  return { ok: errors.length === 0, ...(errors.length ? { error: errors.join(" ") } : {}), done };
}
