"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSection } from "@/lib/guard";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { importAdverts } from "@/lib/olx/import";
import { confirmSuggestions, linkAdvert, setAdvertActive, unlinkAdvert } from "@/lib/olx/links";
import { canUseVehicleType, carTypesError } from "@/lib/vehicle-access";
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
  const r = await importAdverts(admin(), { stats: true });
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

export async function setOlxAdvertActive(advertId: number, active: boolean): Promise<OlxActionResult> {
  const me = await requireSection("anuncios");
  if (!advertIdSchema.safeParse(advertId).success) return { ok: false, error: "Pedido inválido." };
  const carId = await carOfAdvert(advertId);
  if (carId) {
    const denied = await carTypesError(await createClient(), me, [carId]);
    if (denied) return { ok: false, error: denied };
  }
  return done(await setAdvertActive(admin(), advertId, !!active));
}
