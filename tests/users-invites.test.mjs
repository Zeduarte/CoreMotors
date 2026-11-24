// Utilizadores do backoffice: nomes de utilizador, convites (link de uso único
// com validade) e gestão só por administradores — na BD (0053), nas Server
// Actions, na página do convite e no middleware.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createLoader } from './support/load-ts.mjs';
import { bootDatabase, runMigrations, asUserFactory } from './support/pglite.mjs';

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const perms = createLoader()('src/lib/permissions.ts');

// ---------------------------------------------------------------------------
// Base de dados: a 0053 sobre dados que já existiam
// ---------------------------------------------------------------------------

const owner = '00000000-0000-4000-8000-0000000000c1';
const admin2 = '00000000-0000-4000-8000-0000000000c2';
const chefe = '00000000-0000-4000-8000-0000000000c3';
const curto = '00000000-0000-4000-8000-0000000000c4';
const semEmail = '00000000-0000-4000-8000-0000000000c5';
const chefeUsers = '00000000-0000-4000-8000-0000000000c6';
const soUsers = '00000000-0000-4000-8000-0000000000c7';

const db = await bootDatabase({ before: '0053' });
const asUser = asUserFactory(db);
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
let minute = 0;
for (const [id, role, email, sections] of [
  [owner, 'admin', 'dono@empresa.example', null],
  [admin2, 'admin', 'Jose_Duarte@empresa.example', null],
  [chefe, 'chefe', 'jose.duarte@outra.example', null],
  [curto, 'vendedor', 'ab@x.example', null],
  [semEmail, 'vendedor', null, null],
  [chefeUsers, 'chefe', 'chefe.leads@x.example', ['dashboard', 'carros', 'utilizadores']],
  [soUsers, 'vendedor', 'so.users@x.example', ['utilizadores']],
]) {
  await db.query('insert into auth.users(id,email) values($1,$2)', [id, email]);
  await db.query(
    `insert into public.profiles(id,role,email,full_name,allowed_sections,created_at)
     values($1,$2,$3,$3,$4, timestamptz '2026-01-01' + make_interval(mins => $5))`,
    [id, role, email, sections, minute++],
  );
}
await db.query('update public.profiles set is_owner = true where id = $1', [owner]);
await runMigrations(db, { from: '0053' });

test('0053: o dono fica «Core» e os restantes ganham um nome a partir do email', async () => {
  const names = Object.fromEntries((await db.query('select id, username from public.profiles')).rows.map((r) => [r.id, r.username]));
  assert.equal(names[owner], 'Core');
  assert.equal(names[admin2], 'jose.duarte', 'minúsculas, _ → .');
  assert.equal(names[chefe], 'jose.duarte-2', 'repetido ganha sufixo');
  assert.equal(names[curto], 'utilizador', 'curto demais');
  assert.equal(names[semEmail], 'utilizador-2');
  assert.equal(names[chefeUsers], 'chefe.leads');
});

test('0053: «utilizadores» sai dos acessos concedidos, sem deixar a lista vazia', async () => {
  assert.deepEqual((await one('select allowed_sections a from public.profiles where id=$1', [chefeUsers])).a, ['dashboard', 'carros']);
  // Vazia passava aos acessos por omissão do papel, mais largos.
  assert.deepEqual((await one('select allowed_sections a from public.profiles where id=$1', [soUsers])).a, ['dashboard']);
});

test('nome de utilizador: formato e unicidade sem olhar a maiúsculas', async () => {
  await assert.rejects(db.query("update public.profiles set username='CORE' where id=$1", [chefe]), /profiles_username_unique/);
  for (const bad of ['josé', 'ab', 'jose..duarte', '.jose', 'jose duarte', 'a@b.pt', 'x'.repeat(33)]) {
    await assert.rejects(db.query('update public.profiles set username=$2 where id=$1', [chefe, bad]), /profiles_username_format/, bad);
  }
  await db.query("update public.profiles set username='Jose-D_2' where id=$1", [chefe]);
  await db.query("update public.profiles set username='jose.duarte-2' where id=$1", [chefe]);
});

test('ninguém muda o próprio nome de utilizador pelo browser', async () => {
  await assert.rejects(
    asUser(chefe, () => db.query("update public.profiles set username='outro.nome' where id=$1", [chefe])),
    /permission denied/,
  );
});

