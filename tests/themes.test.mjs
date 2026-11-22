// Versões do site (temas Core / Core2) e o separador Gestão (só o acesso core).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
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

test("themes: Core and Core2, every home section, and the saved theme falls back to Core", () => {
  const T = loader()("src/themes/index.ts");
  assert.deepEqual(Object.keys(T.THEMES), ["core", "core2"]);
  assert.equal(T.DEFAULT_THEME, "core");
  const sections = ["hero", "segments", "featured", "brands", "stock", "sell", "trust", "sold", "showroom", "testimonials", "contact"];
  for (const id of ["core", "core2"]) {
    const t = T.getTheme(id);
    assert.equal(t.id, id);
    assert.deepEqual([...t.homeSections].sort(), [...sections].sort(), `${id}: todas as secções da página inicial`);
    for (const key of ["navHome", "navStock", "navIdeal", "navServices", "navAbout", "navContacts"]) assert.ok(t.texts[key], `${id}: texto ${key}`);
  }
  // O Core2 é uma cópia (mudar um não mexe no outro).
  assert.notEqual(T.getTheme("core2").texts, T.getTheme("core").texts);
  assert.notEqual(T.getTheme("core2").homeSections, T.getTheme("core").homeSections);
  for (const raw of [null, {}, { theme: "outro" }, { theme: 2 }]) assert.equal(T.parseThemeId(raw), "core", JSON.stringify(raw));
  assert.equal(T.parseThemeId({ theme: "core2" }), "core2");
  // O CSS do Core2 fica todo debaixo do atributo do tema.
  const css = readFileSync("src/themes/core2.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of css.split("}").map((r) => r.trim()).filter(Boolean))
    assert.match(rule, /^(?:\[data-site-theme="core2"\]|html:has\(\[data-site-theme="core2"\]\) body )/, `regra fora do tema: ${rule.slice(0, 60)}`);
});

test("the public layout marks the theme and the home page follows the theme's section order", () => {
  const layout = readFileSync("src/app/(public)/layout.tsx", "utf8");
  assert.match(layout, /data-site-theme=\{theme\}/);
  assert.match(layout, /<SiteThemeProvider theme=\{theme\}>/);
  assert.match(layout, /import "@\/themes\/core2\.css"/);
  const home = readFileSync("src/app/(public)/(home)/page.tsx", "utf8");
  assert.match(home, /getTheme\(theme\)\.homeSections\.map/);
});

test("Gestão: only the core access (the account owner) sees it, not even an administrator", () => {
  const nav = loader()("src/components/admin/admin-nav.ts");
  const item = nav.ADMIN_NAV.find((i) => i.href === "/admin/gestao");
  assert.ok(item?.ownerOnly);
  const all = ["dashboard", "carros", "pagina-inicial", "leads", "testemunhos", "integracoes", "anuncios", "utilizadores", "definicoes", "oficina", "horas", "financeiro", "partilhas"];
  assert.equal(nav.canSeeNavItem(item, all, false), false, "administrador sem ser o dono: não vê");
  assert.equal(nav.canSeeNavItem(item, ["dashboard"], true), true, "o dono vê");
  assert.equal(nav.canSeeNavItem(nav.ADMIN_NAV[0], all), true, "os outros separadores não mudam");
  assert.ok(nav.ADMIN_NAV_GROUPS.some((g) => g.hrefs.includes("/admin/gestao")));
});

test("saving the site theme: only the owner, only known themes, and the public site is refreshed", async () => {
  let me = null;
  const writes = [];
  const revalidated = [];
  const db = { from: (t) => ({ upsert: async (row, opts) => { writes.push([t, row, opts]); return { error: null }; } }) };
  const load = loader({
    "@/lib/admin-queries": { getCurrentProfile: async () => me },
    "@/lib/supabase/server": { createClient: async () => db },
    "@/lib/public-cache": { revalidatePublic: (...a) => revalidated.push(a) },
    "next/cache": { revalidatePath: (...a) => revalidated.push(a) },
  });
  const { saveSiteTheme } = load("src/lib/actions/gestao.ts");
  me = { id: "a", role: "admin", is_owner: false };
  assert.match((await saveSiteTheme("core2")).error, /acesso core/);
  me = { id: "o", role: "admin", is_owner: true };
  assert.match((await saveSiteTheme("tema-inventado")).error, /Escolha/);
  assert.equal(writes.length, 0);
  assert.equal((await saveSiteTheme("core2")).ok, true);
  assert.deepEqual(writes[0], ["site_content", { key: "theme", content: { theme: "core2" } }, { onConflict: "key" }]);
  assert.deepEqual(revalidated[0], ["/", "layout"]);
});

test("the Gestão page is guarded by requireOwner, which sends anyone else to the Dashboard", async () => {
  assert.match(readFileSync("src/app/admin/(dashboard)/gestao/page.tsx", "utf8"), /await requireOwner\(\)/);
  let profile = null;
  const redirects = [];
  const { requireOwner } = loader({
    "@/lib/admin-queries": { getCurrentProfile: async () => profile },
    "next/navigation": { redirect: (to) => { redirects.push(to); throw new Error(`REDIRECT ${to}`); } },
    "@/lib/supabase/server": { createClient: async () => ({}) },
  })("src/lib/guard.ts");
  await assert.rejects(requireOwner(), /REDIRECT \/admin\/login/);
  profile = { role: "admin", is_owner: false };
  await assert.rejects(requireOwner(), /REDIRECT \/admin$/);
  profile = { role: "admin", is_owner: true };
  assert.equal((await requireOwner()).is_owner, true);
});

