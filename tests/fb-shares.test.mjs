// Partilhas no Facebook: regras (fila, sugestões, duplicados), base de dados
// (cada utilizador só vê o que é seu) e a extensão (só obedece a sites
// autorizados e só abre o Facebook).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createLoader } from './support/load-ts.mjs';
import { bootDatabase, addUser, asUserFactory } from './support/pglite.mjs';

const load = createLoader();
const fb = load('src/lib/fb-shares.ts');
const perms = load('src/lib/permissions.ts');

// ---------------------------------------------------------------------------
// Regras
// ---------------------------------------------------------------------------

const car = { id: 'ad1', price: 13450, vehicle_type: 'car' };
const moto = { id: 'ad2', price: 4000, vehicle_type: 'motorcycle' };

test('sugestões pelo nome do grupo: peças, motas, carros, clássicos e preço máximo', () => {
  assert.equal(fb.suggestExclusion('Marketplace Portugal, Compra & Venda ✔️', car), '');
  assert.equal(fb.suggestExclusion('AUTOMÓVEIS SANTO TIRSO', car), '');
  assert.match(fb.suggestExclusion('Peças auto usadas', car), /peças/);
  assert.match(fb.suggestExclusion('Motas e Scooters Norte', car), /motas/i);
  assert.equal(fb.suggestExclusion('Motas e Scooters Norte', moto), '');
  assert.match(fb.suggestExclusion('Carros usados Porto', moto), /carros/i);
  assert.equal(fb.suggestExclusion('Auto - Compra & Vendas ou Troca de carros e motas', moto), '');
  assert.match(fb.suggestExclusion('Clássicos portugueses', car), /clássicos/);
  assert.match(fb.suggestExclusion('Carros Usados Até 10.000€', car), /10.000/);
  assert.equal(fb.suggestExclusion('Carros Usados Até 50,000€ PORTUGAL', car), '');
  assert.match(fb.suggestExclusion('Receitas da avó', car), /Sem indicação/);
  assert.match(fb.suggestExclusion('Venda de Bilhetes', car), /bilhetes/);
  assert.match(fb.suggestExclusion('Compra - Venda - Troca de Bilhetes', moto), /bilhetes/);
  assert.match(fb.suggestExclusion('Reticket - Vende os teus bilhetes', car), /bilhetes/);
  assert.match(fb.suggestExclusion('Imóveis Porto - compra e venda', car), /imóveis/);
  assert.equal(fb.suggestExclusion('Vendas e Trocas', car), '');
});

test('a fila: pela ordem do Facebook, sem os excluídos, os que saíram e os já partilhados', () => {
  const groups = [
    { id: 'g3', name: 'Carros Norte', position: 3, include: null },
    { id: 'g1', name: 'Carros Sul', position: 1, include: null },
    { id: 'g2', name: 'Motas Centro', position: 2, include: null }, // sugestão: fora
    { id: 'g4', name: 'Receitas', position: 4, include: true }, // escolha do utilizador: dentro
    { id: 'g5', name: 'Carros Este', position: 5, include: false }, // escolha: fora
    { id: 'g6', name: 'Carros Oeste', position: null, include: null }, // saiu do grupo
    { id: 'g7', name: 'Carros Ilhas', position: 7, include: null },
    { id: 'g8', name: 'Carros Interior', position: 8, include: null },
  ];
  const attempts = [
    { group_id: 'g7', ad_id: 'ad1', status: 'confirmed', created_at: '2026-11-01T10:00:00Z' },
    // Falhou e depois foi desbloqueado: volta à fila.
    { group_id: 'g8', ad_id: 'ad1', status: 'uncertain', created_at: '2026-11-01T10:00:00Z' },
    { group_id: 'g8', ad_id: 'ad1', status: 'reset', created_at: '2026-11-02T10:00:00Z' },
    // Noutro anúncio não conta.
    { group_id: 'g1', ad_id: 'outro', status: 'confirmed', created_at: '2026-11-01T10:00:00Z' },
  ];
  assert.deepEqual(fb.buildQueue(groups, attempts, car).map((g) => g.id), ['g1', 'g3', 'g4', 'g8']);
  for (const s of ['confirmed', 'pending', 'uncertain', 'rate_limited']) assert.equal(fb.isBlocked(s), true, s);
  for (const s of ['failed', 'reset', undefined]) assert.equal(fb.isBlocked(s), false, String(s));
});

