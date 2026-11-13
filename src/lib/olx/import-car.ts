import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fieldFor, pickValue, type OlxAttributeDef } from "@/lib/olx/attributes";
import { unwrap } from "@/lib/olx/categories";
import { olxFetch, type OlxResponse } from "@/lib/olx/client";
import { BODY_TYPES, FUEL_TYPES, TRANSMISSIONS } from "@/lib/schemas";
import { MEDIA_BUCKET, MEDIA_CACHE_CONTROL } from "@/lib/storage";
import { isMotorcycleBody } from "@/lib/vehicle-categories";
import type { Database } from "@/lib/supabase/database.types";

/**
 * «Criar viatura» a partir de um anúncio do OLX que não tem viatura no stock:
 * os campos vêm dos atributos do anúncio (lidos com a definição da categoria,
 * para traduzir os códigos do OLX nas etiquetas), e as fotos são copiadas do
 * CDN do OLX para o Storage do site.
 *
 * Um campo obrigatório que não se reconhece não é inventado: diz-se qual falta
 * e a viatura cria-se à mão, como na publicação (`attributes.ts`).
 */

type Db = SupabaseClient<Database>;

/** O anúncio como o `GET /adverts/{id}` o devolve (só o que se usa). */
export interface OlxAdvertFull {
  id: number;
  title: string;
  description?: string | null;
  category_id: number;
  price?: { value?: string | number | null } | null;
  attributes?: { code: string; value?: string | null; values?: string[] | null }[] | null;
  images?: { url: string }[] | null;
}

export type CarInputResult = { ok: true; input: Record<string, unknown> } | { ok: false; missing: string[] };

const fold = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Marca: a categoria (nos carros é a marca) se o título começa por ela; senão a 1.ª palavra. */
export function makeFromAdvert(title: string, categoryName: string | null): string {
  if (categoryName && fold(title).startsWith(fold(categoryName))) return categoryName;
  return title.trim().split(/\s+/)[0] ?? "";
}

/** O maior número do valor: «4-5» portas → 5; «242000» → 242000. */
function numberOf(v: string | null | undefined): number | null {
  const nums = (v ?? "").match(/\d+/g)?.map(Number) ?? [];
  return nums.length ? Math.max(...nums) : null;
}

const asOptions = (list: readonly string[]) => list.map((v) => ({ code: v, label: v }));

export function advertToCarInput(
  advert: OlxAdvertFull,
  defs: OlxAttributeDef[],
  ctx: { make: string; vehicleType: "car" | "motorcycle" },
): CarInputResult {
  const facts: Record<string, string> = {};
  const olxAttributes: Record<string, string | string[]> = {};
  for (const a of advert.attributes ?? []) {
    if (a.values?.length) olxAttributes[a.code] = a.values;
    else if (a.value) olxAttributes[a.code] = a.value;
    const def = defs.find((d) => d.code === a.code);
    const field = def ? fieldFor(def) : null;
    if (!field || !a.value || facts[field]) continue;
    facts[field] = a.value;
    const label = def?.values?.find((v) => v.code === a.value)?.label;
    if (label && !["registrationMonth", "year", "mileage", "power", "displacement", "doors", "seats"].includes(field)) facts[field] = label;
  }

  const bodies = BODY_TYPES.filter((b) => isMotorcycleBody(b) === (ctx.vehicleType === "motorcycle"));
  const year = numberOf(facts.year);
  const fuel = facts.fuel ? pickValue(facts.fuel, asOptions(FUEL_TYPES)) : null;
  const transmission = facts.transmission ? pickValue(facts.transmission, asOptions(TRANSMISSIONS)) : null;
  const body = facts.body ? pickValue(facts.body, asOptions(bodies)) : null;

  const missing = [
    !year && "ano",
    !fuel && "combustível",
    !transmission && "caixa",
    !body && "carroçaria",
  ].filter((m): m is string => !!m);
  if (missing.length) return { ok: false, missing };

  const titleModel = advert.title.trim().slice(fold(advert.title).startsWith(fold(ctx.make)) ? ctx.make.length : 0).trim();
  const month = numberOf(facts.registrationMonth);
  const price = Number(advert.price?.value);
  return {
    ok: true,
    input: {
      vehicle_type: ctx.vehicleType,
      make: ctx.make,
      model: facts.model || titleModel || advert.title,
      year,
      ...(month && month >= 1 && month <= 12 ? { registration_month: month } : {}),
      mileage: numberOf(facts.mileage) ?? 0,
      fuel,
      transmission,
      body,
      power: numberOf(facts.power) ?? 0,
      displacement: numberOf(facts.displacement) ?? 0,
      seats: numberOf(facts.seats) ?? 5,
      doors: numberOf(facts.doors) ?? (ctx.vehicleType === "motorcycle" ? 0 : 5),
      ...(Number.isFinite(price) && price > 0 ? { price } : {}),
      status: "draft",
      channels: [],
      description: (advert.description ?? "").trim().slice(0, 5000),
      olx_attributes: olxAttributes,
    },
  };
}

