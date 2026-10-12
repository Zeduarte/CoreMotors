import { getPublicVehicleType } from "./vehicle-context";
import "server-only";
import type { VehicleType } from "./vehicle-categories";
import { getShowroomContent } from "./showroom-queries";
import { unstable_cache } from "next/cache";
import { cachedPublic, safely } from "@/lib/public-cache";
import { supabasePublic } from "@/lib/supabase/public";
import { toVehicle } from "@/lib/mappers";
import type { CarWithMedia } from "@/lib/supabase/database.types";
import type { Vehicle } from "@/types/vehicle";
import { mergeHomeContent, type HomeContent } from "@/lib/home-content";
import { mergeBadges, type BadgeDef } from "@/lib/badges";
import {
  DEFAULT_BRANDING,
  DEFAULT_COMPANY,
  companyFromPoint,
  telHref,
  type Branding,
} from "@/lib/branding";
import { publicMediaUrl } from "@/lib/storage";
import { toListVehicle } from "@/lib/vehicle-list";

/**
 * Leituras PÚBLICAS do inventário (Supabase).
 *
 * O cliente usa a chave anónima, por isso a RLS garante que apenas viaturas
 * `published` são devolvidas ao público — sem filtros manuais frágeis.
 *
 * Cada leitura tem duas camadas: a interior (`fetch…`) vai ao Supabase e fica
 * em cache (ver `public-cache.ts`); a exterior lê o cookie carros/motas — que
 * não pode entrar na cache — e passa-o como argumento.
 */

async function mapPublicCars(rows: CarWithMedia[]): Promise<Vehicle[]> {
  const { locations } = await getShowroomContent();
  return rows.map((row) => {
    const v = toVehicle(row);
    const p = locations.find((l) => l.id === v.pointOfSaleId);
    return p ? { ...v, location: p.name } : v;
  });
}

const CAR_SELECT = "*, car_media(*)";

const fetchVehicles = cachedPublic(async (vehicleType: VehicleType) => {
  const { data, error } = await supabasePublic
    .from("cars")
    .select(CAR_SELECT)
    .in("status", ["published", "reserved"])
    .order("featured", { ascending: false })
    .order("published_at", { ascending: false, nullsFirst: false })
    .eq("vehicle_type", vehicleType);
  if (error) throw new Error(error.message);
  return mapPublicCars(data as unknown as CarWithMedia[]);
}, "vehicles");

export async function getVehicles(
  vehicleType?: VehicleType | null,
): Promise<Vehicle[]> {
  const type = vehicleType ?? (await getPublicVehicleType());
  return safely("getVehicles", () => fetchVehicles(type), []);
}

