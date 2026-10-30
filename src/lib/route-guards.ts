import "server-only";
import { getVehicleBySlug, getVehicleList } from "@/lib/queries";
import { getShowroomContent } from "@/lib/showroom-queries";
import { resolveSeoPage } from "@/lib/seo-pages";
import type { VehicleType } from "@/lib/vehicle-categories";

/**
 * Verificações "esta página existe?" para os layouts das rotas dinâmicas
 * (/viaturas/<slug>, /carros/<filtro>, /motas/<filtro>, /servicos/<slug>).
 *
 * Correm no layout, fora do `loading.tsx` da rota: o esqueleto só começa a
 * ser enviado depois desta resposta. Feitas na página (dentro do esqueleto), o
 * `notFound()` chegava com o 200 já enviado — um "soft 404" que o Google
 * indexa como página vazia. As leituras são as mesmas da página e estão em
 * cache (public-cache.ts), por isso a página não volta à base de dados.
 */
export async function vehicleExists(slug: string): Promise<boolean> {
  return Boolean(await getVehicleBySlug(slug));
}

export async function seoPageExists(type: VehicleType, slug: string): Promise<boolean> {
  return resolveSeoPage(type, slug, await getVehicleList(type)) !== null;
}

export async function serviceExists(slug: string): Promise<boolean> {
  const { services } = await getShowroomContent();
  return services.some((s) => s.id === slug && s.enabled);
}
