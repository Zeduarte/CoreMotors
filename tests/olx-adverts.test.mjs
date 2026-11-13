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

// ---- Sincronização: adota, respeita o Standvirtual e não duplica ----------
const S = load('src/lib/olx/sync.ts');
const CAR2 = '22222222-2222-4222-8222-222222222222';
function sdb(extra = {}) {
  return makeDb({
    olx_connection: [connectionRow(olx)],
    cars: [{ id: CAR2, slug: 'bmw-320d', make: 'BMW', model: '320d', variant: null, year: 2018, registration_month: null, mileage: 120000,
      fuel: 'Diesel', transmission: 'Manual', body: 'Berlina', power: 190, displacement: 1995, color: 'Preto', doors: 4, seats: 5,
      price: 18500, price_on_request: false, description: 'Muito estimado.', tagline: null, extras: ['GPS'], status: 'published',
      channels: ['olx'], vehicle_type: 'car' }],
    car_media: [{ car_id: CAR2, storage_path: 'bmw/1.jpg', kind: 'image', position: 0, is_cover: true }],
    olx_category_cache: [{ vehicle_type: 'car', category_id: 181, category_name: 'Carros', photos_limit: 8, attributes: [
      { code: 'make', label: 'Marca', validation: { required: true }, values: [{ code: 'bmw', label: 'BMW' }] },
      { code: 'fuel', label: 'Combustível', validation: { required: true }, values: [{ code: 'diesel', label: 'Diesel' }] }] }],
    channel_listings: [{ id: 'l1', car_id: CAR2, channel: 'olx', status: 'pending', sync_state: 'pending', attempts: 0, external_id: null,
      external_url: null, remote_status: null, last_error: null, notes: null, published_at: null }],
    ...extra,
  });
}
const lst = (d) => d._t.channel_listings[0];
const creates = () => olx.calls.filter((c) => c === 'POST /api/partner/adverts');

test('adota o anúncio OLX associado em vez de criar', async () => {
  reset(); ad(42, { category_id: 741 });
  const d = sdb({ olx_adverts: [{ id: 42, origin: 'olx', status: 'active', title: 'BMW 320d', url: 'https://www.olx.pt/d/anuncio/42', car_id: CAR2 }] });
  const r = await S.syncListing(d, CAR2);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(creates(), []);
  assert.ok(olx.calls.includes('PUT /api/partner/adverts/42'));
  assert.equal(lst(d).external_id, '42');
});

test('anúncio do Standvirtual associado: zero pedidos de escrita, sempre', async () => {
  reset(); ad(43, { _standvirtual: true, external_id: '8097' });
  const d = sdb({ olx_adverts: [{ id: 43, origin: 'standvirtual', status: 'active', title: 'BMW 320d', car_id: CAR2 }] });
  for (let i = 0; i < 3; i++) await S.syncListing(d, CAR2);
  assert.deepEqual(writes(olx), []);
  assert.deepEqual([lst(d).sync_state, lst(d).notes, lst(d).last_error], ['idle', 'Gerido no Standvirtual', null]);
});

test('com external_id de um anúncio do Standvirtual também não envia nada', async () => {
  reset(); ad(43, { _standvirtual: true, external_id: '8097' });
  const d = sdb({ olx_adverts: [{ id: 43, origin: 'standvirtual', status: 'active', title: 'BMW 320d', car_id: null }] });
  lst(d).external_id = '43'; lst(d).remote_status = 'active';
  await S.syncListing(d, CAR2);
  assert.deepEqual(writes(olx), []);
  assert.equal(lst(d).notes, 'Gerido no Standvirtual');
});

test('sugestão forte por associar bloqueia a criação', async () => {
  reset();
  const d = sdb({ olx_adverts: [{ id: 44, origin: 'standvirtual', status: 'active', title: 'BMW 320d Pack M', price: 18500, category_name: 'BMW', car_id: null }] });
  const r = await S.syncListing(d, CAR2);
  assert.equal(r.ok, false);
  assert.deepEqual(creates(), []);
  assert.equal(lst(d).sync_state, 'error');
  assert.equal(lst(d).last_error, 'Já existe no OLX um anúncio que parece ser desta viatura («BMW 320d Pack M»). Associe-o, ou desative-o, em Plataformas de anúncios.');
});

