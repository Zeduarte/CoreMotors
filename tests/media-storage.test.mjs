// Fotos no Supabase ou no Cloudflare R2: URLs, operações no R2 (contra um R2
// falso, local), escolha do armazenamento e carregamentos do backoffice.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import ts from "typescript";

const require = createRequire(import.meta.url);
function loader(mocks = {}) {
  const cache = new Map();
  function load(file) {
    file = resolve(file);
    if (cache.has(file)) return cache.get(file);
    const mod = { exports: {} };
    cache.set(file, mod.exports);
    const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    });
    const custom = (id) => {
      if (id in mocks) return mocks[id];
      if (id === "server-only") return {};
      if (id.startsWith("@/") || id.startsWith(".")) {
        let path = id.startsWith("@/") ? resolve("src", id.slice(2)) : resolve(dirname(file), id);
        if (!existsSync(path) || !/\.[a-z]+$/.test(path)) path = existsSync(`${path}.tsx`) ? `${path}.tsx` : existsSync(`${path}.ts`) ? `${path}.ts` : `${path}/index.ts`;
        return load(path);
      }
      return require(id);
    };
    new Function("module", "exports", "require", outputText)(mod, mod.exports, custom);
    cache.set(file, mod.exports);
    return mod.exports;
  }
  return load;
}

const ENV = ["NEXT_PUBLIC_MEDIA_STORAGE", "NEXT_PUBLIC_MEDIA_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_ENDPOINT", "NEXT_PUBLIC_SUPABASE_URL"];
function withEnv(values, fn) {
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, values);
  const restore = () => {
    for (const k of ENV) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  };
  let out;
  try {
    out = fn();
  } catch (e) {
    restore();
    throw e;
  }
  // Nas funções assíncronas, as variáveis só voltam ao fim.
  if (out && typeof out.then === "function") return out.finally(restore);
  restore();
  return out;
}

// ---- R2 falso (API S3, endereços «path-style»: /<bucket>/<chave>) ----
const objects = new Map();
const seen = [];
let server;
let endpoint;
before(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const [, bucket, ...rest] = url.pathname.split("/");
    const key = rest.map(decodeURIComponent).join("/");
    seen.push({ method: req.method, key, auth: req.headers.authorization ?? "", query: url.search, headers: req.headers });
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (bucket !== "fotos") return res.writeHead(404).end("NoSuchBucket");
      if (req.method === "GET" && !key) {
        const prefix = url.searchParams.get("prefix") ?? "";
        const all = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const start = Number(url.searchParams.get("continuation-token") ?? 0);
        const page = all.slice(start, start + 2); // páginas pequenas: testa a paginação
        const more = start + 2 < all.length;
        const xml = `<?xml version="1.0"?><ListBucketResult>${page
          .map((k) => `<Contents><Key>${k.replace(/&/g, "&amp;")}</Key><Size>${objects.get(k).body.length}</Size></Contents>`)
          .join("")}<IsTruncated>${more}</IsTruncated>${more ? `<NextContinuationToken>${start + 2}</NextContinuationToken>` : ""}</ListBucketResult>`;
        return res.writeHead(200, { "content-type": "application/xml" }).end(xml);
      }
      if (req.method === "PUT") {
        const src = req.headers["x-amz-copy-source"];
        // Como o R2 verdadeiro: sem tamanho (envio em «stream»), recusa.
        if (!src && req.headers["content-length"] === undefined) return res.writeHead(411).end("MissingContentLength");
        if (src) {
          const from = decodeURIComponent(src.split("/").slice(2).join("/"));
          if (!objects.has(from)) return res.writeHead(404).end();
          objects.set(key, { ...objects.get(from) });
        } else {
          objects.set(key, { body: Buffer.concat(chunks), type: req.headers["content-type"], cache: req.headers["cache-control"] });
        }
        return res.writeHead(200).end();
      }
      const obj = objects.get(key);
      if (req.method === "DELETE") {
        objects.delete(key);
        return res.writeHead(204).end();
      }
      if (!obj) return res.writeHead(404).end();
      if (req.method === "HEAD") return res.writeHead(200).end();
      return res.writeHead(200, { "content-type": obj.type ?? "application/octet-stream" }).end(obj.body);
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  endpoint = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

const r2Env = () => ({
  R2_ENDPOINT: endpoint,
  R2_ACCESS_KEY_ID: "AKIDTEST",
  R2_SECRET_ACCESS_KEY: "secret",
  R2_BUCKET: "fotos",
  NEXT_PUBLIC_MEDIA_URL: "https://fotos.exemplo.pt/",
  NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co",
});

test("photo URLs: always R2 (default address if unset), Supabase only when asked explicitly", () => {
  const S = loader()("src/lib/storage.ts");
  // Sem variáveis nenhumas: R2, no endereço por omissão.
  withEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }, () => {
    assert.equal(S.mediaStorage(), "r2");
    assert.equal(S.publicMediaUrl("car1/a.jpg"), "https://fotos.supermotas.com/car1/a.jpg");
  });
  // Com o endereço público configurado: usa esse.
  withEnv({ ...r2Env() }, () => {
    assert.equal(S.mediaStorage(), "r2");
    assert.equal(S.publicMediaUrl("car1/a.jpg"), "https://fotos.exemplo.pt/car1/a.jpg");
    assert.equal(S.publicMediaUrl("https://images.unsplash.com/x.jpg"), "https://images.unsplash.com/x.jpg");
  });
  withEnv({ ...r2Env(), NEXT_PUBLIC_MEDIA_STORAGE: "r2" }, () => assert.equal(S.mediaStorage(), "r2"));
  // Endereço inválido: não parte as fotos, cai no endereço por omissão.
  withEnv({ NEXT_PUBLIC_MEDIA_URL: "fotos", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }, () =>
    assert.equal(S.publicMediaUrl("car1/a.jpg"), "https://fotos.supermotas.com/car1/a.jpg"),
  );
  // Só volta ao Supabase se for pedido de propósito.
  withEnv({ NEXT_PUBLIC_MEDIA_STORAGE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }, () => {
    assert.equal(S.mediaStorage(), "supabase");
    assert.equal(S.publicMediaUrl("car1/a.jpg"), "https://abc.supabase.co/storage/v1/object/public/car-media/car1/a.jpg");
  });
});

