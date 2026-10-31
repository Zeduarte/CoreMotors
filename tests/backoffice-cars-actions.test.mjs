// Ações do backoffice (viaturas, vendas e reservas, manutenção) com a base de
// dados e o OLX simulados: o que muda o estado de uma viatura avisa o OLX, o que
// não se pode apagar não toca no OLX, e o tipo de viatura de cada utilizador
// vale nas gravações.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

// ---- Base de dados simulada ---------------------------------------------------
let t; let rpcCalls; let deleteHook;
function reset() {
  t = { cars: [], car_media: [], leads: [], reservations: [], vehicle_financials: [], channel_listings: [], profiles: [] };
  rpcCalls = [];
  deleteHook = () => null;
}
function from(table) {
  const f = []; let op = 'select', patch = null, wantRows = false, single = false;
  const api = {
    select() { wantRows = true; return api; },
    eq(c, v) { f.push((r) => r[c] === v); return api; },
    neq(c, v) { f.push((r) => r[c] !== v); return api; },
    in(c, v) { f.push((r) => v.includes(r[c])); return api; },
    is(c, v) { f.push((r) => (r[c] ?? null) === v); return api; },
    not(c, _o, v) { f.push((r) => (r[c] ?? null) !== v); return api; },
    lte(c, v) { f.push((r) => r[c] <= v); return api; },
    lt(c, v) { f.push((r) => r[c] < v); return api; },
    gte(c, v) { f.push((r) => r[c] >= v); return api; },
    order() { return api; }, limit() { return api; }, range() { return api; },
    update(p) { op = 'update'; patch = p; return api; },
    delete() { op = 'delete'; return api; },
    insert(row) { op = 'insert'; patch = row; return api; },
    maybeSingle() { single = true; return api; },
    single() { single = true; return api; },
    then(res, rej) {
      const rows = t[table].filter((r) => f.every((fn) => fn(r)));
      let data = rows, error = null;
      if (op === 'update') rows.forEach((r) => Object.assign(r, patch));
      if (op === 'insert') { const row = { id: `id-${Math.random().toString(16).slice(2)}`, ...patch }; t[table].push(row); data = [row]; }
      if (op === 'delete') {
        for (const r of rows) { error = deleteHook(table, r); if (error) break; }
        if (error) data = null;
        else t[table] = t[table].filter((r) => !rows.includes(r));
      }
      return Promise.resolve({ data: single ? (data?.[0] ?? null) : data, error }).then(res, rej);
    },
  };
  return api;
}
const db = {
  from: (table) => from(table),
  rpc: async (name, args) => { rpcCalls.push([name, args]); return rpcResult(name, args); },
  storage: { from: () => ({ remove: async (paths) => { removed.push(...paths); return { error: null }; } }) },
};
let rpcResult = () => ({ data: null, error: null });
let removed = [];

