/**
 * Conteúdo editável da página inicial.
 *
 * Os `DEFAULT_HOME_CONTENT` são EXATAMENTE os textos do site `main` — assim, se
 * nada for editado no backoffice, a homepage fica idêntica ao original. O que o
 * admin guardar em `site_content` (key = 'home') é fundido por cima destes
 * defaults.
 */

export interface CtaContent {
  label: string;
  href: string;
}

export interface HeroContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: CtaContent;
  secondaryCta: CtaContent;
  /**
   * O que mostrar no fundo do hero:
   *  - "auto"  → deteta pelo ficheiro em public/media/carros/ (mp4 → vídeo, senão imagem)
   *  - "video" → força o vídeo (public/media/carros/topo.mp4)
   *  - "image" → força a imagem (public/media/carros/topo.jpg|png|webp|avif)
   */
  media: "auto" | "video" | "image";
}

export interface TrustPillar {
  kpi: string;
  title: string;
  body: string;
}

export interface TrustContent {
  eyebrow: string;
  /** Pode conter quebras de linha (\n) — renderizado com whitespace-pre-line. */
  title: string;
  pillars: TrustPillar[];
}

export interface CtaSectionContent {
  eyebrow: string;
  title: string;
  whatsappLabel: string;
  secondary: CtaContent;
}

/** Topo da página inicial quando o visitante está nas motas. */
export interface MotoHeroContent {
  eyebrow: string;
  title: string;
  subtitle: string;
  primaryCta: CtaContent;
}

export interface HomeContent {
  hero: HeroContent;
  motoHero: MotoHeroContent;
  /** Mostra «Que segmento procura?» (as categorias com stock). Por defeito não. */
  showSegments: boolean;
  /**
   * O topo da página inicial: a imagem e os textos dos carros ou das motas.
   * «auto»: os dos carros, salvo num site só de motas.
   */
  heroType: "auto" | "car" | "motorcycle";
  brands: string[];
  trust: TrustContent;
  cta: CtaSectionContent;
}

export const DEFAULT_HOME_CONTENT: HomeContent = {
  hero: {
    eyebrow: "Stand premium · Portugal",
    title: "Cada viatura conta uma história de precisão",
    subtitle: "Uma seleção rigorosa de viaturas premium. Role para explorar.",
    primaryCta: { label: "Ver stock", href: "/inventario" },
    secondaryCta: { label: "Conhecer o stand", href: "/sobre" },
    media: "auto",
  },
  motoHero: {
    eyebrow: "Stand premium · Portugal",
    title: "A sua próxima viagem começa sobre duas rodas",
    subtitle: "Explore as nossas motas e encontre a sua próxima companheira de estrada.",
    primaryCta: { label: "Ver motas", href: "/inventario" },
  },
  showSegments: false,
  heroType: "auto",
  brands: [
    "BMW",
    "Audi",
    "Porsche",
    "Mercedes-Benz",
    "Volkswagen",
    "Tesla",
    "Land Rover",
    "Volvo",
  ],
  trust: {
    eyebrow: "Confiança",
    title: "Comprar sem\nmargem para dúvidas.",
    pillars: [
      {
        kpi: "150+",
        title: "Inspeção em 150 pontos",
        body: "Cada viatura passa por uma verificação mecânica e estética exaustiva antes de entrar no stand. Sem surpresas depois da compra.",
      },
      {
        kpi: "24 meses",
        title: "Garantia incluída",
        body: "Todas as viaturas incluem garantia de 24 meses, extensível. Cobertura clara, por escrito, sem letras pequenas.",
      },
      {
        kpi: "100%",
        title: "Histórico transparente",
        body: "Relatório completo de quilometragem, manutenções e proprietários anteriores. Verificável, sempre.",
      },
      {
        kpi: "48h",
        title: "Financiamento aprovado",
        body: "Simulação imediata e resposta de crédito em 48 horas, com as principais instituições financeiras do mercado.",
      },
    ],
  },
  cta: {
    eyebrow: "Vamos falar",
    title: "A sua próxima viatura está a um contacto de distância",
    whatsappLabel: "Falar por WhatsApp",
    secondary: { label: "Ver contactos e mapa", href: "/contactos" },
  },
};

/** Funde conteúdo parcial (da BD) por cima dos defaults, campo a campo. */
export function mergeHomeContent(partial?: Partial<HomeContent> | null): HomeContent {
  const d = DEFAULT_HOME_CONTENT;
  if (!partial) return d;
  return {
    hero: {
      ...d.hero,
      ...partial.hero,
      primaryCta: { ...d.hero.primaryCta, ...partial.hero?.primaryCta },
      secondaryCta: { ...d.hero.secondaryCta, ...partial.hero?.secondaryCta },
    },
    motoHero: {
      ...d.motoHero,
      ...partial.motoHero,
      primaryCta: { ...d.motoHero.primaryCta, ...partial.motoHero?.primaryCta },
    },
    showSegments: typeof partial.showSegments === "boolean" ? partial.showSegments : d.showSegments,
    heroType:
      partial.heroType === "car" || partial.heroType === "motorcycle" ? partial.heroType : d.heroType,
    brands:
      partial.brands && partial.brands.length ? partial.brands : d.brands,
    trust: {
      ...d.trust,
      ...partial.trust,
      pillars:
        partial.trust?.pillars && partial.trust.pillars.length
          ? partial.trust.pillars
          : d.trust.pillars,
    },
    cta: {
      ...d.cta,
      ...partial.cta,
      secondary: { ...d.cta.secondary, ...partial.cta?.secondary },
    },
  };
}
