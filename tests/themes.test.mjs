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

test("themes: Core, Core2 and Core3, every home section, and the saved theme falls back to Core", () => {
  const T = loader()("src/themes/index.ts");
  assert.deepEqual(Object.keys(T.THEMES), ["core", "core2", "core3"]);
  assert.equal(T.DEFAULT_THEME, "core");
  const sections = ["hero", "segments", "featured", "brands", "stock", "sell", "trust", "sold", "showroom", "testimonials", "contact"];
  // O Core3 troca o topo e os segmentos pelos das maquetes (os destaques ficam).
  const core3Sections = ["c3hero", "c3categories", "c3services", ...sections.filter((s) => !["hero", "segments"].includes(s))];
  for (const id of ["core", "core2", "core3"]) {
    const t = T.getTheme(id);
    assert.equal(t.id, id);
    assert.deepEqual([...t.homeSections].sort(), [...(id === "core3" ? core3Sections : sections)].sort(), `${id}: todas as secções da página inicial`);
    for (const key of ["navHome", "navStock", "navIdeal", "navServices", "navAbout", "navContacts"]) assert.ok(t.texts[key], `${id}: texto ${key}`);
  }
  // O Core2 é uma cópia (mudar um não mexe no outro).
  assert.notEqual(T.getTheme("core2").texts, T.getTheme("core").texts);
  assert.notEqual(T.getTheme("core2").homeSections, T.getTheme("core").homeSections);
  for (const raw of [null, {}, { theme: "outro" }, { theme: 2 }]) assert.equal(T.parseThemeId(raw), "core", JSON.stringify(raw));
  assert.equal(T.parseThemeId({ theme: "core2" }), "core2");
  // A aparência de cada versão: Escuro (o de sempre), Claro ou Automático; o que faltar é Escuro.
  assert.deepEqual(T.SITE_MODES, ["dark", "light", "system"]);
  assert.deepEqual(Object.values(T.SITE_MODE_LABELS), ["Escuro", "Claro", "Automático"]);
  for (const raw of [null, {}, { theme: "core2" }, { modes: { core: "rosa" } }])
    assert.deepEqual(T.parseSiteModes(raw), { core: "dark", core2: "dark", core3: "dark" }, JSON.stringify(raw));
  assert.deepEqual(T.parseSiteModes({ modes: { core: "light", core2: "system" } }), { core: "light", core2: "system", core3: "dark" });
  assert.deepEqual(T.parseSiteAppearance({ theme: "core3", modes: { core: "light", core2: "system", core3: "light" } }), {
    theme: "core3",
    mode: "light",
    modes: { core: "light", core2: "system", core3: "light" },
    layouts: {},
  });
  assert.equal(T.parseSiteAppearance({ theme: "core", modes: { core: "light" } }).mode, "light", "cada versão tem a sua");
  // O CSS do Core2 fica todo debaixo do atributo do tema (o do stock, partilhado com o Core3).
  const css = readFileSync("src/themes/core2.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  for (const rule of css.split("}").map((r) => r.trim()).filter(Boolean))
    assert.match(rule, /^(\[data-site-theme="core2"\]|:is\(\[data-site-theme="core2"\], \[data-site-theme="core3"\]\))/, `regra fora do tema: ${rule.slice(0, 60)}`);
});

test("the public layout marks the theme and the home page follows the theme's section order", () => {
  const layout = readFileSync("src/app/(public)/layout.tsx", "utf8");
  assert.match(layout, /data-site-theme=\{theme\}/);
  assert.match(layout, /<SiteThemeProvider theme=\{theme\}>/);
  assert.match(layout, /import "@\/themes\/core2\.css"/);
  const home = readFileSync("src/app/(public)/(home)/page.tsx", "utf8");
  assert.match(home, /const order = homeSectionsFor\(getTheme\(theme\), layouts\[theme\], content\.showSegments\)/);
  assert.match(home, /\{order\.map\(\(key\)/);
  // Os dados só das secções desligadas nem se pedem.
  assert.match(home, /shown\.has\("sold"\) \? getSoldVehicleList\(10\) : \[\]/);
  assert.match(home, /shown\.has\("testimonials"\) \? getTestimonials\(\) : \[\]/);
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
  // O registo guardado (lido antes de escrever: as listas da página inicial ficam).
  let stored = null;
  const db = {
    from: (t) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: stored && { content: stored }, error: null }) }) }),
      upsert: async (row, opts) => { writes.push([t, row, opts]); stored = row.content; return { error: null }; },
    }),
  };
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
  // Com a aparência de cada versão (só modos conhecidos, todas as versões).
  assert.equal((await saveSiteTheme("core", { core: "light", core2: "system", core3: "dark" })).ok, true);
  assert.deepEqual(writes[1][1], { key: "theme", content: { theme: "core", modes: { core: "light", core2: "system", core3: "dark" } } });
  assert.equal((await saveSiteTheme("core3", { core: "dark", core2: "dark", core3: "system" })).ok, true, "o Core3 é uma versão conhecida");
  assert.match((await saveSiteTheme("core", { core: "rosa", core2: "dark", core3: "dark" })).error, /Escuro, Claro ou Automático/);
  assert.match((await saveSiteTheme("core", { core: "light" })).error, /Escuro, Claro ou Automático/);
  assert.match((await saveSiteTheme("core", null)).error, /Escuro, Claro ou Automático/);
  assert.equal(writes.length, 3);

  // A página inicial de cada tema: limpa e junta ao resto (a versão e as aparências ficam).
  const { saveHomeLayout } = load("src/lib/actions/gestao.ts");
  me = { id: "a", role: "admin", is_owner: false };
  assert.match((await saveHomeLayout("core", [])).error, /acesso core/);
  me = { id: "o", role: "admin", is_owner: true };
  assert.match((await saveHomeLayout("outro", [])).error, /Escolha/);
  assert.match((await saveHomeLayout("core", "x")).error, /inválida/);
  const before = stored;
  assert.equal((await saveHomeLayout("core2", [{ id: "sold", on: true }, { id: "hero", on: false }, { id: "c3hero" }, { id: "sold", on: false }, { id: "brands", on: false }])).ok, true);
  assert.equal(stored.theme, before.theme);
  assert.deepEqual(stored.modes, before.modes);
  const core2 = stored.layouts.core2;
  assert.deepEqual(core2.slice(0, 2), [{ id: "sold", on: true }, { id: "brands", on: false }], "sem o topo fixo, sem secções de outro tema, sem repetidas");
  assert.equal(core2.length, 10, "as que faltam entram no fim");
  // Guardar outro tema e depois a versão não apaga as listas.
  await saveHomeLayout("core3", [{ id: "contact", on: true }]);
  await saveSiteTheme("core3", { core: "dark", core2: "dark", core3: "light" });
  assert.deepEqual(Object.keys(stored.layouts).sort(), ["core2", "core3"]);
  assert.equal(stored.theme, "core3");
});

