// Partilhas · procurar grupos novos: regras (palavras-chave, limite diário,
// candidatos), base de dados (cada um só o seu) e os horários da extensão.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { createLoader } from './support/load-ts.mjs';
import { bootDatabase, addUser, asUserFactory } from './support/pglite.mjs';

const load = createLoader();
const d = load('src/lib/fb-discovery.ts');

test('palavras-chave: separadas por vírgulas ou linhas, sem repetidas nem vazias', () => {
  assert.deepEqual(d.cleanKeywords('carros, Automóveis\nautomoveis ; x ,  viaturas usadas '), ['carros', 'Automóveis', 'viaturas usadas']);
  assert.deepEqual(d.cleanKeywords(''), []);
  assert.equal(d.cleanKeywords(Array.from({ length: 40 }, (_, i) => `palavra ${i}`)).length, 30);
});

test('o nome do grupo tem uma palavra-chave (sem acentos, no início das palavras)', () => {
  const kw = ['carro', 'automóveis', 'compra e venda'];
  assert.equal(d.matchedKeyword('CARROS USADOS EM SINTRA', kw), 'carro');
  assert.equal(d.matchedKeyword('Venda de Automoveis Porto', kw), 'automóveis');
  assert.equal(d.matchedKeyword('📍COMPRA E VENDA DE MOTAS📍', kw), 'compra e venda');
  assert.equal(d.matchedKeyword('Bicarros e afins', kw), null, 'só no início de uma palavra');
  assert.equal(d.matchesKeywords('Amigos de Fafe', kw), false);
});

test('limite diário: 5 por conta em 24 h, só entradas e pedidos contam', () => {
  assert.equal(d.JOIN_DAILY_LIMIT, 5);
  const now = new Date('2026-11-23T18:00:00Z');
  const at = (h) => new Date(now.getTime() - h * 3600_000).toISOString();
  const joins = [
    { status: 'joined', created_at: at(1) },
    { status: 'requested', created_at: at(5) },
    { status: 'questions', created_at: at(2) },
    { status: 'failed', created_at: at(2) },
    { status: 'joined', created_at: at(30) }, // ontem: já não conta
  ];
  assert.equal(d.joinsInLastDay(joins, now), 2);
  assert.equal(d.remainingJoins(joins, now), 3);
  assert.equal(d.remainingJoins(Array.from({ length: 7 }, () => ({ status: 'joined', created_at: at(1) })), now), 0);
});

test('candidatos: pode aderir, tem a palavra, não é de outros artigos nem já tratado', () => {
  const found = d.cleanFoundGroups([
    { name: 'Carros Norte', url: 'https://www.facebook.com/groups/111/', privacy: 'public', info: '5K', state: 'join' },
    { name: 'Carros Sul', url: 'https://www.facebook.com/groups/222/', privacy: 'private', state: 'join' },
    { name: 'Carros membro', url: 'https://www.facebook.com/groups/333/', state: 'member' },
    { name: 'Bilhetes carros antigos', url: 'https://www.facebook.com/groups/444/', state: 'join' },
    { name: 'Receitas', url: 'https://www.facebook.com/groups/555/', state: 'join' },
    { name: 'Carros já pedido', url: 'https://www.facebook.com/groups/666/', state: 'join' },
    { name: 'Sem endereço', url: 'https://evil.example/groups/1/', state: 'join' },
    { name: 'Carros Norte (repetido)', url: 'https://www.facebook.com/groups/111/', state: 'join' },
  ]);
  assert.equal(found.length, 6, 'sem lixo nem repetidos');
  const keys = (opts) => d.pickJoinCandidates(found, { keywords: ['carros'], skipKeys: new Set(['666']), ...opts }).map((g) => g.key);
  assert.deepEqual(keys({}), ['111', '222']);
  assert.deepEqual(keys({ publicOnly: true }), ['111']);
  assert.equal(d.doneJoinKeys([{ group_key: 'a', status: 'requested' }, { group_key: 'b', status: 'failed' }]).has('b'), false);
});

