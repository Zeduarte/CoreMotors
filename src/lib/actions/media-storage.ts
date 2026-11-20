"use server";

import { randomUUID } from "node:crypto";
import { getCurrentProfile } from "@/lib/admin-queries";
import { createClient } from "@/lib/supabase/server";
import { supabaseStore } from "@/lib/media-store";
import { mediaStorage, r2MediaUrl, r2PublicBase, type MediaStorage } from "@/lib/storage";
import { presignPut, r2Config, r2Delete, r2Exists, r2Get, r2List, r2Missing, r2Put } from "@/lib/r2";

/**
 * Gestão → Fotos: passar as fotos do Supabase para o Cloudflare R2.
 * 1) testar a ligação, 2) copiar (aos poucos, o browser vai chamando),
 * 3) ligar o R2 no Netlify. Os originais ficam no Supabase (nada se apaga).
 * Só o acesso core.
 */

export interface MediaStorageStatus {
  ok: boolean;
  error?: string;
  active: MediaStorage;
  /** Variáveis do Netlify que faltam para o R2. */
  missing: string[];
  publicUrl: string;
  /** Ficheiros guardados (fotos, vídeos e logótipo). */
  total: number;
  /** Os que ainda não estão no R2 (vazio se o R2 não estiver configurado). */
  toCopy: string[];
}

async function owner(): Promise<boolean> {
  const me = await getCurrentProfile();
  return !!me?.is_owner;
}

const isUrl = (p: string) => /^https?:\/\//i.test(p);

/** Todos os ficheiros do site que estão no armazenamento (não os links externos). */
async function storedPaths(): Promise<string[]> {
  const db = await createClient();
  const paths = new Set<string>();
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await db.from("car_media").select("storage_path").range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const r of data ?? []) if (r.storage_path && !isUrl(r.storage_path)) paths.add(r.storage_path);
    if (!data || data.length < 1000) break;
  }
  const { data: settings } = await db.from("site_settings").select("logo_url").limit(1).maybeSingle();
  const logo = (settings as { logo_url?: string | null } | null)?.logo_url;
  if (logo && !isUrl(logo)) paths.add(logo);
  return [...paths];
}

export async function getMediaStorageStatus(): Promise<MediaStorageStatus> {
  const base = { active: mediaStorage(), missing: r2Missing(), publicUrl: r2PublicBase(), total: 0, toCopy: [] as string[] };
  if (!(await owner())) return { ok: false, error: "Só o acesso core.", ...base };
  if (!base.publicUrl) base.missing.push("NEXT_PUBLIC_MEDIA_URL");
  try {
    const paths = await storedPaths();
    base.total = paths.length;
    if (r2Config()) {
      const inR2 = new Set((await r2List()).map((o) => o.path));
      base.toCopy = paths.filter((p) => !inR2.has(p));
    }
    return { ok: true, ...base };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), ...base };
  }
}

export interface StorageCheck {
  label: string;
  ok: boolean;
  hint?: string;
}

/** Grava, lê e apaga um ficheiro de teste, e vê se o endereço público funciona. */
export async function testMediaStorage(): Promise<{ ok: boolean; checks: StorageCheck[] }> {
  if (!(await owner())) return { ok: false, checks: [{ label: "Permissão", ok: false, hint: "Só o acesso core." }] };
  const checks: StorageCheck[] = [];
  const missing = r2Missing();
  checks.push({
    label: "Chaves do Cloudflare R2 no Netlify",
    ok: !missing.length,
    hint: missing.length ? `Falta: ${missing.join(", ")} (e novo deploy).` : undefined,
  });
  if (missing.length) return { ok: false, checks };

  const path = `_teste/${randomUUID()}.txt`;
  const body = `teste ${new Date().toISOString()}`;
  try {
    await r2Put(path, Buffer.from(body), "text/plain");
    const back = await r2Get(path);
    checks.push({ label: "Gravar e ler no bucket", ok: back?.data.toString() === body });
  } catch (e) {
    checks.push({
      label: "Gravar e ler no bucket",
      ok: false,
      hint: `${e instanceof Error ? e.message : e}. Confirme o ID da conta, o nome do bucket e que a chave tem permissão «Object Read & Write».`,
    });
    return { ok: false, checks };
  }

  const publicUrl = r2PublicBase();
  if (!publicUrl) {
    checks.push({ label: "Endereço público das fotos", ok: false, hint: "Falta NEXT_PUBLIC_MEDIA_URL (e novo deploy)." });
  } else {
    try {
      const res = await fetch(r2MediaUrl(path), { cache: "no-store" });
      const ok = res.ok && (await res.text()) === body;
      checks.push({
        label: `Endereço público (${publicUrl})`,
        ok,
        hint: ok ? undefined : `Respondeu ${res.status}. Ligue o domínio ao bucket (Settings → Custom Domains) ou o «Public Development URL».`,
      });
    } catch (e) {
      checks.push({ label: `Endereço público (${publicUrl})`, ok: false, hint: e instanceof Error ? e.message : String(e) });
    }
  }
  await r2Delete([path]).catch(() => undefined);
  return { ok: checks.every((c) => c.ok), checks };
}

/** Endereço para o browser testar o carregamento direto (a regra CORS do bucket). */
export async function getTestUploadTarget(): Promise<{ ok: boolean; path?: string; url?: string; headers?: Record<string, string> }> {
  if (!(await owner()) || !r2Config()) return { ok: false };
  const path = `_teste/${randomUUID()}.txt`;
  return { ok: true, path, ...(await presignPut(path, "text/plain")) };
}

/** Confirma que o teste do browser chegou ao bucket, e apaga-o. */
export async function finishTestUpload(path: string): Promise<{ ok: boolean }> {
  if (!(await owner()) || !/^_teste\/[0-9a-f-]{36}\.txt$/.test(path)) return { ok: false };
  const there = await r2Exists(path).catch(() => false);
  await r2Delete([path]).catch(() => undefined);
  return { ok: there };
}

// Por pedido: o Netlify corta pedidos com mais de ~10 s.
const COPY_BATCH = 4;

const TYPES: Record<string, string> = {
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

/** Copia uns poucos ficheiros do Supabase para o R2 (o browser vai chamando até acabar). */
export async function copyMediaToR2(
  paths: string[],
): Promise<{ ok: boolean; error?: string; copied: number; failed: { path: string; error: string }[] }> {
  if (!(await owner())) return { ok: false, error: "Só o acesso core.", copied: 0, failed: [] };
  if (!r2Config()) return { ok: false, error: "O Cloudflare R2 não está configurado.", copied: 0, failed: [] };
  const batch = paths.filter((p) => typeof p === "string" && !isUrl(p) && !p.includes("..")).slice(0, COPY_BATCH);
  const db = await createClient();
  const source = supabaseStore(db);
  let copied = 0;
  const failed: { path: string; error: string }[] = [];
  await Promise.all(
    batch.map(async (path) => {
      try {
        if (await r2Exists(path)) {
          copied++;
          return;
        }
        const data = await source.download(path);
        if (!data) {
          failed.push({ path, error: "não existe no Supabase" });
          return;
        }
        const ext = path.split(".").pop()?.toLowerCase() ?? "";
        await r2Put(path, data, TYPES[ext] ?? "application/octet-stream");
        copied++;
      } catch (e) {
        failed.push({ path, error: e instanceof Error ? e.message : String(e) });
      }
    }),
  );
  return { ok: true, copied, failed };
}
