import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoader } from './support/load-ts.mjs';

/**
 * O login com `signIn` (o signInWithPassword do Supabase) e `lookup` (o que a
 * BD responde a `login_email`; `null` = sem chave de serviço).
 */
function action(signIn, lookup = async () => ({ data: null, error: null })) {
  const logs = [];
  const calls = { signIn: [], lookup: [] };
  const load = createLoader({
    'next/navigation': { redirect: (url) => { throw new Error(`REDIRECT:${url}`); } },
    '@/lib/supabase/server': {
      createClient: async () => ({ auth: { signInWithPassword: async (creds) => { calls.signIn.push(creds); return signIn(creds); } } }),
    },
    '@/lib/supabase/admin': {
      createAdminClient: () => lookup === null ? null : ({
        rpc: async (name, args) => { calls.lookup.push([name, args]); return lookup(args); },
      }),
    },
  });
  const realWarn = console.warn;
  const mod = load('src/lib/actions/auth.ts');
  const wrap = (fn) => async (...args) => {
    console.warn = (...a) => logs.push(a);
    try { return await fn(...args); } finally { console.warn = realWarn; }
  };
  return { login: wrap(mod.login), logs, calls };
}
function form(username = 'jose.duarte', password = 'test-secret') {
  const data = new FormData();
  data.set('username', username);
  data.set('password', password);
  return data;
}

test('login distinguishes rejected credentials, account restrictions and service failures without logging secrets', async () => {
  for (const [error, expected] of [
    [{ code: 'invalid_credentials', status: 400 }, /Nome de utilizador ou palavra-passe incorretos/],
    [{ code: 'email_not_confirmed', status: 400 }, /ainda não está ativa/],
    [{ code: 'user_banned', status: 403 }, /suspenso/],
    [{ status: 429 }, /Demasiadas tentativas/],
    [{ status: 503 }, /serviço de autenticação/],
  ]) {
    const { login, logs } = action(async () => ({ error: { ...error, message: 'test-secret' } }));
    assert.match((await login({}, form())).error, expected);
    assert.doesNotMatch(JSON.stringify(logs), /test-secret|jose\.duarte|example/);
  }
});

test('a connection failure returns an actionable error and a successful login still redirects', async () => {
  const offline = action(async () => { throw new TypeError('fetch failed'); });
  assert.match((await offline.login({}, form())).error, /Verifique a ligação/);
  const success = action(async () => ({ error: null }));
  await assert.rejects(success.login({}, form()), /REDIRECT:\/admin/);
});

test('login por nome de utilizador: o email de Auth vem da BD (contas antigas, como o dono «Core»)', async () => {
  const { login, calls, logs } = action(
    async () => ({ error: null }),
    async () => ({ data: 'dono@empresa.example', error: null }),
  );
  await assert.rejects(login({}, form('Core', 'a-mesma-de-sempre')), /REDIRECT:\/admin/);
  assert.deepEqual(calls.lookup, [['login_email', { p_username: 'Core' }]]);
  assert.deepEqual(calls.signIn, [{ email: 'dono@empresa.example', password: 'a-mesma-de-sempre' }]);
  assert.doesNotMatch(JSON.stringify(logs), /dono@|a-mesma/);
});

test('login por nome de utilizador: contas novas usam o email interno; um nome desconhecido dá a mesma resposta', async () => {
  // A BD não conhece o nome → email interno; o Auth recusa como palavra-passe errada.
  const unknown = action(async () => ({ error: { code: 'invalid_credentials', status: 400 } }));
  assert.match((await unknown.login({}, form('Ninguem.Aqui'))).error, /^Nome de utilizador ou palavra-passe incorretos\.$/);
  assert.deepEqual(unknown.calls.signIn.map((c) => c.email), ['ninguem.aqui@utilizadores.coremotors.local']);

  // Sem chave de serviço não há consulta: vai direto ao email interno.
  const noKey = action(async () => ({ error: null }), null);
  await assert.rejects(noKey.login({}, form('jose.duarte')), /REDIRECT/);
  assert.deepEqual(noKey.calls.signIn.map((c) => c.email), ['jose.duarte@utilizadores.coremotors.local']);

  // Se a consulta falhar, também (e regista só o código).
  const broken = action(async () => ({ error: null }), async () => ({ data: null, error: { code: 'PGRST202', message: 'jose.duarte' } }));
  await assert.rejects(broken.login({}, form('jose.duarte')), /REDIRECT/);
  assert.deepEqual(broken.calls.signIn.map((c) => c.email), ['jose.duarte@utilizadores.coremotors.local']);
  assert.match(JSON.stringify(broken.logs), /PGRST202/);
  assert.doesNotMatch(JSON.stringify(broken.logs), /jose/);
});

test('login: um email ou um nome inválido não chega ao Supabase; campos vazios pedem-se', async () => {
  for (const bad of ['jose@empresa.pt', 'josé', 'jo', 'jose duarte']) {
    const { login, calls } = action(async () => ({ error: null }));
    assert.match((await login({}, form(bad))).error, /Nome de utilizador ou palavra-passe incorretos/, bad);
    assert.equal(calls.signIn.length + calls.lookup.length, 0, bad);
  }
  const { login } = action(async () => ({ error: null }));
  assert.match((await login({}, form('', 'x'))).error, /Preencha o nome de utilizador e a palavra-passe/);
  assert.match((await login({}, form('jose.duarte', ''))).error, /Preencha/);
  // Espaços à volta do nome não contam.
  const trimmed = action(async () => ({ error: null }));
  await assert.rejects(trimmed.login({}, form('  jose.duarte ')), /REDIRECT/);
  assert.deepEqual(trimmed.calls.lookup, [['login_email', { p_username: 'jose.duarte' }]]);
});

test('depois do login só se vai para o backoffice: o caminho é normalizado antes de se ver', async () => {
  const success = action(async () => ({ error: null }));
  const go = async (target) => {
    const data = form();
    data.set('redirect', target);
    try { await success.login({}, data); } catch (e) { return e.message.replace('REDIRECT:', ''); }
    return null;
  };
  assert.equal(await go('/admin/carros?tipo=motas'), '/admin/carros?tipo=motas');
  assert.equal(await go('/admin'), '/admin');
  for (const bad of ['/admin/../../inventario', '/admin/%2e%2e/inventario', '//evil.example/admin', '/admin\\@evil', 'https://evil.example/admin', '/administrador', '/inventario']) {
    assert.equal(await go(bad), '/admin', bad);
  }
});

test('o formulário de login pede o nome de utilizador, não o email', async () => {
  const React = (await import('react')).default;
  const { renderToStaticMarkup } = await import('react-dom/server');
  const load = createLoader({ '@/lib/actions/auth': { login: async () => ({}) } });
  const { LoginForm } = load('src/components/admin/LoginForm.tsx');
  const html = renderToStaticMarkup(React.createElement(LoginForm, { redirectTo: '/admin' }));
  assert.match(html, /name="username"/);
  assert.match(html, /autoComplete="username"|autocomplete="username"/i);
  assert.match(html, /Nome de utilizador/);
  assert.doesNotMatch(html, /type="email"|name="email"/);
});
