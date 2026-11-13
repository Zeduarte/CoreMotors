// Anúncios da conta do OLX geridos no backoffice: os que o site criou, os
// feitos à mão no OLX e os exportados do Standvirtual (que o OLX não deixa
// alterar). Os dados de exemplo são os da conta do stand a 13/11/2026.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { createLoader } from './support/load-ts.mjs';
import { startFakeOlx, makeDb, connectionRow, writes, READ_ERROR, MISSING_TABLE } from './support/olx-fake.mjs';

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
  assert.equal(A.advertOrigin(null), 'olx');
  assert.equal(A.advertOrigin(''), 'olx');
  assert.equal(A.advertOrigin('11111111-1111-4111-8111-111111111111'), 'site');
  assert.equal(A.advertOrigin('8097748498'), 'standvirtual');
  // A origem que já se sabia mantém-se: um anúncio do OLX adotado passa a levar
  // o id da viatura, e um recusado pelo OLX como do Standvirtual fica assim.
  assert.equal(A.advertOrigin('11111111-1111-4111-8111-111111111111', 'olx'), 'olx');
  assert.equal(A.advertOrigin(null, 'standvirtual'), 'standvirtual');
  assert.equal(A.advertOrigin('8097748498', 'site'), 'standvirtual');
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
  const r = await I.importAdverts(d, { stats: 'all' });
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
    // A criação de viaturas tem os seus próprios testes; aqui não é chamada.
    '@/lib/actions/cars': { createCar: async () => ({ ok: false, error: 'não usado' }) },
  });
  const act = loadActions('src/lib/actions/olx-adverts.ts');
  assert.deepEqual(await act.linkOlxAdvert(42, CAR), { ok: false, error: 'Sem acesso a este tipo de viatura.' });
  assert.deepEqual(sections, ['anuncios']);
  assert.equal(row(d, 42).car_id, null);
});

// ---- Criar a viatura a partir de um anúncio --------------------------------
const IC = load('src/lib/olx/import-car.ts');
const GRAND_SCENIC = {
  id: 667023834, title: 'Renault Grand Scenic', category_id: 603, price: { value: '6000' },
  description: 'Se procuras, uma carrinha com espaço e conforto, esta é o ideal para ti.',
  images: [{ url: 'https://ireland.apollo.olxcdn.com:443/v1/files/a-PT/image;s=1000x700' }],
  attributes: [
    { code: 'body_type', value: 'combi', values: null }, { code: 'year', value: '2008', values: null },
    { code: 'modelo', value: 'grand-scenic', values: null }, { code: 'first_registration_month', value: '04', values: null },
    { code: 'engine_capacity', value: '1500', values: null }, { code: 'combustivel', value: 'diesel', values: null },
    { code: 'engine_power', value: '106', values: null }, { code: 'quilometros', value: '242000', values: null },
    { code: 'gearbox', value: 'manual', values: null }, { code: 'condicao', value: 'usado', values: null },
    { code: 'portas', value: '4-5', values: null }, { code: 'nr_seats', value: '7', values: null },
    { code: 'origin', value: 'national', values: null },
  ],
};
const GS_DEFS = [
  { code: 'modelo', label: 'Modelo', values: [{ code: 'grand-scenic', label: 'Grand Scenic' }, { code: 'megane', label: 'Mégane' }] },
  { code: 'year', label: 'Ano', validation: { numeric: true } },
  { code: 'first_registration_month', label: 'Mês de registo', values: [{ code: '04', label: 'Abril' }] },
  { code: 'quilometros', label: 'Quilómetros', unit: 'km', validation: { numeric: true } },
  { code: 'combustivel', label: 'Combustível', values: [{ code: 'diesel', label: 'Diesel' }, { code: 'gasolina', label: 'Gasolina' }] },
  { code: 'gearbox', label: 'Caixa de velocidades', values: [{ code: 'manual', label: 'Manual' }, { code: 'automatico', label: 'Automática' }] },
  { code: 'body_type', label: 'Segmento', values: [{ code: 'combi', label: 'Monovolume' }] },
  { code: 'engine_power', label: 'Potência', unit: 'cv', validation: { numeric: true } },
  { code: 'engine_capacity', label: 'Cilindrada', unit: 'cm3', validation: { numeric: true } },
  { code: 'nr_seats', label: 'Lotação', values: [{ code: '7', label: '7' }] },
  { code: 'portas', label: 'Nº de portas', values: [{ code: '4-5', label: '4/5' }] },
  { code: 'condicao', label: 'Condição', values: [{ code: 'usado', label: 'Usado' }] },
  { code: 'origin', label: 'Origem', values: [{ code: 'national', label: 'Nacional' }] },
];

