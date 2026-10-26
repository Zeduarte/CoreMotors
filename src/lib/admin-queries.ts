import { getAdminVehicleType } from "@/lib/vehicle-context";
import "server-only";
import { allRows } from "@/lib/pagination";
import { createClient } from "@/lib/supabase/server";
import type {
  CarWithMedia,
  CarRow,
  ProfileRow,
  ChannelListingRow,
} from "@/lib/supabase/database.types";
import { DEFAULT_COMPANY } from "@/lib/branding";
import { CAR_BRANDS } from "@/lib/car-brands";

// Marca canónica por chave minúscula (ex.: "bmw" -> "BMW").
const BRAND_CANON = new Map(CAR_BRANDS.map((b) => [b.toLowerCase(), b]));

/**
 * Agrupa marcas ignorando maiúsculas/minúsculas ("BMW" e "Bmw" contam como a
 * mesma). O nome mostrado usa a forma canónica da lista de marcas quando existe,
 * senão a primeira grafia encontrada.
 */
function tallyBrands(makes: string[]): { name: string; value: number }[] {
  const m = new Map<string, { name: string; value: number }>();
  for (const raw of makes) {
    const trimmed = (raw ?? "").trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    const display = BRAND_CANON.get(key) ?? trimmed;
    const cur = m.get(key);
    if (cur) cur.value += 1;
    else m.set(key, { name: display, value: 1 });
  }
  return [...m.values()].sort((a, b) => b.value - a.value);
}

/** Perfil (role) do utilizador autenticado. */
export async function getCurrentProfile(): Promise<ProfileRow | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .maybeSingle();
  return data ?? null;
}

/** Todos os carros (staff) com a sua media — para a listagem do backoffice. */
export async function getAdminCars(): Promise<CarWithMedia[]> {
  const supabase = await createClient();
  const vehicleType = await getAdminVehicleType();
  const cars = await allRows((a,b) => supabase.from("cars").select("*, car_media(*)").eq("vehicle_type", vehicleType).order("updated_at", {ascending:false}).order("id").range(a,b)) as unknown as CarWithMedia[];
  // As que estão na oficina só aparecem lá; entram aqui ao serem preparadas.
  // Filtra-se aqui e não na query: pedir `status <> 'workshop'` à BD rebenta
  // se a migração 0027 (que cria esse estado) ainda não tiver sido aplicada.
  return cars.filter((c) => c.status !== "workshop");
}

/** Um carro por id, com media ordenada. */
export async function getAdminCarById(
  id: string,
): Promise<CarWithMedia | null> {
  const supabase = await createClient();
  const vehicleType = await getAdminVehicleType();
  const { data, error } = await supabase
    .from("cars")
    .select("*, car_media(*)").eq("vehicle_type", vehicleType)
    .eq("id", id)
    .maybeSingle();
  if (error) {
    console.error("getAdminCarById:", error.message);
    return null;
  }
  if (data && Array.isArray((data as unknown as CarWithMedia).car_media)) {
    (data as unknown as CarWithMedia).car_media.sort(
      (a, b) => Number(b.is_cover) - Number(a.is_cover) || a.position - b.position,
    );
  }
  return data as unknown as CarWithMedia | null;
}

export interface DashboardStats {
  total: number;
  published: number;
  draft: number;
  reserved: number;
  sold: number;
  inventoryValue: number;
  avgPrice: number;
  createdThisMonth: number;
  soldThisMonth: number;
  newLeads: number;
  totalViews: number;
  viewsThisMonth: number;
  totalLeads: number;
  contactRate: number;
  byFuel: { name: string; value: number }[];
  byMake: { name: string; value: number }[];
  byPriceBand: { name: string; value: number }[];
  salesByMonth: { name: string; vendidos: number }[];
  topViewed: { name: string; slug: string; views: number }[];
  /** Funil viatura a viatura: visitas → leads → taxa de conversão. */
  conversion: {
    name: string;
    slug: string;
    status: CarRow["status"];
    views: number;
    leads: number;
    rate: number;
  }[];
}

const PRICE_BANDS: [string, number, number][] = [
  ["< 20k", 0, 20000],
  ["20–40k", 20000, 40000],
  ["40–70k", 40000, 70000],
  ["70–100k", 70000, 100000],
  ["100k+", 100000, Infinity],
];

const MONTHS_PT = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

