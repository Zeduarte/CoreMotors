import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);

// Site público: cache da CDN, rotas, mundo carros/motas e formulários.

/**
 * Carrega um módulo TS/TSX do projeto (transpilado) com `mocks` para os
 * imports indicados; o resto resolve-se normalmente.
 */
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
      if (id in mocks) return typeof mocks[id] === "function" && mocks[id].lazy ? mocks[id]() : mocks[id];
      if (id === "server-only") return {};
      if (id.startsWith("@/") || id.startsWith(".")) {
        let path = id.startsWith("@/") ? resolve("src", id.slice(2)) : resolve(dirname(file), id);
        if (!existsSync(path) || !/\.[a-z]+$/.test(path)) path = existsSync(`${path}.tsx`) ? `${path}.tsx` : `${path}.ts`;
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

/** Cabeçalhos que o next.config.mjs aplica a um endereço (por `source`). */
async function configHeaders(source) {
  const { default: config } = await import(`../next.config.mjs?t=${Date.now()}`);
  const rules = await config.headers();
  const rule = rules.find((r) => r.source === source);
  return Object.fromEntries((rule?.headers ?? []).map((h) => [h.key, h.value]));
}
const directives = (value) => (value ?? "").split(",").map((d) => d.trim());

test("the CDN keeps one copy per search on the stock and compare pages", async () => {
  // `query` sem lista: o Netlify varia por toda a pesquisa (e o runtime do Next
  // no Netlify junta-o aos seus `query=__nextDataReq|_rsc` como `query`).
  for (const page of ["/inventario", "/comparar"]) {
    const h = await configHeaders(page);
    assert.match(h["Netlify-CDN-Cache-Control"], /s-maxage=60/, page);
    assert.ok(directives(h["Netlify-Vary"]).includes("query"), page);
    assert.ok(directives(h["Netlify-Vary"]).includes("cookie=coremotors_public_type"), page);
  }
  // As outras páginas não dependem da pesquisa: ?utm_… não parte a cache.
  for (const page of ["/", "/carros/:path*", "/viaturas/:path*", "/sobre"]) {
    const h = await configHeaders(page);
    assert.match(h["Netlify-CDN-Cache-Control"], /s-maxage=60/, page);
    assert.ok(!directives(h["Netlify-Vary"]).some((d) => d.startsWith("query")), page);
  }
});

test("the vehicle page is rendered per request, never as a static page that reads cookies", () => {
  // Com generateStaticParams a rota ficava estática; sem slugs no build, cada
  // visita lia o cookie do mundo num render estático → DYNAMIC_SERVER_USAGE (500).
  const source = readFileSync("src/app/(public)/viaturas/[slug]/page.tsx", "utf8");
  assert.doesNotMatch(source, /export\s+(async\s+)?function\s+generateStaticParams/);
  assert.match(source, /export const dynamic = "force-dynamic"/);
});

test("the vehicle Open Graph image is always a PNG, without reading the world cookie", async () => {
  const vehicle = {
    slug: "yamaha-mt-07-2016", make: "Yamaha", model: "MT-07", variant: "ABS", year: 2016,
    mileage: 23000, fuel: "Gasolina", transmission: "Manual", price: 5990, priceOnRequest: false,
  };
  let preferred = "unset";
  let failBranding = false;
  const load = loader({
    "@/lib/queries": {
      getVehicleBySlug: async (slug, type) => {
        preferred = type;
        return slug === vehicle.slug ? vehicle : undefined;
      },
      getBranding: async () => {
        if (failBranding) throw new Error("supabase em baixo");
        return { companyName: "Supermotas", accent: "#E8B15A" };
      },
    },
    "next/headers": { cookies: () => { throw new Error("cookies() numa rota de imagem"); } },
  });
  const { default: Image, contentType } = load("src/app/(public)/viaturas/[slug]/opengraph-image.tsx");
  assert.equal(contentType, "image/png");
  const png = async (slug) => {
    const res = await Image({ params: Promise.resolve({ slug }) });
    assert.equal(res.status, 200, slug);
    const body = Buffer.from(await res.arrayBuffer());
    assert.ok(body.length > 1000, `${slug}: imagem vazia`);
    assert.equal(body.subarray(1, 4).toString(), "PNG", slug);
  };
  // Antes: o atalho `background: "radial-gradient(…), #0A0A0A"` rebentava no
  // gerador ("Invalid background image") com o 200 já enviado → 500 vazio.
  await png(vehicle.slug);
  assert.notEqual(preferred, undefined, "passa um tipo fixo em vez de ler o cookie");
  await png("nao-existe");
  failBranding = true;
  await png(vehicle.slug);
});
