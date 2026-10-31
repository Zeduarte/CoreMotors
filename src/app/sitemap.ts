import { getShowroomContent } from "@/lib/showroom-queries";
import type { MetadataRoute } from "next";
import { getVehicleList } from "@/lib/queries";
import { supabasePublic } from "@/lib/supabase/public";
import { seoPagesFor, seoPath, TYPE_PATH } from "@/lib/seo-pages";
import { VEHICLE_TYPES } from "@/lib/vehicle-categories";
import { site } from "@/lib/site";
import { buildSitemap, latest, type SitemapVehicle } from "@/lib/sitemap";

export const revalidate = 300;

/** Fichas públicas (à venda, reservadas e vendidas) com a data da última edição. */
async function sitemapVehicles(): Promise<SitemapVehicle[]> {
  const { data, error } = await supabasePublic
    .from("cars")
    .select("slug, status, vehicle_type, updated_at")
    .in("status", ["published", "reserved", "sold"]);
  if (error) {
    console.error("sitemap:", error.message);
    return [];
  }
  return (data ?? []) as SitemapVehicle[];
}

/** Sitemap gerado dinamicamente a partir das rotas estáticas + viaturas. Ver `lib/sitemap.ts`. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const [vehicles, showroom] = await Promise.all([sitemapVehicles(), getShowroomContent()]);

  const staticPaths = [
    "",
    "/inventario",
    "/servicos",
    ...showroom.services.filter((s) => s.enabled).map((s) => `/servicos/${s.id}`),
    "/vender",
    "/sobre",
    "/contactos",
    "/politica-de-privacidade",
    "/politica-de-cookies",
    "/termos-condicoes",
  ];

  // Páginas por marca, categoria, preço e combustível — só as que têm stock.
  const listings = (
    await Promise.all(
      VEHICLE_TYPES.map(async (type) => {
        const stock = await getVehicleList(type);
        if (!stock.length) return [];
        return [
          { path: `/${TYPE_PATH[type]}`, lastModified: latest(stock.map((v) => v.updatedAt)) },
          ...seoPagesFor(type, stock).map(({ page }) => ({
            path: seoPath(page),
            lastModified: latest(stock.filter(page.matches).map((v) => v.updatedAt)),
          })),
        ];
      }),
    )
  ).flat();

  return buildSitemap({ base: site.url, staticPaths, vehicles, listings });
}