test('grupos lidos: chaves pelo endereço, sem repetidos nem lixo, pela ordem recebida', () => {
  const out = fb.cleanScannedGroups([
    { key: '123', name: '  Carros  Norte ', url: 'https://www.facebook.com/groups/123/?ref=x' },
    { key: '123', name: 'Repetido', url: 'https://www.facebook.com/groups/123/' },
    { key: 'carrosul', name: 'Carros Sul', url: 'https://evil.example/groups/carrosul/' },
    { key: '../x', name: 'Chave má' },
    { name: 'x' },
    'lixo',
  ]);
  assert.deepEqual(out, [
    { key: '123', name: 'Carros Norte', url: 'https://www.facebook.com/groups/123/' },
    { key: 'carrosul', name: 'Carros Sul', url: null },
    { key: 'nome:chave ma', name: 'Chave má', url: null },
  ]);
  assert.equal(fb.groupKeyFromUrl('https://www.facebook.com/groups/joins/'), null);
  assert.deepEqual(fb.parseManualGroups('Grupo A\n\nhttps://web.facebook.com/groups/999/\nGrupo A').map((g) => g.key), [
    'nome:grupo a',
    '999',
  ]);
  assert.equal(fb.isFacebookUrl('https://www.facebook.com/marketplace/item/1/'), true);
  assert.equal(fb.isFacebookUrl('http://www.facebook.com/x'), false);
  assert.equal(fb.isFacebookUrl('https://facebook.com.evil.example/'), false);
  assert.equal(fb.isFbUserId('100012345'), true);
  assert.equal(fb.isFbUserId('abc'), false);
});

test('o separador Partilhas existe no menu e nas permissões', () => {
  const nav = load('src/components/admin/admin-nav.ts');
  assert.ok(perms.ALL_SECTIONS.includes('partilhas'));
  assert.ok(nav.ADMIN_NAV.some((i) => i.href === '/admin/partilhas' && i.section === 'partilhas'));
  assert.ok(nav.ADMIN_NAV_GROUPS.some((g) => g.hrefs.includes('/admin/partilhas')));
  assert.equal(perms.canAccess('vendedor', [], 'partilhas'), true);
  assert.equal(perms.canAccess('vendedor', ['dashboard', 'carros'], 'partilhas'), false);
  assert.equal(perms.canAccess('mecanico', [], 'partilhas'), false);
});

// ---------------------------------------------------------------------------
// Base de dados
// ---------------------------------------------------------------------------

const db = await bootDatabase();
const asUser = asUserFactory(db);
const admin = '00000000-0000-4000-8000-0000000000a1';
const ana = '00000000-0000-4000-8000-0000000000a2';
const rui = '00000000-0000-4000-8000-0000000000a3';
const semAcesso = '00000000-0000-4000-8000-0000000000a4';
const chefe = '00000000-0000-4000-8000-0000000000a5';
const mecanico = '00000000-0000-4000-8000-0000000000a6';
await addUser(db, admin, 'admin');
await addUser(db, ana, 'vendedor', 'Ana');
await addUser(db, rui, 'vendedor', 'Rui');
await addUser(db, semAcesso, 'vendedor', 'Sem acesso');
await addUser(db, chefe, 'chefe');
await addUser(db, mecanico, 'mecanico');
await db.query("update public.profiles set allowed_sections=array['dashboard','carros'] where id=$1", [semAcesso]);

const one = async (sql, params) => (await db.query(sql, params)).rows[0];

test('has_section_for na BD bate certo com os acessos por defeito do TypeScript', async () => {
  for (const [id, role] of [[chefe, 'chefe'], [ana, 'vendedor']]) {
    for (const s of perms.ALL_SECTIONS) {
      if (s === 'dashboard' || s === 'horas') continue; // sempre/pessoais, tratados à parte
      const { ok } = await one('select public.has_section_for($1,$2) ok', [id, s]);
      assert.equal(ok, perms.DEFAULT_SECTIONS[role].includes(s), `${role} → ${s}`);
    }
  }
  assert.equal((await one("select public.has_section_for($1,'partilhas') ok", [mecanico])).ok, false);
  assert.equal((await one("select public.has_section_for($1,'partilhas') ok", [semAcesso])).ok, false);
});

