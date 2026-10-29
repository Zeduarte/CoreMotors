import type { MetadataRoute } from "next";

/**
 * Montagem do sitemap — função PURA (o `app/sitemap.ts` só lê os dados).
 *
 * `lastModified` só quando há uma data verdadeira: a `updated_at` da viatura,
 * ou a mais recente das viaturas que a página lista. Uma data "agora" em todas
 * as entradas (como antes) diz ao Google que tudo mudou a cada leitura, e ele
 * deixa de confiar no campo. As páginas institucionais ficam sem data.
 *
 * Viaturas vendidas: a ficha continua pública (é para onde apontam a página
 * /vendidos e os links antigos) e o JSON-LD diz `SoldOut`, por isso entram no
 * sitemap, com prioridade baixa. /vendidos só entra quando tem vendas para
 * mostrar a quem chega sem escolha (os carros); vazia fica `noindex`.
 */

export interface SitemapVehicle {
  slug: string;
  status: string;
  vehicle_type: string | null;
  updated_at: string | null;
}

export interface SitemapInput {
  base: string;
  /** Páginas institucionais (sem data). "" é a página inicial. */
  staticPaths: string[];
  vehicles: SitemapVehicle[];
  /** Listas por tipo/marca/categoria, com a data mais recente das viaturas. */
  listings: { path: string; lastModified: string | null }[];
}

/** A data mais recente de uma lista de ISO strings (ou `null`). */
export function latest(dates: (string | null | undefined)[]): string | null {
  let best: string | null = null;
  for (const d of dates) {
    if (d && !Number.isNaN(Date.parse(d)) && (!best || Date.parse(d) > Date.parse(best))) best = d;
  }
  return best;
}

const withDate = (date: string | null) => (date ? { lastModified: new Date(date) } : {});

export function buildSitemap({ base, staticPaths, vehicles, listings }: SitemapInput): MetadataRoute.Sitemap {
  const forSale = vehicles.filter((v) => v.status === "published" || v.status === "reserved");
  const sold = vehicles.filter((v) => v.status === "sold");
  const stockDate = latest(forSale.map((v) => v.updated_at));
  // O que o Google vê em /vendidos: os carros (não guarda a escolha carros/motas).
  const soldShown = sold.filter((v) => (v.vehicle_type ?? "car") === "car");

  const pages: MetadataRoute.Sitemap = staticPaths.map((path) => ({
    url: `${base}${path}`,
    // A página inicial e o stock mudam com as viaturas.
    ...(path === "" || path === "/inventario" ? withDate(stockDate) : {}),
    changeFrequency: path === "" || path === "/inventario" ? ("daily" as const) : ("monthly" as const),
    priority: path === "" ? 1 : 0.8,
  }));

  if (soldShown.length) {
    pages.push({
      url: `${base}/vendidos`,
      ...withDate(latest(soldShown.map((v) => v.updated_at))),
      changeFrequency: "weekly",
      priority: 0.5,
    });
  }

  return [
    ...pages,
    ...listings.map(({ path, lastModified }) => ({
      url: `${base}${path}`,
      ...withDate(lastModified),
      changeFrequency: "daily" as const,
      priority: 0.75,
    })),
    ...forSale.map((v) => ({
      url: `${base}/viaturas/${v.slug}`,
      ...withDate(v.updated_at),
      changeFrequency: "daily" as const,
      priority: 0.7,
    })),
    ...sold.map((v) => ({
      url: `${base}/viaturas/${v.slug}`,
      ...withDate(v.updated_at),
      changeFrequency: "monthly" as const,
      priority: 0.3,
    })),
  ];
}
