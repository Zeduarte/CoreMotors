"use server";

import { requireSection } from "@/lib/guard";

import { revalidatePublic } from "@/lib/public-cache";
import { createClient } from "@/lib/supabase/server";
import { MEDIA_BUCKET } from "@/lib/storage";
import type { MediaKind } from "@/lib/supabase/database.types";
import { queueOlxSync } from "@/lib/olx/queue";

export interface MediaResult {
  ok: boolean;
  error?: string;
}

interface NewMedia {
  storage_path: string;
  kind: MediaKind;
  alt?: string;
  width?: number | null;
  height?: number | null;
}

async function revalidateCar(carId: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("cars")
    .select("slug")
    .eq("id", carId)
    .maybeSingle();
  if (data?.slug) revalidatePublic(`/viaturas/${data.slug}`);
  revalidatePublic("/inventario");
  revalidatePublic("/");
  revalidatePublic(`/admin/carros/${carId}`);
  // As fotografias também vão para o anúncio do OLX.
  await queueOlxSync([carId]);
}

/**
 * Regista media já carregada para o Storage (o upload em si acontece no
 * browser com o cliente autenticado). Acrescenta no fim da ordem; a primeira
 * imagem de um carro sem capa passa a ser a capa.
 */
export async function registerMedia(
  carId: string,
  items: NewMedia[],
): Promise<MediaResult> {
  await requireSection("carros");
  if (!items.length) return { ok: true };
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("car_media")
    .select("id, position, is_cover, kind")
    .eq("car_id", carId);

  const rows = existing ?? [];
  let position = rows.reduce((m, r) => Math.max(m, r.position), -1) + 1;
  const hasCover = rows.some((r) => r.is_cover);
  const hasImage = rows.some((r) => r.kind === "image");

  const payload = items.map((it, i) => {
    const isFirstImageEver =
      it.kind === "image" && !hasCover && !hasImage && i === 0;
    return {
      car_id: carId,
      kind: it.kind,
      storage_path: it.storage_path,
      alt: it.alt ?? "",
      width: it.width ?? null,
      height: it.height ?? null,
      position: position++,
      is_cover: isFirstImageEver,
    };
  });

  const { error } = await supabase.from("car_media").insert(payload);
  if (error) {
    console.error("registerMedia:", error.message);
    return { ok: false, error: error.message };
  }
  await revalidateCar(carId);
  return { ok: true };
}

/** Nova ordem: `orderedIds` na sequência desejada. */
export async function reorderMedia(
  carId: string,
  orderedIds: string[],
): Promise<MediaResult> {
  await requireSection("carros");
  const supabase = await createClient();
  const updates = await Promise.all(
    orderedIds.map((id, i) =>
      supabase.from("car_media").update({ position: i }).eq("id", id).eq("car_id", carId),
    ),
  );
  const failed = updates.find((u) => u.error);
  if (failed?.error) return { ok: false, error: failed.error.message };
  await revalidateCar(carId);
  return { ok: true };
}

/** Define a capa (garante unicidade: limpa as restantes primeiro). */
export async function setCover(
  carId: string,
  mediaId: string,
): Promise<MediaResult> {
  await requireSection("carros");
  const supabase = await createClient();
  const { error: clearErr } = await supabase
    .from("car_media")
    .update({ is_cover: false })
    .eq("car_id", carId)
    .eq("is_cover", true);
  if (clearErr) return { ok: false, error: clearErr.message };

  const { error } = await supabase
    .from("car_media")
    .update({ is_cover: true })
    .eq("id", mediaId).eq("car_id", carId);
  if (error) return { ok: false, error: error.message };
  await revalidateCar(carId);
  return { ok: true };
}

export async function updateMediaAlt(
  mediaId: string,
  alt: string,
): Promise<MediaResult> {
  await requireSection("carros");
  const supabase = await createClient();
  const { error } = await supabase
    .from("car_media")
    .update({ alt })
    .eq("id", mediaId);
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Apaga media (objeto no Storage + linha). Promove nova capa se necessário. */
export async function deleteMedia(
  carId: string,
  mediaId: string,
): Promise<MediaResult> {
  await requireSection("carros");
  const supabase = await createClient();
  const { data: row } = await supabase
    .from("car_media")
    .select("storage_path, is_cover, kind")
    .eq("id", mediaId)
    .eq("car_id", carId)
    .maybeSingle();

  if (!row) return {ok:false,error:"Imagem não encontrada nesta viatura."};
  const { error } = await supabase.from("car_media").delete().eq("id", mediaId).eq("car_id", carId);
  if (error) return { ok: false, error: error.message };

  if (!/^https?:\/\//i.test(row.storage_path)) {
    const {error: cleanupError} = await supabase.storage.from(MEDIA_BUCKET).remove([row.storage_path]);
    if (cleanupError) console.error("Media cleanup:",cleanupError.message);
  }

  // Se apagámos a capa, promove a primeira imagem restante.
  if (row?.is_cover) {
    const { data: next } = await supabase
      .from("car_media")
      .select("id")
      .eq("car_id", carId)
      .eq("kind", "image")
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (next) {
      await supabase
        .from("car_media")
        .update({ is_cover: true })
        .eq("id", next.id);
    }
  }

  await revalidateCar(carId);
  return { ok: true };
}
