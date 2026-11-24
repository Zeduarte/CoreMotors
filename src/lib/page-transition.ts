/**
 * Navegação entre páginas: evento de arranque e direção do deslize.
 *
 * As páginas principais estão numa fila, pela ordem do menu. Ir para uma
 * página mais à direita desliza para a esquerda ("forward"); voltar para uma
 * mais à esquerda desliza para a direita ("back"). As subpáginas pertencem à
 * secção de onde se abrem (a ficha de viatura é "dentro" do Stock): entrar
 * nelas é "forward", sair delas para a mesma secção é "back".
 */

/** Disparado no clique num link interno, com `detail.pathname` do destino. */
export const NAV_START_EVENT = "site:navigation-start";

export type NavStartDetail = { pathname: string };
export type NavDirection = "forward" | "back";

/**
 * Ordem do menu (a do Header do Core e a do Core3, juntas). O logótipo leva
 * ao Início ("/"). Core3: Motas → Moto 4 → Carros → Vender → Contactos.
 */
const SECTIONS = ["/", "/motas", "/moto4", "/carros", "/inventario", "/quiz", "/servicos", "/vender", "/sobre", "/contactos"];

/** Subpáginas fora das secções acima, e a secção a que pertencem. */
const CHILDREN: [prefix: string, section: string][] = [
  ["/viaturas", "/inventario"],
  ["/favoritos", "/inventario"],
  ["/comparar", "/inventario"],
  ["/vendidos", "/inventario"],
  ["/politica-de", "/contactos"],
  ["/termos-condicoes", "/contactos"],
];

function place(pathname: string): { pos: number; depth: number } {
  const exact = SECTIONS.indexOf(pathname);
  if (exact >= 0) return { pos: exact, depth: 0 };
  const own = SECTIONS.findIndex((s) => s !== "/" && pathname.startsWith(`${s}/`));
  if (own >= 0) return { pos: own, depth: 1 };
  const child = CHILDREN.find(([prefix]) => pathname.startsWith(prefix));
  if (child) return { pos: SECTIONS.indexOf(child[1]), depth: 1 };
  return { pos: SECTIONS.length, depth: 0 };
}

export function navDirection(from: string, to: string): NavDirection {
  const a = place(from);
  const b = place(to);
  if (a.pos !== b.pos) return b.pos > a.pos ? "forward" : "back";
  return b.depth >= a.depth ? "forward" : "back";
}
