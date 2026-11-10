import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getBranding, getSiteVehicleTypes } from "@/lib/queries";
import { site } from "@/lib/site";
import { publicMediaUrl } from "@/lib/storage";
import { buildAdvert, type AdvertCar } from "@/lib/olx/advert";
import type { OlxAttributeDef } from "@/lib/olx/attributes";
import { categoryCandidates, isVehicleCategory, unwrap, type OlxCategory } from "@/lib/olx/categories";
import { getConnection, olxFetch } from "@/lib/olx/client";
import { desiredAction } from "@/lib/olx/lifecycle";
import { parseStats, wantsStats } from "@/lib/olx/stats";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Sincronização de uma viatura com o OLX.
 *
 * Executa o que `desiredAction` decide e grava o resultado em
 * `channel_listings`: o id e o URL do anúncio, o estado no OLX e, quando algo
 * falha, a razão em português. Nunca lança — quem chama (a gravação da viatura
 * ou a manutenção periódica) não pode falhar por causa do OLX.
 */

type Db = SupabaseClient<Database>;

const CHANNEL = "olx";
/** Depois disto deixa de tentar sozinho; fica o erro à vista no backoffice. */
export const MAX_ATTEMPTS = 8;

interface RemoteAdvert {
  id: number;
  status: string;
  url?: string;
}

/** Marca a viatura para sincronizar. Chamado sempre que a viatura é gravada. */
export async function markPending(db: Db, carId: string): Promise<void> {
  const { data: car } = await db.from("cars").select("channels").eq("id", carId).maybeSingle();
  const { data: listing } = await db
    .from("channel_listings")
    .select("id,external_id")
    .eq("car_id", carId)
    .eq("channel", CHANNEL)
    .maybeSingle();
  const quer = (car?.channels ?? []).includes(CHANNEL);
  // Sem OLX marcado e sem anúncio no OLX, não há nada a fazer.
  if (!quer && !listing?.external_id) return;
  if (listing) {
    await db
      .from("channel_listings")
      .update({ sync_state: "pending", attempts: 0 })
      .eq("id", listing.id);
  } else {
    await db.from("channel_listings").insert({
      car_id: carId,
      channel: CHANNEL,
      status: "pending",
      sync_state: "pending",
    });
  }
}

export interface SyncOutcome {
  ok: boolean;
  action: string;
  error?: string;
}

