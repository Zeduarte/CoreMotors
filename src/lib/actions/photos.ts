"use server";

import { requireSection } from "@/lib/guard";
import { createClient } from "@/lib/supabase/server";
import { revalidatePublic } from "@/lib/public-cache";
import { PHOTOS_PER_BATCH } from "@/lib/storage";
import { mediaStore } from "@/lib/media-store";
import { MAX_PHOTO_SIDE } from "@/lib/image-compress";
import {
  BACKUP_PREFIX,
  OPTIMIZE_MIN_BYTES,
  optimizeStoredPhoto,
  type PhotoResult,
} from "@/lib/photo-optimize";

export interface PhotoScan {
  ok: boolean;
  error?: string;
  /** Fotos pesadas, por reduzir. */
  todo: { id: string; size: number }[];
  /**
   * Fotos leves mas guardadas com cache de 1 hora (as antigas): o Netlify
   * volta a pedi-las ao Supabase a cada hora. Regravam-se iguais, com 1 ano.
   */
  stale: { id: string; size: number }[];
  /** Total de fotos no bucket (para o resumo). */
  total: number;
  /** Cópias de segurança guardadas (de uma redução anterior). */
  backups: { count: number; size: number };
}

/** Que fotos estão pesadas (sem descarregar nenhuma: lê só os tamanhos). */
export async function scanPhotos(): Promise<PhotoScan> {
  await requireSection("definicoes");
  const db = await createClient();
  const empty = { todo: [], stale: [], total: 0, backups: { count: 0, size: 0 } };

  const { data: rows, error } = await db
    .from("car_media")
    .select("id, storage_path, width, height")
    .eq("kind", "image");
  if (error) return { ok: false, error: error.message, ...empty };
  // URLs absolutos (fotos de exemplo externas) não estão no nosso bucket.
  const photos = (rows ?? []).filter((r) => !/^https?:\/\//i.test(r.storage_path));

  const folders = [...new Set(photos.map((p) => p.storage_path.split("/").slice(0, -1).join("/")))];
  const store = mediaStore(db);
  const sizes = await store.sizes(folders);
  // Pesada = ficheiro grande E (maior do que o site mostra, dimensões
  // desconhecidas ou mesmo muito grande). Uma foto já reduzida com muito
  // detalhe pode passar dos 500 KB — não volta a aparecer como pesada.
  const all = photos.map((p) => ({ ...p, ...(sizes.get(p.storage_path) ?? { size: 0, longCache: true }) }));
  const heavy = (p: (typeof all)[number]) =>
    p.size > OPTIMIZE_MIN_BYTES &&
    (!p.width || !p.height || Math.max(p.width, p.height) > MAX_PHOTO_SIDE || p.size > 1.5 * 1024 * 1024);
  const todo = all.filter(heavy).map((p) => ({ id: p.id, size: p.size }));
  const stale = all.filter((p) => !heavy(p) && !p.longCache).map((p) => ({ id: p.id, size: p.size }));

  const backupSizes = await store.tree(BACKUP_PREFIX);
  const backupSize = [...backupSizes.values()].reduce((a, b) => a + b.size, 0);

  return { ok: true, todo, stale, total: photos.length, backups: { count: backupSizes.size, size: backupSize } };
}

/** Reduz umas poucas fotos (o browser vai chamando até acabar). */
export async function optimizePhotos(ids: string[]): Promise<{ ok: boolean; error?: string; results: PhotoResult[] }> {
  await requireSection("definicoes");
  const db = await createClient();
  const { data: rows, error } = await db
    .from("car_media")
    .select("id, storage_path")
    .in("id", ids.slice(0, PHOTOS_PER_BATCH));
  if (error) return { ok: false, error: error.message, results: [] };

  const results: PhotoResult[] = [];
  for (const row of rows ?? []) results.push(await optimizeStoredPhoto(db, row));

  // Uma .png que passou a .jpg muda de caminho: o site tem de ler de novo.
  if (results.some((r) => r.status === "reduzida")) {
    revalidatePublic("/", "layout");
  }
  return { ok: true, results };
}

/** Regrava uma foto leve tal como está, só com a cache de 1 ano. */
export async function refreshPhotoCache(ids: string[]): Promise<{ ok: boolean; error?: string; done: number }> {
  await requireSection("definicoes");
  const db = await createClient();
  const { data: rows, error } = await db
    .from("car_media")
    .select("id, storage_path")
    .in("id", ids.slice(0, PHOTOS_PER_BATCH));
  if (error) return { ok: false, error: error.message, done: 0 };
  let done = 0;
  const store = mediaStore(db);
  for (const row of rows ?? []) {
    const data = await store.download(row.storage_path);
    if (!data) continue;
    const type = /\.png$/i.test(row.storage_path) ? "image/png" : /\.webp$/i.test(row.storage_path) ? "image/webp" : "image/jpeg";
    const upError = await store.upload(row.storage_path, data, { upsert: true, contentType: type });
    if (!upError) done++;
  }
  return { ok: true, done };
}

/** Apaga as cópias dos originais (depois de confirmar que está tudo bem). */
export async function deletePhotoBackups(): Promise<{ ok: boolean; error?: string; removed: number }> {
  await requireSection("definicoes");
  const db = await createClient();
  const store = mediaStore(db);
  const paths = [...(await store.tree(BACKUP_PREFIX)).keys()];
  for (let i = 0; i < paths.length; i += 100) {
    const error = await store.remove(paths.slice(i, i + 100));
    if (error) return { ok: false, error, removed: i };
  }
  return { ok: true, removed: paths.length };
}
