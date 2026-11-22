import { core } from "./core";
import type { ThemeConfig } from "./types";

/**
 * Core2: parte do Core e muda o que for preciso — textos e ordem das secções
 * aqui; tamanhos de letra, posição das imagens e o resto do aspeto em
 * `core2.css` (sempre debaixo de `[data-site-theme="core2"]`).
 *
 * As maquetes da Supermotas: fundo claro, com menu, rodapé, página inicial e
 * stock próprios (src/components/themes/core2/). As outras páginas são as do
 * Core, em claro. As secções de `homeSections` só contam no Core (a página
 * inicial do Core2 é a das maquetes).
 */
export const core2: ThemeConfig = {
  ...core,
  id: "core2",
  label: "Core2",
  description: "Fundo claro, como as maquetes: menu, página inicial, stock e rodapé próprios.",
  texts: { ...core.texts },
  homeSections: [...core.homeSections],
};