test('login_email: traduz o nome no email de Auth (sem maiúsculas nem espaços), só para o servidor', async () => {
  const asService = (fn) => asUser(null, fn, 'service_role');
  for (const name of ['Core', 'core', ' CORE ']) {
    assert.equal((await asService(() => one('select public.login_email($1) e', [name]))).e, 'dono@empresa.example', name);
  }
  assert.equal((await asService(() => one("select public.login_email('ninguem') e"))).e, null);
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(asUser(owner, () => one("select public.login_email('core') e"), role), /permission denied/, role);
  }
});

test('convites: só o servidor lhes acede; um novo anula o anterior; cada um serve uma vez', async () => {
  const asService = (fn) => asUser(null, fn, 'service_role');
  const h1 = sha256('primeiro'); const h2 = sha256('segundo'); const h3 = sha256('terceiro');
  const create = (h) => asService(() => db.query(
    "select public.create_user_invite($1, $2, $3, now() + interval '7 days')", [curto, h, owner]));
  const claim = async (h) => (await asService(() => one('select public.claim_user_invite($1) u', [h]))).u;
  const release = (h) => asService(() => db.query('select public.release_user_invite($1)', [h]));

  await create(h1);
  await create(h2);
  assert.ok((await one('select used_at from public.user_invites where token_hash=$1', [h1])).used_at, 'o primeiro deixou de valer');
  assert.equal(await claim(h1), null);
  assert.equal(await claim(h2), curto);
  assert.equal(await claim(h2), null, 'uso único');

  // Palavra-passe recusada → o convite volta a servir…
  await release(h2);
  assert.equal(await claim(h2), curto);
  // …mas não depois de ter sido substituído.
  await create(h3);
  await release(h2);
  assert.equal(await claim(h2), null);

  // Expirado não serve, nem é devolvido.
  await db.query("update public.user_invites set created_at = now() - interval '8 days', expires_at = now() - interval '1 day' where token_hash=$1", [h3]);
  assert.equal(await claim(h3), null);
  await release(h3);
  assert.equal((await one('select used_at from public.user_invites where token_hash=$1', [h3])).used_at, null, 'expirado, por usar');
  assert.equal(await claim(h3), null);

  // Nem administradores nem anónimos leem a tabela ou chamam as funções.
  for (const role of ['anon', 'authenticated']) {
    await assert.rejects(asUser(owner, () => db.query('select * from public.user_invites'), role), /permission denied/, role);
    await assert.rejects(asUser(owner, () => one('select public.claim_user_invite($1) u', [h2]), role), /permission denied/, role);
    await assert.rejects(asUser(owner, () => db.query("select public.create_user_invite($1,$2,$3,now()+interval '1 day')", [owner, sha256('x'), owner]), role), /permission denied/, role);
  }
  await assert.rejects(db.query("insert into public.user_invites(user_id, token_hash, expires_at) values($1, 'nao-e-hash', now() + interval '1 day')", [curto]), /check/);
});

test('apagar o utilizador apaga os convites', async () => {
  await db.query("select public.create_user_invite($1, $2, $3, now() + interval '7 days')", [semEmail, sha256('apagar'), owner]);
  assert.equal((await one('select count(*)::int n from public.user_invites where user_id=$1', [semEmail])).n, 1);
  await db.query('delete from auth.users where id=$1', [semEmail]);
  assert.equal((await one('select count(*)::int n from public.user_invites where user_id=$1', [semEmail])).n, 0);
  assert.equal((await one('select count(*)::int n from public.profiles where id=$1', [semEmail])).n, 0);
});