test('o Grand Scenic vira um rascunho com os campos certos', () => {
  const r = IC.advertToCarInput(GRAND_SCENIC, GS_DEFS, { make: 'Renault', vehicleType: 'car' });
  assert.equal(r.ok, true, JSON.stringify(r.missing));
  const { olx_attributes, description, ...rest } = r.input;
  assert.deepEqual(rest, {
    vehicle_type: 'car', make: 'Renault', model: 'Grand Scenic', year: 2008, registration_month: 4, mileage: 242000,
    fuel: 'Diesel', transmission: 'Manual', body: 'Monovolume', power: 106, displacement: 1500, seats: 7, doors: 5,
    price: 6000, status: 'draft', channels: [],
  });
  assert.equal(description, GRAND_SCENIC.description);
  assert.deepEqual(olx_attributes, Object.fromEntries(GRAND_SCENIC.attributes.map((a) => [a.code, a.value])));
});

test('sem combustível que se reconheça, diz o que falta', () => {
  const advert = { ...GRAND_SCENIC, attributes: GRAND_SCENIC.attributes.filter((a) => a.code !== 'combustivel') };
  assert.deepEqual(IC.advertToCarInput(advert, GS_DEFS, { make: 'Renault', vehicleType: 'car' }), { ok: false, missing: ['combustível'] });
});

test('a marca vem da categoria quando o título começa por ela; senão da primeira palavra', () => {
  assert.equal(IC.makeFromAdvert('Renault Grand Scenic', 'Renault'), 'Renault');
  assert.equal(IC.makeFromAdvert('Mercedes-Benz CLA 180', 'Mercedes-Benz'), 'Mercedes-Benz');
  assert.equal(IC.makeFromAdvert('Yamaha MT-07 de 2016', 'Motociclos - Scooters'), 'Yamaha');
});

test('só copia fotos do CDN do OLX', () => {
  assert.equal(IC.isOlxImageUrl('https://ireland.apollo.olxcdn.com:443/v1/files/x/image'), true);
  for (const bad of ['http://ireland.apollo.olxcdn.com/x', 'https://evil.com/olxcdn.com/x', 'https://olxcdn.com.evil.com/x', 'nada'])
    assert.equal(IC.isOlxImageUrl(bad), false, bad);
});

test('copia as fotos para o Storage e regista-as, a primeira como capa', async () => {
  olx.images.set('a.jpg', { type: 'image/jpeg', bytes: Buffer.alloc(1000) });
  olx.images.set('b.jpg', { type: 'image/jpeg', bytes: Buffer.alloc(2000) });
  olx.images.set('c.html', { type: 'text/html', bytes: Buffer.from('<html>') });
  olx.images.set('big.jpg', { type: 'image/jpeg', bytes: Buffer.alloc(5 * 1024 * 1024 + 1) });
  const d = db();
  const urls = ['a.jpg', 'c.html', 'big.jpg', 'b.jpg'].map((f) => `${fake.url}/img/${f}`);
  const r = await IC.copyAdvertPhotos(d, CAR, urls, { allow: () => true });
  assert.deepEqual(r, { copied: 2, failed: 2 });
  assert.deepEqual(d._storage.uploads.map((u) => u.path), [`${CAR}/olx-1.jpg`, `${CAR}/olx-2.jpg`]);
  assert.deepEqual(d._t.car_media.map((m) => [m.storage_path, m.kind, m.position, m.is_cover]),
    [[`${CAR}/olx-1.jpg`, 'image', 0, true], [`${CAR}/olx-2.jpg`, 'image', 1, false]]);
});

