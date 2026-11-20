// Cópia das fotos entre dois projetos Supabase (scripts/copiar-fotos-supabase.mjs),
// contra um Storage falso em memória.
import { test } from "node:test";
import assert from "node:assert/strict";
import { copyStorage, listAll, projectUrlFromDbUrl } from "../scripts/copiar-fotos-supabase.mjs";

/** Um Storage falso: { bucket: { public, files: Map<path, {body, mimetype, cacheControl}> } }. */
function fakeStorage(buckets) {
  const calls = { uploads: [] };
  const storage = {
    async listBuckets() {
      return { data: Object.entries(buckets).map(([id, b]) => ({ id, public: b.public, file_size_limit: b.limit ?? null, allowed_mime_types: null })), error: null };
    },
    async getBucket(id) {
      return buckets[id] ? { data: { id }, error: null } : { data: null, error: { message: "Bucket not found" } };
    },
    async createBucket(id, opts) {
      buckets[id] = { public: opts.public, limit: opts.fileSizeLimit, files: new Map() };
      return { data: { name: id }, error: null };
    },
    from(id) {
      const files = () => buckets[id].files;
      return {
        async list(folder, { limit, offset }) {
          const prefix = folder ? `${folder}/` : "";
          const names = new Map();
          for (const [path, f] of files()) {
            if (!path.startsWith(prefix)) continue;
            const rest = path.slice(prefix.length);
            const [name, ...deeper] = rest.split("/");
            if (deeper.length) names.set(name, { name, id: null, metadata: null });
            else names.set(name, { name, id: `id-${path}`, metadata: { size: f.body.length, mimetype: f.mimetype, cacheControl: f.cacheControl } });
          }
          const sorted = [...names.values()].sort((a, b) => a.name.localeCompare(b.name));
          return { data: sorted.slice(offset, offset + limit), error: null };
        },
        async download(path) {
          const f = files().get(path);
          return f ? { data: new Blob([f.body], { type: f.mimetype }), error: null } : { data: null, error: { message: "Object not found" } };
        },
        async upload(path, blob, opts) {
          calls.uploads.push({ bucket: id, path, opts });
          if (files().has(path) && !opts.upsert) return { data: null, error: { message: "The resource already exists" } };
          files().set(path, { body: Buffer.from(await blob.arrayBuffer()), mimetype: opts.contentType, cacheControl: `max-age=${opts.cacheControl}` });
          return { data: { path }, error: null };
        },
      };
    },
  };
  return { client: { storage }, buckets, calls };
}

const file = (body, mimetype = "image/jpeg", cacheControl = "max-age=31536000") => ({ body: Buffer.from(body), mimetype, cacheControl });

test("o endereço do projeto sai do endereço da base (pooler e ligação direta)", () => {
  assert.equal(
    projectUrlFromDbUrl("postgresql://postgres.abcdefghijklmnopqrst:segredo@aws-0-eu-west-3.pooler.supabase.com:5432/postgres"),
    "https://abcdefghijklmnopqrst.supabase.co",
  );
  assert.equal(projectUrlFromDbUrl("postgresql://postgres:segredo@db.qwertyuiopasdfghjklz.supabase.co:5432/postgres"), "https://qwertyuiopasdfghjklz.supabase.co");
  assert.throws(() => projectUrlFromDbUrl("postgresql://postgres:x@localhost:5432/postgres"), /Não reconheço/);
  assert.throws(() => projectUrlFromDbUrl("isto não é um endereço"), /não é válido/);
});

test("lista todos os ficheiros, com subpastas e várias páginas", async () => {
  const files = new Map();
  for (let i = 0; i < 5; i++) files.set(`viatura-1/foto-${i}.jpg`, file(`v1-${i}`));
  files.set("viatura-2/_originais/a.jpg", file("orig"));
  files.set("logo.png", file("logo", "image/png"));
  const { client } = fakeStorage({ "car-media": { public: true, files } });
  const all = await listAll(client.storage.from("car-media"), "", 2);
  assert.deepEqual(all.map((f) => f.path).sort(), [...files.keys()].sort());
});

test("copia todos os buckets, cria os que faltam e mantém público/privado", async () => {
  const origem = fakeStorage({
    "car-media": { public: true, limit: 52428800, files: new Map([["v1/a.jpg", file("AAA")], ["v1/b.mp4", file("BBBB", "video/mp4", "max-age=3600")]]) },
    "wa-media": { public: false, files: new Map([["colab/x.jpg", file("XX")]]) },
  });
  // O destino já tem o registo de `v1/a.jpg` (veio na cópia da base) mas com outro conteúdo.
  const destino = fakeStorage({ "car-media": { public: true, files: new Map([["v1/a.jpg", file("")]]) } });

  const summary = await copyStorage(origem.client, destino.client, { log: () => {} });

  assert.deepEqual(
    summary.map(({ bucket, files, copied, failed }) => ({ bucket, files, copied, failed: failed.length })),
    [
      { bucket: "car-media", files: 2, copied: 2, failed: 0 },
      { bucket: "wa-media", files: 1, copied: 1, failed: 0 },
    ],
  );
  assert.equal(destino.buckets["wa-media"].public, false);
  assert.equal(destino.buckets["car-media"].files.get("v1/a.jpg").body.toString(), "AAA");
  assert.equal(destino.buckets["car-media"].files.get("v1/b.mp4").mimetype, "video/mp4");
  assert.equal(destino.buckets["car-media"].files.get("v1/b.mp4").cacheControl, "max-age=3600");
  assert.equal(destino.buckets["wa-media"].files.get("colab/x.jpg").body.toString(), "XX");
  assert.ok(destino.calls.uploads.every((u) => u.opts.upsert === true));
  // A origem só é lida.
  assert.equal(origem.calls.uploads.length, 0);
});

test("um ficheiro que falha aparece no resumo, os outros copiam-se", async () => {
  const origem = fakeStorage({ "car-media": { public: true, files: new Map([["v1/ok.jpg", file("OK")], ["v1/mau.jpg", file("MAU")]]) } });
  const destino = fakeStorage({ "car-media": { public: true, files: new Map() } });
  const real = origem.client.storage.from;
  origem.client.storage.from = (id) => {
    const b = real(id);
    return { ...b, download: async (p) => (p === "v1/mau.jpg" ? { data: null, error: { message: "timeout" } } : b.download(p)) };
  };
  const [s] = await copyStorage(origem.client, destino.client, { log: () => {} });
  assert.equal(s.copied, 1);
  assert.deepEqual(s.failed.map((f) => f.path), ["v1/mau.jpg"]);
  assert.match(s.failed[0].error, /timeout/);
});