let anaAccount, anaGroup, anaAd, ruiAccount;

await test('cada um cria as suas contas, grupos e anúncios', async () => {
  await asUser(ana, async () => {
    anaAccount = (await one("insert into fb_accounts(name) values('Facebook Stand') returning id, profile_id")).id;
    await assert.rejects(db.query("insert into fb_accounts(name) values(' facebook stand ')"), /duplicate|unique/i, 'nome repetido');
    await one("insert into fb_accounts(name) values('Facebook pessoal') returning id");
    anaGroup = (await one("insert into fb_groups(account_id,group_key,name,position) values($1,'123','Carros Norte',1) returning id", [anaAccount])).id;
    anaAd = (await one("insert into fb_share_ads(title,url,price) values('Mercedes A180d','https://www.facebook.com/marketplace/item/1/',13450) returning id")).id;
    await assert.rejects(db.query("insert into fb_share_ads(title,url) values('x','https://evil.example/')"), /check/i, 'só links do Facebook');
    await db.query("insert into fb_share_attempts(account_id,group_id,ad_id,status,reason) values($1,$2,$3,'confirmed','ok')", [anaAccount, anaGroup, anaAd]);
  });
  await asUser(rui, async () => {
    ruiAccount = (await one("insert into fb_accounts(name) values('Facebook Stand') returning id")).id; // o mesmo nome noutro utilizador pode
  });
});

await test('ninguém vê nem mexe no que é dos outros (nem o administrador)', async () => {
  for (const other of [rui, admin]) {
    await asUser(other, async () => {
      for (const t of ['fb_groups', 'fb_share_ads', 'fb_share_attempts'])
        assert.equal((await one(`select count(*)::int n from ${t}`)).n, 0, `${t} de outro`);
      assert.equal((await one('select count(*)::int n from fb_accounts where profile_id=$1', [ana])).n, 0);
      assert.equal((await db.query("update fb_accounts set name='roubado' where id=$1 returning id", [anaAccount])).rows.length, 0);
      assert.equal((await db.query('delete from fb_groups where id=$1 returning id', [anaGroup])).rows.length, 0);
    });
  }
  await asUser(rui, async () => {
    // Nem em nome de outro, nem numa conta de outro, nem com o grupo/anúncio de outro.
    await assert.rejects(db.query("insert into fb_accounts(profile_id,name) values($1,'x')", [ana]), /row-level security/);
    await assert.rejects(db.query("insert into fb_groups(account_id,group_key,name) values($1,'9','x')", [anaAccount]), /row-level security/);
    const g = (await one("insert into fb_groups(account_id,group_key,name) values($1,'9','Meu') returning id", [ruiAccount])).id;
    await assert.rejects(
      db.query("insert into fb_share_attempts(account_id,group_id,ad_id,status) values($1,$2,$3,'failed')", [ruiAccount, g, anaAd]),
      /row-level security/,
    );
    await assert.rejects(
      db.query("insert into fb_share_attempts(account_id,group_id,ad_id,status) values($1,$2,$3,'failed')", [ruiAccount, anaGroup, anaAd]),
      /row-level security/,
    );
  });
});

await test('o histórico não se reescreve e só existe com o separador', async () => {
  await asUser(ana, async () => {
    await assert.rejects(db.query("update fb_share_attempts set status='failed'"), /permission denied/);
    await assert.rejects(db.query('delete from fb_share_attempts'), /permission denied/);
    // O grupo tem de ser da conta indicada.
    const other = (await one("select id from fb_accounts where name='Facebook pessoal'")).id;
    await assert.rejects(
      db.query("insert into fb_share_attempts(account_id,group_id,ad_id,status) values($1,$2,$3,'failed')", [other, anaGroup, anaAd]),
      /row-level security/,
    );
  });
  await asUser(semAcesso, async () => {
    await assert.rejects(db.query("insert into fb_accounts(name) values('x')"), /row-level security/);
  });
  await asUser(null, async () => {
    await assert.rejects(db.query('select * from fb_accounts'), /permission denied/);
  }, 'anon');
  // Apagar a conta leva os grupos e o histórico dela.
  await asUser(ana, async () => {
    await db.query('delete from fb_accounts where id=$1', [anaAccount]);
    assert.equal((await one('select count(*)::int n from fb_share_attempts')).n, 0);
    assert.equal((await one('select count(*)::int n from fb_share_ads')).n, 1, 'o anúncio fica');
  });
});

