import { core } from "./core";
import type { ThemeConfig } from "./types";

/**
 * Core2: parte do Core e muda o que for preciso — textos e ordem das secções
 * aqui; tamanhos de letra, posição das imagens e o resto do aspeto em
 * `core2.css` (sempre debaixo de `[data-site-theme="core2"]`).
 *
 * Por agora é igual ao Core: está pronto a personalizar.
 */
export const core2: ThemeConfig = {
  ...core,
  id: "core2",
  label: "Core2",
  description: "Variante do Core, para personalizar (por agora igual).",
  texts: { ...core.texts },
  homeSections: [...core.homeSections],
};
