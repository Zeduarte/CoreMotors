import { getShowroomContent } from "@/lib/showroom-queries";
import type { MetadataRoute } from "next";
import { getAllSlugs, getVehicleList } from "@/lib/queries";
import { seoPagesFor, seoPath, TYPE_PATH } from "@/lib/seo-pages";
import { VEHICLE_TYPES } from "@/lib/vehicle-categories";
import { site } from "@/lib/site";

export const revalidate = 300;

/** Sitemap gerado dinamicamente a partir das rotas estáticas + viaturas. */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const slugs = await getAllSlugs();
  const now = new Date();

  const staticRoutes = [
    "",
    "/inventario",
    "/servicos",
    ...(await getShowroomContent()).services
      .filter((s) => s.enabled)
      .map((s) => `/servicos/${s.id}`),
    "/vender",
    "/sobre",
    "/contactos",
    "/politica-de-privacidade",
    "/politica-de-cookies",
    "/termos-condicoes",
  ].map((path) => ({
    url: `${site.url}${path}`,
    lastModified: now,
    changeFrequency: "weekly" as const,
    priority: path === "" ? 1 : 0.8,
  }));

  const vehicleRoutes = slugs.map((slug) => ({
    url: `${site.url}/viaturas/${slug}`,
    lastModified: now,
    changeFrequency: "daily" as const,
    priority: 0.7,
  }));

  // Páginas por marca, categoria, preço e combustível — só as que têm stock.
  const seoRoutes = (
    await Promise.all(
      VEHICLE_TYPES.map(async (type) => {
        const stock = await getVehicleList(type);
        if (!stock.length) return [];
        return [`/${TYPE_PATH[type]}`, ...seoPagesFor(type, stock).map(({ page }) => seoPath(page))];
      }),
    )
  )
    .flat()
    .map((path) => ({
      url: `${site.url}${path}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.75,
    }));

  return [...staticRoutes, ...seoRoutes, ...vehicleRoutes];
}
