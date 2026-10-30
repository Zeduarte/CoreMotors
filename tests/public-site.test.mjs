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
      // CSS modules: cada classe devolve o próprio nome.
      if (id.endsWith(".css")) return new Proxy({}, { get: (_, k) => (k === "__esModule" ? undefined : String(k)) });
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

test("the world chooser only covers pages whose content depends on carros/motas", async () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  let pathname = "/";
  const load = loader({
    "next/navigation": { usePathname: () => pathname, useRouter: () => ({ refresh() {} }) },
    "./WorldEntrance.module.css": new Proxy({}, { get: (_, k) => (k === "__esModule" ? undefined : String(k)) }),
  });
  const { WorldEntrance } = load("src/components/site/WorldEntrance.tsx");
  const { needsWorldChoice } = load("src/lib/world.ts");
  const shows = (path, selected = null) => {
    pathname = path;
    return renderToStaticMarkup(React.createElement(WorldEntrance, { name: "Supermotas", selected })).includes("<dialog");
  };
  for (const path of ["/", "/inventario", "/vendidos", "/favoritos", "/quiz", "/vender"]) {
    assert.equal(shows(path), true, path);
    assert.equal(shows(path, "car"), false, `${path} (já escolheu)`);
  }
  // O link de cancelar o alerta chega por WhatsApp/email, muitas vezes noutro
  // telemóvel: o ecrã tapava-o e, ao escolher, ia-se parar à homepage.
  for (const path of [
    "/alertas/cancelar/0f8fad5b-d9cb-469f-a165-70867728950e.AbCdEfGhIjKlMnOpQrSt_-",
    "/contactos", "/sobre", "/servicos", "/servicos/financiamento",
    "/politica-de-privacidade", "/politica-de-cookies", "/termos-condicoes",
    "/viaturas/bmw-116d", "/viaturas/bmw-116d/ficha", "/motas/yamaha", "/carros",
  ]) {
    assert.equal(shows(path), false, path);
    assert.equal(needsWorldChoice(path), false, path);
  }
  // O aviso de variável por usar (setEntered) desapareceu com o estado.
  assert.doesNotMatch(readFileSync("src/components/site/WorldEntrance.tsx", "utf8"), /setEntered/);
});

test("unknown vehicles, listings and services answer a real 404 before the skeleton streams", async () => {
  // Um `loading.tsx` acima da rota manda o esqueleto (e o 200) antes de a
  // página correr: o notFound() da página já não muda o código → "soft 404".
  // A verificação vive no layout da rota, e nenhum loading.tsx fica por cima.
  const routes = {
    "viaturas/[slug]": ["vehicleExists", (p) => p.slug],
    "carros/[filtro]": ["seoPageExists", (p) => p.filtro],
    "motas/[filtro]": ["seoPageExists", (p) => p.filtro],
    "servicos/[slug]": ["serviceExists", (p) => p.slug],
  };
  for (const [route, [guard, value]] of Object.entries(routes)) {
    const parts = route.split("/");
    for (let i = 0; i < parts.length; i++) {
      const dir = ["src/app/(public)", ...parts.slice(0, i)].join("/");
      assert.ok(!existsSync(`${dir}/loading.tsx`), `${dir}/loading.tsx envolve ${route}`);
    }
    let exists = false;
    const calls = [];
    const load = loader({
      "next/navigation": { notFound: () => { throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }); } },
      "@/lib/route-guards": { [guard]: async (...args) => { calls.push(args); return exists; } },
    });
    const Layout = load(`src/app/(public)/${route}/layout.tsx`).default;
    const params = Promise.resolve({ slug: "x-y", filtro: "x-y" });
    await assert.rejects(Layout({ children: "ficha", params }), /NEXT_NOT_FOUND/, route);
    exists = true;
    assert.equal(await Layout({ children: "ficha", params }), "ficha", route);
    assert.equal(calls.at(-1).at(-1), value({ slug: "x-y", filtro: "x-y" }), route);
  }
  // As listas continuam com o esqueleto (dentro de um grupo de rotas).
  for (const dir of ["carros/(todos)", "motas/(todos)", "servicos/(lista)", "viaturas/[slug]", "carros/[filtro]", "inventario"])
    assert.ok(existsSync(`src/app/(public)/${dir}/loading.tsx`), dir);
});

