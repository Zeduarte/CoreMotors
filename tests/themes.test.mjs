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
    assert.match(rule, /^\[data-site-theme="core2"\]/, `regra fora do tema: ${rule.slice(0, 60)}`);
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

// ---- Core2: página do Stock ----------------------------------------------------

const stockVehicle = (slug, make, type, body, extra = {}) => ({ slug, make, model: "X", year: 2020, mileage: 10000, price: 10000, fuel: "Gasolina", transmission: "Manual", body, power: 0, displacement: 0, color: "Preto", doors: 0, seats: 0, featured: false, tagline: "", description: "", images: [], highlights: [], vehicleType: type, ...extra });
const stockFixture = () => [
  stockVehicle("bmw-320", "BMW", "car", "Berlina", { fuel: "Diesel", transmission: "Automática", displacement: 1995, power: 190, year: 2018, price: 21000 }),
  stockVehicle("gs", "BMW", "motorcycle", "Trail", { displacement: 1170, power: 125, year: 2015, mileage: 59400, price: 11900 }),
  stockVehicle("pcx", "Honda", "motorcycle", "Scooter", { displacement: 125, year: 2022, mileage: 3000, price: 3500 }),
  stockVehicle("yfz", "Yamaha", "motorcycle", "Moto 4", { displacement: 450, year: 2009, mileage: 4000, price: 9950 }),
  stockVehicle("tenere", "yamaha", "motorcycle", "Trail", { displacement: 689, year: 2020, mileage: 17800, price: 9900 }),
];

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
  // Marcas (sem olhar a maiúsculas), categorias e cilindrada (só motas, intervalos sem buracos).
  assert.deepEqual(run({ makes: ["Yamaha"] }), ["tenere", "yfz"]);
  assert.deepEqual(run({ makes: ["BMW", "Honda"] }), ["bmw-320", "gs", "pcx"]);
  assert.deepEqual(run({ bodies: ["Trail"] }), ["gs", "tenere"]);
  assert.deepEqual(run({ cc: ["125"] }), ["pcx"]);
  assert.deepEqual(run({ cc: ["450", "800"] }), ["tenere", "yfz"]);
  assert.deepEqual(run({ cc: ["801"] }), ["gs"], "o carro de 1995 cc não é uma mota de mais de 800 cc");
  for (const cc of [125, 126, 450, 451, 800, 801, 1300]) assert.equal(S.CC_BUCKETS.filter((b) => S.inBucket(cc, b.id)).length, 1, `${cc} cc num só intervalo`);
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
  assert.deepEqual(S.applyCore2(all, S.emptyCore2(), "price-asc").map((v) => v.slug), ["pcx", "tenere", "yfz", "gs", "bmw-320"]);
});

