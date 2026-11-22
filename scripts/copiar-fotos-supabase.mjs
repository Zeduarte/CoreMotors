// Copia os ficheiros do Storage (fotos e vídeos) de um projeto Supabase para
// outro: todos os buckets (`car-media`, `wa-media`, …), com os mesmos caminhos.
//
// A base de dados guarda só os caminhos (`<viatura>/<uuid>.jpg`); os ficheiros
// em si não vão na cópia da base. É este script que os copia.
//
// O projeto de origem só é lido. No destino, cada ficheiro é gravado por cima
// (a cópia da base já lá pôs o registo do ficheiro, mas sem o conteúdo).
//
// Corre na ação «Copiar base de dados» do GitHub
// (.github/workflows/copiar-base-supabase.yml). Também corre no computador:
//
//   ORIGEM_DB_URL=… ORIGEM_SECRET_KEY=… DESTINO_DB_URL=… DESTINO_SECRET_KEY=… \
//     node scripts/copiar-fotos-supabase.mjs
//
// Os endereços *_DB_URL são os da base (Connect → Session pooler); o endereço
// do projeto (https://<ref>.supabase.co) sai deles. As chaves são a «secret»
// (ou a antiga «service_role») de cada projeto.

const PAGE = 1000;
const PARALLEL = 8;
const ATTEMPTS = 3;

/** https://<ref>.supabase.co a partir do endereço da base de dados. */
export function projectUrlFromDbUrl(dbUrl) {
  let url;
  try {
    url = new URL(dbUrl);
  } catch {
    throw new Error("O endereço da base não é válido (copie-o de Connect → Session pooler).");
  }
  const user = decodeURIComponent(url.username);
  const ref =
    user.match(/^postgres\.([a-z0-9]+)$/)?.[1] ?? // Session/Transaction pooler
    url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/)?.[1]; // ligação direta
  if (!ref) throw new Error(`Não reconheço o projeto Supabase no endereço da base (${url.hostname}).`);
  return `https://${ref}.supabase.co`;
}

/** "max-age=31536000" → "31536000" (o que o upload espera). */
function cacheSeconds(cacheControl) {
  return String(cacheControl ?? "").match(/max-age=(\d+)/)?.[1] ?? "3600";
}

/** Todos os ficheiros de um bucket, com as subpastas. */
export async function listAll(bucket, prefix = "", page = PAGE) {
  const files = [];
  const folders = [prefix];
  while (folders.length) {
    const folder = folders.shift();
    for (let offset = 0; ; offset += page) {
      const { data, error } = await bucket.list(folder, { limit: page, offset, sortBy: { column: "name", order: "asc" } });
      if (error) throw new Error(`Não consegui listar «${folder || "/"}»: ${error.message}`);
      for (const item of data ?? []) {
        const path = folder ? `${folder}/${item.name}` : item.name;
        if (item.id) files.push({ path, size: item.metadata?.size ?? 0, mimetype: item.metadata?.mimetype, cacheControl: item.metadata?.cacheControl });
        else folders.push(path); // sem id = pasta
      }
      if ((data ?? []).length < page) break;
    }
  }
  return files;
}

async function retry(fn) {
  let last;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  throw last;
}

async function copyFile(src, dst, file) {
  await retry(async () => {
    const { data, error } = await src.download(file.path);
    if (error || !data) throw new Error(`descarregar: ${error?.message ?? "vazio"}`);
    const { error: up } = await dst.upload(file.path, data, {
      upsert: true,
      contentType: file.mimetype || data.type || "application/octet-stream",
      cacheControl: cacheSeconds(file.cacheControl),
    });
    if (up) throw new Error(`gravar: ${up.message}`);
  });
}

/**
 * Que tipo de chave é, sem a mostrar: prefixo, tamanho e enganos comuns ao
 * copiar (texto escondido com «•», a publishable em vez da secret, a anon…).
 */
export function describeKey(raw) {
  const value = String(raw ?? "");
  const key = value.trim();
  const notes = [];
  if (key !== value) notes.push("tinha espaços ou uma mudança de linha no início ou no fim (ignorados)");
  if (/[^\x21-\x7e]/.test(key)) notes.push("tem bolinhas «•» ou outros caracteres estranhos: foi copiado o texto escondido; use o botão de copiar");
  let kind = "desconhecida";
  let ref = null;
  if (key.startsWith("sb_secret_")) kind = "secret (sb_secret_…)";
  else if (key.startsWith("sb_publishable_")) {
    kind = "publishable (sb_publishable_…)";
    notes.push("é a chave publishable: é precisa a secret (Secret keys)");
  } else if (/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(key)) {
    let role = "?";
    try {
      const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString("utf8"));
      role = payload.role ?? "?";
      ref = payload.ref ?? null;
    } catch {}
    kind = `JWT antiga (${role})`;
    if (role !== "service_role") notes.push(`é a chave ${role}: é precisa a service_role (ou a secret)`);
  } else notes.push("não parece uma chave do Supabase (devia começar por sb_secret_)");
  return { key, kind, length: key.length, ref, notes };
}

