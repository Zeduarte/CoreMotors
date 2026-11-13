"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSection } from "@/lib/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { importAdverts } from "@/lib/olx/import";
import { confirmSuggestions, linkAdvert, setAdvertActive, unlinkAdvert } from "@/lib/olx/links";
import { canUseVehicleType, carTypesError, VEHICLE_TYPE_DENIED } from "@/lib/vehicle-access";
import { olxFetch } from "@/lib/olx/client";
import { unwrap } from "@/lib/olx/categories";
import type { OlxAttributeDef } from "@/lib/olx/attributes";
import {
  advertToCarInput,
  copyAdvertPhotos,
  makeFromAdvert,
  vehicleTypeOfCategory,
  type OlxAdvertFull,
} from "@/lib/olx/import-car";
import { createCar } from "@/lib/actions/cars";
import type { OlxActionResult } from "@/lib/actions/olx";

/**
 * Ações da lista «Anúncios no OLX» (Plataformas de anúncios). Correm com o
 * cliente de serviço — `olx_adverts` não é legível por nenhuma sessão — por
 * isso cada uma verifica primeiro o separador e, quando mexe numa viatura, o
 * tipo dela: a RLS por tipo não se aplica ao cliente de serviço.
 */

function admin() {
  const db = createAdminClient();
  if (!db) throw new Error("SUPABASE_SERVICE_ROLE_KEY em falta.");
  return db;
}

const advertIdSchema = z.number().int().positive();

function done(r: { ok: boolean; error?: string; message?: string }): OlxActionResult {
  revalidatePath("/admin/anuncios");
  return r.ok ? { ok: true, message: r.message } : { ok: false, error: r.error };
}

/** Viatura associada a um anúncio, para verificar o tipo antes de mexer. */
async function carOfAdvert(advertId: number): Promise<string | null> {
  const { data } = await admin().from("olx_adverts").select("car_id").eq("id", advertId).maybeSingle();
  return data?.car_id ?? null;
}

export async function readOlxAdverts(): Promise<OlxActionResult> {
  await requireSection("anuncios");
  const r = await importAdverts(admin(), { stats: "all" });
  revalidatePath("/admin/anuncios");
  if (!r.ok) return { ok: false, error: r.error ?? "Não foi possível ler os anúncios do OLX." };
  const extra = r.cleared ? ` ${r.cleared} anúncio(s) de outra conta deixaram de estar associados.` : "";
  return { ok: true, message: `${r.read} anúncio(s) lido(s) do OLX.${extra}` };
}

export async function linkOlxAdvert(advertId: number, carId: string): Promise<OlxActionResult> {
  const me = await requireSection("anuncios");
  if (!advertIdSchema.safeParse(advertId).success || !z.string().uuid().safeParse(carId).success) {
    return { ok: false, error: "Pedido inválido." };
  }
  const denied = await carTypesError(await createClient(), me, [carId]);
  if (denied) return { ok: false, error: denied };
  const r = await linkAdvert(admin(), advertId, carId);
  revalidatePath(`/admin/carros/${carId}`);
  return done(r);
}

export async function unlinkOlxAdvert(advertId: number): Promise<OlxActionResult> {
  const me = await requireSection("anuncios");
  if (!advertIdSchema.safeParse(advertId).success) return { ok: false, error: "Pedido inválido." };
  const carId = await carOfAdvert(advertId);
  if (carId) {
    const denied = await carTypesError(await createClient(), me, [carId]);
    if (denied) return { ok: false, error: denied };
    revalidatePath(`/admin/carros/${carId}`);
  }
  return done(await unlinkAdvert(admin(), advertId));
}

export async function confirmOlxSuggestions(): Promise<OlxActionResult> {
  const me = await requireSection("anuncios");
  return done(await confirmSuggestions(admin(), (type) => canUseVehicleType(me, type)));
}

/**
 * «Criar viatura» a partir de um anúncio sem viatura: rascunho, sem OLX
 * marcado, já associado e com as fotos do anúncio. A `createCar` verifica o
 * separador «Viaturas», o tipo de quem pede e o tipo de site.
 */
export async function createCarFromOlxAdvert(advertId: number): Promise<OlxActionResult & { carId?: string }> {
  await requireSection("anuncios");
  if (!advertIdSchema.safeParse(advertId).success) return { ok: false, error: "Pedido inválido." };
  const db = admin();
  const { data: row } = await db.from("olx_adverts").select("car_id, category_name").eq("id", advertId).maybeSingle();
  if (!row) return { ok: false, error: "Anúncio não encontrado. Carregue em «Ler anúncios do OLX» e tente outra vez." };
  if (row.car_id) return { ok: false, error: "Este anúncio já está associado a uma viatura." };

  const g = await olxFetch<unknown>(db, `/adverts/${advertId}`);
  const advert = g.ok ? unwrap<OlxAdvertFull>(g.data) : null;
  if (!advert) return { ok: false, error: g.error ?? "O OLX não devolveu o anúncio." };
  const attrs = await olxFetch<unknown>(db, `/categories/${advert.category_id}/attributes`);
  const defs = attrs.ok ? unwrap<OlxAttributeDef[]>(attrs.data) ?? [] : [];

  const built = advertToCarInput(advert, defs, {
    make: makeFromAdvert(advert.title, row.category_name),
    vehicleType: await vehicleTypeOfCategory(db, advert.category_id),
  });
  if (!built.ok) {
    return {
      ok: false,
      error: `Não dá para criar a viatura sozinho: o anúncio não diz ${built.missing.join(", ")}. Crie-a à mão e associe-a.`,
    };
  }
  const created = await createCar(built.input);
  if (!created.ok || !created.id) {
    const campos = created.fieldErrors ? ` (${Object.values(created.fieldErrors).flat().join("; ")})` : "";
    return { ok: false, error: `${created.error ?? "Não foi possível criar a viatura."}${campos}` };
  }

  const link = await linkAdvert(db, advertId, created.id);
  const photos = await copyAdvertPhotos(db, created.id, (advert.images ?? []).map((i) => i.url));
  revalidatePath("/admin/anuncios");
  revalidatePath("/admin/carros");
  const avisos = [
    photos.failed ? `${photos.failed} foto(s) não foram copiadas` : "",
    link.ok ? "" : `não ficou associada (${link.error})`,
  ].filter(Boolean);
  return {
    ok: true,
    carId: created.id,
    message: `Viatura criada em rascunho com ${photos.copied} foto(s)${avisos.length ? ` — ${avisos.join("; ")}` : ""}. Reveja-a antes de a publicar.`,
  };
}

export async function setOlxAdvertActive(advertId: number, active: boolean): Promise<OlxActionResult> {
  const me = await requireSection("anuncios");
  if (!advertIdSchema.safeParse(advertId).success) return { ok: false, error: "Pedido inválido." };
  const carId = await carOfAdvert(advertId);
  if (carId) {
    const denied = await carTypesError(await createClient(), me, [carId]);
    if (denied) return { ok: false, error: denied };
  } else {
    // Sem viatura, o tipo vem da categoria do anúncio (carros ou motas).
    const db = admin();
    const { data } = await db.from("olx_adverts").select("category_id").eq("id", advertId).maybeSingle();
    if (data?.category_id && !canUseVehicleType(me, await vehicleTypeOfCategory(db, data.category_id))) {
      return { ok: false, error: VEHICLE_TYPE_DENIED };
    }
  }
  return done(await setAdvertActive(admin(), advertId, !!active));
}