test('sugestão fraca não bloqueia', async () => {
  reset();
  const d = sdb({ olx_adverts: [{ id: 44, origin: 'standvirtual', status: 'active', title: 'BMW 320d Pack M', price: 17000, category_name: 'BMW', car_id: null }] });
  const r = await S.syncListing(d, CAR2);
  assert.equal(r.ok, true, r.error);
  assert.equal(creates().length, 1);
});

test('PUT recusado por ser do Standvirtual: passa a standvirtual, sem erro', async () => {
  reset(); ad(45, { _standvirtual: true });
  const d = sdb({ olx_adverts: [{ id: 45, origin: 'olx', status: 'active', title: 'BMW 320d', car_id: CAR2 }] });
  const r = await S.syncListing(d, CAR2);
  assert.equal(r.ok, true, r.error);
  assert.equal(row(d, 45).origin, 'standvirtual');
  assert.deepEqual([lst(d).sync_state, lst(d).notes, lst(d).last_error], ['idle', 'Gerido no Standvirtual', null]);
});

// ---- Associar, desassociar, sugestões, ativar e desativar -----------------
const LK = load('src/lib/olx/links.ts');
const carRow = (d, id) => d._t.cars.find((c) => c.id === id);

test('associar liga o anúncio à viatura sem marcar OLX', async () => {
  reset(); ad(42);
  const d = db({ olx_adverts: [{ id: 42, origin: 'olx', status: 'active', title: 'BMW 116d', car_id: null }] });
  carRow(d, CAR).channels = [];
  const r = await LK.linkAdvert(d, 42, CAR);
  assert.equal(r.ok, true, r.error);
  assert.equal(row(d, 42).car_id, CAR);
  assert.deepEqual(carRow(d, CAR).channels, []);
  assert.deepEqual(writes(olx), []);
});

test('associar com OLX marcado sincroniza já (o anúncio passa a ter os dados da ficha)', async () => {
  reset(); ad(42);
  const d = sdb({ olx_adverts: [{ id: 42, origin: 'olx', status: 'active', title: 'BMW 320d', car_id: null }] });
  const r = await LK.linkAdvert(d, 42, CAR2);
  assert.equal(r.ok, true, r.error);
  assert.ok(olx.calls.includes('PUT /api/partner/adverts/42'));
  assert.deepEqual(creates(), []);
});

test('associar recusa viatura ou anúncio já associados', async () => {
  reset();
  const base = () => db({ olx_adverts: [
    { id: 42, origin: 'olx', status: 'active', title: 'a', car_id: null },
    { id: 43, origin: 'olx', status: 'active', title: 'b', car_id: CAR },
    { id: 50, origin: 'olx', status: 'active', title: 'c', car_id: null },
  ] });
  assert.equal((await LK.linkAdvert(base(), 43, '33333333-3333-4333-8333-333333333333')).ok, false, 'anúncio já associado');
  assert.equal((await LK.linkAdvert(base(), 42, CAR)).ok, false, 'viatura já associada');
  const d = base(); d._t.olx_adverts[1].car_id = null;
  d._t.channel_listings.push({ id: 'lx', car_id: CAR, channel: 'olx', external_id: '50', status: 'published', sync_state: 'idle' });
  assert.equal((await LK.linkAdvert(d, 42, CAR)).ok, false, 'viatura com anúncio do site');
  assert.equal(row(d, 42).car_id, null);
});

