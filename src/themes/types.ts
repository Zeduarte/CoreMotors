/**
 * Temas do site público (o frontend). O projeto é um só; cada tema muda só o
 * aspeto: textos (palavras), a ordem das secções da página inicial e o CSS
 * próprio do tema (tamanhos de letra, posição das imagens…), em
 * `src/themes/<tema>.css`, sempre debaixo de `[data-site-theme="<tema>"]`.
 *
 * O tema ativo escolhe-se no backoffice, em Gestão (só o acesso core).
 */

export const THEME_IDS = ["core", "core2", "core3"] as const;
export type ThemeId = (typeof THEME_IDS)[number];

/**
 * A aparência de cada versão: Escuro (o de sempre), Claro (o mesmo site em
 * branco) ou Automático (segue o sistema do dispositivo). Também em Gestão.
 */
export const SITE_MODES = ["dark", "light", "system"] as const;
export type SiteMode = (typeof SITE_MODES)[number];
export const SITE_MODE_LABELS: Record<SiteMode, string> = {
  dark: "Escuro",
  light: "Claro",
  system: "Automático",
};

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
  | "contact"
  // Core 3: o topo, os cartões das categorias e a faixa de serviços.
  | "c3hero"
  | "c3categories"
  | "c3services";

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
  /** O que muda no backoffice com este tema (em Gestão, com o tema escolhido). */
  adminNotes?: ThemeNote[];
}

export interface ThemeNote {
  text: string;
  /** Uma ligação para onde se edita. */
  href?: string;
  link?: string;
}
