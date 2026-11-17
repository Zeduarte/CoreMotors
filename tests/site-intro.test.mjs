import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createLoader } from "./support/load-ts.mjs";

// Entrada do site público na 1.ª visita: a foto das motas por cima do site
// enquanto carrega (src/lib/site-intro.ts, src/components/site/SiteIntro.tsx).

const intro = createLoader()("src/lib/site-intro.ts");
const { INTRO_IMAGE, INTRO_STORAGE_KEY, INTRO_MIN_MS, INTRO_MAX_MS, INTRO_OUT_MS, introScript, srcAtWidth } = intro;

/**
 * Corre o script inline num browser de mentira: relógio e temporizadores
 * controlados, localStorage, `load`, cliques e teclas.
 */
function browser({ stored = false, ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Safari/604.1", webdriver = false, readyState = "loading", storageThrows = false } = {}) {
  let now = 0;
  const timers = [];
  const attrs = {};
  const win = {};
  const doc = {};
  const storage = new Map(stored ? [[INTRO_STORAGE_KEY, "1"]] : []);
  const blocked = () => {
    if (storageThrows) throw new Error("SecurityError");
  };
  const context = {
    navigator: { userAgent: ua, webdriver },
    localStorage: {
      getItem: (k) => (blocked(), storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => (blocked(), storage.set(k, String(v))),
    },
    document: {
      readyState,
      documentElement: { setAttribute: (k, v) => (attrs[k] = v), getAttribute: (k) => attrs[k] ?? null },
      addEventListener: (type, fn) => (doc[type] = fn),
    },
    addEventListener: (type, fn) => (win[type] = fn),
    setTimeout: (fn, ms) => timers.push({ at: now + ms, fn }),
    Date: { now: () => now },
    Math,
  };
  vm.runInNewContext(introScript(), context);
  return {
    storage,
    state: () => attrs["data-intro"],
    /** Avança o relógio, a correr os temporizadores pela ordem. */
    advance(ms) {
      const target = now + ms;
      for (;;) {
        timers.sort((a, b) => a.at - b.at);
        if (!timers.length || timers[0].at > target) break;
        const next = timers.shift();
        now = next.at;
        next.fn();
      }
      now = target;
    },
    load: () => win.load?.(),
    click: () => doc.click?.(),
    key: (key) => win.keydown?.({ key }),
  };
}

test("the intro uses the yellow motorcycle photo from the old entrance screen", () => {
  assert.equal(INTRO_IMAGE, "/media/motas/entrada.jpg");
  assert.ok(existsSync(`public${INTRO_IMAGE}`));
});

test("first visit: the intro covers the site and is remembered", () => {
  const b = browser();
  assert.equal(b.state(), "show");
  assert.equal(b.storage.get(INTRO_STORAGE_KEY), "1");
});

test("the intro stays at least the minimum time, then fades out and is removed", () => {
  const b = browser();
  b.advance(200);
  b.load(); // site rápido
  b.advance(INTRO_MIN_MS - 201);
  assert.equal(b.state(), "show");
  b.advance(1);
  assert.equal(b.state(), "out");
  b.advance(INTRO_OUT_MS);
  assert.equal(b.state(), "done");
});

test("a slow page keeps the intro until it finishes loading", () => {
  const b = browser();
  b.advance(2000);
  assert.equal(b.state(), "show");
  b.load();
  b.advance(0);
  assert.equal(b.state(), "out");
});

test("the intro never waits longer than the maximum", () => {
  const b = browser();
  b.advance(INTRO_MAX_MS - 1);
  assert.equal(b.state(), "show");
  b.advance(1);
  assert.equal(b.state(), "out");
});

test("an already loaded page only waits for the minimum", () => {
  const b = browser({ readyState: "complete" });
  b.advance(INTRO_MIN_MS);
  assert.equal(b.state(), "out");
});

test("a tap or Escape skips the intro", () => {
  const tap = browser();
  tap.click();
  assert.equal(tap.state(), "out");
  const esc = browser();
  esc.key("Enter");
  assert.equal(esc.state(), "show");
  esc.key("Escape");
  assert.equal(esc.state(), "out");
});

test("later visits never show the intro", () => {
  const b = browser({ stored: true });
  assert.equal(b.state(), undefined);
});

test("blocked storage, robots and automation skip the intro", () => {
  // Sem armazenamento não se sabe se é a 1.ª visita: mais vale não a mostrar
  // em todas as páginas.
  assert.equal(browser({ storageThrows: true }).state(), undefined);
  for (const ua of [
    "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    "Mozilla/5.0 (Linux; Android 11; moto g power (2022)) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36 Chrome-Lighthouse",
    "facebookexternalhit/1.1",
  ]) {
    const b = browser({ ua });
    assert.equal(b.state(), undefined, ua);
    assert.equal(b.storage.size, 0, ua);
  }
  assert.equal(browser({ webdriver: true }).state(), undefined);
});

test("srcAtWidth picks the first optimised image wide enough", () => {
  const set = "/_next/image?url=a&w=640&q=75 640w, /_next/image?url=a&w=1200&q=75 1200w, /_next/image?url=a&w=1920&q=75 1920w";
  assert.equal(srcAtWidth(set, 1200), "/_next/image?url=a&w=1200&q=75");
  assert.equal(srcAtWidth(set, 700), "/_next/image?url=a&w=1200&q=75");
  assert.equal(srcAtWidth(set, 4000), "/_next/image?url=a&w=1920&q=75");
  assert.equal(srcAtWidth(undefined, 1200), undefined);
});

test("SiteIntro: hidden decorative overlay, decided by the inline script before it", () => {
  const css = new Proxy({}, { get: (_, k) => (k === "__esModule" ? undefined : String(k)) });
  let asked;
  const load = createLoader({
    "./SiteIntro.module.css": css,
    "next/image": {
      getImageProps: (props) => {
        asked = props;
        return { props: { src: "/_next/image?url=x&w=3840", srcSet: "/_next/image?url=x&w=828 828w, /_next/image?url=x&w=1200 1200w" } };
      },
    },
  });
  const { SiteIntro } = load("src/components/site/SiteIntro.tsx");
  const html = renderToStaticMarkup(React.createElement(SiteIntro, { name: "CoreMotors", label: "Automóveis e motas" }));
  assert.equal(asked.src, "/media/motas/entrada.jpg");
  assert.ok(html.indexOf("<script>") < html.indexOf('class="intro"'), "o script vem antes da entrada");
  assert.ok(html.includes(INTRO_STORAGE_KEY));
  assert.match(html, /aria-hidden="true"/);
  assert.match(html, /--intro-photo:url\(&quot;\/_next\/image\?url=x&amp;w=1200&quot;\)/);
  assert.match(html, /CoreMotors/);
  assert.match(html, /Automóveis e motas/);
});

test("the intro is only on the public site, hidden without JS and respects reduced motion", () => {
  const publicLayout = readFileSync("src/app/(public)/layout.tsx", "utf8");
  assert.match(publicLayout, /<SiteIntro\b/);
  assert.doesNotMatch(readFileSync("src/app/admin/layout.tsx", "utf8"), /SiteIntro/);
  assert.doesNotMatch(readFileSync("src/app/layout.tsx", "utf8"), /SiteIntro/);

  const css = readFileSync("src/components/site/SiteIntro.module.css", "utf8");
  assert.match(css, /^\.intro \{ display: none; \}/m);
  assert.match(css, /html\[data-intro="show"\]\) \.intro/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*animation: none/);
  // A transição de saída no CSS é a mesma que o script espera.
  assert.match(css, new RegExp(`opacity \\.${String(INTRO_OUT_MS).replace(/0+$/, "")}s`));
  assert.match(readFileSync("src/app/globals.css", "utf8"), /html\[data-intro="show"\] \{\s*overflow: hidden;/);
});
