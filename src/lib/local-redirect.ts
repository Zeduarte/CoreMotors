import { NextResponse } from "next/server";

/**
 * Redireciona para um caminho DESTE site (ex.: "/admin/anuncios?olx=ligado")
 * com um `Location` relativo, que o navegador resolve no endereço em que está.
 *
 * Não usar `new URL(caminho, request.url)`: no Netlify o `request.url` traz o
 * endereço interno do site (ex.: nome-aleatorio.netlify.app), não o domínio
 * por onde a pessoa entrou — ela saltava para outro endereço, sem os cookies
 * (consentimento, carros/motas, sessão) e com tudo para escolher de novo.
 */
export function localRedirect(path: string, status = 307): NextResponse {
  return new NextResponse(null, { status, headers: { Location: path } });
}