test("Core2 stock: everything goes to the address and back; old links still open filtered", () => {
  const S = loader()("src/themes/core2/stock.ts");
  const all = stockFixture();
  const kinds = S.kindsFor(["car", "motorcycle"], all);
  const read = (qs, k = kinds) => S.core2FromQuery(Object.fromEntries(new URLSearchParams(qs)), k);
  const roundTrip = (f, sort = "relevance") => {
    const qs = S.core2ToQuery(f, sort, kinds);
    const back = read(qs);
    return { qs, back };
  };
  // Ao abrir: nada escolhido.
  assert.deepEqual(read("").filters, S.emptyCore2());
  assert.equal(read("").sort, "relevance");
  // Ida e volta.
  const f = { ...S.emptyCore2(), kinds: ["motas"], makes: ["BMW", "Honda"], bodies: ["Trail"], cc: ["801"], base: { ...S.emptyCore2().base, maxPrice: 15000, minYear: 2010, maxYear: 2025, maxMileage: 50000 } };
  const { qs, back } = roundTrip(f, "price-asc");
  assert.equal(qs, "tipo=motas&moto4=0&marca=BMW%2CHonda&categoria=Trail&cc=801&preco_max=15000&ano_min=2010&ano_max=2025&km_max=50000&ordem=price-asc");
  assert.deepEqual(back.filters, f);
  assert.equal(back.sort, "price-asc");
  for (const k of [["moto4"], ["carros"], ["motas", "moto4"], ["moto4", "carros"], ["motas", "carros"]])
    assert.deepEqual(roundTrip({ ...S.emptyCore2(), kinds: k }).back.filters.kinds, k, k.join("+"));
  // As três caixas é o mesmo que nenhuma (não vai para o endereço).
  assert.equal(S.core2ToQuery({ ...S.emptyCore2(), kinds: ["motas", "moto4", "carros"] }, "relevance", kinds), "");
  // Links antigos: ?tipo=motas são todas as motas (como no Core e nas páginas de SEO).
  assert.deepEqual(read("tipo=motas&marca=Yamaha&preco_max=8000").filters.kinds, ["motas", "moto4"]);
  assert.deepEqual(read("tipo=motas&marca=Yamaha&preco_max=8000").filters.makes, ["Yamaha"]);
  assert.equal(read("tipo=motas&marca=Yamaha&preco_max=8000").filters.base.maxPrice, 8000);
  assert.deepEqual(read("tipo=carros").filters.kinds, ["carros"]);
  assert.deepEqual(read("tipo=camioes").filters.kinds, []);
  // A Moto 4 da página inicial (?tipo=motas&categoria=Moto 4): o tipo Moto 4, sem a categoria repetida.
  const quad = read(`tipo=motas&categoria=${encodeURIComponent("Moto 4")}`).filters;
  assert.deepEqual([quad.kinds, quad.bodies], [["moto4"], []]);
  // A marca com a grafia do catálogo; os parâmetros antigos (make=) também.
  assert.deepEqual(read("marca=bmw").filters.makes, ["BMW"]);
  assert.deepEqual(read("make=Honda&fuel=Diesel").filters.makes, ["Honda"]);
  assert.equal(read("make=Honda&fuel=Diesel").filters.base.fuel, "Diesel");
  // O local e os campos do OLX não têm caixa aqui: não filtram às escondidas.
  const hidden = read("local=abc&olx_cor=preto").filters.base;
  assert.deepEqual([hidden.location, hidden.olx], [null, {}]);
  assert.deepEqual(read("cc=999,125").filters.cc, ["125"]);
  // Num site de um só tipo, o tipo nunca filtra nem vai para o endereço.
  assert.deepEqual(read("tipo=motas", []).filters.kinds, []);
  assert.equal(S.core2ToQuery({ ...S.emptyCore2(), kinds: ["carros"] }, "relevance", []), "");
  // O 1.º valor de um parâmetro repetido, como no servidor.
  assert.deepEqual(S.firstValues(new URLSearchParams("marca=BMW&marca=Honda")), { marca: "BMW" });
});

test("Core2 stock: active filters as tags with «×», and the card's data line", () => {
  const S = loader()("src/themes/core2/stock.ts");
  const f = { ...S.emptyCore2(), kinds: ["moto4"], makes: ["Yamaha"], bodies: ["Trail"], cc: ["450"], base: { ...S.emptyCore2().base, maxPrice: 15000, maxMileage: 50000, minYear: 2010, query: "ténéré", warrantyOnly: true } };
  const chips = S.activeChips(f);
  const label = (s) => s.replace(/\s/g, " ");
  assert.deepEqual(chips.map((c) => label(c.label)), ["Moto 4", "Yamaha", "Trail", "«ténéré»", "Até 15 000 €", "Desde 2010", "Até 50 000 km", "126 a 450 cc", "Com garantia"]);
  assert.deepEqual(S.activeChips(S.emptyCore2()), []);
  // Cada «×» tira só o seu filtro.
  let left = f;
  for (const chip of chips) {
    const next = S.withoutChip(left, chip.key);
    assert.equal(S.activeChips(next).length, S.activeChips(left).length - 1, chip.key);
    left = next;
  }
  assert.deepEqual(left, S.emptyCore2());
  // A linha de dados: km • cc • cv • categoria nas motas; km • combustível • caixa • cv nos carros.
  const [car, gs, , yfz] = stockFixture();
  const line = (v) => S.cardFacts(v).join(" • ").replace(/\s/g, " ");
  assert.equal(line(gs), "59 400 km • 1 170 cc • 125 cv • Trail");
  assert.equal(line(yfz), "4 000 km • 450 cc • Moto 4", "sem potência indicada, não aparece");
  assert.equal(line(car), "10 000 km • Diesel • Automática • 190 cv");
});

