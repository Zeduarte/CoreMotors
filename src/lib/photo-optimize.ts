import "server-only";
import sharp from "sharp";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_BUCKET, MEDIA_CACHE_CONTROL } from "@/lib/storage";
import { MAX_PHOTO_SIDE } from "@/lib/image-compress";

/**
 * Redução das fotos que JÁ estão no Supabase (as novas já sobem reduzidas —
 * ver `image-compress.ts`). Corre no servidor, a partir do botão em
 * Definições, umas poucas fotos de cada vez.
 *
 * Mesmo resultado que no upload: no máximo 2400 px no lado maior, JPEG de
 * qualidade alta. Antes de substituir, o original é copiado para
 * `_originais/<mesmo caminho>` no próprio bucket (cópia no servidor, sem
 * descarregar), para se poder repor; as cópias apagam-se depois, com outro
 * botão, quando se confirmar que está tudo bem.
 */
export const BACKUP_PREFIX = "_originais";
/** Abaixo disto a foto já está leve: nem se descarrega. */
export const OPTIMIZE_MIN_BYTES = 500 * 1024;
const QUALITY = 85;
/** Só substitui se poupar pelo menos 10%. */
const MIN_SAVING = 0.1;

export interface PhotoRow {
  id: string;
  storage_path: string;
}

export interface PhotoResult {
  id: string;
  before: number;
  after: number;
  status: "reduzida" | "ja-leve" | "erro";
  error?: string;
}

export async function optimizeStoredPhoto(db: SupabaseClient, row: PhotoRow): Promise<PhotoResult> {
  const path = row.storage_path;
  const fail = (error: string, before = 0): PhotoResult => ({ id: row.id, before, after: before, status: "erro", error });

  const { data: blob, error: dlError } = await db.storage.from(MEDIA_BUCKET).download(path);
  if (dlError || !blob) return fail(`não descarregou (${dlError?.message ?? "vazio"})`);
  const original = Buffer.from(await blob.arrayBuffer());

  let output: Buffer;
  let width: number;
  let height: number;
  try {
    // `.rotate()` sem argumentos aplica a rotação EXIF (fotos ao alto).
    const { data, info } = await sharp(original, { failOn: "none" })
      .rotate()
      .resize({ width: MAX_PHOTO_SIDE, height: MAX_PHOTO_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
    output = data;
    width = info.width;
    height = info.height;
  } catch {
    return fail("não é uma imagem legível", original.length);
  }

  if (output.length >= original.length * (1 - MIN_SAVING)) {
    // Fica como está; guarda as dimensões para a análise não a voltar a
    // propor (é por elas que se vê se ainda é maior do que o site mostra).
    const meta = await sharp(original, { failOn: "none" }).metadata().catch(() => null);
    if (meta?.width && meta.height) {
      const turned = (meta.orientation ?? 1) >= 5;
      await db
        .from("car_media")
        .update({ width: turned ? meta.height : meta.width, height: turned ? meta.width : meta.height })
        .eq("id", row.id);
    }
    return { id: row.id, before: original.length, after: original.length, status: "ja-leve" };
  }

  // Cópia de segurança do original (se já existir de uma tentativa anterior,
  // fica a que lá está — é a original).
  const backup = `${BACKUP_PREFIX}/${path}`;
  const { error: copyError } = await db.storage.from(MEDIA_BUCKET).copy(path, backup);
  if (copyError && !/exists|duplicate/i.test(copyError.message)) {
    return fail(`sem cópia de segurança, não mexi (${copyError.message})`, original.length);
  }

  // Outra extensão (ex.: .png) passa a .jpg: caminho novo, a linha da BD
  // aponta para ele e o antigo sai (o original está na cópia).
  const target = /\.jpe?g$/i.test(path) ? path : path.replace(/\.[^./]+$/, "") + ".jpg";
  const { error: upError } = await db.storage
    .from(MEDIA_BUCKET)
    .upload(target, output, { upsert: true, contentType: "image/jpeg", cacheControl: MEDIA_CACHE_CONTROL });
  if (upError) return fail(`não gravou (${upError.message})`, original.length);

  const { error: rowError } = await db
    .from("car_media")
    .update({ storage_path: target, width, height })
    .eq("id", row.id);
  if (rowError) return fail(`foto gravada mas a ficha não atualizou (${rowError.message})`, original.length);
  if (target !== path) await db.storage.from(MEDIA_BUCKET).remove([path]);

  return { id: row.id, before: original.length, after: output.length, status: "reduzida" };
}