test('desassociar um anúncio olx desmarca OLX; gravar a viatura depois não cria nem desativa', async () => {
  reset(); ad(42);
  const d = sdb({ olx_adverts: [{ id: 42, origin: 'olx', status: 'active', title: 'BMW 320d', car_id: CAR2 }] });
  Object.assign(lst(d), { external_id: '42', remote_status: 'active', status: 'published', sync_state: 'idle' });
  const r = await LK.unlinkAdvert(d, 42);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(carRow(d, CAR2).channels, []);
  assert.equal(lst(d).external_id, null);
  assert.equal(row(d, 42).car_id, null);
  await S.markPending(d, CAR2);
  await S.syncListing(d, CAR2);
  assert.deepEqual(writes(olx), []);
});

test('não se desassocia um anúncio criado pelo site', async () => {
  reset();
  const d = db({ olx_adverts: [{ id: 42, origin: 'site', status: 'active', title: 'x', car_id: CAR, external_id: CAR }] });
  assert.equal((await LK.unlinkAdvert(d, 42)).ok, false);
  assert.equal(row(d, 42).car_id, CAR);
});

test('confirmar sugestões associa só as fortes', async () => {
  reset();
  const CAPTUR = '44444444-4444-4444-8444-444444444444';
  const d = db({ olx_adverts: [
    { id: 1, origin: 'standvirtual', status: 'active', title: 'BMW 116 d Pack M', price: 12900, category_name: 'BMW', car_id: null },
    { id: 2, origin: 'standvirtual', status: 'active', title: 'Renault Captur 0.9 TCE', price: 11000, category_name: 'Renault', car_id: null },
  ] });
  d._t.cars.push({ id: CAPTUR, make: 'Renault', model: 'Captur', price: 11500, status: 'published', channels: [], vehicle_type: 'car' });
  const r = await LK.confirmSuggestions(d);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([row(d, 1).car_id, row(d, 2).car_id], [CAR, null]);
  assert.match(r.message, /1 anúncio/);
});

test('ativar/desativar: comando certo; recusado no Standvirtual e nos geridos pela ficha', async () => {
  reset(); ad(60); ad(61, { _standvirtual: true }); ad(62);
  const d = db({ olx_adverts: [
    { id: 60, origin: 'olx', status: 'active', title: 'a', car_id: null },
    { id: 61, origin: 'standvirtual', status: 'active', title: 'b', car_id: null },
    { id: 62, origin: 'olx', status: 'active', title: 'c', car_id: CAR },
  ] });
  const r = await LK.setAdvertActive(d, 60, false);
  assert.equal(r.ok, true, r.error);
  assert.ok(olx.calls.includes('POST /api/partner/adverts/60/commands'));
  assert.equal(olx.adverts.get(60)._sold, false);
  assert.equal(row(d, 60).status, 'removed_by_user');
  olx.calls.length = 0;
  assert.equal((await LK.setAdvertActive(d, 61, false)).ok, false, 'Standvirtual');
  assert.equal((await LK.setAdvertActive(d, 62, false)).ok, false, 'gerido pela ficha (OLX marcado)');
  assert.deepEqual(writes(olx), []);
});

test('as ações exigem o separador e o tipo da viatura', async () => {
  reset();
  const d = db({ olx_adverts: [{ id: 42, origin: 'olx', status: 'active', title: 'a', car_id: null }] });
  const sections = [];
  const loadActions = createLoader({
    '@/lib/queries': { getBranding: async () => ({}), getSiteVehicleTypes: async () => ['car'] },
    '@/lib/guard': { requireSection: async (s) => { sections.push(s); return { role: 'vendedor', allowed_vehicle_types: ['motorcycle'] }; } },
    '@/lib/vehicle-access': { carTypesError: async () => 'Sem acesso a este tipo de viatura.', canUseVehicleType: () => false },
    '@/lib/supabase/server': { createClient: async () => ({}) },
    '@/lib/supabase/admin': { createAdminClient: () => d },
    'next/cache': { revalidatePath() {} },
  });
  const act = loadActions('src/lib/actions/olx-adverts.ts');
  assert.deepEqual(await act.linkOlxAdvert(42, CAR), { ok: false, error: 'Sem acesso a este tipo de viatura.' });
  assert.deepEqual(sections, ['anuncios']);
  assert.equal(row(d, 42).car_id, null);
});