/** Agrega KPIs e séries para os gráficos da dashboard. */
export async function getDashboardStats(): Promise<DashboardStats> {
  const supabase = await createClient();
  const vehicleType = await getAdminVehicleType();
  const [cars, summary] = await Promise.all([
    allRows((a,b) => supabase.from("cars").select("id, slug, make, model, fuel, price, price_on_request, status, created_at, sold_at").eq("vehicle_type", vehicleType).order("id").range(a,b)),
    supabase.rpc("analytics_summary_by_type", {selected_type:vehicleType}),
  ]);
  if (summary.error || !summary.data) throw new Error("Não foi possível carregar os indicadores.");
  const analytics = summary.data;
  const leadCount = analytics.new_leads;
  const totalLeads = analytics.leads;
  const viewsThisMonth = analytics.month_views;

  const list = (cars ?? []) as Pick<
    CarRow,
    | "id"
    | "slug"
    | "make"
    | "model"
    | "fuel"
    | "price"
    | "price_on_request"
    | "status"
    | "created_at"
    | "sold_at"
  >[];

  // Visitas por viatura → top 5 mais vistas.
  const totalViews = analytics.views;
  const viewsByCar = new Map(analytics.by_car.filter(c => c.views > 0).map(c => [c.id,c.views]));
  const topViewed = [...viewsByCar.entries()]
    .map(([id, count]) => {
      const car = list.find((c) => c.id === id);
      return {
        name: car ? `${car.make} ${car.model}` : "—",
        slug: car?.slug ?? "",
        views: count,
      };
    })
    .sort((a, b) => b.views - a.views)
    .slice(0, 5);

  // Leads por viatura (para o funil de conversão por viatura).
  const leadsByCar = new Map(analytics.by_car.map(c => [c.id,c.leads]));

  // Conversão viatura a viatura: visitas → leads. Ordena pelas mais vistas e
  // mostra as 8 com mais tração — ajuda a detetar preços mal calibrados
  // (muitas visitas, poucos contactos).
  const conversion = list
    .map((c) => {
      const v = viewsByCar.get(c.id) ?? 0;
      const l = leadsByCar.get(c.id) ?? 0;
      return {
        name: `${c.make} ${c.model}`,
        slug: c.slug,
        status: c.status,
        views: v,
        leads: l,
        rate: v ? Math.round((l / v) * 1000) / 10 : 0,
      };
    })
    .filter((c) => c.views > 0)
    .sort((a, b) => b.views - a.views)
    .slice(0, 8);

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  const available = list.filter(
    (c) => c.status === "published" || c.status === "reserved",
  );
  const priced = available.filter((c) => !c.price_on_request && c.price);
  const inventoryValue = priced.reduce((s, c) => s + (c.price ?? 0), 0);

  const count = (s: CarRow["status"]) =>
    list.filter((c) => c.status === s).length;

  const tally = (key: (c: (typeof list)[number]) => string) => {
    const m = new Map<string, number>();
    for (const c of list) m.set(key(c), (m.get(key(c)) ?? 0) + 1);
    return [...m.entries()]
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  };

  const byPriceBand = PRICE_BANDS.map(([name, min, max]) => ({
    name,
    value: priced.filter((c) => (c.price ?? 0) >= min && (c.price ?? 0) < max)
      .length,
  }));

  // Últimos 6 meses de vendas.
  const salesByMonth: { name: string; vendidos: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1);
    const vendidos = list.filter((c) => {
      if (!c.sold_at) return false;
      const t = new Date(c.sold_at);
      return t >= d && t < next;
    }).length;
    salesByMonth.push({ name: MONTHS_PT[d.getMonth()]!, vendidos });
  }

  return {
    total: list.length,
    published: count("published"),
    draft: count("draft"),
    reserved: count("reserved"),
    sold: count("sold"),
    inventoryValue,
    avgPrice: priced.length ? Math.round(inventoryValue / priced.length) : 0,
    createdThisMonth: list.filter((c) => new Date(c.created_at) >= monthStart)
      .length,
    soldThisMonth: list.filter(
      (c) => c.sold_at && new Date(c.sold_at) >= monthStart,
    ).length,
    newLeads: leadCount ?? 0,
    totalViews,
    viewsThisMonth: viewsThisMonth ?? 0,
    totalLeads: totalLeads ?? 0,
    contactRate: totalViews
      ? Math.round((analytics.by_car.reduce((n,c) => n+c.leads,0) / totalViews) * 1000) / 10
      : 0,
    byFuel: tally((c) => c.fuel ?? "Por confirmar"),
    byMake: tallyBrands(list.map((c) => c.make)).slice(0, 6),
    byPriceBand,
    salesByMonth,
    topViewed,
    conversion,
  };
}