test('«utilizadores» só para administradores, na BD e no TypeScript, mesmo se concedido', async () => {
  await db.query("update public.profiles set allowed_sections = array['dashboard','carros','utilizadores'] where id=$1", [chefeUsers]);
  for (const s of perms.ALL_SECTIONS) {
    const { ok } = await one('select public.has_section_for($1,$2) ok', [chefeUsers, s]);
    const allowed = ['dashboard', 'carros', 'utilizadores'];
    if (s === 'horas') continue; // pessoais, só no TypeScript
    assert.equal(ok, perms.canAccess('chefe', allowed, s), s);
  }
  assert.equal((await one("select public.has_section_for($1,'utilizadores') ok", [chefeUsers])).ok, false);
  assert.equal((await one("select public.has_section_for($1,'utilizadores') ok", [admin2])).ok, true);
  assert.equal(perms.canAccess('chefe', ['dashboard', 'utilizadores'], 'utilizadores'), false);
  assert.equal(perms.canAccess('vendedor', ['utilizadores'], 'utilizadores'), false);
  assert.equal(perms.canAccess('admin', [], 'utilizadores'), true);
  // Sem o separador, um chefe só lê o próprio perfil.
  const seen = await asUser(chefeUsers, () => db.query('select id from public.profiles'));
  assert.deepEqual(seen.rows.map((r) => r.id), [chefeUsers]);
  const all = await asUser(admin2, () => db.query('select id from public.profiles'));
  assert.ok(all.rows.length > 1, 'o admin vê todos');
});

test('só administradores gerem; outro administrador só o dono', () => {
  assert.equal(perms.canManage('admin', 'vendedor'), true);
  assert.equal(perms.canManage('admin', 'admin'), false);
  assert.equal(perms.canManage('admin', 'admin', true), true);
  for (const r of ['chefe', 'vendedor', 'mecanico']) {
    assert.equal(perms.canManage(r, 'vendedor', true), false, r);
    assert.deepEqual(perms.assignableRoles(r), [], r);
  }
});

// ---------------------------------------------------------------------------
// Server Actions de Utilizadores
// ---------------------------------------------------------------------------

const state = { me: null, admin: null };
const actionsLoad = createLoader({
  'next/navigation': { redirect: (url) => { throw new Error(`REDIRECT:${url}`); } },
  'next/cache': { revalidatePath() {} },
  '@/lib/admin-queries': { getCurrentProfile: async () => state.me },
  '@/lib/supabase/server': { createClient: async () => ({}) },
  '@/lib/supabase/admin': { createAdminClient: () => state.admin?.client ?? null },
});
const users = actionsLoad('src/lib/actions/users.ts');

const ME = { id: 'admin-id', role: 'admin', is_owner: false, allowed_sections: null };
const OWNER = { ...ME, id: 'owner-id', is_owner: true };

function fakeAdmin({ profiles = {}, lookup = null, createError = null } = {}) {
  const calls = [];
  const client = {
    rpc: async (name, args) => {
      calls.push(['rpc', name, args]);
      return name === 'login_email' ? { data: lookup, error: null } : { data: 'invite-id', error: null };
    },
    from: (table) => ({
      select: () => ({ eq: (_col, id) => ({ maybeSingle: async () => ({ data: profiles[id] ?? null }) }) }),
      upsert: async (row) => { calls.push(['upsert', table, row]); return { error: null }; },
      update: (row) => ({ eq: async (_col, id) => { calls.push(['update', table, row, id]); return { error: null }; } }),
    }),
    auth: {
      admin: {
        createUser: async (args) => {
          calls.push(['createUser', args]);
          return createError ? { data: { user: null }, error: createError } : { data: { user: { id: 'new-id' } }, error: null };
        },
        deleteUser: async (id) => { calls.push(['deleteUser', id]); return { error: null }; },
      },
    },
  };
  return { calls, client };
}

const TARGETS = {
  vend: { role: 'vendedor', is_owner: false },
  adm: { role: 'admin', is_owner: false },
  dono: { role: 'admin', is_owner: true },
};

test('quem não é administrador não cria, não gere nem apaga utilizadores (nem com o separador concedido)', async () => {
  for (const role of ['chefe', 'vendedor', 'mecanico']) {
    state.me = { id: 'x', role, is_owner: false, allowed_sections: ['dashboard', 'utilizadores'] };
    state.admin = fakeAdmin({ profiles: TARGETS });
    await assert.rejects(users.createUser({ username: 'novo.user' }), /REDIRECT:\/admin$/, role);
    await assert.rejects(users.createInviteLink('vend'), /REDIRECT:\/admin$/, role);
    await assert.rejects(users.updateUserAccess('vend', 'vendedor', ['dashboard']), /REDIRECT:\/admin$/, role);
    await assert.rejects(users.deleteUser('vend'), /REDIRECT:\/admin$/, role);
    assert.deepEqual(state.admin.calls, [], role);
  }
  state.me = null;
  await assert.rejects(users.createUser({ username: 'novo.user' }), /REDIRECT:\/admin\/login/);
});

