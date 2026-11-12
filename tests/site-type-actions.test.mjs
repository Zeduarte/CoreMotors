// Tipo de site (Definições): num site que não vende um tipo, não se criam
// viaturas dele nem se põem à venda — a ficha pública daria 404. As que já
// existem continuam a poder ser trabalhadas. (Base de dados simulada, como
// em backoffice-cars-actions.test.mjs.)
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
let siteTypes = ['car', 'motorcycle'];
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
  '@/lib/site-types-query': { getSiteVehicleTypes: async () => siteTypes },
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

const bike = { vehicle_type: 'motorcycle', make: 'Ducati', model: 'Monster', year: 2022, mileage: 1000, fuel: 'Gasolina', transmission: 'Manual', body: 'Naked', doors: 0, seats: 2, price: 9000, status: 'draft' };

await test('site só de carros: não se cria, duplica nem publica uma mota', async () => {
  seed(); siteTypes = ['car'];
  const created = await cars.createCar(bike);
  assert.equal(created.ok, false);
  assert.match(created.error, /não vende motas/);
  assert.equal(t.cars.length, 2);
  const dup = await cars.duplicateCar(BIKE);
  assert.match(dup.error, /não vende motas/);
  assert.equal(t.cars.length, 2);

  t.cars.find((c) => c.id === BIKE).status = 'draft';
  assert.match((await cars.setCarStatus(BIKE, 'published')).error, /não vende motas/);
  assert.equal(t.cars.find((c) => c.id === BIKE).status, 'draft');
  const bulk = await cars.bulkSetStatus([CAR, BIKE], 'published');
  assert.match(bulk.error, /Yamaha MT-07: O site não vende motas/);
  assert.equal(t.cars.find((c) => c.id === BIKE).status, 'draft');
  siteTypes = ['car', 'motorcycle'];
});

await test('site só de carros: as motas que já existem continuam a poder ser trabalhadas', async () => {
  seed(); siteTypes = ['car'];
  // Retirar do site, e editar sem mudar o estado, continua a dar.
  assert.equal((await cars.setCarStatus(BIKE, 'draft')).ok, true);
  t.cars.find((c) => c.id === BIKE).status = 'published';
  assert.equal((await cars.updateCar(BIKE, { ...bike, status: 'published', price: 8500 })).ok, true);
  // Um carro não passa a mota (tipo que o site não vende).
  const car = { ...bike, vehicle_type: 'car', make: 'BMW', model: '320d', body: 'Berlina', doors: 4, seats: 5, status: 'published' };
  const r = await cars.updateCar(CAR, { ...car, vehicle_type: 'motorcycle', body: 'Naked', doors: 0, seats: 2 });
  assert.equal(r.ok, false);
  assert.match(r.fieldErrors.vehicle_type, /não vende motas/);
  // Com os dois tipos volta tudo.
  siteTypes = ['car', 'motorcycle'];
  t.cars.find((c) => c.id === BIKE).status = 'draft';
  assert.equal((await cars.setCarStatus(BIKE, 'published')).ok, true);
});