/** Todos os testemunhos (staff) para gestão. */
export async function getAllTestimonials() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("testimonials")
    .select("id, name, rating, body, role, published, created_at")
    .order("created_at", { ascending: false });
  if (error) {
    console.error("getAllTestimonials:", error.message);
    return [];
  }
  return data;
}

/** Marca do site para edição no backoffice. */
export async function getSiteSettings(): Promise<{
  company_name: string;
  logo_url: string | null;
  tagline: string | null;
  accent: string;
  accent_soft: string;
  ga4_id: string | null;
  pixel_id: string | null;
  reservation_enabled: boolean;
  deposit_amount: number;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("site_settings")
    .select(
      "company_name, logo_url, tagline, accent, accent_soft, ga4_id, pixel_id, reservation_enabled, deposit_amount",
    )
    .eq("id", 1)
    .maybeSingle();
  return {
    company_name: data?.company_name ?? "Supermotas",
    logo_url: data?.logo_url ?? null,
    tagline: data?.tagline ?? null,
    accent: data?.accent ?? "#E8B15A",
    accent_soft: data?.accent_soft ?? "#C8934A",
    ga4_id: data?.ga4_id ?? null,
    pixel_id: data?.pixel_id ?? null,
    reservation_enabled: data?.reservation_enabled ?? false,
    deposit_amount: data?.deposit_amount ?? 500,
  };
}

/** Valor/hora da mão de obra da oficina (€). 0 se ainda não definido. */
export async function getWorkshopRate(): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("site_settings")
    .select("workshop_hourly_rate")
    .eq("id", 1)
    .maybeSingle();
  return Number(data?.workshop_hourly_rate ?? 0) || 0;
}

/**
 * Dados de contacto/empresa (admin) para o formulário. Cai nos defaults de
 * `site.ts` quando ainda não foram definidos.
 */
export async function getCompanySettings(): Promise<{
  phone: string;
  email: string;
  whatsapp: string;
  messenger: string;
  address_street: string;
  address_city: string;
  address_postal: string;
  address_country: string;
  hours: string;
  geo_lat: number | null;
  geo_lng: number | null;
}> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("site_settings")
    .select(
      "phone, email, whatsapp, messenger, address_street, address_city, address_postal, address_country, hours, geo_lat, geo_lng",
    )
    .eq("id", 1)
    .maybeSingle();
  const d = DEFAULT_COMPANY;
  return {
    phone: data?.phone ?? d.phone,
    email: data?.email ?? d.email,
    whatsapp: data?.whatsapp ?? d.whatsapp,
    messenger: data?.messenger ?? d.messenger,
    address_street: data?.address_street ?? d.address.street,
    address_city: data?.address_city ?? d.address.city,
    address_postal: data?.address_postal ?? d.address.postalCode,
    address_country: data?.address_country ?? d.address.country,
    hours: data?.hours ?? d.hours,
    geo_lat: data?.geo_lat ?? d.geo.lat,
    geo_lng: data?.geo_lng ?? d.geo.lng,
  };
}

/**
 * Credenciais das plataformas externas (admin). Devolve o JSON guardado em
 * `integration_secrets`, ou `{}` se ainda não existir / sem permissão.
 */
export async function getIntegrations(): Promise<Record<string, unknown>> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("integration_secrets")
    .select("data")
    .eq("id", 1)
    .maybeSingle();
  return (data?.data as Record<string, unknown>) ?? {};
}

/** Estado de publicação de uma viatura em cada canal (backoffice). */
export async function getCarListings(
  carId: string,
): Promise<ChannelListingRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("channel_listings")
    .select("*")
    .eq("car_id", carId);
  if (error) {
    // Tabela pode ainda não existir (migração 0013 por aplicar) — não bloqueia.
    console.error("getCarListings:", error.message);
    return [];
  }
  return data as ChannelListingRow[];
}

/** Todos os perfis (só admin, via RLS). */
export async function getProfiles(): Promise<ProfileRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) {
    console.error("getProfiles:", error.message);
    return [];
  }
  return data as ProfileRow[];
}