test('criar utilizador: só o nome; conta sem palavra-passe, email interno, vendedor, e um link de convite', async () => {
  state.me = ME;
  state.admin = fakeAdmin();
  const before = Date.now();
  const res = await users.createUser({ username: ' jose.duarte ' });
  assert.equal(res.ok, true, res.error);
  const token = res.path.match(/^\/admin\/convite\/([A-Za-z0-9_-]{43})$/)?.[1];
  assert.ok(token, res.path);

  const [lookup, create, upsert, invite] = state.admin.calls;
  assert.deepEqual(lookup, ['rpc', 'login_email', { p_username: 'jose.duarte' }]);
  assert.equal(create[0], 'createUser');
  assert.equal(create[1].email, 'jose.duarte@utilizadores.coremotors.local');
  assert.equal(create[1].email_confirm, true);
  assert.ok(!('password' in create[1]), 'ninguém escolhe a palavra-passe por ela');
  assert.equal(upsert[2].username, 'jose.duarte');
  assert.equal(upsert[2].role, 'vendedor');
  assert.equal(upsert[2].allowed_sections, null);
  assert.equal(invite[1], 'create_user_invite');
  assert.equal(invite[2].p_user, 'new-id');
  assert.equal(invite[2].p_created_by, ME.id);
  assert.equal(invite[2].p_token_hash, sha256(token), 'na BD só o hash');
  const ttl = new Date(invite[2].p_expires_at).getTime() - before;
  assert.ok(ttl > 6.9 * 864e5 && ttl < 7.1 * 864e5, 'válido 7 dias');
  assert.equal(res.expiresAt, invite[2].p_expires_at);

  const again = await users.createUser({ username: 'outra.pessoa' });
  assert.notEqual(again.path, res.path, 'cada link é único');
});

test('criar utilizador: nome inválido ou repetido não cria nada', async () => {
  state.me = ME;
  state.admin = fakeAdmin();
  assert.match((await users.createUser({ username: 'josé' })).error, /sem acentos/);
  assert.match((await users.createUser({ username: 'jo' })).error, /pelo menos 3/);
  assert.deepEqual(state.admin.calls, []);

  state.admin = fakeAdmin({ lookup: 'alguem@x.example' });
  assert.match((await users.createUser({ username: 'Core' })).error, /Já existe um utilizador «Core»/);
  assert.equal(state.admin.calls.filter((c) => c[0] === 'createUser').length, 0);

  state.admin = fakeAdmin({ createError: { code: 'email_exists', status: 422 } });
  assert.match((await users.createUser({ username: 'jose.duarte' })).error, /Já existe/);
});

