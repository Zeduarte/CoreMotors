// Anúncios da conta do OLX geridos no backoffice: os que o site criou, os
// feitos à mão no OLX e os exportados do Standvirtual (que o OLX não deixa
// alterar). Os dados de exemplo são os da conta do stand a 13/11/2026.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLoader } from './support/load-ts.mjs';
import { startFakeOlx, makeDb, connectionRow, writes } from './support/olx-fake.mjs';

const fake = await startFakeOlx();
after(() => fake.close());
const olx = fake.olx;
process.env.OLX_BASE_URL = fake.url;
process.env.OLX_CLIENT_ID = 'cid';
process.env.OLX_CLIENT_SECRET = 'csec';
process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co';

const load = createLoader({
  '@/lib/queries': {
    getBranding: async () => ({ companyName: 'CoreMotors', company: { phone: '+351 916 193 337', geo: { lat: 41.2, lng: -8.28 } } }),
    getSiteVehicleTypes: async () => ['car', 'motorcycle'],
  },
});
const A = load('src/lib/olx/adverts.ts');

const ADS = [
  { id: 675176856, title: 'Mercedes-Benz A 180 d Progressive Aut.', price: 21900, categoryName: 'Mercedes-Benz' },
  { id: 673875376, title: 'Renault Mégane 1.5 dCi GT Line', price: 11450, categoryName: 'Renault' },
  { id: 675176600, title: 'Renault Captur 0.9 TCE', price: 11500, categoryName: 'Renault' },
  { id: 675176520, title: 'BMW 420 d Auto', price: 22900, categoryName: 'BMW' },
  { id: 675176398, title: 'Citroën C3 1.2 PureTech C-Series', price: 12450, categoryName: 'Citroën' },
  { id: 672199203, title: 'BMW 116 d Pack M', price: 12900, categoryName: 'BMW' },
  { id: 673875380, title: 'BMW 525 d Auto', price: 14350, categoryName: 'BMW' },
  { id: 672202645, title: 'Citroën C3 1.2 PureTech Feel', price: 11950, categoryName: 'Citroën' },
  { id: 672202637, title: 'Opel Combo 1.5 CDTi Edition', price: 12950, categoryName: 'Opel' },
  { id: 670778144, title: 'Mercedes-Benz CLA 180', price: 15900, categoryName: 'Mercedes-Benz' },
  { id: 667023834, title: 'Renault Grand Scenic', price: 6000, categoryName: 'Renault' },
];
const CARS = [
  ['bmw525', 'BMW', '525 d Auto', 14350], ['bmw420', 'BMW', '420 d', 22900], ['bmw116', 'BMW', '116d', 12900],
  ['c3', 'Citroën', 'C3', 12450], ['punto', 'Fiat', 'Punto', 4950], ['a180', 'Mercedes-Benz', 'A 180 d', 21900],
  ['p2008', 'Peugeot', '2008', 12950], ['captur', 'Renault', 'Captur', 11500], ['megane', 'Renault', 'Mégane', 11450],
].map(([id, make, model, price]) => ({ id, make, model, price }));

test('sugere as 7 viaturas certas, todas fortes, e nenhuma errada', () => {
  const s = A.suggestAll(ADS, CARS);
  assert.deepEqual(Object.fromEntries([...s].map(([k, v]) => [k, v.carId])), {
    675176856: 'a180', 673875376: 'megane', 675176600: 'captur', 675176520: 'bmw420',
    675176398: 'c3', 672199203: 'bmw116', 673875380: 'bmw525',
  });
  assert.ok([...s.values()].every((v) => v.strong));
});

test('dois anúncios para a mesma viatura: só o de preço igual', () => {
  const s = A.suggestAll(ADS, CARS);
  assert.equal(s.get(675176398)?.carId, 'c3');
  assert.equal(s.has(672202645), false);
});

test('marca e modelo sem o preço: sugestão fraca', () => {
  assert.deepEqual(
    A.suggestCar({ id: 1, title: 'BMW 116 d Pack M', price: 11000, categoryName: 'BMW' }, CARS),
    { carId: 'bmw116', strong: false },
  );
});

test('a marca tem de bater: o mesmo modelo de outra marca não serve', () => {
  assert.equal(A.suggestCar({ id: 2, title: 'Seat 2008 qualquer', price: 12950, categoryName: 'Seat' }, CARS), null);
});

test('a origem vem do external_id', () => {
  const ids = new Set(['11111111-1111-4111-8111-111111111111']);
  assert.equal(A.advertOrigin(null, ids), 'olx');
  assert.equal(A.advertOrigin('', ids), 'olx');
  assert.equal(A.advertOrigin('11111111-1111-4111-8111-111111111111', ids), 'site');
  assert.equal(A.advertOrigin('8097748498', ids), 'standvirtual');
  assert.equal(A.isStandvirtualExport('user: Anúncio exportado do  Standvirtual. Para alterá-lo, necessita de aceder à sua conta.'), true);
  assert.equal(A.isStandvirtualExport('Advert not found'), false);
  assert.equal(A.isStandvirtualExport(null), false);
});

// ---- Ler os anúncios da conta (importAdverts) -----------------------------
const I = load('src/lib/olx/import.ts');
const CAR = '11111111-1111-4111-8111-111111111111';