test("Core2 stock page: filter column, active filters bar and cards, all from the stock's own data", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const h = React.createElement;
  const render = (qs, props) => {
    const { Core2Stock } = loader({
      "next/navigation": { useSearchParams: () => new URLSearchParams(qs), useRouter: () => ({ prefetch() {} }) },
      "next/link": { __esModule: true, default: ({ href, children, prefetch, ...p }) => h("a", { href, ...p }, children) },
      "next/image": { __esModule: true, default: ({ fill, priority, sizes, ...p }) => h("img", p) },
      "next/dynamic": { __esModule: true, default: () => () => null },
    })("src/components/themes/core2/Core2Stock.tsx");
    // Os espaços dos números (pt-PT) passam a espaços normais, para comparar.
    return renderToStaticMarkup(h(Core2Stock, props)).replace(/[  ]/g, " ");
  };
  const all = stockFixture().map((v) => ({ ...v, images: [{ src: `https://cdn.example/${v.slug}.jpg`, alt: "", width: 1, height: 1 }] }));
  const both = { vehicles: all, siteTypes: ["car", "motorcycle"] };

  // Com filtros no endereço (?tipo=motas&moto4=0&marca=BMW): só a BMW GS.
  const html = render("tipo=motas&moto4=0&marca=BMW&ordem=price-asc", both);
  // A coluna: «Filtros», quantos resultados, as secções e os dois botões.
  assert.match(html, /<h2[^>]*>.*Filtros<\/h2>/);
  assert.match(html, /1 resultado</);
  const sections = [...html.matchAll(/aria-expanded="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(sections, ["Tipo", "Marca", "Categoria", "Preço máximo", "Ano", "Quilómetros", "Cilindrada"]);
  assert.match(html, />Ordenar por</);
  assert.match(html, /Aplicar filtros/);
  assert.match(html, /Limpar</);
  assert.match(html, /50 000 €\+/);
  assert.match(html, /100 000 km\+/);
  assert.equal((html.match(/checked=""/g) ?? []).length, 2, "Motas e BMW escolhidas");
  // Em cima: os filtros ativos com «×», quantos veículos e a ordem.
  assert.match(html, /Filtros ativos:/);
  assert.match(html, /aria-label="Tirar o filtro Motas"/);
  assert.match(html, /aria-label="Tirar o filtro BMW"/);
  assert.match(html, /<strong[^>]*>1<\/strong> veículo encontrado/);
  assert.match(html, /Ordenar por:/);
  assert.match(html, /<option value="price-asc" selected="">Preço mais baixo<\/option>/);
  // O cartão: foto, nome, ano numa pastilha, a linha de dados, o preço e «Ver detalhes» para a ficha.
  assert.equal((html.match(/href="\/viaturas\//g) ?? []).length, 1);
  assert.match(html, /href="\/viaturas\/gs"/);
  assert.match(html, /src="https:\/\/cdn\.example\/gs\.jpg"/);
  assert.match(html, /<h3[^>]*>BMW X<\/h3><span[^>]*>2015<\/span>/);
  assert.match(html, /59 400 km • 1 170 cc • 125 cv • Trail/);
  assert.match(html, /text-accent">11 900 €</);
  assert.match(html, /Ver detalhes/);
  // Grelha de 3 colunas no computador, 2 no meio e 1 no telemóvel; a coluna dos filtros num botão no telemóvel.
  assert.match(html, /grid gap-5 sm:grid-cols-2 xl:grid-cols-3/);
  assert.match(html, /<aside aria-label="Filtros" class="hidden lg:block">/);
  assert.match(html, /aria-haspopup="dialog"[^>]*lg:hidden/);
  // Fundo escuro: nada de paleta clara (a tentativa anterior trocava --ink).
  assert.doesNotMatch(html, /bg-white(?!\/)/);
  assert.doesNotMatch(readFileSync("src/themes/core2.css", "utf8"), /--ink:|--paper:|color-scheme: light/);

  // Sem filtros: tudo, por relevância (o ano mais recente primeiro), e «nenhum» filtro ativo.
  const open = render("", both);
  assert.match(open, /<strong[^>]*>5<\/strong> veículos encontrados/);
  assert.match(open, /Filtros ativos:<\/span><span[^>]*>nenhum</);
  assert.deepEqual([...open.matchAll(/href="\/viaturas\/([^"]+)"/g)].map((m) => m[1]), ["pcx", "tenere", "bmw-320", "gs", "yfz"]);
  assert.match(open, /10 000 km • Diesel • Automática • 190 cv/);

  // Nada encontrado: limpar ou deixar um alerta.
  assert.match(render("preco_max=1000", both), /Nenhuma viatura corresponde aos filtros[\s\S]*Limpar filtros[\s\S]*href="#alerta"/);

  // Site só de carros: sem Tipo nem Cilindrada, e «Carroçaria».
  const cars = render("", { vehicles: all.filter((v) => v.vehicleType === "car"), siteTypes: ["car"] });
  const carSections = [...cars.matchAll(/aria-expanded="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(carSections, ["Marca", "Carroçaria", "Preço máximo", "Ano", "Quilómetros"]);
});

test("the stock page shows the Core2 stock only with the Core2 theme; Core, the home page and the vehicle page stay as they were", async () => {
  const all = stockFixture().map((v) => ({ ...v, description: "Texto longo", extras: ["ABS"] }));
  const Core2Stock = () => null;
  const InventoryClient = () => null;
  const SeoLinks = () => null;
  let theme = "core2";
  const page = loader({
    "@/lib/vehicle-context": { getPublicVehicleType: async () => "motorcycle", getSiteVehicleTypes: async () => ["car", "motorcycle"] },
    "@/lib/queries": { getBranding: async () => ({ companyName: "Stand" }), getVehicles: async () => all },
    "@/lib/olx/search": { inventoryWithOlx: async (vehicles) => ({ vehicles, fields: [] }) },
    "@/lib/site-theme-query": { getSiteTheme: async () => theme },
    "@/components/themes/core2/Core2Stock": { Core2Stock },
    "@/components/inventory/InventoryClient": { InventoryClient },
    "@/components/seo/SeoLinks": { SeoLinks },
    "next/image": { __esModule: true, default: () => null },
  })("src/app/(public)/inventario/page.tsx");

  const el = await page.default({ searchParams: Promise.resolve({ tipo: "motas" }) });
  assert.equal(el.type, Core2Stock);
  assert.equal(el.key, JSON.stringify({ tipo: "motas" }), "outra pesquisa no endereço começa de novo");
  assert.deepEqual(el.props.siteTypes, ["car", "motorcycle"]);
  assert.deepEqual(el.props.vehicles.map((v) => v.slug), all.map((v) => v.slug));
  assert.ok(el.props.vehicles.every((v) => v.description === "" && v.extras === undefined), "a versão leve, como no Core");
  assert.deepEqual(el.props.below.map((x) => [x.type, x.props.type]), [[SeoLinks, "car"], [SeoLinks, "motorcycle"]]);

  theme = "core";
  const core = await page.default({ searchParams: Promise.resolve({}) });
  assert.equal(core.type, "div");
  assert.ok([core.props.children].flat(3).some((x) => x?.type === InventoryClient), "o Core continua com o stock de sempre");

  // A página do Core2 só se usa no stock (a página inicial e a ficha não a importam).
  const users = execFileSync("git", ["grep", "-l", "--untracked", "-F", 'from "@/components/themes/core2/Core2Stock"', "--", "src"], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(users, ["src/app/(public)/inventario/page.tsx"]);
});
