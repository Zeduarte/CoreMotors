import type { HomeSection, ThemeConfig, ThemeId } from "./types";

/**
 * A página inicial de cada tema, escolhida em Gestão: que secções aparecem e
 * por que ordem. Sem nada guardado, a do tema (`homeSections`), com «Que
 * segmento procura?» como estava em Página inicial (`showSegments`).
 *
 * As secções fixas do tema (`fixedSections`: o topo e, no Core3, os cartões
 * das categorias) ficam sempre no cimo e não se escondem, para a página nunca
 * começar vazia. Uma secção desligada nem se desenha nem se envia ao browser.
 *
 * Guarda-se em `site_content` (chave `theme`), ao lado da versão e da
 * aparência: `{ layouts: { core2: [{ id: "featured", on: true }, …] } }`.
 */

export interface HomeLayoutItem {
  id: HomeSection;
  on: boolean;
}

export type HomeLayouts = Partial<Record<ThemeId, HomeLayoutItem[]>>;

/** O nome e uma frase de cada secção (em Gestão). */
export const SECTION_INFO: Record<HomeSection, { label: string; hint: string }> = {
  hero: { label: "Topo", hint: "A imagem ou o vídeo do início, com a pesquisa rápida." },
  c3hero: { label: "Topo", hint: "A foto da loja com o título e os botões." },
  c3categories: { label: "Cartões das categorias", hint: "Motas · Moto 4 · Automóveis, com foto." },
  segments: { label: "Que segmento procura?", hint: "Atalhos por categoria (SUV, Naked…), só as que têm stock." },
  featured: { label: "Viaturas em destaque", hint: "O carrossel com as marcadas como destaque e as mais recentes." },
  brands: { label: "Faixa das marcas", hint: "As marcas a passar; cada uma abre o stock dessa marca." },
  stock: { label: "Stock", hint: "A grelha do stock na página inicial." },
  sell: { label: "Tem uma viatura para trocar?", hint: "O convite para a retoma." },
  trust: { label: "Confiança", hint: "A secção com o vídeo e os números do stand." },
  sold: { label: "Vendidos", hint: "As últimas viaturas vendidas." },
  c3services: { label: "Faixa de serviços", hint: "Retomas, entregas, financiamento e garantia." },
  showroom: { label: "Serviços, avaliações e perguntas", hint: "Os cartões dos serviços, as avaliações Google e as perguntas frequentes." },
  testimonials: { label: "Testemunhos", hint: "O que dizem os clientes." },
  contact: { label: "Vamos falar", hint: "O fecho com os contactos." },
};

/** As secções que se escolhem (as do tema, sem as fixas). */
export function editableSections(theme: ThemeConfig): HomeSection[] {
  const fixed = new Set(theme.fixedSections ?? []);
  return theme.homeSections.filter((s) => !fixed.has(s));
}

/** A lista de origem do tema: tudo ligado, menos os segmentos se estavam escondidos. */
export function defaultLayout(theme: ThemeConfig, showSegments = false): HomeLayoutItem[] {
  return editableSections(theme).map((id) => ({ id, on: id !== "segments" || showSegments }));
}

/**
 * A lista guardada, limpa: só secções deste tema, sem repetidas; as que
 * faltarem (uma secção nova do tema) entram no fim, ligadas como na origem.
 */
export function resolveLayout(theme: ThemeConfig, saved: unknown, showSegments = false): HomeLayoutItem[] {
  const base = defaultLayout(theme, showSegments);
  if (!Array.isArray(saved)) return base;
  const allowed = new Set(base.map((i) => i.id));
  const seen = new Set<HomeSection>();
  const out: HomeLayoutItem[] = [];
  for (const raw of saved) {
    const id = (raw as { id?: unknown } | null)?.id as HomeSection;
    if (!allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, on: (raw as { on?: unknown }).on !== false });
  }
  return [...out, ...base.filter((i) => !seen.has(i.id))];
}

/** As secções da página inicial, pela ordem: as fixas e depois as ligadas. */
export function homeSectionsFor(theme: ThemeConfig, saved: unknown, showSegments = false): HomeSection[] {
  return [
    ...(theme.fixedSections ?? []),
    ...resolveLayout(theme, saved, showSegments)
      .filter((i) => i.on)
      .map((i) => i.id),
  ];
}

/** As listas guardadas por tema (`content.layouts`), sem validar o conteúdo de cada uma. */
export function parseLayouts(content: unknown): HomeLayouts {
  const raw = (content as { layouts?: unknown } | null)?.layouts;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => Array.isArray(v))) as HomeLayouts;
}