test('link de acesso novo: para outros, nunca para o dono, outro admin só pelo dono', async () => {
  state.admin = fakeAdmin({ profiles: TARGETS });
  state.me = ME;
  const res = await users.createInviteLink('vend');
  assert.equal(res.ok, true);
  assert.match(res.path, /^\/admin\/convite\//);
  assert.match((await users.createInviteLink('dono')).error, /dono da conta não pode/);
  assert.match((await users.createInviteLink('adm')).error, /Só o dono da conta/);
  assert.match((await users.createInviteLink(ME.id)).error, /si próprio/);
  state.me = OWNER;
  assert.equal((await users.createInviteLink('adm')).ok, true);
});

test('link de acesso para a própria conta: só o dono (acesso core), que não tem a quem o pedir', async () => {
  state.admin = fakeAdmin({ profiles: { ...TARGETS, [OWNER.id]: { role: 'admin', is_owner: true } } });
  state.me = OWNER;
  const res = await users.createInviteLink(OWNER.id);
  assert.equal(res.ok, true, res.error);
  assert.match(res.path, /^\/admin\/convite\/[A-Za-z0-9_-]{43}$/);
  const invite = state.admin.calls.find((c) => c[1] === 'create_user_invite');
  assert.equal(invite[2].p_user, OWNER.id);
  assert.equal(invite[2].p_created_by, OWNER.id);
  // Um administrador que não é o dono continua a não poder.
  state.me = ME;
  state.admin = fakeAdmin({ profiles: { [ME.id]: { role: 'admin', is_owner: false } } });
  assert.match((await users.createInviteLink(ME.id)).error, /si próprio/);
  assert.deepEqual(state.admin.calls, []);
});

test('mudar a própria palavra-passe: confirma a atual, valida a nova, nunca a regista', async () => {
  const calls = [];
  let currentOk = true;
  let updateError = null;
  const client = {
    auth: {
      getUser: async () => ({ data: { user: state.me ? { email: 'core@x.example' } : null } }),
      signInWithPassword: async (args) => {
        calls.push(['signIn', args.email]);
        return { error: currentOk ? null : { code: 'invalid_credentials', status: 400 } };
      },
      updateUser: async (args) => {
        calls.push(['update', 'password' in args]);
        return { error: updateError };
      },
    },
  };
  const profile = createLoader({
    'next/cache': { revalidatePath() {} },
    '@/lib/admin-queries': { getCurrentProfile: async () => state.me },
    '@/lib/supabase/server': { createClient: async () => client },
  })('src/lib/actions/profile.ts');
  const form = (o) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  const good = { current_password: 'antiga123', new_password: 'NovaSenha2026', confirm_password: 'NovaSenha2026' };
  state.me = OWNER;

  assert.deepEqual(await profile.changeMyPassword(form(good)), { ok: true });
  assert.deepEqual(calls, [['signIn', 'core@x.example'], ['update', true]]);

  calls.length = 0;
  currentOk = false;
  assert.match((await profile.changeMyPassword(form(good))).error, /atual não está certa/);
  assert.deepEqual(calls, [['signIn', 'core@x.example']], 'sem a atual certa, não grava');

  calls.length = 0;
  currentOk = true;
  assert.match((await profile.changeMyPassword(form({ ...good, confirm_password: 'outra' }))).error, /não são iguais/);
  assert.match((await profile.changeMyPassword(form({ ...good, new_password: 'curta', confirm_password: 'curta' }))).error, /pelo menos 8/);
  assert.match((await profile.changeMyPassword(form({ ...good, current_password: '' }))).error, /atual/);
  assert.match(
    (await profile.changeMyPassword(form({ current_password: 'igual12345', new_password: 'igual12345', confirm_password: 'igual12345' }))).error,
    /diferente/,
  );
  assert.deepEqual(calls, [], 'erros de formulário nem chegam ao Auth');

  updateError = { code: 'weak_password', status: 422 };
  assert.match((await profile.changeMyPassword(form(good))).error, /fraca/);

  state.me = null;
  updateError = null;
  assert.match((await profile.changeMyPassword(form(good))).error, /Sessão expirada/);
});

test('gerir acessos: «utilizadores» nunca se concede; apagar só com permissão', async () => {
  state.me = ME;
  state.admin = fakeAdmin({ profiles: TARGETS });
  assert.equal((await users.updateUserAccess('vend', 'chefe', ['carros', 'utilizadores', 'inventado'], ['car'])).ok, true);
  const [, , row, id] = state.admin.calls.find((c) => c[0] === 'update');
  assert.equal(id, 'vend');
  assert.deepEqual([...row.allowed_sections].sort(), ['carros', 'dashboard']);
  assert.deepEqual(row.allowed_vehicle_types, ['car']);

  assert.match((await users.deleteUser('adm')).error, /Só o dono da conta pode apagar/);
  assert.equal((await users.deleteUser('vend')).ok, true);
  assert.deepEqual(state.admin.calls.at(-1), ['deleteUser', 'vend']);
});

// ---------------------------------------------------------------------------
// Usar o convite
// ---------------------------------------------------------------------------

function inviteAction({ claim = 'user-1', pwError = null, signInError = null } = {}) {
  const calls = [];
  const logs = [];
  const load = createLoader({
    'next/navigation': { redirect: (url) => { throw new Error(`REDIRECT:${url}`); } },
    '@/lib/supabase/admin': {
      createAdminClient: () => ({
        rpc: async (name, args) => { calls.push([name, args]); return { data: name === 'claim_user_invite' ? claim : null, error: null }; },
        auth: { admin: { updateUserById: async (id, attrs) => {
          calls.push(['updateUserById', id, attrs]);
          return pwError ? { data: { user: null }, error: pwError } : { data: { user: { id, email: 'jose.duarte@utilizadores.coremotors.local' } }, error: null };
        } } },
      }),
    },
    '@/lib/supabase/server': {
      createClient: async () => ({ auth: { signInWithPassword: async (c) => { calls.push(['signIn', c]); return { error: signInError }; } } }),
    },
  });
  const { acceptInvite } = load('src/lib/actions/invites.ts');
  return {
    calls, logs,
    accept: async (fields) => {
      const data = new FormData();
      for (const [k, v] of Object.entries(fields)) data.set(k, v);
      const warn = console.warn;
      console.warn = (...a) => logs.push(a);
      try { return await acceptInvite({}, data); } finally { console.warn = warn; }
    },
  };
}
const TOKEN = 'A'.repeat(20) + '_-' + 'b'.repeat(21);

test('convite: define a palavra-passe e entra logo, com o convite gasto antes', async () => {
  const { accept, calls } = inviteAction();
  await assert.rejects(accept({ token: TOKEN, password: 'segredo-novo-1', confirm: 'segredo-novo-1' }), /REDIRECT:\/admin$/);
  assert.deepEqual(calls[0], ['claim_user_invite', { p_token_hash: sha256(TOKEN) }]);
  assert.deepEqual(calls[1], ['updateUserById', 'user-1', { password: 'segredo-novo-1' }]);
  assert.deepEqual(calls[2], ['signIn', { email: 'jose.duarte@utilizadores.coremotors.local', password: 'segredo-novo-1' }]);
});

test('convite: link inválido, gasto ou expirado, e palavras-passe que não servem', async () => {
  let a = inviteAction();
  assert.match((await a.accept({ token: 'curto', password: 'segredo-novo-1', confirm: 'segredo-novo-1' })).error, /não é válido/);
  assert.match((await a.accept({ token: TOKEN, password: 'curta', confirm: 'curta' })).error, /pelo menos 8/);
  assert.match((await a.accept({ token: TOKEN, password: 'segredo-novo-1', confirm: 'segredo-novo-2' })).error, /não são iguais/);
  assert.match((await a.accept({ token: TOKEN, password: 'x'.repeat(73), confirm: 'x'.repeat(73) })).error, /no máximo 72/);
  assert.deepEqual(a.calls, [], 'nada chega à BD');

  a = inviteAction({ claim: null });
  assert.match((await a.accept({ token: TOKEN, password: 'segredo-novo-1', confirm: 'segredo-novo-1' })).error, /já foi usado ou expirou/);
  assert.equal(a.calls.filter((c) => c[0] === 'updateUserById').length, 0);
});

test('convite: palavra-passe recusada pelo Auth devolve o convite e não regista a palavra-passe', async () => {
  const a = inviteAction({ pwError: { code: 'weak_password', status: 422, message: 'segredo-fraco' } });
  assert.match((await a.accept({ token: TOKEN, password: 'segredo-fraco', confirm: 'segredo-fraco' })).error, /demasiado fraca/);
  assert.deepEqual(a.calls.at(-1), ['release_user_invite', { p_token_hash: sha256(TOKEN) }]);
  assert.doesNotMatch(JSON.stringify(a.logs), /segredo/);
});

test('convite: se a entrada automática falhar, vai para o login com aviso', async () => {
  const a = inviteAction({ signInError: { code: 'unexpected_failure', status: 500 } });
  await assert.rejects(a.accept({ token: TOKEN, password: 'segredo-novo-1', confirm: 'segredo-novo-1' }), /REDIRECT:\/admin\/login\?convite=ok/);
});

// ---------------------------------------------------------------------------
// Página do convite
// ---------------------------------------------------------------------------

async function renderInvite(token, invite, username = 'jose.duarte') {
  const load = createLoader({
    'next/link': { __esModule: true, default: ({ href, children, ...p }) => React.createElement('a', { href, ...p }, children) },
    '@/lib/actions/invites': { acceptInvite: async () => ({}) },
    '@/lib/supabase/admin': {
      createAdminClient: () => ({
        from: (table) => ({ select: () => ({ eq: (col, value) => ({ maybeSingle: async () => {
          if (table === 'user_invites') return { data: col === 'token_hash' && value === sha256(token) ? invite : null };
          return { data: { username } };
        } }) }) }),
      }),
    },
  });
  const { default: Page, metadata } = load('src/app/admin/convite/[token]/page.tsx');
  assert.equal(metadata.referrer, 'no-referrer', 'o token não sai pelo Referer');
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ token }) }));
}