// ---- Módulos substituídos -----------------------------------------------------
let me = { id: 'u1', role: 'admin', allowed_vehicle_types: null, allowed_sections: null };
const olx = { queued: [], collected: [], retired: [], marked: [] };
const STUBS = {
  'server-only': {},
  'next/cache': { revalidatePath() {}, revalidateTag() {}, unstable_cache: (fn) => fn },
  'next/server': require('next/server'),
  '@/lib/supabase/server': { createClient: async () => db },
  '@/lib/supabase/admin': { createAdminClient: () => db },
  '@/lib/guard': { requireSection: async () => me },
  '@/lib/notifications-kick': { deliverNotificationsSoon() {} },
  '@/lib/olx/queue': {
    queueOlxSync: async (ids) => { olx.queued.push(...ids); },
    olxAdvertIds: async (ids) => { const out = t.channel_listings.filter((l) => ids.includes(l.car_id) && l.external_id).map((l) => l.external_id); olx.collected.push(...out); return out; },
    retireOlxAdverts: async (ids) => { olx.retired.push(...ids); },
    carsWithExpiredReservations: async () => [...new Set(t.reservations.filter((r) => r.status === 'active' && r.expires_at <= new Date().toISOString()).map((r) => r.car_id))],
  },
  '@/lib/olx/client': { olxConfigured: () => true, refreshIfNeeded: async () => {} },
  '@/lib/olx/sync': { markPending: async (_db, id) => { olx.marked.push(id); }, syncPending: async () => 0, refreshStats: async () => ({}) },
  '@/lib/notifications': { processNotificationJobs: async () => ({ ok: true }) },
  '@/lib/whatsapp/photos': { pruneWaMedia: async () => {} },
  '@/lib/stock-alert-run': { runStockAlerts: async () => {} },
  '@/lib/visit-run': { runVisitReminders: async () => {} },
};
const cache = new Map();
function withExt(base) { for (const ext of ['.ts', '.tsx', '/index.ts']) if (existsSync(base + ext)) return base + ext; throw new Error(`não resolvido: ${base}`); }
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } });
  const mod = { exports: {} }; cache.set(path, mod.exports);
  const r = (id) => id in STUBS ? STUBS[id] : id.startsWith('@/') ? load(withExt(`src/${id.slice(2)}`)) : id.startsWith('.') ? load(withExt(new URL(id, new URL(path, 'file:///')).pathname.slice(1))) : require(id);
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, r);
  cache.set(path, mod.exports); return mod.exports;
}
const ops = load('src/lib/actions/operations.ts');
const cars = load('src/lib/actions/cars.ts');
const { manualStatusError, manualStatusOptions } = load('src/lib/car-status.ts');

const CAR = '11111111-1111-4111-8111-111111111111';
const BIKE = '22222222-2222-4222-8222-222222222222';
const LEAD = '33333333-3333-4333-8333-333333333333';
const RES = '44444444-4444-4444-8444-444444444444';
function seed() {
  reset(); removed = []; olx.queued = []; olx.collected = []; olx.retired = []; olx.marked = [];
  me = { id: 'u1', role: 'admin', allowed_vehicle_types: null, allowed_sections: null };
  rpcResult = () => ({ data: null, error: null });
  t.cars.push({ id: CAR, make: 'BMW', model: '320d', status: 'published', vehicle_type: 'car', slug: 'bmw-320d' });
  t.cars.push({ id: BIKE, make: 'Yamaha', model: 'MT-07', status: 'published', vehicle_type: 'motorcycle', slug: 'yamaha-mt-07' });
  t.leads.push({ id: LEAD, car_id: CAR, vehicle_type: 'car', status: 'proposal' });
  t.channel_listings.push({ car_id: CAR, channel: 'olx', external_id: '901' });
  t.car_media.push({ car_id: CAR, storage_path: 'bmw/1.jpg' });
}
const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };

// ---- 1. OLX acompanha vendas e reservas -----------------------------------------
await test('closing a sale, reserving and releasing queue the OLX sync of that car', async () => {
  seed();
  assert.equal((await ops.closeSale(form({ lead: LEAD, amount: '19000', sale_date: '2026-10-01' }))).ok, true);
  assert.deepEqual(rpcCalls.map((c) => c[0]), ['close_vehicle_sale']);
  assert.deepEqual(olx.queued, [CAR], 'vendida → o OLX é avisado');

  seed();
  assert.equal((await ops.reserveVehicle(form({ lead: LEAD, expiry: new Date(Date.now() + 86400e3).toISOString(), deposit: '0' }))).ok, true);
  assert.deepEqual(olx.queued, [CAR]);

  seed();
  t.reservations.push({ id: RES, car_id: CAR, lead_id: LEAD, status: 'active' });
  assert.equal((await ops.releaseReservation(form({ id: RES }))).ok, true);
  assert.deepEqual(olx.queued, [CAR]);

  // A base de dados recusa: nada vai ao OLX.
  seed();
  rpcResult = () => ({ data: null, error: { message: 'Viatura indisponível' } });
  assert.equal((await ops.closeSale(form({ lead: LEAD, amount: '19000', sale_date: '2026-10-01' }))).ok, false);
  assert.deepEqual(olx.queued, []);
});

