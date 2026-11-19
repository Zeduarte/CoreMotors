/**
 * Temas do site público (o frontend). O projeto é um só; cada tema muda só o
 * aspeto: textos (palavras), a ordem das secções da página inicial e o CSS
 * próprio do tema (tamanhos de letra, posição das imagens…), em
 * `src/themes/<tema>.css`, sempre debaixo de `[data-site-theme="<tema>"]`.
 *
 * O tema ativo escolhe-se no backoffice, em Gestão (só o acesso core).
 */

export const THEME_IDS = ["core", "core2"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/** As secções da página inicial, pela ordem em que o tema as mostra. */
export type HomeSection =
  | "hero"
  | "segments"
  | "featured"
  | "brands"
  | "stock"
  | "sell"
  | "trust"
  | "sold"
  | "showroom"
  | "testimonials"
  | "contact";

/** Os textos fixos do site que cada tema pode dizer de outra forma. */
export interface ThemeTexts {
  navHome: string;
  navStock: string;
  navIdeal: string;
  navServices: string;
  navAbout: string;
  navContacts: string;
}

export interface ThemeConfig {
  id: ThemeId;
  /** O nome em Gestão. */
  label: string;
  /** Uma frase em Gestão: o que distingue o tema. */
  description: string;
  texts: ThemeTexts;
  /** A ordem das secções da página inicial (as que faltarem não aparecem). */
  homeSections: HomeSection[];
}
