import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);

// Carrega um ficheiro TS do projeto (CommonJS), com módulos substituíveis.
function load(file, mocks = {}) {
  const source = readFileSync(file, 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} };
  const custom = (id) => {
    if (id in mocks) return mocks[id];
    if (id.startsWith('@/') || id.startsWith('.')) {
      let path = id.startsWith('@/') ? resolve('src', id.slice(2)) : resolve(dirname(file), id);
      if (!existsSync(path)) path = existsSync(path + '.tsx') ? path + '.tsx' : path + '.ts';
      return load(path, mocks);
    }
    return require(id);
  };
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, custom);
  return mod.exports;
}

const pwa = load('src/lib/admin-pwa.ts');
const publicFile = (url) => resolve('public', url.replace(/^\//, ''));
// Largura × altura de um PNG (cabeçalho IHDR).
const pngSize = (file) => { const b = readFileSync(file); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };

test('the admin manifest opens the backoffice, stays inside /admin/ and has real icons', () => {
  const m = pwa.adminManifest();
  assert.equal(m.id, '/admin/');
  assert.equal(m.scope, '/admin');
  assert.equal(m.start_url, '/admin');
  // O âmbito é um prefixo de texto: com "/admin/" o Chrome ignorava-o
  // ("Start url should be within scope") e a app ficava com o site todo.
  assert.ok(m.start_url.startsWith(m.scope));
  assert.equal(m.display, 'standalone');
  assert.equal(m.name, 'CoreMotors');
  assert.equal(m.short_name, 'CoreMotors');
  assert.equal(m.lang, 'pt-PT');
  assert.equal(m.theme_color, '#0A0A0A');
  assert.equal(m.background_color, '#0A0A0A');
  for (const purpose of ['any', 'maskable']) assert.ok(m.icons.some((i) => i.purpose === purpose && i.sizes === '512x512'), purpose);
  assert.ok(m.icons.some((i) => i.purpose === 'any' && i.sizes === '192x192'));
  for (const icon of m.icons) {
    assert.equal(icon.type, 'image/png');
    assert.ok(existsSync(publicFile(icon.src)), icon.src);
    const [w, h] = pngSize(publicFile(icon.src));
    assert.equal(`${w}x${h}`, icon.sizes, icon.src);
  }
  assert.deepEqual(pngSize(publicFile(pwa.ADMIN_ICONS.apple)), [180, 180]);
});

test('the public manifest is a plain metadata link, so /admin can replace it', async () => {
  // Um manifest "de ficheiro" na raiz (app/manifest.ts, .json, .webmanifest) é
  // colado pelo Next também aos segmentos de 1.º nível (como /admin) e passa à
  // frente do `manifest` do layout: o backoffice ficava com o do site.
  for (const name of ['manifest.ts', 'manifest.tsx', 'manifest.js', 'manifest.json', 'manifest.webmanifest']) {
    const file = resolve('src/app', name);
    assert.ok(!existsSync(file) || !statSync(file).isFile(), name);
  }
  assert.match(readFileSync('src/app/layout.tsx', 'utf8'), /manifest: "\/manifest\.webmanifest"/);
  const route = load('src/app/manifest.webmanifest/route.ts', { '@/lib/site': { site: { name: 'Supermotas', description: 'Stand' } } });
  assert.equal(route.dynamic, 'force-static');
  const res = route.GET();
  assert.equal(res.headers.get('content-type'), 'application/manifest+json');
  const body = await res.json();
  assert.equal(body.start_url, '/');
  assert.equal(body.name, 'Supermotas — Motas e Automóveis');
  assert.equal(body.scope, undefined);
});

test('the admin manifest route answers JSON with the fixed app name', async () => {
  const route = load('src/app/admin/manifest.webmanifest/route.ts');
  const res = route.GET();
  assert.match(res.headers.get('content-type'), /^application\/manifest\+json/);
  const body = await res.json();
  // A app é «CoreMotors»; o site e o backoffice ficam com o nome da empresa.
  assert.equal(body.name, 'CoreMotors');
  assert.equal(body.short_name, 'CoreMotors');
  assert.equal(body.scope, '/admin');
});

test('the admin layout links its own manifest, apple tags and viewport-fit=cover', async () => {
  const layout = load('src/app/admin/layout.tsx', {
    '@/components/admin/PwaRegister': { PwaRegister: () => null },
  });
  // O `metadata` substitui o manifest e os ícones do site...
  assert.equal(layout.metadata.manifest, '/admin/manifest.webmanifest');
  assert.deepEqual(layout.metadata.robots, { index: false, follow: false });
  assert.equal(layout.metadata.icons.apple, undefined);
  for (const icon of layout.metadata.icons.icon) assert.ok(existsSync(publicFile(icon.url)), icon.url);
  assert.equal(layout.viewport.viewportFit, 'cover');
  assert.equal(layout.viewport.themeColor, '#0A0A0A');
  // ...e as tags da app saem do próprio layout (o React põe-nas no <head>;
  // o metadata do Next chega em streaming e pode ficar no <body>).
  const html = renderToStaticMarkup(await layout.default({ children: React.createElement('main', null, 'login') }));
  assert.ok(html.includes('<link rel="manifest" href="/admin/manifest.webmanifest"/>'), html);
  assert.ok(html.includes('<link rel="apple-touch-icon" href="/admin-icons/apple-touch-icon.png" sizes="180x180"/>'));
  assert.ok(html.includes('<meta name="apple-mobile-web-app-capable" content="yes"/>'));
  assert.ok(html.includes('<meta name="apple-mobile-web-app-title" content="CoreMotors"/>'));
  assert.ok(html.includes('<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent"/>'));
  assert.ok(html.includes('<main>login</main>'));
});

// O script tal como a rota /admin/sw.js o devolve.
const swRoute = load('src/app/admin/sw.js/route.ts');
const swSource = await swRoute.GET().text();

// Corre o SW num contexto isolado e devolve os listeners registados.
function bootServiceWorker({ fetchImpl, cacheKeys = [] } = {}) {
  const listeners = {};
  const deleted = [];
  const self = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
    registration: { navigationPreload: { enable: async () => {} } },
  };
  const caches = { keys: async () => cacheKeys, delete: async (k) => { deleted.push(k); return true; } };
  vm.runInNewContext(swSource, { self, caches, fetch: fetchImpl, Response });
  return { listeners, deleted };
}

function fetchEvent(url, mode, method = 'GET') {
  const ev = { request: { url, mode, method }, preloadResponse: Promise.resolve(undefined), responded: null };
  ev.respondWith = (p) => { ev.responded = p; };
  return ev;
}

test('the admin service worker is network-only: it never answers chunks, RSC or Server Actions', async () => {
  const src = swSource;
  for (const forbidden of ['cache.put', 'caches.match', 'cache.match', 'addAll(', '.put(']) assert.ok(!src.includes(forbidden), forbidden);
  const { listeners } = bootServiceWorker({ fetchImpl: async () => new Response('ok') });
  assert.ok(listeners.install && listeners.activate && listeners.fetch);
  for (const ev of [
    fetchEvent('https://x.pt/_next/static/chunks/app.js', 'no-cors'),
    fetchEvent('https://x.pt/admin/carros?_rsc=abc', 'cors'),
    fetchEvent('https://x.pt/admin/carros', 'cors', 'POST'), // Server Action
    fetchEvent('https://x.pt/admin/carros', 'navigate', 'POST'),
  ]) {
    listeners.fetch(ev);
    assert.equal(ev.responded, null, `${ev.request.method} ${ev.request.url}`);
  }
});

test('offline navigations get the inline "Sem ligação" page; online ones go to the network', async () => {
  let online = true;
  const { listeners } = bootServiceWorker({ fetchImpl: async () => { if (!online) throw new TypeError('Failed to fetch'); return new Response('página', { status: 200 }); } });
  let ev = fetchEvent('https://x.pt/admin', 'navigate');
  listeners.fetch(ev);
  assert.equal(await (await ev.responded).text(), 'página');
  online = false;
  ev = fetchEvent('https://x.pt/admin/leads', 'navigate');
  listeners.fetch(ev);
  const res = await ev.responded;
  assert.equal(res.status, 503);
  const html = await res.text();
  assert.ok(html.includes('Sem ligação à internet'));
  assert.ok(html.includes('location.reload()'));
});

test('activating the admin service worker only clears its own caches', async () => {
  const { listeners, deleted } = bootServiceWorker({ cacheKeys: ['coremotors-admin-offline-v0', 'outra-cache'] });
  let done;
  listeners.activate({ waitUntil: (p) => { done = p; } });
  await done;
  assert.deepEqual(deleted, ['coremotors-admin-offline-v0']);
});

test('the public site no longer unregisters the admin service worker or its caches', () => {
  assert.equal(pwa.isAdminServiceWorker('https://coremotors.pt/admin'), true);
  assert.equal(pwa.isAdminServiceWorker('https://coremotors.pt/admin/'), true);
  assert.equal(pwa.isAdminServiceWorker('https://coremotors.pt/'), false);
  assert.equal(pwa.isAdminServiceWorker('https://coremotors.pt/admin/carros/'), false);
  assert.equal(pwa.isAdminCache('coremotors-admin-offline-v1'), true);
  assert.equal(pwa.isAdminCache('next-data'), false);
  const src = readFileSync('src/components/site/SiteRuntime.tsx', 'utf8');
  assert.match(src, /\.filter\(\(r\) => !isAdminServiceWorker\(r\.scope\)\)\s*\.forEach\(\(r\) => r\.unregister\(\)\)/);
  assert.match(src, /keys\.filter\(\(k\) => !isAdminCache\(k\)\)\.forEach\(\(k\) => caches\.delete\(k\)\)/);
  assert.ok(!/regs\.forEach\(\(r\) => r\.unregister\(\)\)/.test(src));
});

test('the session middleware skips the admin manifest and service worker, but still guards the backoffice', () => {
  const { config } = load('middleware.ts', { '@/lib/supabase/middleware': { updateSession: async () => null } });
  const { getMiddlewareMatchers } = require('next/dist/build/analysis/get-page-static-info');
  const regexps = getMiddlewareMatchers(config.matcher, {}).map((m) => new RegExp(m.regexp));
  const guarded = (path) => regexps.some((r) => r.test(path));
  for (const path of ['/admin', '/admin/', '/admin/login', '/admin/carros/novo', '/admin/leads.rsc', '/api/admin/x']) assert.ok(guarded(path), path);
  for (const path of ['/admin/sw.js', '/admin/manifest.webmanifest', '/admin-icons/icon-192.png', '/']) assert.ok(!guarded(path), path);
});

test('the service worker script is never cached and may control /admin itself', () => {
  // Os cabeçalhos vêm da própria rota: o Netlify serve os ficheiros de
  // `public/` sem os do next.config.mjs, e sem `Service-Worker-Allowed` o
  // browser recusava o SW (e a app deixava de se poder instalar).
  assert.equal(swRoute.dynamic, 'force-static');
  const res = swRoute.GET();
  assert.match(res.headers.get('cache-control'), /no-cache/);
  assert.match(res.headers.get('content-type'), /^application\/javascript/);
  assert.equal(res.headers.get('service-worker-allowed'), pwa.ADMIN_SCOPE);
  assert.ok(!existsSync('public/admin/sw.js'), 'um ficheiro estático passava à frente da rota, sem os cabeçalhos');
  const register = readFileSync('src/components/admin/PwaRegister.tsx', 'utf8');
  assert.match(register, /register\(ADMIN_SW_URL, \{ scope: ADMIN_SCOPE \}\)/);
  assert.match(register, /process\.env\.NODE_ENV !== "production"/);
  assert.equal(pwa.ADMIN_SW_URL, '/admin/sw.js');
});