/** A categoria «Motociclos - Scooters» do OLX Portugal. */
const MOTORCYCLES_CATEGORY = 379;

/** Mota se a categoria é 379 ou descende dela (até 4 níveis); carro nos outros casos. */
export async function vehicleTypeOfCategory(db: Db, categoryId: number): Promise<"car" | "motorcycle"> {
  let id: number | null = categoryId;
  for (let level = 0; id && level < 4; level++) {
    if (id === MOTORCYCLES_CATEGORY) return "motorcycle";
    const r: OlxResponse<unknown> = await olxFetch<unknown>(db, `/categories/${id}`);
    id = r.ok ? unwrap<{ parent_id?: number | null }>(r.data)?.parent_id ?? null : null;
  }
  return "car";
}

/** Só se copiam fotos do CDN do OLX (https e um anfitrião *.olxcdn.com). */
export function isOlxImageUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && u.hostname.endsWith(".olxcdn.com");
  } catch {
    return false;
  }
}

const MAX_PHOTOS = 30;
const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Copia as fotos do anúncio para `car-media/{carId}/olx-N.jpg` e regista-as em
 * `car_media` (a primeira é a capa). Uma foto que falhe não trava as outras.
 * `allow` só existe para os testes apontarem para um servidor local.
 */
export async function copyAdvertPhotos(
  db: Db,
  carId: string,
  urls: string[],
  opts: { allow?: (url: string) => boolean } = {},
): Promise<{ copied: number; failed: number }> {
  const allow = opts.allow ?? isOlxImageUrl;
  let copied = 0;
  let failed = 0;
  for (const url of urls.slice(0, MAX_PHOTOS)) {
    try {
      if (!allow(url)) throw new Error("origem não permitida");
      const r = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: "error" });
      const type = r.headers.get("content-type") ?? "";
      if (!r.ok || !type.startsWith("image/")) throw new Error("não é uma imagem");
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.byteLength > MAX_BYTES) throw new Error("demasiado grande");
      const path = `${carId}/olx-${copied + 1}.jpg`;
      const up = await db.storage.from(MEDIA_BUCKET).upload(path, bytes, {
        contentType: type,
        cacheControl: MEDIA_CACHE_CONTROL,
        upsert: true,
      });
      if (up.error) throw new Error(up.error.message);
      const { error } = await db
        .from("car_media")
        .insert({ car_id: carId, storage_path: path, kind: "image", position: copied, is_cover: copied === 0 });
      if (error) throw new Error(error.message);
      copied += 1;
    } catch (e) {
      console.error("olx copyAdvertPhotos:", e instanceof Error ? e.message : e);
      failed += 1;
    }
  }
  return { copied, failed };
}