const fetchFeatured = cachedPublic(async (vehicleType: VehicleType, limit: number) => {
  const { data, error } = await supabasePublic
    .from("cars")
    .select(CAR_SELECT).eq("vehicle_type", vehicleType)
    .in("status", ["published", "reserved"])
    .eq("featured", true)
    .order("published_at", { ascending: false, nullsFirst: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return mapPublicCars(data as unknown as CarWithMedia[]);
}, "featured");

export async function getFeaturedVehicles(limit = 3): Promise<Vehicle[]> {
  const type = await getPublicVehicleType();
  return safely("getFeaturedVehicles", () => fetchFeatured(type, limit), []);
}

/** Viaturas publicadas mais recentes (para o carrossel da homepage). */
const fetchRecent = cachedPublic(async (vehicleType: VehicleType, limit: number) => {
  const { data, error } = await supabasePublic
    .from("cars")
    .select(CAR_SELECT).eq("vehicle_type", vehicleType)
    .in("status", ["published", "reserved"])
    .order("published_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return mapPublicCars(data as unknown as CarWithMedia[]);
}, "recent");

export async function getRecentVehicles(limit = 12): Promise<Vehicle[]> {
  const type = await getPublicVehicleType();
  return safely("getRecentVehicles", () => fetchRecent(type, limit), []);
}

/**
 * Viaturas já vendidas (prova social). Ordenadas pela data de venda mais
 * recente. `limit` opcional — a homepage mostra as últimas 10, a página
 * `/vendidos` mostra todas.
 */
const fetchSold = cachedPublic(async (vehicleType: VehicleType, limit: number | null) => {
  let query = supabasePublic
    .from("cars")
    .select(CAR_SELECT).eq("vehicle_type", vehicleType)
    .eq("status", "sold")
    .order("sold_at", { ascending: false, nullsFirst: false })
    .order("updated_at", { ascending: false });
  if (limit) query = query.limit(limit);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return mapPublicCars(data as unknown as CarWithMedia[]);
}, "sold");

export async function getSoldVehicles(limit?: number): Promise<Vehicle[]> {
  const type = await getPublicVehicleType();
  return safely("getSoldVehicles", () => fetchSold(type, limit ?? null), []);
}

/**
 * Versões leves para as listas (cartões e filtros): sem descrição,
 * equipamento, ficha alargada nem vídeo — ver `toListVehicle`.
 */
export async function getVehicleList(vehicleType?: VehicleType | null): Promise<Vehicle[]> {
  return (await getVehicles(vehicleType)).map(toListVehicle);
}
export async function getSoldVehicleList(limit?: number): Promise<Vehicle[]> {
  return (await getSoldVehicles(limit)).map(toListVehicle);
}

// `null` e não `undefined`: a cache guarda em JSON.
const fetchBySlug = cachedPublic(async (vehicleType: VehicleType, slug: string) => {
  const { data, error } = await supabasePublic
    .from("cars")
    .select(CAR_SELECT).eq("vehicle_type", vehicleType)
    .eq("slug", slug)
    .in("status", ["published", "reserved", "sold"])
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ? (await mapPublicCars([data as unknown as CarWithMedia]))[0] ?? null : null;
}, "by-slug");

export async function getVehicleBySlug(
  slug: string,
): Promise<Vehicle | undefined> {
  const type = await getPublicVehicleType();
  return (await safely("getVehicleBySlug", () => fetchBySlug(type, slug), null)) ?? undefined;
}

/**
 * Etiquetas dos cards (texto, cor, ligadas) — Definições → Etiquetas. Sem nada
 * guardado (ou sem acesso), ficam as de fábrica.
 */
const fetchBadges = cachedPublic(async () => {
  const { data, error } = await supabasePublic
    .from("site_content")
    .select("content")
    .eq("key", "badges")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return mergeBadges(data?.content ?? null);
}, "badges");

export async function getBadges(): Promise<BadgeDef[]> {
  return safely("getBadges", fetchBadges, mergeBadges(null));
}

/**
 * Conteúdo da página inicial (textos editáveis). Funde o que está guardado em
 * `site_content` sobre os defaults — se nada foi editado, devolve o original.
 */
const fetchHomeContent = cachedPublic(async () => {
  const { data, error } = await supabasePublic
    .from("site_content")
    .select("content")
    .eq("key", "home")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return mergeHomeContent((data?.content as Partial<HomeContent> | undefined) ?? null);
}, "home");

export async function getHomeContent(): Promise<HomeContent> {
  return safely("getHomeContent", fetchHomeContent, mergeHomeContent(null));
}

/**
 * Marca do site (nome + logótipo). Como aparece em todas as páginas, é mantida
 * em cache (tag "branding") para não bater na BD a cada request — a ação de
 * gravar invalida essa cache. Cai nos defaults se ainda não definida (ou se a
 * tabela ainda não existir).
 */
export const getBranding = unstable_cache(
  async (): Promise<Branding> => {
    const { data, error } = await supabasePublic
      .from("site_settings")
      .select(
        "company_name, logo_url, tagline, accent, accent_soft, ga4_id, pixel_id, reservation_enabled, deposit_amount, phone, email, whatsapp, messenger, address_street, address_city, address_postal, address_country, hours, geo_lat, geo_lng",
      )
      .eq("id", 1)
      .maybeSingle();

    if (error || !data) {
      return DEFAULT_BRANDING;
    }

    const d = DEFAULT_COMPANY;
    const phone = data.phone || d.phone;
    // Contactos: o ponto de venda principal (Página inicial) manda; o que
    // está em site_settings fica só como reserva enquanto não houver pontos.
    const { locations } = await getShowroomContent();
    return {
      companyName: data.company_name || DEFAULT_BRANDING.companyName,
      logoUrl: data.logo_url ? publicMediaUrl(data.logo_url) : null,
      tagline: data.tagline,
      accent: data.accent || DEFAULT_BRANDING.accent,
      accentSoft: data.accent_soft || DEFAULT_BRANDING.accentSoft,
      ga4Id: data.ga4_id || null,
      pixelId: data.pixel_id || null,
      reservationEnabled: data.reservation_enabled ?? false,
      depositAmount: data.deposit_amount ?? DEFAULT_BRANDING.depositAmount,
      company: companyFromPoint({
        phone,
        phoneHref: telHref(phone),
        email: data.email || d.email,
        whatsapp: (data.whatsapp || d.whatsapp).replace(/\D/g, ""),
        messenger: data.messenger || d.messenger,
        address: {
          street: data.address_street || d.address.street,
          city: data.address_city || d.address.city,
          postalCode: data.address_postal || d.address.postalCode,
          country: data.address_country || d.address.country,
        },
        hours: data.hours || d.hours,
        geo: {
          lat: data.geo_lat ?? d.geo.lat,
          lng: data.geo_lng ?? d.geo.lng,
        },
      }, locations[0]),
    };
  },
  ["site-branding"],
  { tags: ["branding"], revalidate: 300 },
);

export interface Testimonial {
  id: string;
  name: string;
  rating: number;
  body: string;
  role: string | null;
}

/** Testemunhos publicados (para a secção de confiança). */
const fetchTestimonials = cachedPublic(async () => {
  const { data, error } = await supabasePublic
    .from("testimonials")
    .select("id, name, rating, body, role")
    .eq("published", true)
    .order("position", { ascending: true })
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return data as Testimonial[];
}, "testimonials");

export async function getTestimonials(): Promise<Testimonial[]> {
  return safely("getTestimonials", fetchTestimonials, []);
}

/**
 * Viaturas publicadas marcadas para um determinado canal/portal externo.
 * Usado nos feeds de exportação (`/api/feeds/<canal>.xml`).
 */
export async function getChannelVehicles(channel: string): Promise<Vehicle[]> {
  const { data, error } = await supabasePublic
    .from("cars")
    .select(CAR_SELECT)
    .eq("status", "published")
    .contains("channels", [channel])
    .order("published_at", { ascending: false, nullsFirst: false });

  if (error) {
    console.error("getChannelVehicles:", error.message);
    return [];
  }
  return mapPublicCars(data as unknown as CarWithMedia[]);
}

export async function getAllSlugs(): Promise<string[]> {
  const supabase = supabasePublic;
  const { data, error } = await supabase
    .from("cars")
    .select("slug")
    .in("status", ["published", "reserved"]);

  if (error) {
    console.error("getAllSlugs:", error.message);
    return [];
  }
  return data.map((r) => r.slug);
}