test('horários: descrição em português', () => {
  assert.equal(d.describeSchedule([1, 2, 3, 4, 5], '18:00'), 'Dias úteis às 18:00');
  assert.equal(d.describeSchedule([0, 1, 2, 3, 4, 5, 6], '21:00'), 'Todos os dias às 21:00');
  assert.equal(d.describeSchedule([0, 3, 6], '09:30'), 'Qua, Sáb, Dom às 09:30');
  assert.equal(d.isValidTime('24:00'), false);
});

// ---------------------------------------------------------------------------
// Base de dados
// ---------------------------------------------------------------------------

const db = await bootDatabase();
const asUser = asUserFactory(db);
const ana = '00000000-0000-4000-8000-0000000000b2';
const rui = '00000000-0000-4000-8000-0000000000b3';
const admin = '00000000-0000-4000-8000-0000000000b1';
await addUser(db, admin, 'admin');
await addUser(db, ana, 'vendedor', 'Ana');
await addUser(db, rui, 'vendedor', 'Rui');
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

let anaAccount, anaCat, anaAd;

await test('categorias, adesões e horários: cada um os seus', async () => {
  await asUser(ana, async () => {
    anaAccount = (await one("insert into fb_accounts(name) values('Conta nova') returning id")).id;
    anaCat = (await one("insert into fb_categories(name, keywords) values('Carros', array['carros','automóveis']) returning id")).id;
    await assert.rejects(db.query("insert into fb_categories(name, keywords) values(' carros ', array['x'])"), /duplicate|unique/i);
    await assert.rejects(db.query("insert into fb_categories(name, keywords) values('Vazia', array[]::text[])"), /check/i);
    anaAd = (await one("insert into fb_share_ads(title,url) values('Yamaha','https://www.facebook.com/marketplace/item/9/') returning id")).id;
    await db.query(
      "insert into fb_group_joins(account_id, category_id, group_key, name, url, status) values($1,$2,'111','Carros Norte','https://www.facebook.com/groups/111/','joined')",
      [anaAccount, anaCat],
    );
    await db.query("insert into fb_schedules(account_id, kind, category_id, count, weekdays, at_time) values($1,'join',$2,3,'{1,3}','18:00')", [anaAccount, anaCat]);
    await db.query("insert into fb_schedules(account_id, kind, ad_id, count, weekdays, at_time) values($1,'share',$2,10,'{5}','21:00')", [anaAccount, anaAd]);
    await assert.rejects(
      db.query("insert into fb_schedules(account_id, kind, count, weekdays, at_time) values($1,'join',3,'{1}','18:00')", [anaAccount]),
      /check/i,
      'aderir precisa de categoria',
    );
    await assert.rejects(
      db.query("insert into fb_schedules(account_id, kind, category_id, count, weekdays, at_time) values($1,'join',$2,3,'{7}','18:00')", [anaAccount, anaCat]),
      /check/i,
      'dia da semana inválido',
    );
    await assert.rejects(
      db.query("insert into fb_schedules(account_id, kind, category_id, count, weekdays, at_time) values($1,'join',$2,3,'{1}','25:00')", [anaAccount, anaCat]),
      /check/i,
      'hora inválida',
    );
    await assert.rejects(db.query("update fb_group_joins set status='failed'"), /permission denied/, 'o histórico não se reescreve');
  });

  for (const other of [rui, admin]) {
    await asUser(other, async () => {
      for (const t of ['fb_categories', 'fb_group_joins', 'fb_schedules'])
        assert.equal((await one(`select count(*)::int n from ${t}`)).n, 0, `${t} de outro`);
    });
  }
  await asUser(rui, async () => {
    const mine = (await one("insert into fb_accounts(name) values('Rui') returning id")).id;
    await assert.rejects(
      db.query("insert into fb_group_joins(account_id, group_key, name, status) values($1,'9','x','joined')", [anaAccount]),
      /row-level security/,
      'na conta de outro',
    );
    await assert.rejects(
      db.query("insert into fb_group_joins(account_id, category_id, group_key, name, status) values($1,$2,'9','x','joined')", [mine, anaCat]),
      /row-level security/,
      'com a categoria de outro',
    );
    await assert.rejects(
      db.query("insert into fb_schedules(account_id, kind, ad_id, count, weekdays, at_time) values($1,'share',$2,1,'{1}','10:00')", [mine, anaAd]),
      /row-level security/,
      'com o anúncio de outro',
    );
  });

  // Apagar a categoria leva os horários dela; as adesões ficam (sem categoria).
  await asUser(ana, async () => {
    await db.query('delete from fb_categories where id=$1', [anaCat]);
    assert.equal((await one("select count(*)::int n from fb_schedules where kind='join'")).n, 0);
    assert.equal((await one('select count(*)::int n from fb_group_joins where category_id is null')).n, 1);
  });
});