// ---- Core2: as maquetes (menu, rodapé, página inicial e stock) -----------------

const stockVehicle = (slug, make, type, body, extra = {}) => ({ slug, make, model: "X", year: 2020, mileage: 10000, price: 10000, fuel: "Gasolina", transmission: "Manual", body, power: 0, displacement: 0, color: "Preto", doors: 0, seats: 0, featured: false, tagline: "", description: "", images: [], highlights: [], vehicleType: type, ...extra });
const stockFixture = () => [
  stockVehicle("bmw-320", "BMW", "car", "Berlina", { fuel: "Diesel", transmission: "Automática", displacement: 1995, power: 190, year: 2018, price: 21000, createdAt: "2026-11-19T10:00:00Z" }),
  stockVehicle("gs", "BMW", "motorcycle", "Trail", { displacement: 1170, power: 125, year: 2015, mileage: 59400, price: 11900, createdAt: "2026-10-01T10:00:00Z" }),
  stockVehicle("pcx", "Honda", "motorcycle", "Scooter", { displacement: 125, year: 2022, mileage: 3000, price: 3500, createdAt: "2026-11-20T10:00:00Z" }),
  stockVehicle("yfz", "Yamaha", "motorcycle", "Moto 4", { displacement: 450, year: 2009, mileage: 4000, price: 9950, tagline: "Excelente estado", createdAt: "2026-11-21T10:00:00Z" }),
  stockVehicle("tenere", "yamaha", "motorcycle", "Trail", { displacement: 689, year: 2020, mileage: 17800, price: 9900, createdAt: "2026-11-18T10:00:00Z" }),
];
const withPhotos = (list) => list.map((v) => ({ ...v, images: [{ src: `https://cdn.example/${v.slug}.jpg`, alt: "", width: 1, height: 1 }] }));
/** Mocks do Next para desenhar componentes no servidor dos testes. */
const nextMocks = (React, extra = {}) => ({
  "next/link": { __esModule: true, default: ({ href, children, prefetch, ...p }) => React.createElement("a", { href, ...p }, children) },
  "next/image": { __esModule: true, default: ({ fill, priority, sizes, ...p }) => React.createElement("img", p) },
  ...extra,
});
const flat = (html) => html.replace(/[\u00a0\u202f]/g, " ");

test("Core2 stock: Tipo (Motas, Moto 4, Carros), brands, categories, cc, price, year and km in boxes", () => {
  const S = loader()("src/themes/core2/stock.ts");
  const all = stockFixture();
  const slugs = (list) => list.map((x) => x.slug).sort();
  const run = (patch, base = {}) => slugs(S.filterCore2(all, { ...S.emptyCore2(), ...patch, base: { ...S.emptyCore2().base, ...base } }));
  // Os tipos: os que o site vende; a Moto 4 só com alguma em stock; com um só, nada a escolher.
  assert.deepEqual(S.kindsFor(["car", "motorcycle"], all), ["motas", "moto4", "carros"]);
  assert.deepEqual(S.kindsFor(["motorcycle"], all), ["motas", "moto4"]);
  assert.deepEqual(S.kindsFor(["motorcycle"], all.filter((v) => v.body !== "Moto 4")), []);
  assert.deepEqual(S.kindsFor(["car"], all), []);
  // Nenhuma caixa: tudo. Motas sem a Moto 4; Moto 4 só a categoria Moto 4; várias de uma vez.
  assert.deepEqual(run({}), slugs(all));
  assert.deepEqual(run({ kinds: ["motas"] }), ["gs", "pcx", "tenere"]);
  assert.deepEqual(run({ kinds: ["moto4"] }), ["yfz"]);
  assert.deepEqual(run({ kinds: ["moto4", "carros"] }), ["bmw-320", "yfz"]);
  // Marcas (sem olhar a maiúsculas) e categorias.
  assert.deepEqual(run({ makes: ["Yamaha"] }), ["tenere", "yfz"]);
  assert.deepEqual(run({ makes: ["BMW", "Honda"] }), ["bmw-320", "gs", "pcx"]);
  assert.deepEqual(run({ bodies: ["Trail"] }), ["gs", "tenere"]);
  // Cilindrada com os nomes da maqueta; cada caixa apanha as motas mais perto dessa classe, sem buracos.
  assert.deepEqual(S.CC_BUCKETS.map((b) => b.label), ["125 cc", "450 cc", "800 cc", "1200 cc+"]);
  assert.deepEqual(run({ cc: ["125"] }), ["pcx"]);
  assert.deepEqual(run({ cc: ["450", "800"] }), ["tenere", "yfz"]);
  assert.deepEqual(run({ cc: ["1200"] }), ["gs"], "o carro de 1995 cc não é uma mota de 1200 cc+");
  for (const cc of [50, 125, 250, 251, 650, 651, 1000, 1001, 1300]) assert.equal(S.CC_BUCKETS.filter((b) => S.inBucket(cc, b.id)).length, 1, `${cc} cc numa só caixa`);
  // Preço, ano e km: os filtros de sempre.
  assert.deepEqual(run({}, { maxPrice: 10000 }), ["pcx", "tenere", "yfz"]);
  assert.deepEqual(run({}, { minYear: 2015, maxYear: 2020 }), ["bmw-320", "gs", "tenere"]);
  assert.deepEqual(run({}, { maxMileage: 5000 }), ["pcx", "yfz"]);
  // As opções: marcas sem duplicados, categorias pela ordem habitual, anos seguidos.
  assert.deepEqual(S.makeOptions(all, []), ["BMW", "Honda", "Yamaha"]);
  assert.deepEqual(S.makeOptions(all, ["Ducati"]), ["BMW", "Honda", "Yamaha", "Ducati"], "a escolhida sem stock fica à vista");
  assert.deepEqual(S.bodyOptions(all, []), ["Scooter", "Trail", "Moto 4", "Berlina"]);
  assert.deepEqual(S.yearOptions(all), Array.from({ length: 14 }, (_, i) => 2009 + i));
  assert.deepEqual(S.yearOptions([]), []);
  // A ordem: «Mais recentes» por defeito, como na maqueta.
  assert.equal(S.DEFAULT_SORT, "year-desc");
  assert.deepEqual(S.SORT_OPTIONS.map((o) => o.label), ["Mais recentes", "Preço mais baixo", "Preço mais alto", "Menos quilómetros"]);
  assert.deepEqual(S.applyCore2(all, S.emptyCore2(), "price-asc").map((v) => v.slug), ["pcx", "tenere", "yfz", "gs", "bmw-320"]);
});

