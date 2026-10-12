"use server";

import { requireSection } from "@/lib/guard";
import { createClient } from "@/lib/supabase/server";
import { revalidatePublic } from "@/lib/public-cache";
import { MEDIA_BUCKET, PHOTOS_PER_BATCH } from "@/lib/storage";
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
  /** Total de fotos no bucket (para o resumo). */
  total: number;
  /** Cópias de segurança guardadas (de uma redução anterior). */
  backups: { count: number; size: number };
}

type ObjectInfo = { name: string; id: string | null; metadata: { size?: number } | null };

/** Lista uma pasta do bucket (ficheiros com tamanho), várias de cada vez. */
async function listFolders(db: Awaited<ReturnType<typeof createClient>>, folders: string[]) {
  const sizes = new Map<string, number>();
  const queue = [...folders];
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (queue.length) {
        const folder = queue.shift()!;
        const { data } = await db.storage.from(MEDIA_BUCKET).list(folder, { limit: 1000 });
        for (const o of (data ?? []) as ObjectInfo[]) {
          if (o.id) sizes.set(`${folder}/${o.name}`, o.metadata?.size ?? 0);
        }
      }
    }),
  );
  return sizes;
}

/** Que fotos estão pesadas (sem descarregar nenhuma: lê só os tamanhos). */
export async function scanPhotos(): Promise<PhotoScan> {
  await requireSection("definicoes");
  const db = await createClient();
  const empty = { todo: [], total: 0, backups: { count: 0, size: 0 } };

  const { data: rows, error } = await db
    .from("car_media")
    .select("id, storage_path, width, height")
    .eq("kind", "image");
  if (error) return { ok: false, error: error.message, ...empty };
  // URLs absolutos (fotos de exemplo externas) não estão no nosso bucket.
  const photos = (rows ?? []).filter((r) => !/^https?:\/\//i.test(r.storage_path));

  const folders = [...new Set(photos.map((p) => p.storage_path.split("/").slice(0, -1).join("/")))];
  const sizes = await listFolders(db, folders);
  // Pesada = ficheiro grande E (maior do que o site mostra, dimensões
  // desconhecidas ou mesmo muito grande). Uma foto já reduzida com muito
  // detalhe pode passar dos 500 KB — não volta a aparecer como pesada.
  const todo = photos
    .map((p) => ({ ...p, size: sizes.get(p.storage_path) ?? 0 }))
    .filter(
      (p) =>
        p.size > OPTIMIZE_MIN_BYTES &&
        (!p.width || !p.height || Math.max(p.width, p.height) > MAX_PHOTO_SIDE || p.size > 1.5 * 1024 * 1024),
    )
    .map((p) => ({ id: p.id, size: p.size }));

  const { data: backupFolders } = await db.storage.from(MEDIA_BUCKET).list(BACKUP_PREFIX, { limit: 1000 });
  const backupSizes = await listFolders(
    db,
    ((backupFolders ?? []) as ObjectInfo[]).filter((f) => !f.id).map((f) => `${BACKUP_PREFIX}/${f.name}`),
  );
  const backupSize = [...backupSizes.values()].reduce((a, b) => a + b, 0);

  return { ok: true, todo, total: photos.length, backups: { count: backupSizes.size, size: backupSize } };
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

/** Apaga as cópias dos originais (depois de confirmar que está tudo bem). */
export async function deletePhotoBackups(): Promise<{ ok: boolean; error?: string; removed: number }> {
  await requireSection("definicoes");
  const db = await createClient();
  const { data: folders } = await db.storage.from(MEDIA_BUCKET).list(BACKUP_PREFIX, { limit: 1000 });
  const files = await listFolders(
    db,
    ((folders ?? []) as ObjectInfo[]).filter((f) => !f.id).map((f) => `${BACKUP_PREFIX}/${f.name}`),
  );
  const paths = [...files.keys()];
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await db.storage.from(MEDIA_BUCKET).remove(paths.slice(i, i + 100));
    if (error) return { ok: false, error: error.message, removed: i };
  }
  return { ok: true, removed: paths.length };
}