test('página do convite: formulário só para um convite válido; usado, expirado e inválido explicam o que fazer', async () => {
  const future = new Date(Date.now() + 864e5).toISOString();
  const past = new Date(Date.now() - 1000).toISOString();
  const ok = await renderInvite(TOKEN, { user_id: 'u', expires_at: future, used_at: null });
  assert.match(ok, /value="jose\.duarte"/);
  assert.match(ok, /name="password"/);
  assert.match(ok, /name="confirm"/);
  assert.match(ok, /autoComplete="new-password"|autocomplete="new-password"/i);

  const used = await renderInvite(TOKEN, { user_id: 'u', expires_at: future, used_at: past });
  assert.match(used, /Link já usado/);
  assert.doesNotMatch(used, /name="password"/);
  assert.match(await renderInvite(TOKEN, { user_id: 'u', expires_at: past, used_at: null }), /Link expirado/);
  assert.match(await renderInvite('nao-e-um-token', null), /Link inválido/);
  assert.match(await renderInvite(TOKEN, null), /Link inválido/);
});

// ---------------------------------------------------------------------------
// Middleware: o convite abre-se sem sessão
// ---------------------------------------------------------------------------

test('middleware: o link de convite abre sem sessão; o resto do backoffice continua a pedir login', async () => {
  const load = createLoader({
    'next/server': { NextResponse: { next: () => ({ kind: 'next', cookies: { set() {} } }), redirect: (url) => ({ kind: 'redirect', url: String(url) }) } },
    '@supabase/ssr': { createServerClient: () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) },
  });
  const { updateSession } = load('src/lib/supabase/middleware.ts');
  const request = (path) => ({
    cookies: { getAll: () => [], set() {} },
    nextUrl: { pathname: path, search: '', clone: () => new URL(`http://localhost${path}`) },
  });
  assert.equal((await updateSession(request(`/admin/convite/${TOKEN}`))).kind, 'next');
  for (const path of ['/admin/carros', '/admin/convite', `/admin/convite/${TOKEN}/outra`]) {
    const res = await updateSession(request(path));
    assert.equal(res.kind, 'redirect', path);
    assert.match(res.url, /\/admin\/login/, path);
  }
});