test("Core2 stock: everything goes to the address and back; old links and the menu links open filtered", () => {
  const S = loader()("src/themes/core2/stock.ts");
  const U = loader()("src/themes/core2/ui.ts");
  const all = stockFixture();
  const kinds = S.kindsFor(["car", "motorcycle"], all);
  const read = (qs, k = kinds) => S.core2FromQuery(Object.fromEntries(new URLSearchParams(qs)), k);
  const roundTrip = (f, sort = S.DEFAULT_SORT) => {
    const qs = S.core2ToQuery(f, sort, kinds);
    return { qs, back: read(qs) };
  };
  // Ao abrir: nada escolhido, «Mais recentes» (também com a «Relevância» do Core no endereço).
  assert.deepEqual(read("").filters, S.emptyCore2());
  assert.equal(read("").sort, "year-desc");
  assert.equal(read("ordem=relevance").sort, "year-desc");
  assert.equal(S.core2ToQuery(S.emptyCore2(), "year-desc", kinds), "", "a ordem por defeito não vai para o endereço");
  // Ida e volta.
  const f = { ...S.emptyCore2(), kinds: ["motas"], makes: ["BMW", "Honda"], bodies: ["Trail"], cc: ["1200"], base: { ...S.emptyCore2().base, maxPrice: 15000, minYear: 2010, maxYear: 2025, maxMileage: 50000 } };
  const { qs, back } = roundTrip(f, "price-asc");
  assert.equal(qs, "tipo=motas&moto4=0&marca=BMW%2CHonda&categoria=Trail&cc=1200&preco_max=15000&ano_min=2010&ano_max=2025&km_max=50000&ordem=price-asc");
  assert.deepEqual(back.filters, f);
  assert.equal(back.sort, "price-asc");
  for (const k of [["moto4"], ["carros"], ["motas", "moto4"], ["moto4", "carros"], ["motas", "carros"]])
    assert.deepEqual(roundTrip({ ...S.emptyCore2(), kinds: k }).back.filters.kinds, k, k.join("+"));
  // As três caixas é o mesmo que nenhuma (não vai para o endereço).
  assert.equal(S.core2ToQuery({ ...S.emptyCore2(), kinds: ["motas", "moto4", "carros"] }, "year-desc", kinds), "");
  // Os links do menu e da página inicial do Core2.
  const link = (href) => read(href.split("?")[1]).filters.kinds;
  assert.deepEqual([link(U.STOCK_LINKS.motas), link(U.STOCK_LINKS.moto4), link(U.STOCK_LINKS.carros)], [["motas"], ["moto4"], ["carros"]]);
  // Links antigos: ?tipo=motas são todas as motas (como no Core e nas páginas de SEO).
  assert.deepEqual(read("tipo=motas&marca=Yamaha&preco_max=8000").filters.kinds, ["motas", "moto4"]);
  assert.deepEqual(read("tipo=motas&marca=Yamaha&preco_max=8000").filters.makes, ["Yamaha"]);
  assert.equal(read("tipo=motas&marca=Yamaha&preco_max=8000").filters.base.maxPrice, 8000);
  assert.deepEqual(read("tipo=camioes").filters.kinds, []);
  // A Moto 4 da página inicial do Core (?tipo=motas&categoria=Moto 4): o tipo Moto 4, sem a categoria repetida.
  const quad = read(`tipo=motas&categoria=${encodeURIComponent("Moto 4")}`).filters;
  assert.deepEqual([quad.kinds, quad.bodies], [["moto4"], []]);
  // A marca com a grafia do catálogo; os parâmetros antigos (make=) também.
  assert.deepEqual(read("marca=bmw").filters.makes, ["BMW"]);
  assert.deepEqual(read("make=Honda&fuel=Diesel").filters.makes, ["Honda"]);
  assert.equal(read("make=Honda&fuel=Diesel").filters.base.fuel, "Diesel");
  // O local e os campos do OLX não têm caixa aqui: não filtram às escondidas.
  const hidden = read("local=abc&olx_cor=preto").filters.base;
  assert.deepEqual([hidden.location, hidden.olx], [null, {}]);
  assert.deepEqual(read("cc=999,125,801").filters.cc, ["125"]);
  // Num site de um só tipo, o tipo nunca filtra nem vai para o endereço.
  assert.deepEqual(read("tipo=motas", []).filters.kinds, []);
  assert.equal(S.core2ToQuery({ ...S.emptyCore2(), kinds: ["carros"] }, "year-desc", []), "");
  // O 1.º valor de um parâmetro repetido, como no servidor.
  assert.deepEqual(S.firstValues(new URLSearchParams("marca=BMW&marca=Honda")), { marca: "BMW" });
});

