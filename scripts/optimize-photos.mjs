#!/usr/bin/env node
/**
 * Reduz as fotos das viaturas que JÁ estão no Supabase (as novas já são
 * reduzidas no browser ao subir — ver src/lib/image-compress.ts).
 *
 * Cada foto fica com no máximo 2400 px no lado maior, em JPEG de qualidade
 * alta (85, mozjpeg): o site nunca mostra mais do que isso, por isso não se
 * nota diferença, mas o ficheiro passa de 4–8 MB para ~300–500 KB. Também
 * passa a ter cache de 1 ano (as antigas tinham 1 hora).
 *
 * Por omissão SÓ MOSTRA o que faria (não mexe em nada). Para aplicar:
 *
 *   SUPABASE_SERVICE_ROLE_KEY=… node scripts/optimize-photos.mjs --aplicar
 *
 * (o URL do projeto vem de NEXT_PUBLIC_SUPABASE_URL ou do netlify.toml.)
 * Antes de substituir, guarda o original em ./copia-fotos-AAAA-MM-DD/, com o
 * mesmo caminho do bucket — para repor, basta voltar a carregá-lo.
 *
 * Seguro de correr mais do que uma vez: o que já está otimizado é saltado.
 */
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const BUCKET = "car-media";
const MAX_SIDE = 2400;
const QUALITY = 85;
const CACHE_CONTROL = "31536000";
/** Só substitui se poupar pelo menos isto (evita reescrever à toa). */
const MIN_SAVING = 0.1;
const CONCURRENCY = 4;

const apply = process.argv.includes("--aplicar");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || (await urlFromNetlifyToml());
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Falta NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no ambiente.");
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });
const backupDir = `copia-fotos-${new Date().toISOString().slice(0, 10)}`;

async function urlFromNetlifyToml() {
  try {
    const toml = await readFile("netlify.toml", "utf8");
    return toml.match(/NEXT_PUBLIC_SUPABASE_URL\s*=\s*"([^"]+)"/)?.[1];
  } catch {
    return undefined;
  }
}

const kb = (n) => `${Math.round(n / 1024)} KB`;
const mb = (n) => `${(n / 1024 / 1024).toFixed(1)} MB`;

const { data: rows, error } = await db
  .from("car_media")
  .select("id, storage_path, width, height")
  .eq("kind", "image");
if (error) {
  console.error("Não foi possível ler car_media:", error.message);
  process.exit(1);
}
// URLs absolutos (fotos de exemplo externas) não estão no nosso bucket.
const photos = rows.filter((r) => !/^https?:\/\//i.test(r.storage_path));
console.log(`${photos.length} fotos no bucket ${BUCKET}. ${apply ? "A APLICAR." : "Só a simular (use --aplicar para mudar)."}\n`);

let before = 0;
let after = 0;
let changed = 0;
let failed = 0;

async function handle(row) {
  const path = row.storage_path;
  const { data: blob, error: dlError } = await db.storage.from(BUCKET).download(path);
  if (dlError || !blob) {
    failed++;
    console.log(`✗ ${path}: não descarregou (${dlError?.message ?? "vazio"})`);
    return;
  }
  const original = Buffer.from(await blob.arrayBuffer());

  let output;
  let info;
  try {
    // `.rotate()` sem argumentos aplica a rotação EXIF (fotos ao alto).
    ({ data: output, info } = await sharp(original, { failOn: "none" })
      .rotate()
      .resize({ width: MAX_SIDE, height: MAX_SIDE, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: QUALITY, mozjpeg: true })
      .toBuffer({ resolveWithObject: true }));
  } catch (e) {
    failed++;
    console.log(`✗ ${path}: não é uma imagem legível (${e.message})`);
    return;
  }

  before += original.length;
  const worth = output.length < original.length * (1 - MIN_SAVING);
  after += worth ? output.length : original.length;
  if (!worth) {
    console.log(`= ${path}: ${kb(original.length)} (já está bem)`);
    return;
  }
  changed++;
  console.log(`↓ ${path}: ${kb(original.length)} → ${kb(output.length)} (${info.width}×${info.height})`);
  if (!apply) return;

  // Cópia de segurança do original antes de mexer.
  const backup = join(backupDir, path);
  await mkdir(dirname(backup), { recursive: true });
  await writeFile(backup, original);

  // JPEG com outra extensão (ex.: .png) passa a .jpg: caminho novo, a linha
  // da BD aponta para ele e o antigo é apagado no fim.
  const isJpegName = /\.jpe?g$/i.test(path);
  const target = isJpegName ? path : path.replace(/\.[^./]+$/, "") + ".jpg";
  const { error: upError } = await db.storage
    .from(BUCKET)
    .upload(target, output, { upsert: true, contentType: "image/jpeg", cacheControl: CACHE_CONTROL });
  if (upError) {
    failed++;
    console.log(`  ✗ não gravou: ${upError.message} (original em ${backup})`);
    return;
  }
  const { error: rowError } = await db
    .from("car_media")
    .update({ storage_path: target, width: info.width, height: info.height })
    .eq("id", row.id);
  if (rowError) {
    failed++;
    console.log(`  ✗ foto gravada mas a BD não atualizou: ${rowError.message}`);
    return;
  }
  if (target !== path) await db.storage.from(BUCKET).remove([path]);
}

// Algumas de cada vez, para não sobrecarregar o Supabase.
const queue = [...photos];
await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await handle(queue.shift());
  }),
);

console.log(
  `\n${changed} de ${photos.length} fotos ${apply ? "reduzidas" : "a reduzir"}: ${mb(before)} → ${mb(after)}` +
    (before ? ` (−${Math.round((1 - after / before) * 100)}%)` : "") +
    (failed ? `. ${failed} com erro (ver acima).` : "."),
);
if (apply && changed) console.log(`Originais guardados em ./${backupDir}/`);
