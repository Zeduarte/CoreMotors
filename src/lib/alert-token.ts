import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Link para o cliente cancelar o alerta de stock, sem conta nem palavra-passe.
 *
 * O link leva o id do contacto e uma assinatura: sem a chave do servidor não se
 * fabrica o link de outra pessoa. A página pede um toque no botão antes de
 * cancelar — as pré-visualizações de links (do próprio WhatsApp) abrem o link
 * sozinhas, e não podem cancelar nada.
 */
function secret(): string | null {
  return process.env.ALERT_LINK_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY || null;
}

function sign(leadId: string, key: string): string {
  return createHmac("sha256", key).update(`alerta:${leadId}`).digest("base64url").slice(0, 22);
}

export function alertCancelToken(leadId: string): string | null {
  const key = secret();
  return key ? `${leadId}.${sign(leadId, key)}` : null;
}

/** O id do contacto, se a assinatura for válida. */
export function verifyAlertCancelToken(token: string): string | null {
  const key = secret();
  const match = /^([0-9a-f-]{36})\.([A-Za-z0-9_-]{22})$/.exec(token);
  if (!key || !match) return null;
  const expected = Buffer.from(sign(match[1]!, key));
  const given = Buffer.from(match[2]!);
  return expected.length === given.length && timingSafeEqual(expected, given) ? match[1]! : null;
}