await test('expiring reservations (button and scheduled maintenance) queue the OLX sync of the released cars', async () => {
  seed();
  t.reservations.push({ id: RES, car_id: CAR, lead_id: LEAD, status: 'active', expires_at: new Date(Date.now() - 60e3).toISOString() });
  t.reservations.push({ id: 'r2', car_id: BIKE, lead_id: LEAD, status: 'active', expires_at: new Date(Date.now() + 3600e3).toISOString() });
  rpcResult = (name) => ({ data: name === 'expire_reservations' ? 1 : null, error: null });
  assert.equal((await ops.expireReservationsNow()).ok, true);
  assert.deepEqual(olx.queued, [CAR], 'só a que expirou');

  olx.marked = [];
  process.env.MAINTENANCE_SECRET = 'segredo';
  const { POST } = load('src/app/api/maintenance/route.ts');
  const res = await POST(new Request('https://example.test/api/maintenance', { method: 'POST', headers: { authorization: 'Bearer segredo' } }));
  assert.equal(res.status, 200);
  assert.deepEqual(olx.marked, [CAR], 'a manutenção marca o anúncio antes de sincronizar os pendentes');
});

// ---- 2. Apagar viaturas ----------------------------------------------------------
await test('a car with sales or reservation history is not deleted and its OLX advert is left alone', async () => {
  seed();
  t.reservations.push({ id: RES, car_id: CAR, lead_id: LEAD, status: 'cancelled' });
  const r = await cars.deleteCar(CAR);
  assert.equal(r.ok, false);
  assert.match(r.error, /reservas ou uma venda registadas.*passe-a a rascunho/);
  assert.ok(t.cars.some((c) => c.id === CAR), 'continua no site');
  assert.deepEqual(olx.retired, [], 'e no OLX');

  // Vendida com venda registada: outra mensagem (não há rascunho para ela).
  t.reservations = [];
  t.cars[0].status = 'sold';
  t.vehicle_financials.push({ car_id: CAR, sale_lead_id: LEAD });
  assert.match((await cars.deleteCar(CAR)).error, /vendida.*histórico de vendas/);
});

await test('when the database refuses the delete, the OLX advert is not retired', async () => {
  seed();
  // Sem a 0047 nem acesso às reservas: só a base de dados sabe.
  deleteHook = (table) => table === 'cars' ? { message: 'update or delete on table "cars" violates foreign key constraint "reservations_car_id_fkey"' } : null;
  const r = await cars.deleteCar(CAR);
  assert.equal(r.ok, false);
  assert.match(r.error, /reservas ou uma venda registadas/);
  assert.deepEqual(olx.retired, []);
  assert.deepEqual(removed, [], 'as fotografias ficam');
});

await test('a car without history is deleted, then its OLX advert retired and its media removed', async () => {
  seed();
  const r = await cars.deleteCar(CAR);
  assert.equal(r.ok, true, r.error);
  assert.ok(!t.cars.some((c) => c.id === CAR));
  assert.deepEqual(olx.retired, ['901']);
  assert.deepEqual(removed, ['bmw/1.jpg']);
});

await test('bulk delete handles a mixed selection one by one and says what stayed', async () => {
  seed();
  t.reservations.push({ id: RES, car_id: CAR, lead_id: LEAD, status: 'expired' });
  const r = await cars.bulkDelete([CAR, BIKE]);
  assert.equal(r.ok, false);
  assert.match(r.error, /^1 viatura apagada\. Não apagadas: BMW 320d tem reservas/);
  assert.deepEqual(t.cars.map((c) => c.id), [CAR]);
  assert.deepEqual(olx.retired, [], 'o BMW (com anúncio) ficou, o anúncio também');
});