test('mota se a categoria descende de 379 (Motociclos); carro nos outros casos, comerciais incluídos', async () => {
  reset();
  olx.categories.set(379, { id: 379, name: 'Motociclos - Scooters', parent_id: 362 });
  olx.categories.set(999, { id: 999, name: 'Yamaha', parent_id: 379 });
  olx.categories.set(1479, { id: 1479, name: 'Opel', parent_id: 416 });
  olx.categories.set(416, { id: 416, name: 'Comerciais - Camiões', parent_id: 362 });
  const d = db();
  assert.equal(await IC.vehicleTypeOfCategory(d, 999), 'motorcycle');
  assert.equal(await IC.vehicleTypeOfCategory(d, 379), 'motorcycle');
  assert.equal(await IC.vehicleTypeOfCategory(d, 1479), 'car');
  assert.equal(await IC.vehicleTypeOfCategory(d, 603), 'car');
});

// ---- Ligar a conta ----------------------------------------------------------
test('ligar outra conta esvazia o espelho; a mesma conta (ou a primeira) não', async () => {
  const seeded = () => db({ olx_adverts: [{ id: 1, origin: 'olx', status: 'active', title: 'a', car_id: CAR }] });
  const d = seeded();
  assert.equal(await I.resetForAccount(d, '111', '222'), true);
  assert.deepEqual(d._t.olx_adverts, []);
  for (const [prev, next] of [['222', '222'], [null, '222'], ['222', null]]) {
    const same = seeded();
    assert.equal(await I.resetForAccount(same, prev, next), false, `${prev} → ${next}`);
    assert.equal(same._t.olx_adverts.length, 1);
  }
});

// ---- Painel «Anúncios no OLX» e ficha da viatura ----------------------------
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const noop = async () => ({ ok: true });
const loadUi = createLoader({
  'next/navigation': { useRouter: () => ({ refresh() {} }), usePathname: () => '/admin/anuncios' },
  'next/link': { __esModule: true, default: ({ href, children, ...p }) => React.createElement('a', { href, ...p }, children) },
  sonner: { toast: { success() {}, error() {} } },
  '@/lib/actions/olx-adverts': { readOlxAdverts: noop, linkOlxAdvert: noop, unlinkOlxAdvert: noop, confirmOlxSuggestions: noop, setOlxAdvertActive: noop, createCarFromOlxAdvert: noop },
  '@/lib/actions/olx': { refreshOlxStats: noop, retryOlxListing: noop, setCarOlxCategory: noop, browseOlxCategories: noop },
  '@/lib/actions/channels': { saveListing: noop },
});
const { OlxAdvertsTable } = loadUi('src/components/admin/OlxAdvertsTable.tsx');
const view = (over) => ({ id: 1, title: 'Anúncio', url: 'https://www.olx.pt/d/anuncio/1', origin: 'olx', status: 'active',
  views: 10, phone_views: 1, observers: 2, car: null, suggestion: null, ...over });
const html = (adverts) => renderToStaticMarkup(React.createElement(OlxAdvertsTable, { adverts, cars: [{ id: CAR, label: 'BMW 116d · 12 900 €' }], readAt: null }));

test('a lista mostra origem, estado e as ações certas por linha', () => {
  const sv = html([view({ origin: 'standvirtual', title: 'Mercedes-Benz A 180 d', suggestion: { carId: CAR, label: 'Mercedes-Benz A 180 d · 21 900 €', strong: true } })]);
  assert.match(sv, /Gerido no Standvirtual/);
  assert.match(sv, /Sugestão/);
  assert.match(sv, />Associar</);
  assert.doesNotMatch(sv, />Ativar<|>Desativar</);

  const linked = html([view({ origin: 'standvirtual', car: { id: CAR, label: 'BMW 116d', managed: false } })]);
  assert.match(linked, />Desassociar</);
  assert.match(linked, new RegExp(`/admin/carros/${CAR}`));

  const loose = html([view({ origin: 'olx', status: 'limited', title: 'Renault Grand Scenic' })]);
  assert.match(loose, /Criar viatura/);
  assert.match(loose, />Ativar</);
  assert.match(loose, /precisa de pacote pago/);

  const managed = html([view({ origin: 'olx', car: { id: CAR, label: 'BMW 116d', managed: true } })]);
  assert.match(managed, /Gere-se na ficha/);
  assert.doesNotMatch(managed, />Desativar<|>Ativar</);

  const free = html([view({ origin: 'olx', status: 'active', car: { id: CAR, label: 'BMW 116d', managed: false } })]);
  assert.match(free, />Desativar</);
});

