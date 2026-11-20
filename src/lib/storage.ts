/**
 * Onde estão as fotos e vídeos das viaturas (e o logótipo).
 *
 * - Por omissão: Supabase Storage, bucket público `car-media`.
 * - Cloudflare R2 (sem custo de tráfego): quando o Netlify tem
 *   `NEXT_PUBLIC_MEDIA_STORAGE=r2` e `NEXT_PUBLIC_MEDIA_URL` (o endereço
 *   público do bucket, ex.: https://fotos.supermotas.com). Os caminhos na base
 *   de dados são os mesmos nos dois (`<viatura>/<uuid>.jpg`): mudar de um para
 *   o outro é só copiar os ficheiros (Gestão → Fotos) e ligar a variável.
 *
 * Este ficheiro corre no browser e no servidor (só lê variáveis públicas). O
 * acesso ao R2 com as chaves está em `r2.ts` / `media-store.ts` (só servidor).
 */

export const MEDIA_BUCKET = "car-media";

/**
 * Cache das fotos: 1 ano. Cada ficheiro tem um nome único (UUID) e nunca é
 * reescrito — uma foto nova é um ficheiro novo —, por isso o browser e a CDN
 * podem guardá-las para sempre sem ficarem desatualizadas.
 */
export const MEDIA_CACHE_CONTROL = "31536000";
/** O mesmo, como cabeçalho HTTP (no R2 é o cabeçalho que fica guardado). */
export const MEDIA_CACHE_HEADER = `public, max-age=${MEDIA_CACHE_CONTROL}, immutable`;

/**
 * Fotos reduzidas por pedido no botão "Otimizar fotos" (Definições): cada
 * pedido ao servidor tem de acabar em poucos segundos (limite do Netlify) — uma foto grande demora 1–3 s.
 */
export const PHOTOS_PER_BATCH = 1;

export type MediaStorage = "supabase" | "r2";

/** O endereço público do bucket do R2, sem barra no fim (vazio se não houver). */
export function r2PublicBase(): string {
  return (process.env.NEXT_PUBLIC_MEDIA_URL ?? "").trim().replace(/\/+$/, "");
}

/** Onde se leem e gravam as fotos agora. */
export function mediaStorage(): MediaStorage {
  return process.env.NEXT_PUBLIC_MEDIA_STORAGE === "r2" && /^https?:\/\//i.test(r2PublicBase()) ? "r2" : "supabase";
}

/** O endereço da foto no Supabase (a origem da cópia para o R2). */
export function supabaseMediaUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  return `${base}/storage/v1/object/public/${MEDIA_BUCKET}/${encodePath(path)}`;
}

/** O endereço da foto no R2 (mesmo antes de o R2 estar ligado: para testar). */
export function r2MediaUrl(path: string): string {
  return `${r2PublicBase()}/${encodePath(path)}`;
}

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

/**
 * Resolve o URL público de um objeto do Storage.
 *
 * Aceita tanto um `storage_path` (relativo ao bucket) como um URL absoluto
 * (usado no seed com imagens externas) — devolvendo-o inalterado nesse caso.
 */
export function publicMediaUrl(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  return mediaStorage() === "r2" ? r2MediaUrl(pathOrUrl) : supabaseMediaUrl(pathOrUrl);
}
