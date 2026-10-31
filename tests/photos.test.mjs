import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import sharp from "sharp";
const require = createRequire(import.meta.url);

// Bucket e tabela car_media em memória.
const files = new Map();
const cacheHeaders = new Map();
const rows = [];
const removed = [];

const storage = {
  from() {
    return {
      async download(path) {
        const f = files.get(path);
        return f ? { data: new Blob([f]), error: null } : { data: null, error: { message: "Object not found" } };
      },
      async copy(from, to) {
        if (files.has(to)) return { error: { message: "The resource already exists" } };
        files.set(to, files.get(from));
        return { error: null };
      },
      async upload(path, buf, opts) {
        files.set(path, Buffer.isBuffer(buf) ? buf : Buffer.from(await buf.arrayBuffer()));
        cacheHeaders.set(path, `max-age=${opts.cacheControl}`);
        assert.equal(opts.cacheControl, "31536000");
        return { error: null };
      },
      async remove(paths) {
        for (const p of paths) files.delete(p), removed.push(p);
        return { error: null };
      },
      async list(folder) {
        const prefix = folder ? `${folder}/` : "";
        const out = new Map();
        for (const [k, v] of files) {
          if (!k.startsWith(prefix)) continue;
          const rest = k.slice(prefix.length);
          const [head, ...tail] = rest.split("/");
          out.set(head, tail.length ? { name: head, id: null, metadata: null } : { name: head, id: k, metadata: { size: v.length, cacheControl: cacheHeaders.get(k) ?? "max-age=3600" } });
        }
        return { data: [...out.values()], error: null };
      },
    };
  },
};

function table() {
  let filter = () => true;
  let patch = null;
  const api = {
    select() { return api; },
    eq(col, val) { const prev = filter; filter = (r) => prev(r) && r[col] === val; return api; },
    in(col, vals) { const prev = filter; filter = (r) => prev(r) && vals.includes(r[col]); return api; },
    update(p) { patch = p; return api; },
    then(resolve) {
      const hit = rows.filter(filter);
      if (patch) hit.forEach((r) => Object.assign(r, patch));
      resolve({ data: patch ? null : hit.map((r) => ({ ...r })), error: null });
    },
  };
  return api;
}
const db = { from: table, storage };

const cache = new Map();
function load(file) {
  file = resolve(file);
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  const custom = (id) => {
    if (id === "server-only") return {};
    if (id === "@/lib/guard") return { requireSection: async () => {}, requireVehicleType: async () => {}, requireCarsAccess: async () => {} };
    if (id === "@/lib/supabase/server") return { createClient: async () => db };
    if (id === "@/lib/public-cache") return { revalidatePublic() {} };
    if (id.startsWith("@/") || id.startsWith(".")) {
      let path = id.startsWith("@/") ? resolve("src", id.slice(2)) : resolve(dirname(file), id);
      if (!existsSync(path)) path += ".ts";
      return load(path);
    }
    return require(id);
  };
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  new Function("module", "exports", "require", outputText)(mod, mod.exports, custom);
  cache.set(file, mod.exports);
  return mod.exports;
}

const noise = (w, h) => sharp({ create: { width: w, height: h, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 40 } } });

test("otimizar fotos: reduz as pesadas com cópia do original, salta as leves e apaga as cópias no fim", async () => {
  files.set("car1/grande.jpg", await noise(4000, 3000).jpeg({ quality: 95 }).toBuffer());
  files.set("car1/ecra.png", await noise(3000, 2000).png().toBuffer());
  files.set("car2/leve.jpg", await noise(800, 600).jpeg({ quality: 70 }).toBuffer());
  rows.push(
    { id: "a", kind: "image", storage_path: "car1/grande.jpg", width: 4000, height: 3000 },
    { id: "b", kind: "image", storage_path: "car1/ecra.png", width: null, height: null },
    { id: "c", kind: "image", storage_path: "car2/leve.jpg", width: 800, height: 600 },
    { id: "d", kind: "image", storage_path: "https://images.unsplash.com/x", width: null, height: null },
  );
  const { scanPhotos, optimizePhotos, refreshPhotoCache, deletePhotoBackups } = load("src/lib/actions/photos.ts");

  const scan = await scanPhotos();
  assert.equal(scan.ok, true);
  assert.equal(scan.total, 3, "a foto externa não conta");
  assert.deepEqual(scan.todo.map((t) => t.id).sort(), ["a", "b"]);
  assert.deepEqual(scan.stale.map((t) => t.id), ["c"], "a leve só precisa da cache longa");

  // Como o botão: um pedido por foto (cada pedido tem de ser curto).
  const results = [];
  for (const id of scan.todo.map((t) => t.id)) results.push(...(await optimizePhotos([id])).results);
  assert.deepEqual(results.map((r) => r.status), ["reduzida", "reduzida"]);
  for (const r of results) assert.ok(r.after < r.before * 0.9, "poupa pelo menos 10%");

  // O JPEG fica no mesmo caminho, mais pequeno e com o tamanho do site.
  const a = rows.find((r) => r.id === "a");
  assert.equal(a.storage_path, "car1/grande.jpg");
  assert.deepEqual([a.width, a.height], [2400, 1800]);
  const meta = await sharp(files.get("car1/grande.jpg")).metadata();
  assert.deepEqual([meta.format, meta.width, meta.height], ["jpeg", 2400, 1800]);

  // O PNG passa a .jpg (a linha aponta para o novo, o antigo sai).
  const b = rows.find((r) => r.id === "b");
  assert.equal(b.storage_path, "car1/ecra.jpg");
  assert.ok(files.has("car1/ecra.jpg") && !files.has("car1/ecra.png"));

  // Os originais ficam guardados antes de qualquer mudança.
  assert.ok(files.has("_originais/car1/grande.jpg") && files.has("_originais/car1/ecra.png"));
  assert.ok(files.get("_originais/car1/grande.jpg").length > files.get("car1/grande.jpg").length);

  const before = files.get("car2/leve.jpg");
  assert.equal((await refreshPhotoCache(["c"])).done, 1);
  assert.ok(files.get("car2/leve.jpg").equals(before), "regravada igual");

  const again = await scanPhotos();
  assert.deepEqual(again.todo, [], "nada mais para reduzir");
  assert.deepEqual(again.stale, [], "todas com cache longa");
  assert.equal(again.backups.count, 2);

  const del = await deletePhotoBackups();
  assert.equal(del.removed, 2);
  assert.ok(![...files.keys()].some((k) => k.startsWith("_originais/")));
  assert.ok(files.has("car2/leve.jpg"), "as fotos leves não se tocam");
});
