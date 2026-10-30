/**
 * Destino público seguro: um caminho DESTE site, nunca outro domínio.
 *
 * Qualquer página pública serve — quem escolhe carros/motas à chegada (ou
 * muda de mundo) volta para onde estava: o link de cancelar o alerta de stock
 * (/alertas/cancelar/<token>), um serviço, a ficha impressa, o stock com uma
 * pesquisa… Antes só uma lista fixa passava e o resto ia para a homepage.
 *
 * Contra redirecionamentos para fora: tem de começar por uma só "/" (não
 * "//" nem "/\", que o browser lê como outro domínio), sem esquema
 * ("https:"), sem ".." e só com caracteres de endereço comuns. O backoffice e
 * as rotas da API ficam de fora (esta rota não pode apontar para si própria).
 */
export function safePublicTarget(target: string | null): string | null {
  if (!target || target.length > 600) return null;
  const match = /^(\/(?![/\\])[A-Za-z0-9\-._~/%]*)(\?[A-Za-z0-9_%=&.+\-,~]*)?$/.exec(target);
  if (!match) return null;
  const path = match[1]!;
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (/(^|\/)\.\.?(\/|$)/.test(decoded) || /[\\:]/.test(decoded) || decoded.startsWith("//")) return null;
  if (/^\/(admin|api)(\/|$)/.test(decoded)) return null;
  return target;
}