function reset() {
  olx.adverts.clear(); olx.calls.length = 0; olx.failPage = null; olx.failGet.clear(); olx.categories.clear();
  olx.categories.set(741, { id: 741, name: 'BMW', parent_id: 378 });
  olx.categories.set(603, { id: 603, name: 'Renault', parent_id: 378 });
}
function ad(id, extra = {}) {
  olx.adverts.set(id, { id, status: 'active', title: `Anúncio ${id}`, url: `https://www.olx.pt/d/anuncio/${id}`, external_id: null,
    category_id: 741, price: { value: '1000' }, valid_to: '2026-12-01 10:00:00', created_at: '2026-11-01 10:00:00', ...extra });
}
function db(extra = {}) {
  return makeDb({
    olx_connection: [connectionRow(olx)],
    cars: [{ id: CAR, make: 'BMW', model: '116d', price: 12900, status: 'published', channels: ['olx'], vehicle_type: 'car' }],
    ...extra,
  });
}
const row = (d, id) => d._t.olx_adverts.find((r) => r.id === id);

test('lê todas as páginas e guarda origem, preço, categoria e associação do site', async () => {
  reset();
  for (let i = 1; i <= 230; i++) ad(i);
  ad(7, { external_id: CAR });
  ad(8, { external_id: '8097748498' });
  const d = db();
  const r = await I.importAdverts(d, { stats: false });
  assert.equal(r.ok, true);
  assert.equal(r.read, 230);
  assert.equal(olx.calls.filter((c) => c.startsWith('GET /api/partner/adverts?offset=')).length, 3);
  assert.equal(d._t.olx_adverts.length, 230);
  assert.deepEqual([row(d, 7).origin, row(d, 7).car_id], ['site', CAR]);
  assert.equal(row(d, 8).origin, 'standvirtual');
  assert.deepEqual([row(d, 1).origin, row(d, 1).price, row(d, 1).category_name, row(d, 1).car_id], ['olx', 1000, 'BMW', null]);
  assert.equal(olx.calls.filter((c) => c === 'GET /api/partner/categories/741').length, 1);
});

test('não mexe numa associação já feita', async () => {
  reset(); ad(5);
  const d = db({ olx_adverts: [{ id: 5, origin: 'olx', status: 'active', title: 'x', car_id: CAR }] });
  await I.importAdverts(d, { stats: false });
  assert.equal(row(d, 5).car_id, CAR);
  assert.equal(row(d, 5).title, 'Anúncio 5');
});

test('um anúncio que desapareceu da conta sai da tabela', async () => {
  reset(); ad(1);
  const d = db({ olx_adverts: [{ id: 1, origin: 'olx', status: 'active', title: 'a' }, { id: 99, origin: 'olx', status: 'active', title: 'b' }] });
  const r = await I.importAdverts(d, { stats: false });
  assert.equal(r.removed, 1);
  assert.deepEqual(d._t.olx_adverts.map((x) => x.id), [1]);
});

test('página com erro: não apaga nem limpa nada', async () => {
  reset();
  for (let i = 1; i <= 150; i++) ad(i);
  olx.failPage = 2;
  const listing = { id: 'l1', car_id: CAR, channel: 'olx', external_id: '999', status: 'published', remote_status: 'active', sync_state: 'idle', last_error: null };
  const d = db({ olx_adverts: [{ id: 999, origin: 'olx', status: 'active', title: 'antigo' }], channel_listings: [{ ...listing }] });
  const r = await I.importAdverts(d, { stats: false });
  assert.equal(r.ok, false);
  assert.deepEqual(d._t.olx_adverts.map((x) => x.id), [999]);
  assert.deepEqual(d._t.channel_listings[0], listing);
});

test('anúncio da conta antiga é limpo; um acabado de criar ou um erro passageiro não', async () => {
  reset(); ad(1);
  ad(777, { _hidden: true });
  ad(555, { _owner: true });
  ad(444, { _hidden: true }); olx.failGet.add(444);
  const L = (id, ext) => ({ id, car_id: `car-${id}`, channel: 'olx', external_id: ext, external_url: `https://www.olx.pt/d/anuncio/${ext}`, status: 'published',
    remote_status: 'active', sync_state: 'idle', last_error: null, views: 9, phone_views: 1, observers: 1 });
  const d = db({ channel_listings: [L('a', '999'), L('b', '777'), L('c', '555'), L('d', '444')] });
  const r = await I.importAdverts(d, { stats: false });
  assert.equal(r.cleared, 2);
  const by = Object.fromEntries(d._t.channel_listings.map((l) => [l.id, l]));
  for (const id of ['a', 'c']) {
    assert.deepEqual(
      { e: by[id].external_id, u: by[id].external_url, rs: by[id].remote_status, v: by[id].views, s: by[id].status, ss: by[id].sync_state, err: by[id].last_error },
      { e: null, u: null, rs: null, v: null, s: 'pending', ss: 'idle', err: I.OTHER_ACCOUNT_NOTE },
    );
  }
  assert.equal(by.b.external_id, '777');
  assert.equal(by.d.external_id, '444');
  assert.equal(I.OTHER_ACCOUNT_NOTE, 'O anúncio anterior não está na conta do OLX ligada (era de outra conta ou foi apagado). Grave a viatura para o publicar nesta conta.');
  assert.deepEqual(writes(olx), []);
});

test('com stats, guarda as estatísticas de todos e copia-as para a viatura associada', async () => {
  reset(); ad(1, { _views: 50 }); ad(2, { external_id: '8097748498', _views: 30 });
  const d = db({
    olx_adverts: [{ id: 1, origin: 'olx', status: 'active', title: 'x', car_id: CAR }],
    channel_listings: [{ id: 'l1', car_id: CAR, channel: 'olx', external_id: '1', status: 'published', sync_state: 'idle', views: null }],
  });
  const r = await I.importAdverts(d, { stats: true });
  assert.equal(r.stats, 2);
  assert.deepEqual([row(d, 1).views, row(d, 2).views, row(d, 2).observers], [50, 30, 2]);
  assert.equal(d._t.channel_listings[0].views, 50);
  assert.ok(row(d, 1).stats_at);
});