/** Confirma que o projeto aceita a chave, antes de copiar. */
export async function checkAccess(client, label, ref, info) {
  const { error } = await client.storage.listBuckets();
  if (!error) return;
  const extra = info.notes.length ? ` Atenção: ${info.notes.join("; ")}.` : "";
  const other = info.ref && info.ref !== ref ? ` É uma chave do projeto ${info.ref}, não do ${ref}.` : "";
  throw new Error(
    `O projeto ${ref} não aceita a chave de ${label} (${info.kind}, ${info.length} caracteres): ${String(error.message).replace(/\.+$/, "")}.${other}${extra}` +
      ` Copie a secret key desse projeto (Project Settings → API Keys → Secret keys → botão de copiar) e atualize o segredo.`,
  );
}

/** Garante que o bucket existe no destino, com as mesmas regras (público/privado, limites). */
async function ensureBucket(to, b) {
  const { data, error: missing } = await to.storage.getBucket(b.id);
  if (data) return false;
  if (missing && !/not.?found/i.test(missing.message ?? "")) throw new Error(`Não consegui ver o bucket «${b.id}» no destino: ${missing.message}`);
  const { error } = await to.storage.createBucket(b.id, {
    public: Boolean(b.public),
    fileSizeLimit: b.file_size_limit ?? undefined,
    allowedMimeTypes: b.allowed_mime_types ?? undefined,
  });
  if (error) throw new Error(`Não consegui criar o bucket «${b.id}» no destino: ${error.message}`);
  return true;
}

/** Copia todos os buckets de `from` para `to` (dois clientes Supabase com a chave secreta). */
export async function copyStorage(from, to, { log = console.log, page = PAGE } = {}) {
  const { data: buckets, error } = await from.storage.listBuckets();
  if (error) throw new Error(`Não consegui ler os buckets da origem: ${error.message}`);
  const summary = [];
  for (const b of buckets ?? []) {
    if (await ensureBucket(to, b)) log(`Bucket «${b.id}» criado no destino (${b.public ? "público" : "privado"}).`);
    const src = from.storage.from(b.id);
    const dst = to.storage.from(b.id);
    const files = await listAll(src, "", page);
    log(`Bucket «${b.id}»: ${files.length} ficheiros a copiar…`);
    const failed = [];
    let done = 0;
    let bytes = 0;
    const queue = [...files];
    await Promise.all(
      Array.from({ length: PARALLEL }, async () => {
        while (queue.length) {
          const file = queue.shift();
          try {
            await copyFile(src, dst, file);
            bytes += file.size;
          } catch (e) {
            failed.push({ path: file.path, error: e instanceof Error ? e.message : String(e) });
          }
          done++;
          if (done % 200 === 0) log(`  ${done}/${files.length}`);
        }
      }),
    );
    summary.push({ bucket: b.id, files: files.length, copied: files.length - failed.length, bytes, failed });
  }
  return summary;
}

async function main() {
  const need = ["ORIGEM_DB_URL", "ORIGEM_SECRET_KEY", "DESTINO_DB_URL", "DESTINO_SECRET_KEY"];
  const missing = need.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Faltam: ${missing.join(", ")}`);
  const fromUrl = projectUrlFromDbUrl(process.env.ORIGEM_DB_URL);
  const toUrl = projectUrlFromDbUrl(process.env.DESTINO_DB_URL);
  if (fromUrl === toUrl) throw new Error("A origem e o destino são o mesmo projeto.");

  const fromRef = new URL(fromUrl).hostname.split(".")[0];
  const toRef = new URL(toUrl).hostname.split(".")[0];
  const fromKey = describeKey(process.env.ORIGEM_SECRET_KEY);
  const toKey = describeKey(process.env.DESTINO_SECRET_KEY);
  for (const [name, info] of [["SUPABASE_ORIGEM_SECRET_KEY", fromKey], ["SUPABASE_DESTINO_SECRET_KEY", toKey]]) {
    console.log(`${name}: ${info.kind}, ${info.length} caracteres${info.ref ? `, do projeto ${info.ref}` : ""}${info.notes.length ? ` — ${info.notes.join("; ")}` : ""}`);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const opts = { auth: { persistSession: false, autoRefreshToken: false } };
  const from = createClient(fromUrl, fromKey.key, opts);
  const to = createClient(toUrl, toKey.key, opts);

  console.log(`Fotos: ${fromUrl} → ${toUrl}`);
  await checkAccess(from, "ORIGEM (SUPABASE_ORIGEM_SECRET_KEY)", fromRef, fromKey);
  await checkAccess(to, "DESTINO (SUPABASE_DESTINO_SECRET_KEY)", toRef, toKey);
  console.log("As duas chaves são aceites ✔");
  const summary = await copyStorage(from, to);

  const mb = (n) => (n / 1024 / 1024).toFixed(1);
  const lines = ["| Bucket | Ficheiros | Copiados | MB | Falharam |", "|---|---:|---:|---:|---:|"];
  for (const s of summary) lines.push(`| ${s.bucket} | ${s.files} | ${s.copied} | ${mb(s.bytes)} | ${s.failed.length} |`);
  const failed = summary.flatMap((s) => s.failed.map((f) => `${s.bucket}/${f.path}: ${f.error}`));
  console.log(lines.join("\n"));
  if (process.env.GITHUB_STEP_SUMMARY) {
    const { appendFileSync } = await import("node:fs");
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## Fotos\n\n${lines.join("\n")}\n`);
  }
  if (failed.length) {
    console.error(`\n${failed.length} ficheiro(s) não foram copiados:\n${failed.slice(0, 50).join("\n")}`);
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