test("Core2 stock: active filters as tags with «×», and the card's data line, with dots as in the mockups", () => {
  const S = loader()("src/themes/core2/stock.ts");
  const f = { ...S.emptyCore2(), kinds: ["moto4"], makes: ["Yamaha"], bodies: ["Trail"], cc: ["450"], base: { ...S.emptyCore2().base, maxPrice: 15000, maxMileage: 50000, minYear: 2010, query: "ténéré", warrantyOnly: true } };
  const chips = S.activeChips(f);
  assert.deepEqual(chips.map((c) => c.label), ["Moto 4", "Yamaha", "Trail", "«ténéré»", "Até 15.000 €", "Desde 2010", "Até 50.000 km", "450 cc", "Com garantia"]);
  assert.deepEqual(S.activeChips(S.emptyCore2()), []);
  // Cada «×» tira só o seu filtro.
  let left = f;
  for (const chip of chips) {
    const next = S.withoutChip(left, chip.key);
    assert.equal(S.activeChips(next).length, S.activeChips(left).length - 1, chip.key);
    left = next;
  }
  assert.deepEqual(left, S.emptyCore2());
  // A linha de dados: km • cc • categoria • frase do anúncio (sem frase, a potência); nos carros km • combustível • caixa.
  const [car, gs, , yfz] = stockFixture();
  const line = (v) => S.cardFacts(v).join(" • ");
  assert.equal(line(yfz), "4.000 km • 450 cc • Moto 4 • Excelente estado");
  assert.equal(line(gs), "59.400 km • 1.170 cc • Trail • 125 cv");
  assert.equal(line(car), "10.000 km • Diesel • Automática • 190 cv");
  assert.equal(line({ ...gs, power: 0 }), "59.400 km • 1.170 cc • Trail");
});