test("the world switch on /carros and /motas goes to the equivalent page of the other world", () => {
  const { worldSwitchDestination: go } = loader()("src/lib/world.ts");
  assert.equal(go("/carros", "motorcycle"), "/motas");
  assert.equal(go("/motas/", "car"), "/carros");
  assert.equal(go("/carros/bmw", "motorcycle"), "/motas/bmw"); // marca com carros e motas
  assert.equal(go("/carros/suv", "motorcycle"), "/motas"); // categoria só dos carros
  assert.equal(go("/motas/ate-5000-euros", "car"), "/carros");
  assert.equal(go("/viaturas/bmw-320d", "motorcycle"), "/inventario");
  assert.equal(go("/inventario", "motorcycle"), "/inventario");
});

test("/inventario?tipo= switches world with a real redirect, keeping the search", () => {
  const { inventoryRedirect } = loader()("src/lib/inventory-redirect.ts");
  const q = (s) => new URLSearchParams(s);
  assert.equal(
    inventoryRedirect(q("tipo=motas&marca=Yamaha&preco_max=8000"), "car"),
    `/api/vehicle-context?area=public&type=motorcycle&target=${encodeURIComponent("/inventario?marca=Yamaha&preco_max=8000")}`,
  );
  // Sem escolha guardada também muda (e grava a escolha).
  assert.equal(
    inventoryRedirect(q("tipo=carros"), undefined),
    `/api/vehicle-context?area=public&type=car&target=${encodeURIComponent("/inventario")}`,
  );
  assert.equal(inventoryRedirect(q("tipo=motas"), "motorcycle"), null);
  assert.equal(inventoryRedirect(q("tipo=camioes"), "car"), null);
  assert.equal(inventoryRedirect(q("marca=BMW"), undefined), null);
});

test("/inventario?tipo= is redirected by the config (307 before the page) and comes back with the search", async () => {
  const { default: config } = await import(`../next.config.mjs?t=${Date.now()}`);
  const rules = (await config.redirects()).filter((r) => r.source === "/inventario");
  assert.equal(rules.length, 2);
  for (const [tipo, type] of [["carros", "car"], ["motas", "motorcycle"]]) {
    const rule = rules.find((r) => r.has[0].value === tipo);
    assert.equal(rule.permanent, false);
    assert.deepEqual(rule.missing, [{ type: "cookie", key: "coremotors_public_type", value: type }]);
    assert.match(rule.destination, new RegExp(`type=${type}&target=%2Finventario&carry=1$`));
  }
  // O Next junta a pesquisa original ao destino; a rota devolve-a ao stock.
  const load = loader({
    "@/lib/vehicle-context": { getAllowedVehicleTypes: async () => ["car", "motorcycle"] },
  });
  const { GET } = load("src/app/api/vehicle-context/route.ts");
  const { NextRequest } = require("next/server");
  const res = await GET(new NextRequest("https://example.test/api/vehicle-context?area=public&type=motorcycle&target=%2Finventario&carry=1&tipo=motas&marca=Yamaha&preco_max=8000"));
  assert.equal(res.status, 303);
  assert.equal(res.headers.get("location"), "/inventario?marca=Yamaha&preco_max=8000");
  assert.equal(res.cookies.get("coremotors_public_type").value, "motorcycle");
  // `carry` só serve o stock: noutro destino a pesquisa do pedido não passa.
  const other = await GET(new NextRequest("https://example.test/api/vehicle-context?area=public&type=car&target=%2Fsobre&carry=1&x=1"));
  assert.equal(other.headers.get("location"), null);
  assert.match(await other.text(), /url=\/sobre"/);
});