test("R2: put, get, exists, copy, list (all pages), delete — signed requests", async () => {
  const R = loader()("src/lib/r2.ts");
  await withEnv(r2Env(), async () => {
    assert.deepEqual(R.r2Missing(), []);
    objects.clear();
    seen.length = 0;
    await R.r2Put("car1/a.jpg", Buffer.from("AAA"), "image/jpeg");
    await R.r2Put("car1/b c.jpg", Buffer.from("BB"), "image/jpeg");
    await R.r2Put("car2/c.jpg", Buffer.from("C"), "image/jpeg");
    assert.match(seen[0].auth, /^AWS4-HMAC-SHA256 Credential=AKIDTEST\//);
    // O tamanho vai sempre (o R2 recusa envios sem Content-Length).
    assert.equal(seen[0].headers["content-length"], "3");
    assert.equal(seen[0].headers["transfer-encoding"], undefined);
    // Também com o que vem do Supabase (Buffer de um ArrayBuffer) e com Blob.
    await R.r2Put("car3/x.jpg", Buffer.from(await new Blob(["x".repeat(70000)]).arrayBuffer()), "image/jpeg");
    await R.r2Put("car3/y.jpg", new Blob(["yy"]), "image/jpeg");
    assert.equal(objects.get("car3/x.jpg").body.length, 70000);
    assert.equal(objects.get("car3/y.jpg").body.toString(), "yy");
    objects.delete("car3/x.jpg");
    objects.delete("car3/y.jpg");
    assert.equal(objects.get("car1/a.jpg").cache, "public, max-age=31536000, immutable");
    assert.equal(objects.get("car1/a.jpg").type, "image/jpeg");
    assert.equal((await R.r2Get("car1/a.jpg")).data.toString(), "AAA");
    assert.equal(await R.r2Get("nada.jpg"), null);
    assert.equal(await R.r2Exists("car1/b c.jpg"), true);
    assert.equal(await R.r2Exists("nada.jpg"), false);
    await R.r2Copy("car1/a.jpg", "_originais/car1/a.jpg");
    assert.equal(objects.get("_originais/car1/a.jpg").body.toString(), "AAA");
    const all = await R.r2List();
    assert.deepEqual(all.map((o) => o.path).sort(), ["_originais/car1/a.jpg", "car1/a.jpg", "car1/b c.jpg", "car2/c.jpg"]);
    assert.deepEqual((await R.r2List("car1/")).map((o) => [o.path, o.size]), [["car1/a.jpg", 3], ["car1/b c.jpg", 2]]);
    await R.r2Delete(["car1/a.jpg", "nada.jpg"]);
    assert.equal(objects.has("car1/a.jpg"), false);
  });
});

test("R2: browser upload address is signed, short-lived and fixes the cache header", async () => {
  const R = loader()("src/lib/r2.ts");
  await withEnv(r2Env(), async () => {
    const t = await R.presignPut("car1/new.jpg", "image/jpeg");
    const u = new URL(t.url);
    assert.equal(u.pathname, "/fotos/car1/new.jpg");
    assert.equal(u.searchParams.get("X-Amz-Expires"), "600");
    assert.ok(u.searchParams.get("X-Amz-Signature"));
    assert.match(u.searchParams.get("X-Amz-SignedHeaders"), /cache-control/);
    assert.equal(t.headers["Cache-Control"], "public, max-age=31536000, immutable");
    // O browser carrega com o endereço e os cabeçalhos dados.
    objects.clear();
    const put = await fetch(t.url, { method: "PUT", body: "foto", headers: t.headers });
    assert.equal(put.status, 200);
    assert.equal(objects.get("car1/new.jpg").body.toString(), "foto");
  });
  withEnv({}, () => {
    assert.deepEqual(R.r2Missing(), ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]);
    assert.equal(R.r2Config(), null);
  });
  withEnv({ R2_ACCOUNT_ID: "abc123", R2_ACCESS_KEY_ID: "k", R2_SECRET_ACCESS_KEY: "s", R2_BUCKET: "b" }, () =>
    assert.equal(R.r2Config().endpoint, "https://abc123.r2.cloudflarestorage.com"),
  );
});