// ---------------------------------------------------------------------------
// Ajudas puras
// ---------------------------------------------------------------------------

test('tokens: 43 caracteres base64url, hash sha256, estados do convite', () => {
  const inv = createLoader()('src/lib/user-invites.ts');
  const { token, hash } = inv.newInviteToken();
  assert.equal(inv.isInviteToken(token), true);
  assert.equal(hash, sha256(token));
  assert.equal(inv.hashInviteToken('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(inv.isInviteToken(token + 'x'), false);
  assert.equal(inv.isInviteToken('../../etc/passwd'.padEnd(43, 'a')), false);
  const now = Date.parse('2026-11-17T12:00:00Z');
  assert.equal(inv.inviteState({ expires_at: '2026-11-18T00:00:00Z', used_at: null }, now), 'pending');
  assert.equal(inv.inviteState({ expires_at: '2026-11-17T11:00:00Z', used_at: null }, now), 'expired');
  assert.equal(inv.inviteState({ expires_at: '2026-11-18T00:00:00Z', used_at: '2026-11-17T10:00:00Z' }, now), 'used');

  const u = createLoader()('src/lib/usernames.ts');
  assert.equal(u.internalEmail(' Jose.Duarte '), 'jose.duarte@utilizadores.coremotors.local');
  assert.equal(u.isInternalEmail('jose.duarte@utilizadores.coremotors.local'), true);
  assert.equal(u.isInternalEmail('dono@empresa.example'), false);
  assert.equal(u.isUsername('Core'), true);
  // 40 letras, 80 bytes: o bcrypt cortava-a sem avisar.
  assert.match(u.passwordProblem('ç'.repeat(40), 'ç'.repeat(40)), /no máximo 72/);
  assert.equal(u.passwordProblem('ç'.repeat(36), 'ç'.repeat(36)), null);
});

test('editar dados (nome e telemóvel) de outra pessoa: só o dono; valida e avisa de telemóvel repetido', async () => {
  const calls = [];
  let updateError = null;
  const client = {
    from: (table) => ({
      update: (row) => ({
        eq: (_c, id) => ({
          select: async () => {
            calls.push([table, row, id]);
            return updateError ? { data: null, error: updateError } : { data: id === 'nao-existe' ? [] : [{ id }], error: null };
          },
        }),
      }),
    }),
  };
  state.admin = { client, calls };
  const id = '11111111-1111-4111-8111-111111111111';
  state.me = ME;
  assert.match((await users.updateUserDetails(id, { full_name: 'Ana', phone: '912345678' })).error, /Só o dono/);
  assert.deepEqual(calls, []);

  state.me = OWNER;
  assert.deepEqual(await users.updateUserDetails(id, { full_name: '  Ana Silva ', phone: ' +351 912 345 678 ' }), { ok: true });
  assert.deepEqual(calls[0], ['profiles', { full_name: 'Ana Silva', phone: '+351 912 345 678' }, id]);
  // Telemóvel vazio fica sem telemóvel; nome curto e telefone com letras recusados.
  await users.updateUserDetails(id, { full_name: 'Ana Silva', phone: '' });
  assert.equal(calls[1][1].phone, null);
  assert.match((await users.updateUserDetails(id, { full_name: 'A', phone: '' })).error, /nome/);
  assert.match((await users.updateUserDetails(id, { full_name: 'Ana', phone: '91x' })).error, /Telefone inválido/);
  assert.match((await users.updateUserDetails('../x', { full_name: 'Ana', phone: '' })).error, /inválido/);
  updateError = { code: '23505' };
  assert.match((await users.updateUserDetails(id, { full_name: 'Ana', phone: '912345678' })).error, /já está associado/);
});

test('teste do WhatsApp para outra pessoa: só o dono, e só para quem tem telemóvel', async () => {
  const sent = [];
  const profiles = {
    '11111111-1111-4111-8111-111111111111': { phone: '912 345 678', full_name: 'Ana' },
    '22222222-2222-4222-8222-222222222222': { phone: null, full_name: 'Rui' },
  };
  const notif = createLoader({
    'next/cache': { revalidatePath() {} },
    '@/lib/admin-queries': { getCurrentProfile: async () => state.me },
    '@/lib/guard': { requireAdmin: async () => state.me, requireSection: async () => state.me },
    '@/lib/supabase/server': { createClient: async () => ({}) },
    '@/lib/supabase/admin': {
      createAdminClient: () => ({
        from: () => ({ select: () => ({ eq: (_c, id) => ({ maybeSingle: async () => ({ data: profiles[id] ?? null }) }) }) }),
      }),
    },
    '@/lib/whatsapp/account': { whatsAppNumber: async () => ({ accessToken: 't', phoneNumberId: 'p' }) },
    '@/lib/notifications': { backofficeBaseUrl: () => 'https://stand.pt' },
    '@/lib/notifications-kick': { deliverNotificationsSoon() {} },
    '@/lib/whatsapp/templates-create': { createMessageTemplates: async () => ({ ok: true, lines: [] }) },
    '@/lib/whatsapp/send-template': {
      NOTIFICATION_TEMPLATES: { lead: { example: ['a'] }, aviso: { example: ['b'] } },
      templateLanguage: () => 'pt_PT',
      templateName: (f) => `t_${f}`,
      sendWhatsAppTemplate: async (to, t) => (sent.push([to, t.name]), { ok: true }),
    },
  })('src/lib/actions/notifications.ts');

  state.me = ME;
  assert.match((await notif.sendWhatsAppTestToUser('11111111-1111-4111-8111-111111111111')).error, /Só o dono/);
  assert.deepEqual(sent, []);
  state.me = OWNER;
  assert.deepEqual(await notif.sendWhatsAppTestToUser('11111111-1111-4111-8111-111111111111'), { ok: true });
  assert.deepEqual(sent, [['351912345678', 't_lead'], ['351912345678', 't_aviso']]);
  assert.match((await notif.sendWhatsAppTestToUser('22222222-2222-4222-8222-222222222222')).error, /Rui não tem telemóvel/);
  assert.match((await notif.sendWhatsAppTestToUser('33333333-3333-4333-8333-333333333333')).error, /não encontrado/);
});
