/**
 * Onde estão as fotos e vídeos das viaturas (e o logótipo).
 *
 * - Sempre no Cloudflare R2 (sem custo de tráfego), no endereço público
 *   `NEXT_PUBLIC_MEDIA_URL` — e, sem essa variável, em https://fotos.supermotas.com.
 *   As fotos já não estão no Supabase (foram copiadas e apagadas de lá), por
 *   isso faltar uma variável no Netlify não pode fazer o site voltar a ele.
 * - O Supabase (bucket `car-media`) só volta se o Netlify tiver, de propósito,
 *   `NEXT_PUBLIC_MEDIA_STORAGE=supabase`. Os caminhos na base de dados são os
 *   mesmos nos dois (`<viatura>/<uuid>.jpg`).
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

/** O endereço público do bucket do R2 quando o Netlify não diz outro. */
export const DEFAULT_MEDIA_URL = "https://fotos.supermotas.com";

/** O endereço público do bucket do R2, sem barra no fim. */
export function r2PublicBase(): string {
  const url = (process.env.NEXT_PUBLIC_MEDIA_URL ?? "").trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(url) ? url : DEFAULT_MEDIA_URL;
}

/** Onde se leem e gravam as fotos: sempre o R2, salvo pedido explícito. */
export function mediaStorage(): MediaStorage {
  return process.env.NEXT_PUBLIC_MEDIA_STORAGE === "supabase" ? "supabase" : "r2";
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