test("home layout per theme: the fixed top stays, the rest can be hidden and reordered, and odd saves are cleaned", () => {
  const T = loader()("src/themes/index.ts");
  const core = T.getTheme("core");
  const core3 = T.getTheme("core3");
  // Sem nada guardado: a ordem do tema, com «Que segmento procura?» como estava em Página inicial.
  assert.deepEqual(T.homeSectionsFor(core, undefined, false), core.homeSections.filter((s) => s !== "segments"));
  assert.deepEqual(T.homeSectionsFor(core, undefined, true), core.homeSections);
  assert.deepEqual(T.homeSectionsFor(core3, undefined).slice(0, 4), ["c3hero", "c3categories", "featured", "c3services"]);
  // Guardado: o topo fixo no cimo, depois as ligadas pela ordem escolhida.
  const saved = [{ id: "contact", on: true }, { id: "featured", on: false }, { id: "stock", on: true }];
  const order = T.homeSectionsFor(core, saved, false);
  assert.deepEqual(order.slice(0, 3), ["hero", "contact", "stock"]);
  assert.ok(!order.includes("featured"), "desligada não aparece");
  assert.ok(order.includes("brands"), "as que faltam na lista guardada entram ligadas");
  assert.ok(!order.includes("segments"), "e os segmentos como na origem (escondidos)");
  // O topo fixo nunca sai, nem com uma lista estranha.
  for (const raw of [null, "x", [{ id: "hero", on: false }], [{}, { id: 3 }]]) assert.equal(T.homeSectionsFor(core, raw)[0], "hero", JSON.stringify(raw));
  assert.deepEqual(T.homeSectionsFor(core3, [{ id: "c3categories", on: false }]).slice(0, 2), ["c3hero", "c3categories"]);
  // As secções que se escolhem não incluem as fixas; cada uma tem nome e frase.
  for (const t of [core, T.getTheme("core2"), core3])
    for (const id of t.homeSections) assert.ok(T.SECTION_INFO[id]?.label && T.SECTION_INFO[id]?.hint, `${t.id}: ${id}`);
  assert.ok(!T.editableSections(core3).includes("c3hero"));
  // As listas guardadas: só objetos com listas.
  assert.deepEqual(T.parseLayouts({ layouts: { core: [{ id: "sold", on: false }], core2: "x" } }), { core: [{ id: "sold", on: false }] });
  assert.deepEqual(T.parseLayouts(null), {});
  // Gestão mostra a lista; Página inicial já não tem o interruptor dos segmentos.
  assert.match(readFileSync("src/app/admin/(dashboard)/gestao/page.tsx", "utf8"), /<HomeLayoutForm themes=\{layouts\}/);
  assert.doesNotMatch(readFileSync("src/components/admin/HomeContentForm.tsx", "utf8"), /register\("showSegments"\)/);
});

test("Gestão: each version (Core, Core2) has Escuro · Claro · Automático, and saving sends the version and every appearance", async () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { SiteThemeForm } = loader({
    "next/navigation": { useRouter: () => ({ refresh() {} }) },
    sonner: { toast: { success() {}, error() {} } },
    "@/lib/actions/gestao": { saveSiteTheme: async () => ({ ok: true }) },
  })("src/components/admin/SiteThemeForm.tsx");
  const html = renderToStaticMarkup(
    React.createElement(SiteThemeForm, {
      initial: "core2",
      initialModes: { core: "dark", core2: "system" },
      themes: [
        { id: "core", label: "Core", description: "O original." },
        { id: "core2", label: "Core2", description: "Stock das maquetes." },
      ],
    }),
  );
  assert.match(html, /aria-label="Aparência do Core"/);
  assert.match(html, /aria-label="Aparência do Core2"/);
  const groups = html.split('aria-label="Aparência do ').slice(1).map((g) => [...g.matchAll(/aria-pressed="(true|false)"[^>]*>([^<]+)</g)].map((m) => `${m[2]}:${m[1]}`).slice(0, 3));
  assert.deepEqual(groups, [
    ["Escuro:true", "Claro:false", "Automático:false"],
    ["Escuro:false", "Claro:false", "Automático:true"],
  ]);
  assert.match(html, /conforme o sistema do dispositivo/);
  assert.match(html, /<button type="button" disabled="" class="btn-primary">Guardar versão/, "sem mudanças, nada a guardar");
  // A Gestão lê a versão e as aparências guardadas.
  const page = readFileSync("src/app/admin/(dashboard)/gestao/page.tsx", "utf8");
  assert.match(page, /<SiteThemeForm initial=\{current\.theme\} initialModes=\{current\.modes\}/);
});

