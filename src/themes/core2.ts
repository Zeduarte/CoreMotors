import { core } from "./core";
import type { ThemeConfig } from "./types";

/**
 * Core2: parte do Core e muda o que for preciso — textos e ordem das secções
 * aqui; tamanhos de letra, posição das imagens e o resto do aspeto em
 * `core2.css` (sempre debaixo de `[data-site-theme="core2"]`).
 *
 * Igual ao Core, menos a página do Stock, que é a das maquetes da Supermotas
 * (src/components/themes/core2/): o topo com a foto e as categorias, a coluna
 * dos filtros e a grelha de cartões, no fundo preto do site.
 */
export const core2: ThemeConfig = {
  ...core,
  id: "core2",
  label: "Core2",
  description: "Igual ao Core, com a página do Stock das maquetes (topo com foto, filtros) e os cartões deitados do Core3; no telemóvel, Motas · Carros em baixo no stock.",
  texts: { ...core.texts },
  homeSections: [...core.homeSections],
};
