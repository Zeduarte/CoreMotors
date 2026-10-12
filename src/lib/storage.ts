/** Utilitários do Supabase Storage (bucket público `car-media`). */

export const MEDIA_BUCKET = "car-media";

/**
 * Cache das fotos: 1 ano. Cada ficheiro tem um nome único (UUID) e nunca é
 * reescrito — uma foto nova é um ficheiro novo —, por isso o browser e a CDN
 * podem guardá-las para sempre sem ficarem desatualizadas.
 */
export const MEDIA_CACHE_CONTROL = "31536000";

/**
 * Resolve o URL público de um objeto do Storage.
 *
 * Aceita tanto um `storage_path` (relativo ao bucket) como um URL absoluto
 * (usado no seed com imagens externas) — devolvendo-o inalterado nesse caso.
 */
export function publicMediaUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${pathOrUrl}`;
}
