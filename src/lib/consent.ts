/**
 * Consentimento de cookies (RGPD) — o que é partilhado entre o banner
 * (`SiteRuntime`) e os botões «Gerir cookies» (rodapé e Política de Cookies).
 *
 * A decisão fica no `localStorage` do visitante ("yes" | "no"); sem ela, o
 * banner aparece e nenhum script de análise é carregado.
 */

export const CONSENT_KEY = "el-consent";

/** Evento que reabre o banner para mudar ou retirar o consentimento. */
export const OPEN_CONSENT_EVENT = "cookie-consent:open";

export function openCookieSettings() {
  window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
}

/** Cookies do Google Analytics e do Meta Pixel. */
const TRACKING_COOKIE = /^(_ga|_gid|_gat|_gcl_|_fbp|_fbc)/;

/**
 * Apaga os cookies de análise deste site. São gravados no domínio "de topo"
 * (ex.: `.supermotas.com`), por isso tenta-se o host e cada domínio acima dele.
 * Devolve os nomes apagados.
 */
export function clearTrackingCookies(doc: Pick<Document, "cookie"> = document, hostname = location.hostname): string[] {
  const names = doc.cookie
    .split(";")
    .map((c) => c.split("=")[0]!.trim())
    .filter((n) => TRACKING_COOKIE.test(n));
  const parts = hostname.split(".");
  const domains = [""];
  for (let i = 0; i < parts.length - 1; i++) domains.push(`; domain=.${parts.slice(i).join(".")}`);
  for (const name of names) {
    for (const domain of domains) {
      doc.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/${domain}`;
    }
  }
  return names;
}
