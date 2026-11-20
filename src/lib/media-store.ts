import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MEDIA_BUCKET, MEDIA_CACHE_CONTROL, mediaStorage, type MediaStorage } from "@/lib/storage";
import { r2Copy, r2Delete, r2Exists, r2Get, r2List, r2Put } from "@/lib/r2";

/**
 * As fotos e vídeos das viaturas no servidor, estejam no Supabase ou no
 * Cloudflare R2 (ver `storage.ts`). Quem grava, apaga, copia ou lista usa isto
 * em vez de `db.storage`, e não precisa de saber onde estão.
 *
 * Os erros vêm como texto (ou null), como no Supabase.
 */

export interface FileInfo {
  size: number;
  /** Guardada com a cache de 1 ano (as antigas do Supabase tinham 1 hora). */
  longCache: boolean;
}

export interface MediaStore {
  kind: MediaStorage;
  upload(path: string, body: Buffer | Uint8Array | Blob, opts: { contentType: string; upsert?: boolean }): Promise<string | null>;
  download(path: string): Promise<Buffer | null>;
  remove(paths: string[]): Promise<string | null>;
  /** Copia `from` para `to`; se `to` já existir, não mexe e devolve «already exists». */
  copy(from: string, to: string): Promise<string | null>;
  /** Tamanho (e cache) dos ficheiros destas pastas. */
  sizes(folders: string[]): Promise<Map<string, FileInfo>>;
  /** Os ficheiros das subpastas de `prefix` (ex.: as cópias em `_originais/<viatura>/`). */
  tree(prefix: string): Promise<Map<string, FileInfo>>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function mediaStore(db: SupabaseClient): MediaStore {
  return mediaStorage() === "r2" ? r2Store : supabaseStore(db);
}

/** Sempre o Supabase (a origem da cópia para o R2). */
export function supabaseStore(db: SupabaseClient): MediaStore {
  const bucket = () => db.storage.from(MEDIA_BUCKET);
  type ObjectInfo = { name: string; id: string | null; metadata: { size?: number; cacheControl?: string } | null };

  async function sizes(folders: string[]) {
    const out = new Map<string, FileInfo>();
    const queue = [...folders];
    await Promise.all(
      Array.from({ length: 8 }, async () => {
        while (queue.length) {
          const folder = queue.shift()!;
          const { data } = await bucket().list(folder, { limit: 1000 });
          for (const o of (data ?? []) as ObjectInfo[]) {
            if (o.id)
              out.set(`${folder}/${o.name}`, {
                size: o.metadata?.size ?? 0,
                longCache: (o.metadata?.cacheControl ?? "").includes(MEDIA_CACHE_CONTROL),
              });
          }
        }
      }),
    );
    return out;
  }

  return {
    kind: "supabase",
    async upload(path, body, { contentType, upsert = false }) {
      const { error } = await bucket().upload(path, body, { contentType, upsert, cacheControl: MEDIA_CACHE_CONTROL });
      return error?.message ?? null;
    },
    async download(path) {
      const { data, error } = await bucket().download(path);
      if (error || !data) return null;
      return Buffer.from(await data.arrayBuffer());
    },
    async remove(paths) {
      if (!paths.length) return null;
      const { error } = await bucket().remove(paths);
      return error?.message ?? null;
    },
    async copy(from, to) {
      const { error } = await bucket().copy(from, to);
      return error?.message ?? null;
    },
    sizes,
    async tree(prefix) {
      const { data } = await bucket().list(prefix, { limit: 1000 });
      const folders = ((data ?? []) as ObjectInfo[]).filter((f) => !f.id).map((f) => `${prefix}/${f.name}`);
      return sizes(folders);
    },
  };
}

const r2Store: MediaStore = {
  kind: "r2",
  async upload(path, body, { contentType }) {
    try {
      await r2Put(path, body, contentType);
      return null;
    } catch (e) {
      return message(e);
    }
  },
  async download(path) {
    try {
      return (await r2Get(path))?.data ?? null;
    } catch {
      return null;
    }
  },
  async remove(paths) {
    try {
      await r2Delete(paths);
      return null;
    } catch (e) {
      return message(e);
    }
  },
  async copy(from, to) {
    try {
      if (await r2Exists(to)) return "The resource already exists";
      await r2Copy(from, to);
      return null;
    } catch (e) {
      return message(e);
    }
  },
  async sizes(folders) {
    const out = new Map<string, FileInfo>();
    const wanted = new Set(folders);
    // Uma lista do bucket inteiro é mais rápida do que uma por pasta.
    for (const o of await r2List().catch(() => [])) {
      const folder = o.path.split("/").slice(0, -1).join("/");
      if (wanted.has(folder)) out.set(o.path, { size: o.size, longCache: true });
    }
    return out;
  },
  async tree(prefix) {
    const out = new Map<string, FileInfo>();
    for (const o of await r2List(`${prefix}/`).catch(() => [])) out.set(o.path, { size: o.size, longCache: true });
    return out;
  },
};