test("Core2 texts and links: numbers with dots, the call notice, the menu, the category cards and the hero", () => {
  const U = loader()("src/themes/core2/ui.ts");
  assert.deepEqual([0, 950, 1301, 12900, 1234567].map(U.dots), ["0", "950", "1.301", "12.900", "1.234.567"]);
  assert.equal(U.euros(9950), "9.950 €");
  assert.equal(U.priceText({ price: 12900 }), "12.900 €");
  assert.equal(U.priceText({ price: 0 }), "Sob consulta");
  assert.equal(U.priceText({ price: 5000, priceOnRequest: true }), "Sob consulta");
  // O aviso do custo da chamada, junto ao número.
  assert.equal(U.callNotice("+351 253 000 000"), "(chamada para rede fixa nacional)");
  assert.equal(U.callNotice("916 100 742"), "(chamada para rede móvel nacional)");
  assert.equal(U.callNotice("00351 912 345 678"), "(chamada para rede móvel nacional)");
  assert.equal(U.callNotice("+34 600 000 000"), null);
  assert.equal(U.callNotice("800 200 200"), null);
  // O menu: Motas · Moto 4 · Carros · Vender · Contactos (só os tipos que o site vende).
  const labels = (list) => list.map((l) => l.label);
  assert.deepEqual(labels(U.navLinks(["car", "motorcycle"], true)), ["Motas", "Moto 4", "Carros", "Vender", "Contactos"]);
  assert.deepEqual(U.navLinks(["car", "motorcycle"], true).map((l) => l.href), [U.STOCK_LINKS.motas, U.STOCK_LINKS.moto4, U.STOCK_LINKS.carros, "/vender", "/contactos"]);
  assert.deepEqual(labels(U.navLinks(["motorcycle"], false)), ["Motas", "Vender", "Contactos"]);
  assert.deepEqual(labels(U.navLinks(["car"], false)), ["Carros", "Vender", "Contactos"]);
  // Os cartões das categorias: «Automóveis» no computador, «Carros» no telemóvel.
  assert.deepEqual(U.categoryCards(["car", "motorcycle"], true).map((c) => [c.label, c.short, c.photo]), [
    ["Motas", "Motas", "/media/core2/motas.jpg"],
    ["Moto 4", "Moto 4", "/media/core2/moto4.jpg"],
    ["Automóveis", "Carros", "/media/core2/carros.jpg"],
  ]);
  // O topo: o texto da maqueta (a frase segue o que o site vende).
  assert.deepEqual(U.heroTexts(["car", "motorcycle"], true), {
    title: "A sua próxima aventura começa aqui.",
    subtitle: "Motas, moto 4 e automóveis selecionados, com qualidade, confiança e o acompanhamento de uma equipa especializada.",
  });
  assert.match(U.heroTexts(["motorcycle"], true).subtitle, /^Motas e moto 4 selecionadas, /);
  assert.match(U.heroTexts(["car"], false).subtitle, /^Automóveis selecionados, /);
  // Últimas entradas: as que entraram há menos tempo; duas linhas de dados.
  assert.deepEqual(U.latestFirst(stockFixture()).map((v) => v.slug), ["yfz", "pcx", "bmw-320", "tenere", "gs"]);
  const [car, , , yfz] = stockFixture();
  assert.deepEqual(U.latestLines(yfz), ["Moto 4 • 450 cc", "4.000 km • Excelente estado"]);
  assert.deepEqual(U.latestLines(car), ["Berlina • Diesel", "10.000 km • Automática"]);
  // Redes sociais: o Facebook sai do link do Messenger das Definições.
  assert.deepEqual(U.socialLinks({ company: { messenger: "https://m.me/supermotas" } }), [{ network: "facebook", href: "https://www.facebook.com/supermotas", label: "Facebook" }]);
  assert.deepEqual(U.socialLinks({ company: { messenger: "" } }), []);
  assert.deepEqual(U.socialLinks({ company: { messenger: "https://example.com/x" } }), []);
});