// ---------------------------------------------------------------------------
// Extensão: horários
// ---------------------------------------------------------------------------

async function bootExtension({ origins = [] } = {}) {
  const listeners = [];
  const alarms = [];
  const opened = [];
  const store = { origins };
  const event = () => ({ addListener() {}, removeListener() {} });
  const chrome = {
    runtime: { id: 'ext', getManifest: () => ({ version: '1.0.5' }), onMessage: { addListener: (fn) => listeners.push(fn) } },
    storage: {
      local: {
        get: async (keys) => {
          const out = {};
          for (const k of typeof keys === 'string' ? [keys] : Array.isArray(keys) ? keys : Object.keys(store)) if (k in store) out[k] = store[k];
          return JSON.parse(JSON.stringify(out));
        },
        set: async (v) => Object.assign(store, JSON.parse(JSON.stringify(v))),
      },
    },
    cookies: { get: async () => null },
    windows: { create: async () => { throw new Error('não devia abrir janelas'); } },
    tabs: { onUpdated: event(), onRemoved: event(), get: async () => ({}), update: async () => {}, create: async (o) => opened.push(o.url) },
    scripting: { executeScript: async () => [] },
    alarms: { create: (name, o) => alarms.push([name, o]), onAlarm: { addListener() {} } },
  };
  const ctx = { chrome, URL, setTimeout, clearTimeout, console, Intl, Date };
  vm.runInNewContext(await readFile('extension/background.js', 'utf8'), ctx);
  const send = (msg, origin) =>
    new Promise((resolve) => listeners[0](msg, { id: 'ext', tab: { id: 1 }, origin, url: `${origin}/admin/partilhas` }, (r) => resolve(JSON.parse(JSON.stringify(r)))));
  return { ctx, send, store, alarms, opened };
}