// ---------------------------------------------------------------------------
// Extensão
// ---------------------------------------------------------------------------

async function bootExtension({ origins = [], cookies = {} } = {}) {
  const listeners = [];
  const calls = { windows: [], updates: [] };
  const store = { origins };
  const event = () => ({ addListener() {}, removeListener() {} });
  const chrome = {
    runtime: { id: 'ext', getManifest: () => ({ version: '1.0.0' }), onMessage: { addListener: (fn) => listeners.push(fn) } },
    storage: { local: { get: async () => ({ ...store }), set: async (v) => Object.assign(store, v) } },
    cookies: { get: async ({ name }) => (cookies[name] ? { value: cookies[name] } : null) },
    windows: { create: async (o) => { calls.windows.push(o); throw new Error('não devia abrir janelas'); } },
    tabs: { onUpdated: event(), onRemoved: event(), get: async () => ({}), update: async (id, o) => calls.updates.push(o) },
    scripting: { executeScript: async () => [] },
  };
  vm.runInNewContext(await readFile('extension/background.js', 'utf8'), { chrome, URL, setTimeout, clearTimeout, console });
  const send = (msg, origin, tab = { id: 1 }) =>
    // JSON: os objetos vêm de outro «realm» (vm) e o deepEqual estrito compara protótipos.
    new Promise((resolve) => listeners[0](msg, { id: 'ext', tab, origin, url: `${origin}/admin/partilhas` }, (r) => resolve(JSON.parse(JSON.stringify(r)))));
  return { send, calls };
}

await test('extensão: só obedece a sites autorizados e só abre o Facebook', async () => {
  const site = 'https://coremotors.example';
  const locked = await bootExtension({ cookies: { c_user: '1000' } });
  assert.deepEqual(await locked.send({ type: 'hello' }, site), { ok: true, result: { version: '1.0.0', paired: false, fbUserId: null } });
  const refused = await locked.send({ type: 'share', payload: { adUrl: 'https://www.facebook.com/marketplace/item/1/', groupName: 'X' } }, site);
  assert.equal(refused.ok, false);
  assert.equal(refused.code, 'not_paired');
  assert.equal((await locked.send({ type: 'readGroups' }, site)).code, 'not_paired');

  const paired = await bootExtension({ origins: [site], cookies: { c_user: '1000', i_user: '2000' } });
  assert.deepEqual((await paired.send({ type: 'hello' }, site)).result, { version: '1.0.0', paired: true, fbUserId: '2000' });
  // Outro site, mesmo com a extensão autorizada para este: recusado.
  assert.equal((await paired.send({ type: 'hello' }, 'https://evil.example')).result.paired, false);
  // Sem separador (ex.: outra extensão ou página interna): recusado.
  assert.equal((await paired.send({ type: 'hello' }, site, null)).ok, false);
  const bad = await paired.send({ type: 'share', payload: { adUrl: 'https://evil.example/x', groupName: 'X' } }, site);
  assert.deepEqual(bad.result, { status: 'failed', reason: 'O link do anúncio não é do Facebook.', stop: true });
  assert.deepEqual(paired.calls.windows, [], 'não abriu nada');
});

test('extensão: o manifesto só pede o Facebook e a ponte só corre no /admin', async () => {
  const m = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
  assert.equal(m.manifest_version, 3);
  assert.deepEqual(m.host_permissions, ['https://www.facebook.com/*', 'https://web.facebook.com/*']);
  assert.ok(m.content_scripts[0].matches.every((p) => /\/admin\*$/.test(p)));
  assert.ok(!m.permissions.includes('tabs') && !m.permissions.includes('<all_urls>'));
});