test("media store: R2 when switched on, Supabase otherwise; the backup copy never overwrites", async () => {
  const calls = [];
  const db = {
    storage: {
      from: (bucket) => ({
        upload: async (path, _body, opts) => (calls.push(["upload", bucket, path, opts.cacheControl]), { error: null }),
        remove: async (paths) => (calls.push(["remove", bucket, paths]), { error: null }),
        copy: async () => ({ error: { message: "The resource already exists" } }),
        download: async () => ({ data: new Blob(["x"]), error: null }),
        list: async () => ({ data: [] }),
      }),
    },
  };
  const M = loader()("src/lib/media-store.ts");
  await withEnv({ NEXT_PUBLIC_MEDIA_STORAGE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }, async () => {
    const s = M.mediaStore(db);
    assert.equal(s.kind, "supabase");
    assert.equal(await s.upload("c/a.jpg", Buffer.from("x"), { contentType: "image/jpeg" }), null);
    assert.deepEqual(calls[0], ["upload", "car-media", "c/a.jpg", "31536000"]);
    assert.match(await s.copy("c/a.jpg", "_originais/c/a.jpg"), /exists/);
    assert.equal((await s.download("c/a.jpg")).toString(), "x");
  });
  await withEnv({ ...r2Env(), NEXT_PUBLIC_MEDIA_STORAGE: "r2" }, async () => {
    objects.clear();
    const s = M.mediaStore(db);
    assert.equal(s.kind, "r2");
    assert.equal(await s.upload("c/a.jpg", Buffer.from("novo"), { contentType: "image/jpeg" }), null);
    assert.equal(await s.copy("c/a.jpg", "_originais/c/a.jpg"), null);
    await s.upload("c/a.jpg", Buffer.from("reduzida"), { contentType: "image/jpeg", upsert: true });
    // A segunda cópia não substitui o original guardado.
    assert.match(await s.copy("c/a.jpg", "_originais/c/a.jpg"), /exists/);
    assert.equal(objects.get("_originais/c/a.jpg").body.toString(), "novo");
    assert.deepEqual([...(await s.sizes(["c"])).keys()], ["c/a.jpg"]);
    assert.deepEqual([...(await s.tree("_originais")).keys()], ["_originais/c/a.jpg"]);
    assert.equal(await s.remove(["c/a.jpg"]), null);
    assert.equal(objects.has("c/a.jpg"), false);
    assert.equal(calls.length, 1); // o Supabase não foi tocado
  });
});

test("backoffice uploads: the server picks the path; only car folders and image/video types", async () => {
  const guards = [];
  const U = loader({
    "@/lib/guard": {
      requireSection: async (s) => guards.push(s),
      requireCarsAccess: async (ids) => guards.push(...ids),
      requireAdmin: async () => ({ id: "admin" }),
    },
  })("src/lib/actions/upload.ts");
  const car = "11111111-1111-4111-8111-111111111111";
  const files = [{ ext: "jpg", contentType: "image/jpeg" }, { ext: "mp4", contentType: "video/mp4" }];
  await withEnv({ NEXT_PUBLIC_MEDIA_STORAGE: "supabase", NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" }, async () => {
    assert.deepEqual(await U.getUploadTargets({ scope: "car", carId: car, files }), { ok: true, mode: "supabase" });
    assert.deepEqual(guards, ["carros", car]);
  });
  await withEnv({ ...r2Env(), NEXT_PUBLIC_MEDIA_STORAGE: "r2" }, async () => {
    const r = await U.getUploadTargets({ scope: "car", carId: car, files });
    assert.equal(r.mode, "r2");
    assert.equal(r.targets.length, 2);
    assert.match(r.targets[0].path, new RegExp(`^${car}/[0-9a-f-]{36}\\.jpg$`));
    assert.match(r.targets[1].path, /\.mp4$/);
    const logo = await U.getUploadTargets({ scope: "branding", files: [{ ext: "png", contentType: "image/png" }] });
    assert.match(logo.targets[0].path, /^branding\/[0-9a-f-]{36}\.png$/);
    for (const bad of [
      { scope: "car", carId: "../x", files },
      { scope: "car", carId: car, files: [{ ext: "html", contentType: "text/html" }] },
      { scope: "car", carId: car, files: [{ ext: "j/pg", contentType: "image/jpeg" }] },
      { scope: "branding", files },
      { scope: "outro", files },
    ])
      assert.deepEqual(await U.getUploadTargets(bad), { ok: false, error: "Ficheiros inválidos." });
  });
});
