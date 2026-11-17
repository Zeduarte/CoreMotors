import { mediaFor } from "@/lib/media";

/**
 * Ecrã de entrada do site público: na 1.ª visita, a fotografia das motas
 * (`public/media/motas/entrada.jpg`, a que era a metade «motas» do antigo
 * ecrã de escolha) tapa o site enquanto ele carrega e depois desaparece.
 *
 * As páginas públicas vêm da cache da CDN (iguais para toda a gente), por
 * isso o servidor não sabe se é a 1.ª visita: quem decide é o script inline
 * abaixo, que corre antes da 1.ª pintura. Sem JavaScript, ou com o
 * armazenamento do browser bloqueado, a entrada simplesmente não aparece — o
 * conteúdo está sempre no HTML (SEO intacto).
 */

/** Fotografia da entrada (relativa a `public/`). */
export const INTRO_IMAGE = mediaFor("motorcycle").entrada;

/** Marca a entrada como vista neste browser (localStorage). */
export const INTRO_STORAGE_KEY = "cm-entrada-vista";

/** Tempo mínimo à vista, para se perceber a entrada mesmo num site rápido. */
export const INTRO_MIN_MS = 1100;
/** Nunca fica mais do que isto, mesmo que a página não acabe de carregar. */
export const INTRO_MAX_MS = 3500;
/** Duração da saída (a mesma transição do CSS, em SiteIntro.module.css). */
export const INTRO_OUT_MS = 650;

/**
 * Robôs (Google, pré-visualizações, Lighthouse) não guardam o localStorage:
 * veriam a entrada em todas as páginas. Saltam-na — o conteúdo é o mesmo.
 */
export const INTRO_BOT_UA = /bot|crawl|spider|slurp|lighthouse|headless|facebookexternalhit|whatsapp/i;

/**
 * Só aparece a quem entra pela página inicial (supermotas.com). Quem chega por
 * um link direto (uma viatura partilhada, o Google) vê logo a página — e a
 * visita não conta: se mais tarde abrir o site pela página inicial, vê-a então.
 */
export const INTRO_PATH = "/";

/**
 * Estados em `<html data-intro>`:
 *  - (sem atributo) não há entrada (visita repetida, link direto, robô, sem JS);
 *  - `show` a entrada tapa o site;
 *  - `out`  a desaparecer (transição);
 *  - `done` acabou (o CSS tira-a do ecrã).
 *
 * Fica pronta quando a página acaba de carregar (`load`), mas nunca antes de
 * `INTRO_MIN_MS` nem depois de `INTRO_MAX_MS`. Um toque ou Esc saltam-na.
 */
export function introScript(): string {
  return `(function(){var d=document.documentElement;if(location.pathname!=="${INTRO_PATH}")return;try{var n=navigator;if(n.webdriver||${INTRO_BOT_UA}.test(n.userAgent||""))return;if(localStorage.getItem("${INTRO_STORAGE_KEY}"))return;localStorage.setItem("${INTRO_STORAGE_KEY}","1")}catch(e){return}d.setAttribute("data-intro","show");var t=Date.now(),f=0;function end(){if(f)return;f=1;d.setAttribute("data-intro","out");setTimeout(function(){d.setAttribute("data-intro","done")},${INTRO_OUT_MS})}function ready(){setTimeout(end,Math.max(0,${INTRO_MIN_MS}-(Date.now()-t)))}if(document.readyState==="complete")ready();else addEventListener("load",ready);setTimeout(end,${INTRO_MAX_MS});addEventListener("keydown",function(e){if(e.key==="Escape")end()});document.addEventListener("click",function(){if(d.getAttribute("data-intro")==="show")end()},true)})();`;
}

/**
 * Do `srcSet` do Next (`url 640w, url 750w, …`), o 1.º endereço com pelo
 * menos `min` píxeis de largura (ou o maior, se nenhum chegar).
 */
export function srcAtWidth(srcSet: string | undefined, min: number): string | undefined {
  const entries = (srcSet ?? "")
    .split(/,\s+/)
    .map((part) => part.trim().split(/\s+/))
    .filter(([url, size]) => url && /^\d+w$/.test(size ?? ""))
    .map(([url, size]) => ({ url, width: Number.parseInt(size ?? "", 10) }))
    .sort((a, b) => a.width - b.width);
  return (entries.find((e) => e.width >= min) ?? entries.at(-1))?.url;
}