test('«Confirmar N sugestões» conta só as fortes', () => {
  const out = html([
    view({ id: 1, suggestion: { carId: CAR, label: 'a', strong: true } }),
    view({ id: 2, suggestion: { carId: 'x', label: 'b', strong: false } }),
    view({ id: 3, suggestion: { carId: 'y', label: 'c', strong: true } }),
  ]);
  assert.match(out, /Confirmar 2 sugestões/);
  assert.doesNotMatch(html([view({ id: 2, suggestion: { carId: 'x', label: 'b', strong: false } })]), /Confirmar/);
});

test('a ficha mostra o anúncio do Standvirtual mesmo sem OLX marcado', () => {
  const { ChannelListings } = loadUi('src/components/admin/ChannelListings.tsx');
  const sv = renderToStaticMarkup(React.createElement(ChannelListings, { carId: CAR, channels: [], listings: [],
    olxAdvert: { title: 'BMW 116 d Pack M', url: 'https://www.olx.pt/d/anuncio/1', origin: 'standvirtual', status: 'active', views: 171, phone_views: 0, observers: 1 } }));
  assert.match(sv, /Este anúncio vem do Standvirtual: altera-se lá/);
  assert.match(sv, /171/);
  const own = renderToStaticMarkup(React.createElement(ChannelListings, { carId: CAR, channels: [], listings: [],
    olxAdvert: { title: 'Renault Grand Scenic', url: null, origin: 'olx', status: 'limited', views: 0, phone_views: 0, observers: 0 } }));
  assert.match(own, /Marque OLX para o backoffice passar a gerir este anúncio\./);
});

// ---- Revisão final -------------------------------------------------------------
test('uma leitura com um anúncio novo do site não apaga as associações feitas', async () => {
  reset();
  ad(43, { external_id: '8097748498' });
  ad(44, { external_id: CAR2 });
  const d = db({ olx_adverts: [{ id: 43, origin: 'standvirtual', status: 'active', title: 'a', car_id: CAR }] });
  d._t.cars.push({ id: CAR2, make: 'BMW', model: '320d', price: 18500, status: 'published', channels: ['olx'], vehicle_type: 'car' });
  const r = await I.importAdverts(d, { stats: false });
  assert.equal(r.ok, true, r.error);
  assert.deepEqual([row(d, 43).car_id, row(d, 44).car_id], [CAR, CAR2]);
});

test('a origem fica: Standvirtual por recusa, OLX depois de adotado, site sem viatura', async () => {
  reset();
  ad(45);
  ad(46, { external_id: CAR });
  ad(47, { external_id: '99999999-9999-4999-8999-999999999999' });
  const d = db({ olx_adverts: [
    { id: 45, origin: 'standvirtual', status: 'active', title: 'a', car_id: null },
    { id: 46, origin: 'olx', status: 'active', title: 'b', car_id: CAR },
  ] });
  await I.importAdverts(d, { stats: false });
  assert.deepEqual([row(d, 45).origin, row(d, 46).origin, row(d, 47).origin, row(d, 47).car_id], ['standvirtual', 'olx', 'site', null]);
  assert.equal((await LK.unlinkAdvert(d, 46)).ok, true, 'um anúncio adotado desassocia-se');
});

test('uma leitura falhada da base de dados não grava nada', async () => {
  reset(); ad(1); ad(2, { external_id: CAR });
  for (const table of ['olx_adverts', 'cars']) {
    const d = db({ olx_adverts: [{ id: 9, origin: 'olx', status: 'active', title: 'x', car_id: null }] });
    d._failSelect.set(table, READ_ERROR);
    const r = await I.importAdverts(d, { stats: false });
    assert.equal(r.ok, false, table);
    assert.deepEqual(d._t.olx_adverts.map((x) => x.id), [9], table);
  }
});

test('a sincronização não cria se não conseguir ler os anúncios; sem a migração, cria como antes', async () => {
  reset();
  const d = sdb({ olx_adverts: [{ id: 44, origin: 'standvirtual', status: 'active', title: 'BMW 320d', price: 18500, category_name: 'BMW', car_id: CAR2 }] });
  d._failSelect.set('olx_adverts', READ_ERROR);
  const r = await S.syncListing(d, CAR2);
  assert.equal(r.ok, false);
  assert.deepEqual(writes(olx), []);
  const old = sdb();
  old._failSelect.set('olx_adverts', MISSING_TABLE);
  assert.equal((await S.syncListing(old, CAR2)).ok, true);
  assert.equal(creates().length, 1);
});

