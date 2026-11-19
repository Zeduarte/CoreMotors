// Versões do site (temas Core / Core2) e o separador Gestão (só o acesso core).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
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
