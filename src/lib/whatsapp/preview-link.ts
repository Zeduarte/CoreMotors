import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * O link da imagem de confirmação: assinado e com prazo.
 *
 * A Meta vai buscar a imagem a um URL público, sem sessão nem cabeçalhos — por
 * isso o URL é a credencial. Leva o id da proposta, o fim do prazo (`exp`, em
 * segundos) e `sig` = HMAC-SHA256 de `<id>.<exp>`. Sem a assinatura certa, ou
 * fora do prazo, a rota responde 404 e não diz porquê: quem adivinha ids não
 * aprende nada, nem sequer que a proposta existe.
 *
 * A chave é DERIVADA do segredo do servidor (WHATSAPP_APP_SECRET; sem ele, a
 * chave de serviço do Supabase) e nunca é o segredo em bruto. O App Secret
 * também valida os webhooks da Meta (HMAC do corpo): com a mesma chave, uma
 * assinatura produzida aqui seria, em teoria, uma assinatura válida lá. Com
 * uma chave derivada para este fim, os dois usos nunca se cruzam.
 */

/** ~15 minutos: chega para a Meta ir buscar a imagem e para a pessoa a abrir. */
export const PREVIEW_TTL_S = 15 * 60;

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX64 = /^[0-9a-f]{64}$/i;

/** O segredo do servidor, ou "" (e então não há imagem, só texto). */
export function previewSecret(): string {
  return process.env.WHATSAPP_APP_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
}

function previewKey(secret: string): Buffer {
  return createHmac("sha256", secret).update("engineline:whatsapp-preview:v1").digest();
}

export function signPreview(id: string, exp: number, secret: string): string {
  return createHmac("sha256", previewKey(secret)).update(`${id}.${exp}`).digest("hex");
}

/**
 * O caminho (ou URL, com `origin`) da imagem da proposta `id`. `origin` vazio
 * dá um caminho relativo — é o que o simulador do backoffice usa, porque a
 * imagem abre no próprio site. Sem segredo configurado, `null`.
 */
export function previewUrl(
  origin: string,
  id: string,
  now: Date,
  secret: string = previewSecret(),
): string | null {
  if (!secret || !ID.test(id)) return null;
  const exp = Math.floor(now.getTime() / 1000) + PREVIEW_TTL_S;
  const sig = signPreview(id, exp, secret);
  return `${origin.replace(/\/$/, "")}/api/whatsapp/preview/${id}?exp=${exp}&sig=${sig}`;
}

/**
 * O link é verdadeiro e está dentro do prazo? Nunca lança.
 *
 * Um `exp` mais longe do que o prazo máximo também é recusado: não pode ser
 * forjado sem o segredo, mas se um dia o segredo vazar, um link roubado não
 * deve valer para sempre.
 */
export function verifyPreview(
  id: string,
  exp: string | null,
  sig: string | null,
  now: Date,
  secret: string = previewSecret(),
): boolean {
  if (!secret || !ID.test(id) || !exp || !/^\d{1,12}$/.test(exp) || !sig || !HEX64.test(sig))
    return false;
  const expires = Number(exp);
  const nowS = Math.floor(now.getTime() / 1000);
  if (expires <= nowS || expires > nowS + PREVIEW_TTL_S + 60) return false;
  const expected = Buffer.from(signPreview(id, expires, secret), "hex");
  const given = Buffer.from(sig, "hex");
  // Comparação em tempo constante: o tempo da resposta não revela quantos
  // caracteres da assinatura estavam certos.
  return expected.length === given.length && timingSafeEqual(expected, given);
}