// ---- 4. Tipo de viatura -----------------------------------------------------------
await test('a car-only seller cannot create, change or delete motorcycles, nor work their leads', async () => {
  seed();
  me = { id: 'u2', role: 'vendedor', allowed_vehicle_types: ['car'], allowed_sections: null };
  const bike = { vehicle_type: 'motorcycle', make: 'Yamaha', model: 'MT-07', year: 2020, mileage: 1000, fuel: 'Gasolina', transmission: 'Manual', body: 'Naked', doors: 0, seats: 2, price: 7000, status: 'draft' };
  const created = await cars.createCar(bike);
  assert.equal(created.ok, false);
  assert.match(created.error, /tipo de viatura/);
  assert.equal(t.cars.length, 2);
  assert.match((await cars.setCarStatus(BIKE, 'draft')).error, /tipo de viatura/);
  assert.match((await cars.toggleFeatured(BIKE, true)).error, /tipo de viatura/);
  assert.match((await cars.deleteCar(BIKE)).error, /tipo de viatura/);
  assert.ok(t.cars.some((c) => c.id === BIKE));
  t.leads[0].vehicle_type = 'motorcycle';
  assert.match((await ops.saveLeadNotesForm(form({ id: LEAD, notes: 'x' }))).error, /tipo de viatura/);
  assert.match((await ops.closeSale(form({ lead: LEAD, amount: '1', sale_date: '2026-10-01' }))).error, /tipo de viatura/);
  assert.deepEqual(rpcCalls, []);
  // O seu tipo continua a funcionar.
  assert.equal((await cars.setCarStatus(CAR, 'draft')).ok, true);
});

// ---- 8. Vendida e reservada só pelo contacto ------------------------------------------
await test('sold and reserved are only set through the lead flow; reverting a sale is admin-only and never for a recorded sale', async () => {
  assert.match(manualStatusError('published', 'sold', { isAdmin: true }), /Concluir venda/);
  assert.match(manualStatusError('published', 'reserved', { isAdmin: true }), /Confirmar reserva/);
  assert.match(manualStatusError('reserved', 'draft', { isAdmin: true, activeReservation: true }), /reserva ativa/);
  assert.equal(manualStatusError('reserved', 'published', { isAdmin: false, activeReservation: false }), null, 'reservada sem reserva (antiga): corrige-se');
  assert.match(manualStatusError('sold', 'draft', { isAdmin: false }), /administrador/);
  assert.match(manualStatusError('sold', 'published', { isAdmin: true, saleRecorded: true }), /contacto/);
  assert.equal(manualStatusError('sold', 'published', { isAdmin: true, saleRecorded: false }), null);
  assert.deepEqual(manualStatusOptions('published', false), ['draft', 'prepared', 'published']);
  assert.deepEqual(manualStatusOptions('sold', false), ['sold']);

  seed();
  me = { id: 'u2', role: 'vendedor', allowed_vehicle_types: null, allowed_sections: null };
  assert.match((await cars.setCarStatus(CAR, 'sold')).error, /Concluir venda/);
  assert.equal(t.cars[0].status, 'published');
  // Em lote: muda o que pode, explica o resto.
  t.cars[1].status = 'sold';
  const bulk = await cars.bulkSetStatus([CAR, BIKE], 'draft');
  assert.equal(bulk.ok, false);
  assert.match(bulk.error, /^1 viatura atualizada\. Ficaram como estavam — Yamaha MT-07: Só um administrador/);
  assert.deepEqual(t.cars.map((c) => c.status), ['draft', 'sold']);
  assert.deepEqual(olx.queued, [CAR]);
});

// ---- 13. Troca carros/motas dentro de /admin -------------------------------------------
await test('the admin switch route stays under /admin and keeps the same rules', async () => {
  const { NextRequest } = require('next/server');
  STUBS['@/lib/vehicle-context'] = { getAllowedVehicleTypes: async () => ['car'] };
  const { GET } = load('src/app/admin/vehicle-context/route.ts');
  const ok = await GET(new NextRequest('https://example.test/admin/vehicle-context?type=car&target=%2Fadmin%2Fleads'));
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/admin/leads');
  assert.equal(ok.cookies.get('coremotors_admin_type').value, 'car');
  // Mesmo sem `area=admin`, nunca mexe no cookie do site nem aceita destinos públicos.
  assert.equal(ok.cookies.get('coremotors_public_type'), undefined);
  const outside = await GET(new NextRequest('https://example.test/admin/vehicle-context?type=car&target=%2Finventario'));
  assert.equal(outside.headers.get('location'), '/admin/carros');
  assert.equal((await GET(new NextRequest('https://example.test/admin/vehicle-context?type=motorcycle'))).status, 403);
});