export async function syncListing(db: Db, carId: string): Promise<SyncOutcome> {
  const { data: listing } = await db
    .from("channel_listings")
    .select("*")
    .eq("car_id", carId)
    .eq("channel", CHANNEL)
    .maybeSingle();
  if (!listing) return { ok: true, action: "none" };

  const fail = async (action: string, error: string): Promise<SyncOutcome> => {
    await db
      .from("channel_listings")
      .update({
        sync_state: "error",
        last_error: error.slice(0, 1000),
        attempts: listing.attempts + 1,
        ...(action === "create" ? { status: "error" as const } : {}),
      })
      .eq("id", listing.id);
    return { ok: false, action, error };
  };

  try {
    const { data: car } = await db
      .from("cars")
      .select("*, car_media(storage_path, kind, position, is_cover)")
      .eq("id", carId)
      .maybeSingle();
    if (!car) {
      // A viatura foi apagada: o anúncio no OLX não pode ficar órfão.
      if (listing.external_id) {
        await olxFetch(db, `/adverts/${listing.external_id}/commands`, {
          method: "POST",
          body: { command: "deactivate", is_success: false },
        });
      }
      await db.from("channel_listings").delete().eq("id", listing.id);
      return { ok: true, action: "deactivate" };
    }

    // Um tipo que o site deixou de vender (Definições → Tipo de site) sai do
    // OLX como um rascunho: o link do anúncio já não abria a ficha.
    const sold = (await getSiteVehicleTypes()).includes(car.vehicle_type ?? "car");
    const action = desiredAction({
      status: sold ? car.status : "draft",
      channels: car.channels ?? [],
      externalId: listing.external_id,
      remoteStatus: listing.remote_status,
    });

    if (action === "none") {
      await db
        .from("channel_listings")
        .update({ sync_state: "idle", last_error: null, attempts: 0 })
        .eq("id", listing.id);
      return { ok: true, action };
    }

    if (action === "deactivate" || action === "deactivate_sold") {
      const r = await olxFetch(db, `/adverts/${listing.external_id}/commands`, {
        method: "POST",
        body: { command: "deactivate", is_success: action === "deactivate_sold" },
      });
      if (!r.ok) return fail(action, r.error ?? "falha ao desativar");
      await db
        .from("channel_listings")
        .update({
          status: "removed",
          remote_status: "removed_by_user",
          sync_state: "idle",
          last_error: null,
          attempts: 0,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", listing.id);
      return { ok: true, action };
    }

    // create / update: é preciso montar o anúncio.
    const vehicleType = (car.vehicle_type ?? "car") as "car" | "motorcycle";
    const ownCategory = (car as { olx_category_id?: number | null }).olx_category_id ?? null;
    const [{ data: category }, conn, branding] = await Promise.all([
      // A categoria própria da viatura, se tiver; senão a padrão do tipo.
      ownCategory
        ? db.from("olx_category_details").select("*").eq("category_id", ownCategory).maybeSingle()
        : db.from("olx_category_cache").select("*").eq("vehicle_type", vehicleType).maybeSingle(),
      getConnection(db),
      getBranding(),
    ]);
    if (!conn) return fail(action, "A conta do OLX não está ligada (Plataformas de anúncios → Ligar conta OLX).");
    if (!category)
      return fail(
        action,
        ownCategory
          ? "A categoria do OLX escolhida para esta viatura não está carregada. Escolha-a outra vez na ficha."
          : "Falta escolher a categoria do OLX (Plataformas de anúncios → OLX).",
      );

    // A cidade do stand é obrigatória em cada anúncio. Se ainda não foi lida
    // (p. ex. as categorias foram escolhidas pela árvore), lê-se agora.
    let cityId = Number(conn.city_id ?? 0);
    if (!cityId) {
      const loc = await resolveStandLocation(db);
      if (!loc.ok) return fail(action, `Não publicado: ${loc.error}.`);
      cityId = loc.cityId;
    }

    // A relação cars→car_media não está nos tipos gerados; a forma é esta.
    type Media = { storage_path: string; kind: string; position: number; is_cover: boolean };
    const media = [...(((car as unknown as { car_media?: Media[] }).car_media) ?? [])]
      .filter((m) => m.kind === "image")
      .sort((a, b) => Number(b.is_cover) - Number(a.is_cover) || a.position - b.position)
      .map((m) => publicMediaUrl(m.storage_path));

    const advertCar: AdvertCar = {
      id: car.id,
      make: car.make,
      model: car.model,
      variant: car.variant,
      year: car.year ?? 0,
      registrationMonth: car.registration_month ?? null,
      mileage: car.mileage,
      fuel: car.fuel ?? "",
      transmission: car.transmission ?? "",
      body: car.body ?? "",
      power: car.power,
      displacement: car.displacement,
      color: car.color,
      doors: car.doors,
      seats: car.seats,
      price: car.price,
      priceOnRequest: car.price_on_request,
      description: car.description,
      tagline: car.tagline,
      extras: car.extras ?? [],
      olxValues: (car as { olx_attributes?: unknown }).olx_attributes,
    };

    const built = buildAdvert(advertCar, {
      categoryId: Number(category.category_id),
      attributeDefs: (category.attributes ?? []) as unknown as OlxAttributeDef[],
      cityId,
      latitude: branding.company.geo?.lat,
      longitude: branding.company.geo?.lng,
      contactName: branding.companyName,
      contactPhone: (branding.company.phone || "").replace(/[^\d+]/g, ""),
      images: media,
      photosLimit: category.photos_limit,
    });
    if (!built.ok) return fail(action, `Não publicado: ${built.problems.join("; ")}.`);

    let remote: RemoteAdvert | null = null;
    let externalId = listing.external_id;

    if (action === "create") {
      // Idempotência: se uma tentativa anterior chegou a criar o anúncio mas
      // a resposta se perdeu, ele já existe com o nosso external_id.
      const found = await olxFetch<unknown>(db, `/adverts?external_id=${encodeURIComponent(car.id)}`);
      const existentes = found.ok ? unwrap<RemoteAdvert[]>(found.data) ?? [] : [];
      if (existentes.length) {
        externalId = String(existentes[0]!.id);
      } else {
        const r = await olxFetch<unknown>(db, "/adverts", { method: "POST", body: built.advert });
        if (!r.ok) return fail(action, r.error ?? "falha ao criar");
        remote = unwrap<RemoteAdvert>(r.data);
        externalId = String(remote.id);
      }
    }

    if (action !== "create" || !remote) {
      const r = await olxFetch<unknown>(db, `/adverts/${externalId}`, {
        method: "PUT",
        body: built.advert,
      });
      if (!r.ok) return fail(action, r.error ?? "falha ao atualizar");
      remote = unwrap<RemoteAdvert>(r.data) ?? remote;
    }

    if (action === "update_and_activate") {
      const r = await olxFetch(db, `/adverts/${externalId}/commands`, {
        method: "POST",
        body: { command: "activate" },
      });
      if (!r.ok) return fail(action, r.error ?? "falha ao reativar");
    }

    // O estado verdadeiro, depois de tudo (moderação, pacote pago, …).
    const final = await olxFetch<unknown>(db, `/adverts/${externalId}`);
    if (final.ok) remote = unwrap<RemoteAdvert>(final.data) ?? remote;

    const remoteStatus = remote?.status ?? null;
    await db
      .from("channel_listings")
      .update({
        external_id: externalId,
        external_url: remote?.url ?? listing.external_url,
        remote_status: remoteStatus,
        status: remoteStatus === "active" || remoteStatus === "new" ? "published" : "pending",
        published_at: listing.published_at ?? new Date().toISOString(),
        sync_state: "idle",
        // `limited` não é uma falha da sincronização, mas tem de se ver.
        last_error:
          remoteStatus === "limited"
            ? "O OLX pede um pacote pago para esta categoria. Ative-o na conta do OLX."
            : null,
        attempts: 0,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", listing.id);
    return { ok: true, action };
  } catch (error) {
    console.error("olx syncListing:", error);
    return fail("error", error instanceof Error ? error.message : "Falha inesperada.");
  }
}

/** Repete o que ficou pendente ou falhou. Chamado pelo /api/maintenance. */
export async function syncPending(db: Db, limit = 20): Promise<number> {
  const conn = await getConnection(db);
  if (!conn) return 0;
  const { data } = await db
    .from("channel_listings")
    .select("car_id")
    .eq("channel", CHANNEL)
    .in("sync_state", ["pending", "error"])
    .lt("attempts", MAX_ATTEMPTS)
    .limit(limit);
  for (const row of data ?? []) await syncListing(db, row.car_id);
  return data?.length ?? 0;
}

export interface StatsRefresh {
  updated: number;
  failed: number;
  /** Primeiro erro, para mostrar no backoffice. */
  error?: string;
}

/**
 * Lê as estatísticas dos anúncios no OLX e guarda-as em `channel_listings`.
 * `carIds` limita a algumas viaturas; sem ele, todas as que têm anúncio.
 * Nunca lança: um anúncio que falhe não impede os outros.
 */
export async function refreshStats(db: Db, carIds?: string[]): Promise<StatsRefresh> {
  const result: StatsRefresh = { updated: 0, failed: 0 };
  if (!(await getConnection(db))) return { ...result, error: "A conta do OLX não está ligada." };

  let q = db
    .from("channel_listings")
    .select("id, external_id, status")
    .eq("channel", CHANNEL)
    .not("external_id", "is", null);
  if (carIds?.length) q = q.in("car_id", carIds);
  const { data, error } = await q;
  if (error) return { ...result, error: error.message };

  for (const listing of (data ?? []).filter(wantsStats)) {
    try {
      const r = await olxFetch<unknown>(db, `/adverts/${listing.external_id}/statistics`);
      if (!r.ok) {
        result.failed += 1;
        result.error ??= r.error ?? "falha ao ler estatísticas";
        continue;
      }
      const s = parseStats(r.data);
      await db
        .from("channel_listings")
        .update({
          views: s.views,
          phone_views: s.phoneViews,
          observers: s.observers,
          stats_at: new Date().toISOString(),
        })
        .eq("id", listing.id);
      result.updated += 1;
    } catch (e) {
      result.failed += 1;
      result.error ??= e instanceof Error ? e.message : "falha inesperada";
    }
  }
  return result;
}

export interface CategoryLoadResult {
  ok: boolean;
  error?: string;
  /** Por tipo: a escolhida, ou as candidatas quando há dúvida. */
  chosen: Partial<Record<"car" | "motorcycle", OlxCategory>>;
  ambiguous: Partial<Record<"car" | "motorcycle", OlxCategory[]>>;
  /** Alguns nomes lidos do OLX, para explicar quando não se encontra nada. */
  seen?: string[];
  /** Cidade do stand no OLX, quando foi encontrada. */
  location?: string;
  /** Porque não se encontrou a cidade do stand. */
  locationError?: string;
}

/**
 * Um nível da árvore de categorias do OLX: os grupos principais (`parentId`
 * nulo) ou as subcategorias de um. É assim que o OLX as mostra ao criar um
 * anúncio, e evita descarregar a árvore inteira (centenas de pedidos).
 */
export async function browseCategories(
  db: Db,
  parentId: number | null,
): Promise<{ ok: true; categories: OlxCategory[] } | { ok: false; error: string }> {
  const r = await olxFetch<unknown>(db, parentId === null ? "/categories" : `/categories?parent_id=${parentId}`);
  if (!r.ok) return { ok: false, error: r.error ?? "falha ao ler categorias" };
  const lista = (unwrap<OlxCategory[]>(r.data) ?? [])
    // Sem o pedido de parent_id, há APIs que devolvem a árvore toda: fica só a raiz.
    .filter((c) => (parentId === null ? !c.parent_id : true))
    .map((c) => ({ id: c.id, name: c.name, parent_id: c.parent_id ?? null, is_leaf: c.is_leaf, photos_limit: c.photos_limit }))
    .sort((a, b) => a.name.localeCompare(b.name, "pt"));
  return { ok: true, categories: lista };
}

/**
 * Guarda uma categoria escolhida e os seus atributos (os campos que o anúncio
 * leva). `name` é o caminho legível, para o backoffice mostrar onde está.
 */
export async function storeCategoryDetails(
  db: Db,
  category: Pick<OlxCategory, "id" | "photos_limit">,
  name: string,
): Promise<{ error: string | null; attributes: unknown[] }> {
  const attrs = await olxFetch<unknown>(db, `/categories/${category.id}/attributes`);
  if (!attrs.ok) return { error: attrs.error, attributes: [] };
  const attributes = unwrap<unknown[]>(attrs.data) ?? [];
  const { error } = await db.from("olx_category_details").upsert({
    category_id: category.id,
    category_name: name,
    photos_limit: category.photos_limit ?? 0,
    attributes: attributes as never,
    fetched_at: new Date().toISOString(),
  });
  // Sem a migração 0031 a tabela não existe; a categoria padrão (abaixo)
  // continua a funcionar, por isso não é um erro aqui.
  if (error && !/olx_category_details|does not exist|schema cache/i.test(error.message)) {
    return { error: error.message, attributes };
  }
  return { error: null, attributes };
}

/** Guarda a categoria padrão de um tipo de viatura e os seus atributos. */
export async function storeCategory(
  db: Db,
  vehicleType: "car" | "motorcycle",
  category: OlxCategory,
  path?: string,
): Promise<string | null> {
  const details = await storeCategoryDetails(db, category, path ?? category.name);
  if (details.error) return details.error;
  const { error } = await db.from("olx_category_cache").upsert({
    vehicle_type: vehicleType,
    category_id: category.id,
    category_name: path ?? category.name,
    photos_limit: category.photos_limit ?? 0,
    attributes: details.attributes as never,
    fetched_at: new Date().toISOString(),
  });
  return error ? error.message : null;
}

/**
 * Lê a árvore de categorias do OLX e escolhe as de carros e motas. Resolve
 * também a cidade do stand, obrigatória em cada anúncio.
 */
export async function loadCategories(db: Db): Promise<CategoryLoadResult> {
  const result: CategoryLoadResult = { ok: true, chosen: {}, ambiguous: {} };

  // Primeiro a cidade do stand: assim fica guardada mesmo que as categorias
  // falhem ou sejam escolhidas depois pela árvore.
  const loc = await resolveStandLocation(db);
  if (loc.ok) result.location = loc.cityName ?? `cidade ${loc.cityId}`;
  else result.locationError = loc.error;

  // A árvore percorre-se por níveis; três chegam para Veículos → Carros.
  const todas: OlxCategory[] = [];
  let nivel: (number | null)[] = [null];
  for (let profundidade = 0; profundidade < 3 && nivel.length; profundidade++) {
    const seguinte: number[] = [];
    for (const parent of nivel) {
      const r = await olxFetch<unknown>(db, parent === null ? "/categories" : `/categories?parent_id=${parent}`);
      if (!r.ok) return { ...result, ok: false, error: r.error ?? "falha ao ler categorias" };
      const lista = unwrap<OlxCategory[]>(r.data) ?? [];
      todas.push(...lista);
      // Só se desce nos ramos de veículos, para não varrer o OLX inteiro.
      for (const c of lista)
        if (!c.is_leaf && /carro|moto|veicul|automo/i.test(c.name.normalize("NFD").replace(/[̀-ͯ]/g, "")))
          seguinte.push(c.id);
    }
    nivel = seguinte;
  }

  if (!todas.length) return { ...result, ok: false, error: "O OLX não devolveu nenhuma categoria." };
  // Para o diagnóstico, quando não se encontra nada de veículos.
  result.seen = todas.slice(0, 12).map((c) => c.name);

  for (const tipo of ["car", "motorcycle"] as const) {
    const cands = categoryCandidates(todas, tipo);
    if (cands.length === 1) {
      const erro = await storeCategory(db, tipo, cands[0]!);
      if (erro) return { ...result, ok: false, error: erro };
      result.chosen[tipo] = cands[0]!;
    } else if (cands.length > 1) {
      result.ambiguous[tipo] = cands;
    } else {
      // Nenhum nome conhecido: mostra as categorias de veículos que existem,
      // para o administrador escolher em vez de ficar sem saída.
      const veiculos = [...new Map(todas.filter(isVehicleCategory).map((c) => [c.id, c])).values()];
      if (veiculos.length) result.ambiguous[tipo] = veiculos;
    }
  }

  return result;
}

type LocationItem = {
  city?: { id?: number; name?: string } | null;
  city_id?: number;
  district?: { id?: number } | null;
  district_id?: number;
};

/**
 * Cidade (e bairro) do stand no OLX, a partir das coordenadas do ponto de
 * venda principal, e guarda-a na ligação. Devolve um erro em português que diz
 * o que corrigir, em vez de deixar o anúncio falhar sem explicação.
 */
export async function resolveStandLocation(
  db: Db,
): Promise<{ ok: true; cityId: number; cityName: string | null } | { ok: false; error: string }> {
  const branding = await getBranding();
  const geo = branding.company.geo;
  // As coordenadas de exemplo do site.ts (Lisboa) não são as do stand: com
  // elas o anúncio aparecia na cidade errada.
  if (!geo?.lat || !geo?.lng || (geo.lat === site.geo.lat && geo.lng === site.geo.lng)) {
    return {
      ok: false,
      error:
        "falta a localização do stand — marque o ponto de venda principal no mapa (Página inicial → Pontos de venda)",
    };
  }
  const r = await olxFetch<unknown>(db, `/locations?latitude=${geo.lat}&longitude=${geo.lng}`);
  if (!r.ok) return { ok: false, error: `o OLX não devolveu a localização do stand (${r.error ?? "erro"})` };
  const lista = unwrap<unknown>(r.data);
  const first = (Array.isArray(lista) ? lista[0] : lista) as LocationItem | undefined;
  const cityId = Number(first?.city?.id ?? first?.city_id ?? 0);
  if (!cityId) {
    return {
      ok: false,
      error:
        "o OLX não encontrou uma cidade para as coordenadas do stand — confirme o ponto no mapa (Página inicial → Pontos de venda)",
    };
  }
  const districtId = first?.district?.id ?? first?.district_id ?? null;
  await db.from("olx_connection").update({ city_id: cityId, district_id: districtId }).eq("id", 1);
  return { ok: true, cityId, cityName: first?.city?.name ?? null };
}
