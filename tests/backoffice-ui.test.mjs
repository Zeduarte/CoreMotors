// Barra mobile, histórico com nomes e o esquema do novo utilizador.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';
import { createLoader } from './support/load-ts.mjs';

const actor = '00000000-0000-4000-8000-0000000000a1';
const fakeDb = {
  from: () => {
    const api = new Proxy({}, { get: (_, k) => (k === 'then'
      ? (resolve) => resolve({ data: [{ id: 'l1', created_at: '2026-10-01T10:00:00Z', action: 'UPDATE', actor_id: actor, changed_fields: { price: { before: 1, after: 2 } } }], error: null })
      : () => api) });
    return api;
  },
  rpc: async (name) => ({ data: name === 'leave_directory' ? [{ id: actor, full_name: 'Ana Admin' }] : null, error: null }),
};
const load = createLoader({
  '@/lib/supabase/server': { createClient: async () => fakeDb },
  'next/navigation': { usePathname: () => '/admin', useRouter: () => ({ refresh() {} }) },
  'next/link': { __esModule: true, default: ({ href, children, ...p }) => React.createElement('a', { href, ...p }, children) },
  '@/lib/actions/auth': { logout: async () => {} },
});

test('a barra mobile é ela própria sticky e escondida em desktop (sem invólucro que a prenda)', () => {
  const { MobileNav } = load('src/components/admin/MobileNav.tsx');
  const html = renderToStaticMarkup(React.createElement(MobileNav, { user: { name: 'Ana', role: 'admin' }, sections: ['dashboard'] }));
  const header = html.match(/^<header class="([^"]+)"/);
  assert.ok(header, 'o elemento de topo é o <header>');
  for (const c of ['sticky', 'top-0', 'md:hidden', 'pt-[env(safe-area-inset-top)]']) assert.ok(header[1].split(' ').includes(c), c);
  const layout = readFileSync('src/app/admin/(dashboard)/layout.tsx', 'utf8');
  assert.ok(!/<div className="md:hidden"><MobileNav/.test(layout), 'o invólucro limitava o sticky à altura da barra');
});

test('o histórico mostra o nome de quem alterou', async () => {
  const { AuditHistory } = load('src/components/admin/AuditHistory.tsx');
  const html = renderToStaticMarkup(await AuditHistory({ entity: 'cars', id: 'c1' }));
  assert.ok(html.includes('Ana Admin'));
  assert.ok(!html.includes('Utilizador 00000000'));
});

test('novo utilizador: o email é obrigatório (não há entrada por telefone)', () => {
  const { newUserSchema } = load('src/lib/schemas.ts');
  const base = { full_name: 'Novo', password: '12345678', role: 'vendedor' };
  assert.equal(newUserSchema.safeParse({ ...base, email: '' }).success, false);
  assert.equal(newUserSchema.safeParse(base).success, false);
  assert.equal(newUserSchema.safeParse({ ...base, email: 'novo@stand.pt' }).success, true);
});