test("Core2 menu and footer: logo, Motas · Moto 4 · Carros · Vender · Contactos, «Ver stock»; address, phone with notice, e-mail, social", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const U = loader()("src/themes/core2/ui.ts");
  const branding = {
    companyName: "Supermotas",
    logoUrl: "https://cdn.example/logo.png",
    company: {
      phone: "+351 253 000 000",
      phoneHref: "tel:+351253000000",
      email: "geral@supermotas.pt",
      messenger: "https://m.me/supermotas",
      address: { street: "Rua Principal, nº 123", postalCode: "4750-000", city: "Barcelos", country: "Portugal" },
    },
  };
  const { Core2Header } = loader(nextMocks(React, { "next/navigation": { usePathname: () => "/vender" } }))("src/components/themes/core2/Core2Header.tsx");
  const header = renderToStaticMarkup(React.createElement(Core2Header, { branding, links: U.navLinks(["car", "motorcycle"], true) }));
  assert.match(header, /<img src="https:\/\/cdn\.example\/logo\.png" alt="Supermotas"/);
  assert.deepEqual([...header.matchAll(/<li><a href="[^"]*"[^>]*>([^<]+)<\/a><\/li>/g)].map((m) => m[1]), ["Motas", "Moto 4", "Carros", "Vender", "Contactos"]);
  assert.match(header, /href="\/inventario\?tipo=motas&amp;moto4=0"/);
  assert.match(header, /href="\/vender" aria-current="page"/);
  assert.match(header, /<a href="\/inventario"[^>]*bg-accent[^>]*>.*Ver stock<\/a>/);
  assert.match(header, /aria-expanded="false" aria-controls="core2-menu" aria-label="Abrir menu" class="[^"]*lg:hidden"/);
  assert.match(header, /bg-white/);
  // Sem logótipo nas Definições: o nome.
  assert.match(renderToStaticMarkup(React.createElement(Core2Header, { branding: { ...branding, logoUrl: null }, links: [] })), />Supermotas</);

  const { Core2Footer } = loader(nextMocks(React, { "@/components/site/ManageCookiesButton": { ManageCookiesButton: () => React.createElement("button", null, "Gerir cookies") } }))("src/components/themes/core2/Core2Footer.tsx");
  const footer = renderToStaticMarkup(React.createElement(Core2Footer, { branding, placeName: "Penafiel / Cabeça Santa" }));
  for (const text of [">Morada<", "Rua Principal, nº 123", "4750-000 Barcelos, Portugal", ">Telefone<", "+351 253 000 000", "(chamada para rede fixa nacional)", ">E-mail<", "geral@supermotas.pt", ">Siga-nos<", "Penafiel / Cabeça Santa"])
    assert.ok(footer.includes(text), text);
  assert.match(footer, /href="https:\/\/www\.facebook\.com\/supermotas"/);
  assert.match(footer, /href="tel:\+351253000000"/);
  assert.match(footer, /href="mailto:geral@supermotas\.pt"/);
  // O Livro de Reclamações é obrigatório: fica numa linha pequena por baixo.
  assert.match(footer, /href="https:\/\/www\.livroreclamacoes\.pt\/Inicio\/"/);
  // Sem redes nas Definições, não há «Siga-nos».
  const plain = renderToStaticMarkup(React.createElement(Core2Footer, { branding: { ...branding, company: { ...branding.company, messenger: "" } } }));
  assert.doesNotMatch(plain, /Siga-nos/);
  assert.match(plain, />Morada</, "sem nome do ponto de venda, «Morada»");
});

test("Core2 home page: hero, category cards, latest entries from the stock and the benefits strip", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const U = loader()("src/themes/core2/ui.ts");
  const { Core2Home } = loader(nextMocks(React))("src/components/themes/core2/Core2Home.tsx");
  const render = (props) => flat(renderToStaticMarkup(React.createElement(Core2Home, props)));
  const html = render({ vehicles: withPhotos(stockFixture()), siteTypes: ["car", "motorcycle"] });
  // O topo: título, traço, frase, os dois botões e a foto da loja.
  assert.match(html, /<h1[^>]*core2-serif[^>]*>A sua próxima aventura começa aqui\.<\/h1>/);
  assert.ok(html.includes("Motas, moto 4 e automóveis selecionados, com qualidade, confiança e o acompanhamento de uma equipa especializada."));
  assert.match(html, /src="\/media\/core2\/inicio\.jpg"/);
  assert.match(html, /href="\/inventario\?tipo=motas&amp;moto4=0"[^>]*>Ver motas/);
  assert.match(html, /href="\/inventario\?tipo=carros"[^>]*>Ver carros/);
  // As categorias: Motas, Moto 4 e Automóveis (no telemóvel «Carros»), cada uma com a sua foto e o seu link.
  for (const [href, photo] of [[U.STOCK_LINKS.motas, "motas"], [U.STOCK_LINKS.moto4, "moto4"], [U.STOCK_LINKS.carros, "carros"]]) {
    assert.ok(html.includes(`href="${href.replace("&", "&amp;")}"`), href);
    assert.ok(html.includes(`src="/media/core2/${photo}.jpg"`), photo);
  }
  assert.match(html, /<span class="md:hidden">Carros<\/span><span class="hidden md:inline">Automóveis<\/span>/);
  // Últimas entradas: os separadores, «Ver todo o stock» e as 3 mais recentes, com os dados do backoffice.
  assert.match(html, /<h2[^>]*>Últimas entradas<\/h2>/);
  assert.deepEqual([...html.matchAll(/aria-pressed="(?:true|false)"[^>]*>([^<]+)</g)].map((m) => m[1]), ["Todos", "Motas", "Moto 4", "Automóveis"]);
  assert.match(html, /href="\/inventario"[^>]*>Ver todo o stock/);
  assert.deepEqual([...html.matchAll(/href="\/viaturas\/([^"]+)"/g)].map((m) => m[1]), ["yfz", "pcx", "bmw-320"]);
  assert.match(html, /Moto 4 • 450 cc<br\/>4\.000 km • Excelente estado/);
  assert.match(html, /core2-serif[^"]*text-accent[^"]*">9\.950 €</);
  // As vantagens.
  for (const t of ["Aceitamos retomas", "Entregas nacionais", "Opções de pagamento"]) assert.ok(html.includes(`>${t}<`), t);
  // Site só de motas, sem Moto 4: só o cartão das Motas, sem «Ver carros», e a frase certa.
  const motos = render({ vehicles: withPhotos(stockFixture().filter((v) => v.vehicleType === "motorcycle" && v.body !== "Moto 4")), siteTypes: ["motorcycle"] });
  assert.doesNotMatch(motos, /Ver carros|moto4\.jpg|carros\.jpg/);
  assert.ok(motos.includes("Motas selecionadas, com qualidade"));
  assert.doesNotMatch(motos, /aria-pressed/, "sem tipos à escolha, sem separadores");
});

test("Core2 stock page: filter column, active filters bar and cards exactly as in the mockup, with the stock's own data", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const render = (qs, props) => {
    const { Core2Stock } = loader(nextMocks(React, {
      "next/navigation": { useSearchParams: () => new URLSearchParams(qs), useRouter: () => ({ prefetch() {} }) },
    }))("src/components/themes/core2/Core2Stock.tsx");
    return flat(renderToStaticMarkup(React.createElement(Core2Stock, props)));
  };
  const all = withPhotos(stockFixture());
  const both = { vehicles: all, siteTypes: ["car", "motorcycle"] };

  // Com filtros no endereço (?tipo=motas&moto4=0&marca=BMW): só a BMW GS.
  const html = render("tipo=motas&moto4=0&marca=BMW&ordem=price-asc", both);
  // A coluna: «Filtros», quantos resultados, as secções, «Ordenar por» e os dois botões.
  assert.match(html, /<h2[^>]*core2-serif[^>]*>.*Filtros<\/h2>/);
  assert.match(html, /1 resultado</);
  const sections = [...html.matchAll(/aria-expanded="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(sections, ["Tipo", "Marca", "Categoria", "Preço máximo", "Ano", "Quilómetros", "Cilindrada"]);
  assert.match(html, />Ordenar por</);
  assert.match(html, /Aplicar filtros/);
  assert.match(html, /Limpar</);
  assert.match(html, />0 €<\/span><span>50\.000 €\+</);
  assert.match(html, />0 km<\/span><span>100\.000 km\+</);
  for (const cc of ["125 cc", "450 cc", "800 cc", "1200 cc+"]) assert.ok(html.includes(`<span class="min-w-0 break-words">${cc}</span>`), cc);
  assert.match(html, /title="Mais de 1\.000 cc"/);
  assert.equal((html.match(/checked=""/g) ?? []).length, 2, "Motas e BMW escolhidas");
  // Em cima: «Filtros activos» com «×», quantos veículos e a ordem («Mais recentes» primeiro).
  assert.match(html, /Filtros activos:/);
  assert.match(html, /aria-label="Tirar o filtro Motas"/);
  assert.match(html, /aria-label="Tirar o filtro BMW"/);
  assert.match(html, />1 veículo encontrado</);
  assert.match(html, /Ordenar por:/);
  assert.match(html, /<option value="year-desc">Mais recentes<\/option><option value="price-asc" selected="">Preço mais baixo<\/option>/);
  assert.doesNotMatch(html, /Relevância/);
  // O cartão: foto, nome, ano numa pastilha, a linha de dados, o preço com ponto e «Ver detalhes» para a ficha.
  assert.equal((html.match(/href="\/viaturas\//g) ?? []).length, 1);
  assert.match(html, /href="\/viaturas\/gs"/);
  assert.match(html, /src="https:\/\/cdn\.example\/gs\.jpg"/);
  assert.match(html, /<h3[^>]*>BMW X<\/h3><span[^>]*>2015<\/span>/);
  assert.match(html, /59\.400 km • 1\.170 cc • Trail • 125 cv/);
  assert.match(html, /core2-serif[^"]*text-accent">11\.900 €</);
  assert.match(html, /Ver detalhes/);
  // Grelha de 3 colunas no computador, 2 no meio e 1 no telemóvel; a coluna dos filtros num botão no telemóvel.
  assert.match(html, /grid gap-5 sm:grid-cols-2 min-\[1380px\]:grid-cols-3/);
  assert.match(html, /<aside aria-label="Filtros" class="hidden lg:block">/);
  assert.match(html, /aria-haspopup="dialog"[^>]*lg:hidden/);
  // Fundo branco e nada por baixo da grelha (sem alerta nem pesquisas populares).
  assert.match(html, /class="core2-stock bg-white/);
  assert.doesNotMatch(html, /id="alerta"|Pesquisas populares/);

  // Sem filtros: tudo, por «Mais recentes» (o ano mais recente primeiro), sem «Filtros activos».
  const open = render("", both);
  assert.match(open, />5 veículos encontrados</);
  assert.doesNotMatch(open, /Filtros activos/);
  assert.match(open, /<option value="year-desc" selected="">Mais recentes<\/option>/);
  assert.deepEqual([...open.matchAll(/href="\/viaturas\/([^"]+)"/g)].map((m) => m[1]), ["pcx", "tenere", "bmw-320", "gs", "yfz"]);
  assert.match(open, /4\.000 km • 450 cc • Moto 4 • Excelente estado/);

  // Nada encontrado: limpar.
  assert.match(render("preco_max=1000", both), /Nenhuma viatura corresponde aos filtros[\s\S]*Limpar filtros/);

  // Site só de carros: sem Tipo nem Cilindrada, e «Carroçaria».
  const cars = render("", { vehicles: all.filter((v) => v.vehicleType === "car"), siteTypes: ["car"] });
  const carSections = [...cars.matchAll(/aria-expanded="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(carSections, ["Marca", "Carroçaria", "Preço máximo", "Ano", "Quilómetros"]);
});

test("the pages use the Core2 versions only with the Core2 theme; with Core everything stays as it was", async () => {
  const all = stockFixture().map((v) => ({ ...v, description: "Texto longo", extras: ["ABS"] }));
  let theme = "core2";
  // Stock.
  const Core2Stock = () => null;
  const InventoryClient = () => null;
  const SeoLinks = () => null;
  const stockPage = loader({
    "@/lib/vehicle-context": { getPublicVehicleType: async () => "motorcycle", getSiteVehicleTypes: async () => ["car", "motorcycle"] },
    "@/lib/queries": { getBranding: async () => ({ companyName: "Stand" }), getVehicles: async () => all },
    "@/lib/olx/search": { inventoryWithOlx: async (vehicles) => ({ vehicles, fields: [] }) },
    "@/lib/site-theme-query": { getSiteTheme: async () => theme },
    "@/components/themes/core2/Core2Stock": { Core2Stock },
    "@/components/inventory/InventoryClient": { InventoryClient },
    "@/components/seo/SeoLinks": { SeoLinks },
    "next/image": { __esModule: true, default: () => null },
  })("src/app/(public)/inventario/page.tsx");
  const el = await stockPage.default({ searchParams: Promise.resolve({ tipo: "motas" }) });
  assert.equal(el.type, Core2Stock);
  assert.equal(el.key, JSON.stringify({ tipo: "motas" }), "outra pesquisa no endereço começa de novo");
  assert.deepEqual(el.props.siteTypes, ["car", "motorcycle"]);
  assert.deepEqual(el.props.vehicles.map((v) => v.slug), all.map((v) => v.slug));
  assert.ok(el.props.vehicles.every((v) => v.description === "" && v.extras === undefined), "a versão leve, como no Core");
  assert.equal(el.props.vehicles.find((v) => v.slug === "yfz").tagline, "Excelente estado", "com a frase curta do anúncio");
  assert.equal(el.props.below, undefined, "nada por baixo da grelha");
  theme = "core";
  const core = await stockPage.default({ searchParams: Promise.resolve({}) });
  assert.equal(core.type, "div");
  assert.ok([core.props.children].flat(3).some((x) => x?.type === InventoryClient), "o Core continua com o stock de sempre");
  assert.ok([core.props.children].flat(3).some((x) => x?.type === SeoLinks), "e com as pesquisas populares");

  // Página inicial: os componentes do Core são substituídos por nada (só interessa qual página sai).
  theme = "core2";
  const homeFile = "src/app/(public)/(home)/page.tsx";
  const Core2Home = () => null;
  const stubs = Object.fromEntries(
    [...readFileSync(homeFile, "utf8").matchAll(/from "(@\/components\/[^"]+)"/g)].map((m) => [m[1], new Proxy({}, { get: (_, k) => (k === "__esModule" ? false : () => null) })]),
  );
  const home = loader({
    ...stubs,
    "@/components/themes/core2/Core2Home": { Core2Home },
    "@/lib/vehicle-context": { getPublicVehicleType: async () => "motorcycle", getSiteVehicleTypes: async () => ["car", "motorcycle"] },
    "@/lib/site-theme-query": { getSiteTheme: async () => theme },
    "@/lib/showroom-queries": { getShowroomContent: async () => ({ services: [], faqs: [], locations: [], google: {} }) },
    "@/lib/queries": { getVehicles: async () => all, getVehicleList: async () => all, getHomeContent: async () => { throw new Error("o Core2 não lê o conteúdo do Core"); } },
  })(homeFile);
  const page = await home.default();
  assert.equal(page.type, Core2Home);
  assert.deepEqual(page.props.siteTypes, ["car", "motorcycle"]);
  assert.ok(page.props.vehicles.every((v) => v.description === ""));
  assert.equal(page.props.vehicles.find((v) => v.slug === "yfz").tagline, "Excelente estado");
  assert.match(readFileSync(homeFile, "utf8"), /getTheme\(theme\)\.homeSections\.map/, "o Core continua com as secções do tema");

  // Menu, rodapé e letra: os do Core2 só com o Core2; o grão é só do Core.
  const layout = readFileSync("src/app/(public)/layout.tsx", "utf8");
  assert.match(layout, /core2 \? \(\s*<Core2Header /);
  assert.match(layout, /<Header branding=\{branding\} stockSlugs=\{stockSlugs\} \/>/);
  assert.match(layout, /core2 \? \(\s*<Core2Footer /);
  assert.match(layout, /<Footer branding=\{branding\}/);
  assert.match(layout, /core2 \? ` \$\{core2Serif\.variable\}` : ""/);
  assert.match(layout, /\{!core2 && <GrainOverlay \/>\}/);

  // Os componentes do Core2 só se usam nestas três páginas.
  const users = (name) => execFileSync("git", ["grep", "-l", "--untracked", "-F", `from "@/components/themes/core2/${name}"`, "--", "src"], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(users("Core2Stock"), ["src/app/(public)/inventario/page.tsx"]);
  assert.deepEqual(users("Core2Home"), ["src/app/(public)/(home)/page.tsx"]);
  assert.deepEqual(users("Core2Header"), ["src/app/(public)/layout.tsx"]);
  assert.deepEqual(users("Core2Footer"), ["src/app/(public)/layout.tsx"]);
});

test("Core2 is light like the mockups (variables, white films turned dark, serif) and the photos come with the theme", () => {
  const css = readFileSync("src/themes/core2.css", "utf8");
  assert.match(css, /\[data-site-theme="core2"\] \{[^}]*color-scheme: light;[^}]*--ink: 255 255 255;[^}]*--paper: 26 26 26;/);
  assert.match(css, /html:has\(\[data-site-theme="core2"\]\) body \{[^}]*background-color: #ffffff;/);
  assert.match(css, /\[data-site-theme="core2"\] \.border-white\\\/10 \{ border-color: rgb\(0 0 0/);
  assert.match(css, /\[data-site-theme="core2"\] \.core2-serif \{[^}]*var\(--font-core2-serif\)/);
  assert.match(readFileSync("src/themes/core2/fonts.ts", "utf8"), /DM_Serif_Display\([\s\S]*preload: false[\s\S]*--font-core2-serif/);
  for (const name of ["inicio", "motas", "moto4", "carros"]) {
    const jpg = readFileSync(`public/media/core2/${name}.jpg`);
    assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff], `${name}.jpg é um JPEG`);
  }
});
