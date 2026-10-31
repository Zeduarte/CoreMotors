import { NextResponse } from "next/server";

/**
 * Redireciona para um caminho DESTE site (ex.: "/admin/anuncios?olx=ligado")
 * com um `Location` relativo, que o navegador resolve no endereço em que está.
 *
 * Não usar `new URL(caminho, request.url)`: no Netlify o `request.url` traz o
 * endereço interno do site (ex.: nome-aleatorio.netlify.app), não o domínio
 * por onde a pessoa entrou — ela saltava para outro endereço, sem os cookies
 * (consentimento, carros/motas, sessão) e com tudo para escolher de novo.
 *
 * Atenção: quando o `Location` não tem pesquisa (`?…`), o Netlify junta-lhe a
 * pesquisa do pedido original (mesmo num endereço absoluto). Para destinos
 * sem pesquisa, ver `cleanLocalRedirect`.
 */
export function localRedirect(path: string, status = 307): NextResponse {
  return new NextResponse(null, { status, headers: { Location: path } });
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Como `localRedirect`, mas o endereço final fica limpo.
 *
 * O Netlify acrescenta a pesquisa do pedido a um `Location` sem pesquisa:
 * `/api/vehicle-context?type=…&target=%2F` → `/?type=…&area=public&target=%2F`
 * na barra do browser. Com pesquisa no destino (ex.: `/inventario?marca=…`) o
 * Netlify não mexe, e vai um redirecionamento normal; sem pesquisa, responde
 * uma página mínima que segue logo para o destino (`location.replace`, para o
 * passo intermédio não ficar no histórico; `refresh` sem JavaScript). Os
 * cookies definidos na resposta valem na mesma.
 */
export function cleanLocalRedirect(path: string, status = 303): NextResponse {
  if (path.includes("?")) return localRedirect(path, status);
  const href = escapeHtml(path);
  const html =
    `<!doctype html><html lang="pt-PT"><head><meta charset="utf-8">` +
    `<meta name="robots" content="noindex"><meta name="color-scheme" content="dark">` +
    `<meta http-equiv="refresh" content="0;url=${href}">` +
    `<script>location.replace(${JSON.stringify(path).replace(/</g, "\\u003c")})</script>` +
    `<title>A abrir…</title></head><body style="margin:0;background:#0A0A0A">` +
    `<noscript><a href="${href}" style="color:#F5F5F4;font:14px sans-serif;display:block;padding:24px">Continuar</a></noscript>` +
    `</body></html>`;
  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "X-Robots-Tag": "noindex" },
  });
}