test("appearance CSS: dark keeps Tailwind's values, light (and Automático with a light system) turns the site white", () => {
  const css = readFileSync("src/themes/modes.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // Tudo fica no site público (nada do backoffice).
  for (const rule of css.replace(/@media[^{]*\{/g, "").split("}").map((r) => r.trim()).filter(Boolean))
    assert.match(rule, /^(?:\.site\b|html:has\(\.site)/, `regra fora do site: ${rule.slice(0, 60)}`);
  // No escuro as películas são brancas, com os valores do Tailwind (nada muda no site de sempre).
  assert.match(css, /\.site \{\s*--site-film: 255 255 255;/);
  assert.match(css, /\.site \.border-white\\\/10 \{ border-color: rgb\(var\(--site-film\) \/ 0\.1\); \}/);
  // O claro: fundo branco, texto escuro, películas pretas; o Automático faz o mesmo com o sistema em claro.
  const block = (sel) => css.match(new RegExp(`${sel.replace(/[[\]().*"=]/g, "\\$&")} \\{([^}]*)\\}`))?.[1].replace(/\s+/g, " ").trim();
  const light = block('.site[data-site-mode="light"]');
  assert.match(light, /--ink: 255 255 255;[\s\S]*--paper: 20 20 22;[\s\S]*--site-film: 0 0 0;[\s\S]*color-scheme: light;/);
  assert.match(css, /@media \(prefers-color-scheme: light\) \{\s*\.site\[data-site-mode="system"\] \{/);
  assert.equal(block('.site[data-site-mode="system"]'), light, "o Automático em claro é igual ao Claro");
  assert.match(css, /html:has\(\.site\[data-site-mode="light"\]\) body \{\s*background-color: #ffffff;/);
  // As zonas com foto por trás do texto ficam como no escuro (as cores de sempre, de globals.css), também no Automático.
  const zone = block('.site[data-site-mode="light"] .site-dark');
  const globals = readFileSync("src/app/globals.css", "utf8");
  for (const v of ["--ink", "--ink-soft", "--ink-muted", "--paper"]) {
    const original = globals.match(new RegExp(`${v}: ([0-9 ]+);`))[1];
    assert.ok(zone.includes(`${v}: ${original};`), `${v} como no escuro`);
  }
  assert.match(zone, /--site-film: 255 255 255;.*color-scheme: dark;/);
  assert.equal(block('.site[data-site-mode="system"] .site-dark'), zone);
  assert.doesNotMatch(css, /text-shadow: none/, "as sombras do texto ficam (são para as fotos)");
  for (const file of [
    "src/components/hero/Hero.tsx",
    "src/components/home/ContactCTA.tsx",
    "src/components/home/SellCTA.tsx",
    "src/components/home/PinnedTrust.tsx",
    "src/components/quiz/CarQuiz.tsx",
    "src/components/seo/SeoListing.tsx",
    "src/components/layout/Footer.tsx",
    "src/app/(public)/sobre/page.tsx",
    "src/app/(public)/contactos/page.tsx",
    "src/components/vehicle/VehicleCard.tsx",
    "src/components/themes/core2/Core2Stock.tsx",
  ])
    assert.match(readFileSync(file, "utf8"), /className=\{?[`"]site-dark |"site-dark /, `${file}: zona com foto marcada`);
  // O cartão de cima do stock do Core fica na cor da página (no claro, branco).
  assert.doesNotMatch(readFileSync("src/components/inventory/InventoryClient.tsx", "utf8"), /site-dark/);
  // E, só no Core 1, a foto por trás dos filtros fica inteira no claro, com a passagem do branco como no Core2 (no escuro, a de sempre).
  const stockPage = readFileSync("src/app/(public)/inventario/page.tsx", "utf8");
  assert.match(stockPage, /className="stock-photo object-cover object-center opacity-60"/);
  assert.match(stockPage, /className="stock-veil absolute inset-0 /);
  assert.match(css, /\.site\[data-site-theme="core"\]\[data-site-mode="light"\] \.stock-photo \{ opacity: 1; \}/);
  assert.match(css, /\.site\[data-site-theme="core"\]\[data-site-mode="system"\] \.stock-photo \{ opacity: 1; \}/);
  // A foto começa a 35% do cartão (md:left-[35%]): o véu fica liso para lá disso (sem linha) e desvanece como no Core2.
  assert.match(stockPage, /className="absolute inset-0 md:left-\[35%\]"/);
  const veil = css.match(/@media \(min-width: 768px\) \{\s*\.site\[data-site-theme="core"\]\[data-site-mode="light"\] \.stock-veil \{\s*background-image: linear-gradient\(to right, ([^;]+)\);/)?.[1];
  assert.equal(veil, "rgb(var(--ink-soft)) 39%, rgb(var(--ink-soft) / 0.45) 48%, rgb(var(--ink-soft) / 0) 62%");
  const solid = Number(veil.match(/\) (\d+)%/)[1]);
  assert.ok(solid > 35, "liso até depois do início da foto");
  // As mesmas proporções do topo do Core2 (6%, 20% e 42% da foto, que ocupa 65% do cartão).
  assert.match(readFileSync("src/components/themes/core2/Core2StockTop.tsx", "utf8"), /from-ink from-\[6%\] via-ink\/45 via-\[20%\] to-transparent to-\[42%\]/);
  for (const [photoPct, cardPct] of [[6, 39], [20, 48], [42, 62]]) assert.ok(Math.abs(35 + (photoPct * 65) / 100 - cardPct) < 1, `${photoPct}% da foto ≈ ${cardPct}% do cartão`);
  for (const m of css.matchAll(/[^{}]*\.stock-(?:photo|veil)[^{]*\{/g))
    assert.match(m[0].trim(), /^\.site\[data-site-theme="core"\]/, `só no Core 1: ${m[0].trim().slice(0, 60)}`);
  // A foto do topo e o rodapé desvanecem para o branco do site (só no claro; no escuro não aparecem).
  assert.match(css, /\.site \{[^}]*--site-page: var\(--ink\);/);
  assert.match(css, /\.site \.site-fade \{ display: none; \}/);
  assert.match(css, /\.site\[data-site-mode="light"\] \.site-fade \{ display: block; \}/);
  assert.match(css, /\.site\[data-site-mode="system"\] \.site-fade \{ display: block; \}/);
  assert.match(readFileSync("src/components/hero/Hero.tsx", "utf8"), /className="site-fade [^"]*bottom-0[^"]*to-\[rgb\(var\(--site-page\)\)\]"/);
  assert.match(readFileSync("src/components/layout/Footer.tsx", "utf8"), /className="site-fade [^"]*top-0[^"]*to-\[rgb\(var\(--site-page\)\)\]"/);
  // A layout põe a aparência no invólucro do site.
  const layout = readFileSync("src/app/(public)/layout.tsx", "utf8");
  assert.match(layout, /data-site-theme=\{theme\} data-site-mode=\{mode\}/);
  assert.match(layout, /import "@\/themes\/modes\.css";/);
  assert.match(layout, /const \{ theme, mode \} = appearance;/);
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

// ---- Core2: página do Stock (as maquetes) ---------------------------------------

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
  assert.deepEqual(S.CC_BUCKETS.map((b) => b.label), ["125 cc", "450 cc", "800 cc", "1\u00a0200 cc+"]);
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

test("Core2 stock: everything goes to the address and back; old links and the top's links open filtered", () => {
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
  // Os links do topo do Stock (o «#lista» não vai ao servidor).
  const link = (href) => read(href.split("?")[1].split("#")[0]).filters.kinds;
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

test("Core2 stock: active filters as tags with «×», numbers as in the Core", () => {
  const S = loader()("src/themes/core2/stock.ts");
  const f = { ...S.emptyCore2(), kinds: ["moto4"], makes: ["Yamaha"], bodies: ["Trail"], cc: ["450"], base: { ...S.emptyCore2().base, maxPrice: 15000, maxMileage: 50000, minYear: 2010, query: "ténéré", warrantyOnly: true } };
  const chips = S.activeChips(f);
  assert.deepEqual(chips.map((c) => c.label), ["Moto 4", "Yamaha", "Trail", "«ténéré»", "Até 15\u00a0000\u00a0€", "Desde 2010", "Até 50\u00a0000 km", "450 cc", "Com garantia"]);
  assert.deepEqual(S.activeChips(S.emptyCore2()), []);
  // Cada «×» tira só o seu filtro.
  let left = f;
  for (const chip of chips) {
    const next = S.withoutChip(left, chip.key);
    assert.equal(S.activeChips(next).length, S.activeChips(left).length - 1, chip.key);
    left = next;
  }
  assert.deepEqual(left, S.emptyCore2());
});

test("Core2 stock texts and links: numbers as in the Core, the top's links, category cards and hero", () => {
  const U = loader()("src/themes/core2/ui.ts");
  // Os números e os preços como no Core («12 450 €», espaço nos milhares), em todos os temas.
  assert.equal(U.dots, undefined, "sem formatos próprios (os pontos das maquetes)");
  assert.equal(U.euros, undefined);
  // As duas linhas dos cartões do telemóvel: categoria • cc (carros: combustível); km • frase (sem frase, cv; carros, caixa).
  const [car, gs, , yfz] = stockFixture();
  assert.deepEqual(U.rowLines(yfz), ["Moto 4 • 450 cc", "4\u00a0000 km • Excelente estado"]);
  assert.deepEqual(U.rowLines(gs), ["Trail • 1\u00a0170 cc", "59\u00a0400 km • 125 cv"]);
  assert.deepEqual(U.rowLines(car), ["Berlina • Diesel", "10\u00a0000 km • Automática"]);
  // Os links do topo filtram a lista e saltam para ela.
  assert.deepEqual(Object.values(U.STOCK_LINKS), ["/inventario?tipo=motas&moto4=0#lista", "/inventario?tipo=moto4#lista", "/inventario?tipo=carros#lista"]);
  // Os cartões das categorias: «Automóveis» no computador, «Carros» no telemóvel; a Moto 4 só com alguma em stock.
  assert.deepEqual(U.categoryCards(["car", "motorcycle"], true).map((c) => [c.label, c.short, c.photo]), [
    ["Motas", "Motas", "/media/core2/motas.jpg"],
    ["Moto 4", "Moto 4", "/media/core2/moto4.jpg"],
    ["Automóveis", "Carros", "/media/core2/carros.jpg"],
  ]);
  assert.deepEqual(U.categoryCards(["motorcycle"], false).map((c) => c.key), ["motas"]);
  // O topo: o texto da maqueta (a frase segue o que o site vende).
  assert.deepEqual(U.heroTexts(["car", "motorcycle"], true), {
    title: "A sua próxima aventura começa aqui.",
    subtitle: "Motas, moto 4 e automóveis selecionados, com qualidade, confiança e o acompanhamento de uma equipa especializada.",
  });
  assert.match(U.heroTexts(["motorcycle"], true).subtitle, /^Motas e moto 4 selecionadas, /);
  assert.match(U.heroTexts(["car"], false).subtitle, /^Automóveis selecionados, /);
});

test("Core2 stock top: title and the shop photo, then the category cards (no buttons), following the page colour", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const { Core2StockTop } = loader(nextMocks(React))("src/components/themes/core2/Core2StockTop.tsx");
  const render = (props) => renderToStaticMarkup(React.createElement(Core2StockTop, props));
  const html = render({ siteTypes: ["car", "motorcycle"], hasMoto4: true });
  // O topo: título (o h1 da página), traço, frase e a foto da loja (sem botões: as categorias estão por baixo).
  assert.match(html, /<h1[^>]*core2-serif[^>]*>A sua próxima aventura começa aqui\.<\/h1>/);
  assert.ok(html.includes("Motas, moto 4 e automóveis selecionados, com qualidade, confiança e o acompanhamento de uma equipa especializada."));
  assert.match(html, /src="\/media\/core2\/inicio\.jpg"/);
  assert.doesNotMatch(html, /Ver motas|Ver carros/);
  // A foto desvanece para o fundo preto (não para branco).
  assert.match(html, /from-ink/);
  assert.doesNotMatch(html, /to-white|from-white|bg-white(?!\/)/);
  // Os cartões das categorias, cada um com a sua foto e o seu link.
  for (const [href, photo] of [["/inventario?tipo=motas&amp;moto4=0#lista", "motas"], ["/inventario?tipo=moto4#lista", "moto4"], ["/inventario?tipo=carros#lista", "carros"]]) {
    assert.ok(html.includes(`href="${href}"`), href);
    assert.ok(html.includes(`src="/media/core2/${photo}.jpg"`), photo);
  }
  assert.match(html, /<span class="md:hidden">Carros<\/span><span class="hidden md:inline">Automóveis<\/span>/);
  // Site só de motas, sem Moto 4: só o cartão das Motas, e a frase certa.
  const motos = render({ siteTypes: ["motorcycle"], hasMoto4: false });
  assert.doesNotMatch(motos, /Ver carros|moto4\.jpg|carros\.jpg/);
  assert.ok(motos.includes("Motas selecionadas, com qualidade"));
});

test("Core2 stock list: filter column and active filters bar as in the mockup, the Core's vehicle cards, and row cards on phones", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  const render = (qs, props) => {
    const { Core2Stock } = loader(nextMocks(React, {
      "next/navigation": { useSearchParams: () => new URLSearchParams(qs) },
      // O cartão é o do stock do Core (testado à parte): aqui só interessa que viatura recebe.
      "@/components/vehicle/VehicleCard": {
        VehicleCard: ({ vehicle, priority }) => React.createElement("article", { "data-card": vehicle.slug, "data-priority": String(!!priority) }),
      },
    }))("src/components/themes/core2/Core2Stock.tsx");
    return flat(renderToStaticMarkup(React.createElement(Core2Stock, props)));
  };
  const all = withPhotos(stockFixture());
  const both = { vehicles: all, siteTypes: ["car", "motorcycle"] };

  // Com filtros no endereço (?tipo=motas&moto4=0&marca=BMW): só a BMW GS.
  const html = render("tipo=motas&moto4=0&marca=BMW&ordem=price-asc", both);
  // O salto do topo (#lista) e o fundo preto do site.
  assert.match(html, /<div id="lista" class="core2-stock /);
  assert.doesNotMatch(html, /bg-white(?!\/)|neutral-/);
  assert.doesNotMatch(html, /<h1/, "o h1 é o título do topo");
  // A coluna: «Filtros», quantos resultados, as secções, «Ordenar por» e os dois botões.
  assert.match(html, /<h2[^>]*core2-serif[^>]*>.*Filtros<\/h2>/);
  assert.match(html, /1 resultado</);
  const sections = [...html.matchAll(/aria-expanded="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(sections, ["Tipo", "Marca", "Categoria", "Preço máximo", "Ano", "Quilómetros", "Cilindrada"]);
  assert.match(html, />Ordenar por</);
  assert.match(html, /Aplicar filtros/);
  assert.match(html, /Limpar</);
  assert.match(html, />0\s€<\/span><span>50\s000\s€\+</);
  assert.match(html, />0 km<\/span><span>100\s000 km\+</);
  for (const cc of [/125 cc/, /450 cc/, /800 cc/, /1\s200 cc\+/]) assert.match(html, new RegExp(`<span class="min-w-0 break-words">${cc.source}</span>`));
  assert.match(html, /title="Mais de 1\s000 cc"/);
  assert.equal((html.match(/checked=""/g) ?? []).length, 2, "Motas e BMW escolhidas");
  // Em cima: «Filtros activos» com «×», quantos veículos e a ordem («Mais recentes» primeiro).
  assert.match(html, /Filtros activos:/);
  assert.match(html, /aria-label="Tirar o filtro Motas"/);
  assert.match(html, /aria-label="Tirar o filtro BMW"/);
  assert.match(html, />1 veículo encontrado</);
  assert.match(html, /Ordenar por:/);
  assert.match(html, /<option value="year-desc">Mais recentes<\/option><option value="price-asc" selected="">Preço mais baixo<\/option>/);
  assert.doesNotMatch(html, /Relevância/);
  // Os cartões das viaturas são os do stock do Core (foto, favorito, ano, preço, dados e ponto de venda).
  assert.deepEqual([...html.matchAll(/data-card="([^"]+)"/g)].map((m) => m[1]), ["gs"]);
  assert.match(html, /<div class="hidden sm:block"><article data-card="gs" data-priority="false"><\/article><\/div>/);
  // No telemóvel, o cartão deitado: foto pequena à esquerda, marca, modelo e ano, duas linhas, preço e seta.
  const row = html.match(/<div class="sm:hidden">([\s\S]*?)<\/a><\/div>/)?.[1] ?? "";
  assert.match(row, /<a href="\/viaturas\/gs"/);
  assert.match(row, /<div class="site-dark relative w-\[41%\][^"]*"><img src="https:\/\/cdn\.example\/gs\.jpg" alt="BMW X"/);
  assert.match(row, /<p[^>]*>BMW<\/p><div[^>]*><h3[^>]*>X<\/h3><span[^>]*>2015<\/span>/);
  assert.match(row, /Trail • 1\s170 cc<br\/>59\s400 km • 125 cv/);
  assert.match(row, /class="whitespace-nowrap text-lg font-semibold text-accent"><span[^>]*><span>11\s900\s€</);
  // Grelha: 4 por linha nos ecrãs largos, 3 nos médios, 2 nos tablets e 1 no telemóvel; a coluna dos filtros um pouco mais estreita.
  assert.match(html, /grid gap-x-5 gap-y-3 sm:grid-cols-2 sm:gap-y-8 xl:grid-cols-3 min-\[1600px\]:grid-cols-4/);
  assert.match(html, /lg:grid-cols-\[19rem_minmax\(0,1fr\)\] xl:grid-cols-\[20\.5rem_minmax\(0,1fr\)\]/);
  // Telemóvel: Marca e Modelo à vista, como no stock do Core (o resto no botão «Filtros»).
  const quick = html.match(/<div class="mb-4 space-y-4 [^"]*lg:hidden">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.match(quick, />Marca<\/span><select[^>]*><option value="">Todas<\/option><option value="BMW" selected="">BMW<\/option><option value="Honda">Honda<\/option><option value="Yamaha">Yamaha<\/option><\/select>/);
  assert.match(quick, />Modelo<\/span><select[^>]*><option value="" selected="">Todos<\/option><option value="X">X<\/option><\/select>/);
  assert.match(render("marca=BMW,Honda", both), /<option value="__varias__" disabled="" selected="">Várias marcas<\/option>/);
  assert.match(render("marca=Honda&modelo=PCX", both), /<option value="PCX" selected="">PCX<\/option>/, "o modelo pedido fica à vista");
  assert.match(html, /<aside aria-label="Filtros" class="hidden lg:block">/);
  assert.match(html, /aria-haspopup="dialog"[^>]*lg:hidden/);
  // Nada por baixo da grelha (sem alerta nem pesquisas populares).
  assert.doesNotMatch(html, /id="alerta"|Pesquisas populares/);

  // Sem filtros: tudo, por «Mais recentes» (o ano mais recente primeiro), sem «Filtros activos».
  const open = render("", both);
  assert.match(open, />5 veículos encontrados</);
  assert.doesNotMatch(open, /Filtros activos/);
  assert.match(open, /<option value="year-desc" selected="">Mais recentes<\/option>/);
  assert.deepEqual([...open.matchAll(/data-card="([^"]+)"/g)].map((m) => m[1]), ["pcx", "tenere", "bmw-320", "gs", "yfz"]);
  assert.ok([...open.matchAll(/data-priority="([^"]+)"/g)].every((m) => m[1] === "false"), "a imagem principal é a do topo, não as dos cartões");
  assert.match(open, /Moto 4 • 450 cc<br\/>4\s000 km • Excelente estado/);

  // Nada encontrado: limpar.
  assert.match(render("preco_max=1000", both), /Nenhuma viatura corresponde aos filtros[\s\S]*Limpar filtros/);

  // Site só de carros: sem Tipo nem Cilindrada, e «Carroçaria».
  const cars = render("", { vehicles: all.filter((v) => v.vehicleType === "car"), siteTypes: ["car"] });
  const carSections = [...cars.matchAll(/aria-expanded="true"[^>]*>([^<]+)</g)].map((m) => m[1]);
  assert.deepEqual(carSections, ["Marca", "Carroçaria", "Preço máximo", "Ano", "Quilómetros"]);
});

test("only the stock page changes with Core2 (top + list); the layout, the home page and the rest stay as in Core", async () => {
  const all = stockFixture().map((v) => ({ ...v, description: "Texto longo", extras: ["ABS"] }));
  let theme = "core2";
  const Core2Stock = () => null;
  const Core2StockTop = () => null;
  const InventoryClient = () => null;
  const SeoLinks = () => null;
  const stockPage = loader({
    "@/lib/vehicle-context": { getPublicVehicleType: async () => "motorcycle", getSiteVehicleTypes: async () => ["car", "motorcycle"] },
    "@/lib/queries": { getBranding: async () => ({ companyName: "Stand" }), getVehicles: async () => all },
    "@/lib/olx/search": { inventoryWithOlx: async (vehicles) => ({ vehicles, fields: [] }) },
    "@/lib/site-theme-query": { getSiteTheme: async () => theme },
    "@/themes/core2/fonts": { core2Serif: { variable: "font-core2-var" } },
    "@/components/themes/core2/Core2Stock": { Core2Stock },
    "@/components/themes/core2/Core2StockTop": { Core2StockTop },
    "@/components/inventory/InventoryClient": { InventoryClient },
    "@/components/seo/SeoLinks": { SeoLinks },
    "next/image": { __esModule: true, default: () => null },
  })("src/app/(public)/inventario/page.tsx");
  // Core2: o topo (foto e categorias) e, por baixo, a lista; a letra serifada só aqui.
  const el = await stockPage.default({ searchParams: Promise.resolve({ tipo: "motas" }) });
  assert.equal(el.type, "div");
  assert.equal(el.props.className, "font-core2-var");
  const [top, list] = el.props.children;
  assert.equal(top.type, Core2StockTop);
  assert.deepEqual(top.props, { siteTypes: ["car", "motorcycle"], hasMoto4: true });
  assert.equal(list.type, Core2Stock);
  assert.equal(list.key, JSON.stringify({ tipo: "motas" }), "outra pesquisa no endereço começa de novo");
  assert.deepEqual(list.props.vehicles.map((v) => v.slug), all.map((v) => v.slug));
  assert.ok(list.props.vehicles.every((v) => v.description === "" && v.extras === undefined), "a versão leve, como no Core");
  assert.equal(list.props.vehicles.find((v) => v.slug === "yfz").tagline, "Excelente estado", "com a frase curta (cartões do telemóvel)");
  // Core: o stock de sempre, com as pesquisas populares.
  theme = "core";
  const core = await stockPage.default({ searchParams: Promise.resolve({}) });
  assert.equal(core.type, "div");
  assert.ok([core.props.children].flat(3).some((x) => x?.type === InventoryClient), "o Core continua com o stock de sempre");
  assert.ok([core.props.children].flat(3).some((x) => x?.type === SeoLinks), "e com as pesquisas populares");

  // O resto do site é o do Core também no Core2: o mesmo menu, rodapé e página inicial.
  const layout = readFileSync("src/app/(public)/layout.tsx", "utf8");
  // O cabeçalho é sempre o do Core; só o Core3 lhe dá outro menu.
  assert.match(layout, /<Header branding=\{branding\} stockSlugs=\{stockSlugs\} nav=\{theme === "core3" \? core3Nav\(siteTypes\) : undefined\} \/>/);
  assert.match(layout, /<GrainOverlay \/>/);
  assert.doesNotMatch(layout, /components\/themes\/core2/);
  // A serifada não vai para o layout: só as páginas que a usam a carregam.
  assert.doesNotMatch(layout, /core2Serif/);
  assert.doesNotMatch(readFileSync("src/app/(public)/(home)/page.tsx", "utf8"), /components\/themes\/core2/);
  // Os componentes do Core2 só se usam na página do Stock (e no stock por tipo do Core3).
  const users = execFileSync("git", ["grep", "-l", "--untracked", "-F", "@/components/themes/core2/", "--", "src"], { encoding: "utf8" }).trim().split("\n");
  assert.deepEqual(users.filter((f) => !f.startsWith("src/components/themes/core2/")).sort(), [
    "src/app/(public)/inventario/page.tsx",
    "src/components/themes/core3/Core3CategoryPage.tsx",
  ]);
});

test("Core2 leaves the palette to the appearance (no colours of its own), the stock's fields follow it, and the photos come with the theme", () => {
  const css = readFileSync("src/themes/core2.css", "utf8");
  const rules = css.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.doesNotMatch(rules, /--ink:|--paper:|--background:|color-scheme: (?:light|dark)|html:has|\.border-white|\.bg-white/);
  // O stock e a serifada são do Core2 e do Core3 (que usa o mesmo stock).
  const scope = ':is\\(\\[data-site-theme="core2"\\], \\[data-site-theme="core3"\\]\\)';
  assert.match(rules, new RegExp(`${scope} \\.core2-stock \\{\\s*color-scheme: var\\(--site-scheme, dark\\);`));
  assert.match(rules, /border: 1px solid rgb\(var\(--site-film, 255 255 255\) \/ 0\.18\)/);
  assert.match(rules, new RegExp(`${scope} \\.core2-serif \\{[^}]*var\\(--font-core2-serif\\)`));
  assert.match(readFileSync("src/themes/core2/fonts.ts", "utf8"), /localFont\(\{[\s\S]*dm-serif-display[\s\S]*preload: false[\s\S]*--font-core2-serif/);
  // As fotos: a da loja (recorte das maquetes) e as originais das categorias (horizontais, 1376x768).
  const jpegSize = (buf) => {
    for (let i = 2; i < buf.length; ) {
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xc3) return [buf.readUInt16BE(i + 7), buf.readUInt16BE(i + 5)];
      i += 2 + len;
    }
    return null;
  };
  for (const name of ["inicio", "motas", "moto4", "carros"]) {
    const jpg = readFileSync(`public/media/core2/${name}.jpg`);
    assert.deepEqual([...jpg.subarray(0, 3)], [0xff, 0xd8, 0xff], `${name}.jpg é um JPEG`);
    if (name !== "inicio") assert.deepEqual(jpegSize(jpg), [1376, 768], `${name}.jpg é a original`);
  }
  // A viatura está à direita e em baixo nas fotos das categorias.
  assert.match(readFileSync("src/components/themes/core2/Core2StockTop.tsx", "utf8"), /object-\[85%_60%\]/);
});

test("Core3: Motas, Moto 4 and Carros follow what the site sells, the home keeps the featured vehicles, one page per type", () => {
  const ui = loader()("src/themes/core3/ui.ts");
  assert.deepEqual(ui.core3Categories(["car", "motorcycle"]).map((c) => [c.key, c.href, c.short]), [
    ["motas", "/motas", "Motas"],
    ["moto4", "/moto4", "Moto 4"],
    ["carros", "/carros", "Carros"],
  ]);
  assert.deepEqual(ui.core3Categories(["motorcycle"]).map((c) => c.key), ["motas", "moto4"]);
  assert.deepEqual(ui.core3Categories(["car"]).map((c) => c.key), ["carros"]);
  // A foto do topo: os carros a da loja (maqueta), as motas e a Moto 4 a das motas do site.
  assert.equal(ui.categoryOf("carros").hero, "/media/core3/carros.jpg");
  assert.equal(ui.categoryOf("motas").hero, null);
  assert.equal(ui.categoryOf("carros").title, "Automóveis em stock");
  // O cartão das motas mostra a foto um pouco mais acima (a mota inteira).
  assert.equal(ui.categoryOf("motas").photoPosition, "object-[85%_40%]");
  // Na página inicial, os destaques de sempre logo a seguir aos cartões, e por baixo a faixa de serviços.
  const order = loader()("src/themes/index.ts").getTheme("core3").homeSections;
  assert.deepEqual(order.slice(0, 4), ["c3hero", "c3categories", "featured", "c3services"]);
});

test("Core3: the menu order drives the slide (Início → Motas → Moto 4 → Carros), and the Core's order stays", () => {
  const { navDirection } = loader()("src/lib/page-transition.ts");
  assert.equal(navDirection("/", "/motas"), "forward");
  assert.equal(navDirection("/motas", "/moto4"), "forward");
  assert.equal(navDirection("/moto4", "/carros"), "forward");
  assert.equal(navDirection("/carros", "/motas"), "back");
  assert.equal(navDirection("/carros", "/"), "back");
  assert.equal(navDirection("/carros", "/contactos"), "forward");
  // O Core continua: Início → Stock → Veículo ideal → Serviços → Sobre → Contactos.
  assert.equal(navDirection("/inventario", "/quiz"), "forward");
  assert.equal(navDirection("/sobre", "/servicos"), "back");
  assert.equal(navDirection("/inventario", "/viaturas/bmw-320"), "forward");
});

test("Core3: the Core header with the Core3 menu, /motas and /carros become the stock pages, /moto4 exists only in Core3, Gestão explains the change", () => {
  const layout = readFileSync("src/app/(public)/layout.tsx", "utf8");
  assert.doesNotMatch(layout, /Core3Header/, "o cabeçalho é o do Core");
  for (const [path, kind] of [["motas", "motas"], ["carros", "carros"]])
    assert.match(readFileSync(`src/app/(public)/${path}/(todos)/page.tsx`, "utf8"), new RegExp(`=== "core3"\\) return <Core3CategoryPage kind="${kind}" />`));
  assert.match(readFileSync("src/app/(public)/moto4/layout.tsx", "utf8"), /theme !== "core3"[\s\S]*notFound\(\)/);
  // O menu e o rodapé do Core3 só têm as categorias: sem «Ver stock» nem o stock misturado.
  const ui = loader()("src/themes/core3/ui.ts");
  assert.deepEqual(ui.core3Nav(["car", "motorcycle"]), [
    { href: "/motas", label: "Motas" },
    { href: "/moto4", label: "Moto 4" },
    { href: "/carros", label: "Carros" },
    { href: "/vender", label: "Vender" },
    { href: "/contactos", label: "Contactos" },
  ]);
  // No telemóvel, o topo dos carros mostra a direita da foto (a loja e os carros).
  assert.equal(ui.categoryOf("carros").heroMobilePosition, "object-right");
  assert.match(readFileSync("src/components/layout/Footer.tsx", "utf8"), /theme === "core3" \? core3Links\(siteTypes\)/);
  const home = readFileSync("src/app/(public)/(home)/page.tsx", "utf8");
  assert.match(home, /theme !== "core3" && <ServiceCards/, "os serviços do Core3 estão na faixa, não em cartões");
  const T = loader()("src/themes/index.ts");
  assert.ok(T.getTheme("core3").adminNotes.some((n) => n.href === "/admin/pagina-inicial#servicos"));
  assert.equal(T.getTheme("core").adminNotes, undefined);
  // A foto do topo dos carros existe (recorte da maqueta, ampliado).
  assert.deepEqual([...readFileSync("public/media/core3/carros.jpg").subarray(0, 3)], [0xff, 0xd8, 0xff]);
});

test("social links: only links of each network, typed loosely, as footer icons under the logo", () => {
  const S = loader()("src/lib/social.ts");
  assert.equal(S.normalizeSocial("facebook", "facebook.com/supermotas"), "https://facebook.com/supermotas");
  assert.equal(S.normalizeSocial("facebook", "https://www.facebook.com/supermotas/"), "https://www.facebook.com/supermotas/");
  assert.equal(S.normalizeSocial("facebook", "http://m.facebook.com/x"), "https://m.facebook.com/x");
  assert.equal(S.normalizeSocial("instagram", "@super.motas"), "https://www.instagram.com/super.motas");
  assert.equal(S.normalizeSocial("instagram", "instagram.com/supermotas"), "https://instagram.com/supermotas");
  assert.equal(S.normalizeSocial("facebook", "  "), "", "vazio tira o ícone");
  for (const [n, bad] of [["facebook", "https://evil.example/facebook.com"], ["facebook", "https://facebook.com"], ["instagram", "https://facebook.com/x"], ["facebook", "javascript:alert(1)"]])
    assert.equal(S.normalizeSocial(n, bad), null, `${n}: ${bad}`);
  assert.deepEqual(S.parseSocial({ facebook: "facebook.com/a", instagram: "https://evil.example/x", other: 1 }), { facebook: "https://facebook.com/a", instagram: "" });
  assert.deepEqual(S.parseSocial(null), { facebook: "", instagram: "" });
  // O rodapé mostra os ícones (só os que têm link) por baixo do logótipo; o layout lê-os.
  const footer = readFileSync("src/components/layout/Footer.tsx", "utf8");
  assert.match(footer, /SOCIAL_NETWORKS\.filter\(\(n\) => social\[n\]\)/);
  assert.match(footer, /target="_blank"\s+rel="noopener noreferrer"/);
  assert.match(readFileSync("src/app/(public)/layout.tsx", "utf8"), /social=\{social\}/);
  assert.match(readFileSync("src/app/admin/(dashboard)/definicoes/page.tsx", "utf8"), /<SocialLinksForm initial=\{social\} \/>/);
});

test("Core3 on phones: Motas · Moto 4 · Carros at the bottom only inside those pages, the floating buttons go above it; no buttons on the home top", () => {
  const layout = readFileSync("src/app/(public)/layout.tsx", "utf8");
  assert.match(layout, /theme === "core3" && <Core3MobileNav categories=\{core3Categories\(siteTypes\)\} \/>/);
  assert.match(layout, /import "@\/themes\/core3\.css"/);
  const nav = readFileSync("src/components/themes/core3/Core3MobileNav.tsx", "utf8");
  assert.match(nav, /md:hidden/, "só no telemóvel");
  assert.match(nav, /const hidden = !inCategory/, "só dentro das páginas Motas, Moto 4 e Carros");
  assert.match(nav, /--core3-nav/);
  const css = readFileSync("src/themes/core3.css", "utf8");
  assert.match(css, /\[data-site-theme="core3"\] \.contact-fab \{\s*bottom: calc\(var\(--core3-nav, 0px\)/);
  assert.match(css, /\[data-site-theme="core3"\] \.compare-bar \{\s*bottom: calc\(var\(--core3-nav, 0px\)/);
  assert.match(readFileSync("src/components/layout/ContactFab.tsx", "utf8"), /className="contact-fab /);
  assert.match(readFileSync("src/components/inventory/CompareBar.tsx", "utf8"), /className="compare-bar /);
  // O topo da página inicial do Core3 só tem o título e a frase (sem «Ver motas» / «Ver carros»).
  assert.match(readFileSync("src/app/(public)/(home)/page.tsx", "utf8"), /c3hero: <Core3Banner [^>]*big \/>/);
});

test("Core3 bottom switcher: shown on /motas, /moto4, /carros (and their pages), hidden on the home, a vehicle page and the rest", () => {
  const React = require("react");
  const { renderToStaticMarkup } = require("react-dom/server");
  let path = "/";
  const { Core3MobileNav } = loader(nextMocks(React, {
    "next/navigation": { usePathname: () => path },
    "framer-motion": { motion: { span: (p) => React.createElement("span", { className: p.className }) } },
  }))("src/components/themes/core3/Core3MobileNav.tsx");
  const cats = loader()("src/themes/core3/ui.ts").core3Categories(["car", "motorcycle"]);
  const html = (p) => ((path = p), renderToStaticMarkup(React.createElement(Core3MobileNav, { categories: cats })));
  for (const p of ["/", "/viaturas/bmw-320", "/contactos", "/inventario", "/vender"]) assert.equal(html(p), "", p);
  for (const p of ["/motas", "/moto4", "/carros", "/carros/bmw"]) assert.match(html(p), /aria-label="Categorias"/, p);
  assert.match(html("/moto4"), /href="\/moto4" aria-current="page"/);
  assert.doesNotMatch(html("/moto4"), /href="\/motas" aria-current/);
});