await test('extensão: guarda os horários de sites autorizados e abre a página à hora certa', async () => {
  const site = 'https://coremotors.example';
  const acc = '11111111-1111-4111-8111-111111111111';
  const sid = '22222222-2222-4222-8222-222222222222';
  const ext = await bootExtension({ origins: [site] });
  assert.deepEqual(JSON.parse(JSON.stringify(ext.alarms)), [['cm-tick', { periodInMinutes: 1 }]]);

  const refused = await (await bootExtension()).send({ type: 'setSchedules', payload: { accountId: acc, items: [] } }, site);
  assert.equal(refused.code, 'not_paired');

  const r = await ext.send(
    { type: 'setSchedules', payload: { accountId: acc, items: [{ id: sid, at: '18:00', weekdays: [1, 3], enabled: true }, { id: 'lixo', at: '99:00', weekdays: [] }] } },
    site,
  );
  assert.deepEqual(r, { ok: true, result: { saved: 1 } });
  assert.equal(ext.store.schedules[acc].origin, site);

  // isDue: dia certo, a partir da hora, até 2 h depois, uma vez por dia.
  const item = { id: sid, at: '18:00', weekdays: [1, 3], enabled: true };
  const isDue = ext.ctx.isDue;
  assert.equal(isDue(item, { weekday: 1, minutes: 18 * 60, day: '2026-11-23' }, undefined), true);
  assert.equal(isDue(item, { weekday: 1, minutes: 17 * 60 + 59, day: '2026-11-23' }, undefined), false);
  assert.equal(isDue(item, { weekday: 1, minutes: 20 * 60 + 1, day: '2026-11-23' }, undefined), false);
  assert.equal(isDue(item, { weekday: 2, minutes: 18 * 60, day: '2026-11-24' }, undefined), false);
  assert.equal(isDue(item, { weekday: 1, minutes: 18 * 60 + 5, day: '2026-11-23' }, '2026-11-23'), false, 'já correu hoje');
  assert.equal(isDue({ ...item, enabled: false }, { weekday: 1, minutes: 18 * 60, day: '2026-11-23' }, undefined), false);

  // Segunda-feira 23/11/2026 às 18:00 em Lisboa (inverno: UTC+0).
  assert.deepEqual(JSON.parse(JSON.stringify(ext.ctx.lisbonNow(new Date('2026-11-23T18:00:00Z')))), { weekday: 1, minutes: 1080, day: '2026-11-23' });
  // Verão (UTC+1): 17:30 UTC = 18:30 em Lisboa.
  assert.equal(ext.ctx.lisbonNow(new Date('2026-07-01T17:30:00Z')).minutes, 18 * 60 + 30);

  // O tick abre a página Partilhas do site autorizado, com ?auto=.
  ext.ctx.lisbonNow = () => ({ weekday: 1, minutes: 18 * 60 + 1, day: '2026-11-23' });
  await ext.ctx.tick();
  assert.deepEqual(ext.opened, [`${site}/admin/partilhas?conta=${acc}&auto=${sid}`]);
  await ext.ctx.tick();
  assert.equal(ext.opened.length, 1, 'uma vez por dia');

  // Um site que deixou de estar autorizado não abre nada.
  ext.store.origins = [];
  ext.store.ranOn = {};
  await ext.ctx.tick();
  assert.equal(ext.opened.length, 1);
});

test('limite de partilhas: 10 por conta em 24 h, só as que chegaram a Publicar', () => {
  const s = load('src/lib/fb-shares.ts');
  assert.equal(s.SHARE_DAILY_LIMIT, 10);
  const now = new Date('2026-11-23T18:00:00Z');
  const at = (h) => new Date(now.getTime() - h * 3600_000).toISOString();
  const attempts = [
    ...Array.from({ length: 6 }, () => ({ status: 'confirmed', created_at: at(2) })),
    { status: 'pending', created_at: at(3) },
    { status: 'uncertain', created_at: at(3) },
    { status: 'failed', created_at: at(1) },
    { status: 'rate_limited', created_at: at(1) },
    { status: 'confirmed', created_at: at(25) },
  ];
  assert.equal(s.sharesInLastDay(attempts, now), 8);
  assert.equal(s.remainingShares(attempts, now), 2);
  assert.equal(s.remainingShares([...attempts, ...attempts], now), 0);
});

await test('extensão: lê o nome da conta do Facebook (só se for a conta aberta) e guarda-o', async () => {
  const ext = await bootExtension({ origins: ['https://coremotors.example'] });
  const html = 'x"CurrentUserInitialData",[],{"ACCOUNT_ID":"1000","USER_ID":"1000","NAME":"Duarte S\\u00e1","SHORT_NAME":"Duarte"}y';
  assert.equal(ext.ctx.nameFromHtml(html, '1000'), 'Duarte Sá');
  assert.equal(ext.ctx.nameFromHtml(html, '2000'), null, 'de outra conta não serve');
  assert.equal(ext.ctx.nameFromHtml('<html>Facebook</html>', '1000'), null);
});

test('extensão: a ponte deixa passar os pedidos novos e o manifesto pede alarmes', async () => {
  const bridge = await readFile('extension/bridge.js', 'utf8');
  for (const t of ['searchGroups', 'joinGroup', 'setSchedules']) assert.ok(bridge.includes(`"${t}"`), t);
  const m = JSON.parse(await readFile('extension/manifest.json', 'utf8'));
  assert.ok(m.permissions.includes('alarms'));
  assert.deepEqual(m.host_permissions, ['https://www.facebook.com/*', 'https://web.facebook.com/*']);
});
