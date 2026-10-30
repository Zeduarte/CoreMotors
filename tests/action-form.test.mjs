// Formulários do backoffice (ActionForm): o que se escreveu só se limpa quando a
// gravação corre bem. Com `<form action={fn}>` o React 19 limpava-o sempre —
// num erro de validação ou ao cancelar a confirmação, perdia-se o texto.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const STUBS = { 'next/navigation': { useRouter: () => ({ refresh() {}, push() {} }) }, sonner: { toast: { success() {} } } };
const cache = new Map();
function withExt(base) { for (const ext of ['.ts', '.tsx']) if (existsSync(base + ext)) return base + ext; throw new Error(base); }
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const mod = { exports: {} }; cache.set(path, mod.exports);
  const r = (id) => id in STUBS ? STUBS[id] : id.startsWith('@/') ? load(withExt(`src/${id.slice(2)}`)) : require(id);
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, r);
  return mod.exports;
}
const { submitActionForm } = load('src/lib/action-form.ts');
const { ActionForm } = load('src/components/admin/ActionForm.tsx');

function deps(over = {}) {
  const log = { reset: 0, errors: [], success: [], calls: 0 };
  return { log, d: { confirm: () => true, data: () => new FormData(), action: async () => { log.calls++; return { ok: true }; },
    onError: (m) => log.errors.push(m), onSuccess: (r) => log.success.push(r), reset: () => log.reset++, ...over(log) } };
}

await test('an error keeps what was typed; success clears it', async () => {
  let { log, d } = deps(() => ({ action: async () => ({ ok: false, error: 'Indique o motivo de perda' }) }));
  assert.equal(await submitActionForm(d), 'error');
  assert.deepEqual([log.reset, log.errors], [0, ['Indique o motivo de perda']]);
  ({ log, d } = deps(() => ({ action: async () => { throw new Error('rede'); } })));
  assert.equal(await submitActionForm(d), 'error');
  assert.equal(log.reset, 0);
  ({ log, d } = deps(() => ({})));
  assert.equal(await submitActionForm(d), 'ok');
  assert.equal(log.reset, 1);
});

await test('cancelling the confirmation does nothing at all', async () => {
  const { log, d } = deps((l) => ({ confirmText: 'Cancelar a reserva?', confirm: () => false, action: async () => { l.calls++; return { ok: true }; } }));
  assert.equal(await submitActionForm(d), 'cancelled');
  assert.deepEqual([log.calls, log.reset, log.errors.length], [0, 0, 0]);
});

await test('the form is submitted by onSubmit, not as a React form action (which resets fields)', () => {
  const html = renderToStaticMarkup(React.createElement(ActionForm, { action: async () => ({ ok: true }) }, React.createElement('input', { name: 'x', defaultValue: 'a' })));
  assert.doesNotMatch(html, /action=/, 'sem `action`: o React não limpa o formulário sozinho');
  assert.match(html, /<form/);
});
