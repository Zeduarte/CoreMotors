import type { SupabaseClient } from "@supabase/supabase-js";
import { getUploadTargets } from "@/lib/actions/upload";
import { MEDIA_BUCKET, MEDIA_CACHE_CONTROL } from "@/lib/storage";

/**
 * Carrega ficheiros a partir do browser (backoffice), para o Supabase ou para
 * o Cloudflare R2 — o servidor diz qual (`getUploadTargets`). Devolve o
 * caminho guardado de cada ficheiro, pela mesma ordem (null nos que falharam).
 */

export type UploadScope = { scope: "car"; carId: string } | { scope: "branding" };

const EXT_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  avif: "image/avif",
  gif: "image/gif",
  svg: "image/svg+xml",
  mp4: "video/mp4",
  webm: "video/webm",
};

export function fileExt(name: string): string {
  const e = name.split(".").pop()?.toLowerCase() ?? "";
  return /^[a-z0-9]{2,5}$/.test(e) ? e : "bin";
}

function fileType(file: File): string {
  return file.type || EXT_TYPES[fileExt(file.name)] || "application/octet-stream";
}

export async function uploadMediaFiles(
  supabase: SupabaseClient,
  files: File[],
  where: UploadScope,
): Promise<{ paths: (string | null)[]; error?: string }> {
  if (!files.length) return { paths: [] };
  const res = await getUploadTargets({
    ...where,
    files: files.map((f) => ({ ext: fileExt(f.name), contentType: fileType(f) })),
  });
  if (!res.ok) return { paths: files.map(() => null), error: res.error };

  if (res.mode === "r2") {
    const paths = await Promise.all(
      files.map(async (file, i) => {
        const t = res.targets[i]!;
        try {
          const put = await fetch(t.url, { method: "PUT", body: file, headers: { ...t.headers, "Content-Type": fileType(file) } });
          return put.ok ? t.path : null;
        } catch {
          return null;
        }
      }),
    );
    return { paths };
  }

  // Supabase: o browser carrega com a sessão (as regras do bucket decidem).
  const folder = where.scope === "car" ? where.carId : "branding";
  const paths = await Promise.all(
    files.map(async (file) => {
      const path = `${folder}/${crypto.randomUUID()}.${fileExt(file.name)}`;
      const { error } = await supabase.storage
        .from(MEDIA_BUCKET)
        .upload(path, file, { cacheControl: MEDIA_CACHE_CONTROL, upsert: false });
      return error ? null : path;
    }),
  );
  return { paths };
}