test('associar a uma viatura em rascunho (mesmo com OLX marcado) não mexe no anúncio', async () => {
  reset(); ad(42);
  const d = sdb({ olx_adverts: [{ id: 42, origin: 'olx', status: 'active', title: 'BMW 320d', car_id: null }] });
  carRow(d, CAR2).status = 'draft';
  const r = await LK.linkAdvert(d, 42, CAR2);
  assert.equal(r.ok, true, r.error);
  assert.deepEqual(writes(olx), []);
  assert.equal(olx.adverts.get(42).status, 'active');
  assert.equal(r.message, 'Anúncio associado à viatura.');
  // E uma viatura publicada sem OLX marcado também não adota o anúncio.
  const d2 = sdb({ olx_adverts: [{ id: 42, origin: 'olx', status: 'active', title: 'BMW 320d', car_id: CAR2 }] });
  carRow(d2, CAR2).channels = [];
  await S.syncListing(d2, CAR2);
  assert.deepEqual(writes(olx), []);
  assert.equal(lst(d2).external_id, null);
});

test('um anúncio desativado ou expirado não impede publicar a viatura', async () => {
  reset();
  for (const status of ['removed_by_user', 'outdated']) {
    reset();
    const d = sdb({ olx_adverts: [{ id: 44, origin: 'olx', status, title: 'BMW 320d Pack M', price: 18500, category_name: 'BMW', car_id: null }] });
    const r = await S.syncListing(d, CAR2);
    assert.equal(r.ok, true, `${status}: ${r.error}`);
    assert.equal(creates().length, 1, status);
  }
});

test('o que «Criar viatura» monta passa na validação da ficha, carros e motas', () => {
  const { carFormSchema } = load('src/lib/schemas.ts');
  const car = IC.advertToCarInput(GRAND_SCENIC, GS_DEFS, { make: 'Renault', vehicleType: 'car' });
  assert.equal(carFormSchema.safeParse(car.input).success, true, JSON.stringify(carFormSchema.safeParse(car.input).error?.issues));
  const moto = {
    id: 1, title: 'Yamaha MT-07', category_id: 999, price: null, description: 'Mota muito estimada.',
    attributes: [{ code: 'year', value: '2016' }, { code: 'quilometros', value: '21000' }, { code: 'combustivel', value: 'gasolina' },
      { code: 'gearbox', value: 'manual' }, { code: 'tipo', value: 'naked' }, { code: 'engine_capacity', value: '689' }],
  };
  const motoDefs = [...GS_DEFS.filter((x) => x.code !== 'body_type'), { code: 'tipo', label: 'Segmento', values: [{ code: 'naked', label: 'Naked' }] }];
  const m = IC.advertToCarInput(moto, motoDefs, { make: 'Yamaha', vehicleType: 'motorcycle' });
  assert.equal(m.ok, true, JSON.stringify(m.missing));
  assert.deepEqual([m.input.seats, m.input.doors, m.input.price_on_request], [2, 0, true]);
  const parsed = carFormSchema.safeParse(m.input);
  assert.equal(parsed.success, true, JSON.stringify(parsed.error?.issues));
});

test('estatísticas na manutenção: só as dos anúncios à vista e com mais de 20 h, no máximo um lote', async () => {
  reset();
  const old = new Date(Date.now() - 21 * 3600e3).toISOString();
  ad(1); ad(2); ad(3, { status: 'removed_by_user' }); ad(4); ad(5);
  const d = db({ olx_adverts: [
    { id: 1, origin: 'olx', status: 'active', title: 'a', stats_at: new Date().toISOString() },
    { id: 2, origin: 'olx', status: 'active', title: 'b', stats_at: old },
    { id: 3, origin: 'olx', status: 'removed_by_user', title: 'c', stats_at: old },
    { id: 4, origin: 'olx', status: 'active', title: 'd', stats_at: null },
    { id: 5, origin: 'olx', status: 'active', title: 'e', stats_at: old },
  ] });
  const r = await I.importAdverts(d, { stats: 'due', maxStats: 2 });
  const fetched = olx.calls.filter((c) => c.endsWith('/statistics')).map((c) => Number(c.match(/adverts\/(\d+)/)[1])).sort();
  assert.equal(r.stats, 2);
  assert.equal(fetched.length, 2);
  assert.ok(fetched.every((id) => [2, 4, 5].includes(id)), String(fetched));
});
