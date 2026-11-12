// O tipo de viatura de cada utilizador (Utilizadores → Carros/Motas) nas Server
// Actions que recebem o id de uma viatura ou de um contacto: finanças, custos,
// oficina, anúncios, OLX e alertas — e a quem se pode atribuir um contacto.
// Corre o código da app contra as migrações verdadeiras em PGlite, com o RLS de
// cada utilizador; as ações do OLX usam um cliente de serviço (sem RLS), como
// em produção, para provar que é a verificação da ação que as trava.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootDatabase, addUser } from './support/pglite.mjs';
import { createPgliteClient } from './support/pglite-client.mjs';
import { createLoader } from './support/load-ts.mjs';

const db = await bootDatabase();
const admin = '00000000-0000-4000-8000-0000000000a1';
const moto = '00000000-0000-4000-8000-0000000000e1'; // vendedor só de motas
const carros = '00000000-0000-4000-8000-0000000000e2'; // vendedor só de carros
const carros2 = '00000000-0000-4000-8000-0000000000e3'; // colega, também só de carros
await addUser(db, admin, 'admin', 'Ana Admin');
await addUser(db, moto, 'vendedor', 'Vendedor Motas');
await addUser(db, carros, 'vendedor', 'Vendedor Carros');
await addUser(db, carros2, 'vendedor', 'Vera Carros');
const sections = "array['dashboard','carros','leads','financeiro','oficina']";
await db.query(`update profiles set allowed_vehicle_types=array['motorcycle'], allowed_sections=${sections} where id=$1`, [moto]);
await db.query(`update profiles set allowed_vehicle_types=array['car'], allowed_sections=${sections} where id=any($1)`, [[carros, carros2]]);

let current = null;
let currentId = null;
// O PostgREST faz o upsert pela chave primária; o cliente de teste pede-a explícita.
const withPk = (client) => ({
  ...client,
  from(table) {
    const q = client.from(table);
    if (table === 'vehicle_financials') { const up = q.upsert; q.upsert = (rows, o = {}) => up(rows, { onConflict: 'car_id', ...o }); }
    return q;
  },
});
const as = (id) => { currentId = id; current = withPk(createPgliteClient(db, id)); };
// O cliente de serviço: o mesmo PGlite, mas com o papel `service_role` (sem RLS).
const serviceDb = { exec: (sql) => db.exec(sql === 'set role authenticated' ? 'set role service_role' : sql), query: (...a) => db.query(...a) };
const service = createPgliteClient(serviceDb, null);

const olx = { queued: [], synced: [], stats: [] };
const typesOf = async () => {
  const p = (await db.query('select role, allowed_vehicle_types from profiles where id=$1', [currentId])).rows[0];
  if (!p) return ['car'];
  const picked = (p.allowed_vehicle_types ?? []).filter((t) => t === 'car' || t === 'motorcycle');
  return p.role === 'admin' || !picked.length ? ['car', 'motorcycle'] : picked;
};
const load = createLoader({
  '@/lib/supabase/server': { createClient: async () => current },
  '@/lib/supabase/admin': { createAdminClient: () => service },
  'next/cache': { revalidatePath() {}, revalidateTag() {}, unstable_cache: (fn) => fn },
  'next/navigation': { redirect(to) { throw new Error(`redirect ${to}`); } },
  '@/lib/notifications-kick': { deliverNotificationsSoon() {} },
  '@/lib/public-cache': { revalidatePublic() {} },
  '@/lib/vehicle-context': { getAllowedVehicleTypes: typesOf, getActiveVehicleTypes: typesOf },
  '@/lib/olx/queue': { queueOlxSync: async (ids) => { olx.queued.push(...ids); }, carsWithExpiredReservations: async () => [] },
  '@/lib/olx/client': { olxConfigured: () => true, olxFetch: async () => ({ ok: false, error: 'sem OLX nos testes' }) },
  '@/lib/olx/sync': {
    syncListing: async (_db, id) => { olx.synced.push(id); return { ok: true }; },
    refreshStats: async (_db, ids) => { olx.stats.push(...(ids ?? [])); return { updated: 1, failed: 0 }; },
    browseCategories: async () => ({ ok: true, categories: [] }),
    loadCategories: async () => ({ ok: false, error: 'x' }),
    storeCategory: async () => null,
    storeCategoryDetails: async () => ({}),
    syncPending: async () => 0,
  },
});

const ops = load('src/lib/actions/operations.ts');
const workshop = load('src/lib/actions/workshop.ts');
const channels = load('src/lib/actions/channels.ts');
const olxActions = load('src/lib/actions/olx.ts');
const quick = load('src/lib/actions/lead-quick.ts');
const alerts = load('src/lib/actions/alerts.ts');
const access = load('src/lib/vehicle-access.ts');

// ---- Dados ----------------------------------------------------------------------
let n = 0;
const newCar = async (type, status = 'published') => (await db.query(
  `insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type,doors,seats)
   values($1,$2,'X',2020,'Gasolina','Manual',$3,$4,9000,$5,$6,$7) returning id`,
  [`v-${++n}`, type === 'car' ? 'BMW' : 'Yamaha', type === 'car' ? 'Berlina' : 'Naked', status, type, type === 'car' ? 5 : 0, type === 'car' ? 5 : 2])).rows[0].id;
const newLead = async (car, kind = 'contact') => (await db.query(
  "insert into leads(kind,car_id,name,email,phone) values($1,$2,'Cliente','cliente@example.test','912345678') returning id", [kind, car])).rows[0].id;
const one = async (sql, params) => (await db.query(sql, params)).rows[0];
const count = async (sql, params) => (await one(sql, params)).n;

const CAR = await newCar('car'); // publicado: a mota-vendedor vê-o, mas não é do seu tipo
const DRAFT = await newCar('car', 'draft'); // rascunho: a RLS esconde-o de quem só tem motas
const BIKE = await newCar('motorcycle');
const LEAD_CAR = await newLead(CAR);
const LEAD_BIKE = await newLead(BIKE);
const LEAD_GENERAL = await newLead(null);

const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, String(v)); return f; };
const DENIED = /sem acesso/i;
/** A ação é recusada por causa do tipo (ou de o id estar escondido pela RLS). */
const refused = (r) => { assert.equal(r.ok, false, 'devia ser recusado'); assert.match(r.error, DENIED); };
const okay = (r) => assert.equal(r.ok, true, r.error);
/**
 * Pelo id de um registo (custo, horas, anúncio) do carro: recusado. Com a 0050
 * a própria RLS já esconde o registo («não encontrado»); sem ela, a ação vê-o e
 * recusa pelo tipo da viatura.
 */
const refusedRow = (r) => { assert.equal(r.ok, false, 'devia ser recusado'); assert.match(r.error, /sem acesso|não encontrad/i); };

// ---- B7: ids escondidos pela RLS ------------------------------------------------
await test('carTypesError/leadTypeError: um id que a RLS esconde dá «sem acesso», não passa', async () => {
  as(moto);
  const me = { role: 'vendedor', allowed_vehicle_types: ['motorcycle'] };
  assert.equal(await access.carTypesError(current, me, [BIKE]), null);
  assert.equal(await access.carTypesError(current, me, [CAR]), access.VEHICLE_TYPE_DENIED);
  // O rascunho do carro não vem na consulta: antes contava como «sem problema».
  assert.equal(await access.carTypesError(current, me, [DRAFT]), access.CAR_NOT_FOUND);
  assert.equal(await access.carTypesError(current, me, [BIKE, DRAFT]), access.CAR_NOT_FOUND);
  assert.equal(await access.carTypesError(current, me, ['00000000-0000-4000-8000-000000000999']), access.CAR_NOT_FOUND);
  assert.equal(await access.carTypesError(current, me, [BIKE, BIKE]), null, 'o mesmo id repetido não conta como em falta');
  assert.equal(await access.leadTypeError(current, me, LEAD_BIKE), null);
  assert.equal(await access.leadTypeError(current, me, LEAD_GENERAL), null, 'contacto sem tipo: visível');
  assert.equal(await access.leadTypeError(current, me, LEAD_CAR), access.LEAD_NOT_FOUND);
  assert.match(access.CAR_NOT_FOUND, DENIED);
  assert.match(access.LEAD_NOT_FOUND, DENIED);

  // Antes, o contacto de carro escondido passava e a atividade ficava registada.
  const r = await ops.addLeadActivity(form({ lead_id: LEAD_CAR, kind: 'note', body: 'olá' }));
  refused(r);
  assert.equal(await count('select count(*)::int n from lead_activities where lead_id=$1', [LEAD_CAR]), 0);
  okay(await ops.addLeadActivity(form({ lead_id: LEAD_BIKE, kind: 'note', body: 'olá' })));
});

// ---- M4: OLX (cliente de serviço) -------------------------------------------------
await test('OLX: quem só tem motas não muda a categoria, não repete o envio nem as estatísticas de um carro', async () => {
  await db.query('update cars set olx_category_id=123 where id=any($1)', [[CAR, DRAFT, BIKE]]);
  await db.query("insert into channel_listings(car_id,channel,status,sync_state,attempts) values($1,'olx','error','error',8),($2,'olx','error','error',8)", [CAR, BIKE]);
  olx.queued = []; olx.synced = []; olx.stats = [];
  as(moto);

  for (const id of [CAR, DRAFT]) {
    refused(await olxActions.setCarOlxCategory(id, null));
    refused(await olxActions.retryOlxListing(id));
    refused(await olxActions.refreshOlxStats(id));
  }
  assert.equal((await one('select olx_category_id::int c from cars where id=$1', [CAR])).c, 123, 'a categoria do carro ficou');
  assert.equal((await one('select olx_category_id::int c from cars where id=$1', [DRAFT])).c, 123);
  assert.deepEqual(await one("select sync_state, attempts from channel_listings where car_id=$1", [CAR]), { sync_state: 'error', attempts: 8 });
  assert.deepEqual(olx, { queued: [], synced: [], stats: [] }, 'nada foi ao OLX');

  okay(await olxActions.setCarOlxCategory(BIKE, null));
  assert.equal((await one('select olx_category_id c from cars where id=$1', [BIKE])).c, null);
  okay(await olxActions.retryOlxListing(BIKE));
  assert.equal((await one("select sync_state from channel_listings where car_id=$1", [BIKE])).sync_state, 'pending');
  okay(await olxActions.refreshOlxStats(BIKE));
  assert.deepEqual(olx, { queued: [BIKE], synced: [BIKE], stats: [BIKE] });
});

// ---- M4: Custos e margens ------------------------------------------------------------
await test('finanças: aquisição, valor/hora e custos só nas viaturas do seu tipo', async () => {
  as(moto);
  const fin = (car) => form({ car_id: car, acquired_on: '2026-01-10', purchase_price: '5000' });
  const rate = (car) => form({ car_id: car, override: 'on', hourly_rate_override: '30' });
  const cost = (car) => form({ car_id: car, category: 'parts', description: 'Pneus', amount: '120', incurred_on: '2026-01-11' });
  for (const id of [CAR, DRAFT]) {
    refused(await ops.saveFinancials(fin(id)));
    refused(await ops.saveVehicleRate(rate(id)));
    refused(await ops.addVehicleCost(cost(id)));
  }
  assert.equal(await count('select count(*)::int n from vehicle_financials where car_id=any($1)', [[CAR, DRAFT]]), 0);
  assert.equal(await count('select count(*)::int n from vehicle_costs where car_id=any($1)', [[CAR, DRAFT]]), 0);

  okay(await ops.saveFinancials(fin(BIKE)));
  okay(await ops.saveVehicleRate(rate(BIKE)));
  okay(await ops.addVehicleCost(cost(BIKE)));
  assert.deepEqual(await one('select purchase_price::int p, hourly_rate_override::int h from vehicle_financials where car_id=$1', [BIKE]), { p: 5000, h: 30 });

  // Apagar um custo: pelo id do custo, mas conta o tipo da viatura dele.
  const carCost = (await one("insert into vehicle_costs(car_id,category,description,amount,incurred_on,created_by) values($1,'parts','Óleo',30,'2026-01-12',$2) returning id", [CAR, admin])).id;
  refusedRow(await ops.deleteVehicleCost(form({ id: carCost })));
  assert.equal(await count('select count(*)::int n from vehicle_costs where id=$1', [carCost]), 1);
  const bikeCost = (await one('select id from vehicle_costs where car_id=$1', [BIKE])).id;
  okay(await ops.deleteVehicleCost(form({ id: bikeCost })));
  assert.equal(await count('select count(*)::int n from vehicle_costs where id=$1', [bikeCost]), 0);
});

// ---- M4: Oficina -------------------------------------------------------------------
await test('oficina: horas, custos e tarefas só nas viaturas do seu tipo', async () => {
  as(moto);
  const log = (car) => form({ car_id: car, work_date: '2026-01-12', start_time: '09:00', end_time: '10:00', description: '' });
  const wcost = (car) => form({ car_id: car, category: 'parts', description: 'Corrente', amount: '40', incurred_on: '2026-01-12' });
  const task = (car) => form({ id: '', car_id: car, title: 'Lavar', stage: 'preparation', status: 'pending', assigned_to: '', parts: '', due_on: '' });
  for (const id of [CAR, DRAFT]) {
    refused(await workshop.createWorklog(log(id)));
    refused(await workshop.addWorkshopCost(wcost(id)));
    refused(await ops.savePreparationTask(task(id)));
  }
  assert.equal(await count('select count(*)::int n from vehicle_tasks where car_id=any($1)', [[CAR, DRAFT]]), 0);
  assert.equal(await count('select count(*)::int n from vehicle_costs where car_id=any($1)', [[CAR, DRAFT]]), 1, 'só o custo do admin');
  assert.equal(await count('select count(*)::int n from preparation_tasks where car_id=any($1)', [[CAR, DRAFT]]), 0);

  okay(await workshop.createWorklog(log(BIKE)));
  okay(await workshop.addWorkshopCost(wcost(BIKE)));
  okay(await ops.savePreparationTask(task(BIKE)));
  assert.equal(await count('select count(*)::int n from preparation_tasks where car_id=$1', [BIKE]), 1);

  // Pelo id do registo: fechar e apagar horas, apagar custos.
  const open = async (car) => (await one("insert into vehicle_tasks(car_id,work_date,start_time,created_by) values($1,'2026-01-13','09:00',$2) returning id", [car, moto])).id;
  const carLog = await open(CAR);
  refusedRow(await ops.finishWorklog(form({ id: carLog, end_time: '12:00' })));
  assert.equal((await one('select end_time from vehicle_tasks where id=$1', [carLog])).end_time, null);
  refusedRow(await workshop.deleteWorklog(carLog));
  assert.equal(await count('select count(*)::int n from vehicle_tasks where id=$1', [carLog]), 1);
  const bikeLog = await open(BIKE);
  okay(await ops.finishWorklog(form({ id: bikeLog, end_time: '12:00' })));
  assert.equal(Number((await one('select hours from vehicle_tasks where id=$1', [bikeLog])).hours), 3);
  okay(await workshop.deleteWorklog(bikeLog));

  const carCost = (await one("insert into vehicle_costs(car_id,category,description,amount,incurred_on,created_by) values($1,'parts','Filtro',15,'2026-01-13',$2) returning id", [CAR, moto])).id;
  refusedRow(await workshop.deleteWorkshopCost(carCost));
  assert.equal(await count('select count(*)::int n from vehicle_costs where id=$1', [carCost]), 1);
  const bikeCost = (await one('select id from vehicle_costs where car_id=$1 and created_by=$2', [BIKE, moto])).id;
  okay(await workshop.deleteWorkshopCost(bikeCost));
});

// ---- M4: Canais de anúncio ----------------------------------------------------------
await test('canais de anúncio: criar e apagar o registo só nas viaturas do seu tipo', async () => {
  as(moto);
  for (const id of [CAR, DRAFT]) refused(await channels.saveListing({ car_id: id, channel: 'standvirtual', status: 'published' }));
  assert.equal(await count("select count(*)::int n from channel_listings where channel='standvirtual'"), 0);
  okay(await channels.saveListing({ car_id: BIKE, channel: 'standvirtual', status: 'published' }));

  const carListing = (await one("insert into channel_listings(car_id,channel,status) values($1,'custojusto','published') returning id", [CAR])).id;
  refusedRow(await channels.deleteListing(carListing));
  assert.equal(await count('select count(*)::int n from channel_listings where id=$1', [carListing]), 1);
  const bikeListing = (await one("select id from channel_listings where car_id=$1 and channel='standvirtual'", [BIKE])).id;
  okay(await channels.deleteListing(bikeListing));
  assert.equal(await count('select count(*)::int n from channel_listings where id=$1', [bikeListing]), 0);
});

// ---- Alertas de stock ----------------------------------------------------------------
await test('alertas: «marcar como avisado» só nos contactos do seu tipo, e a correspondência tem de ser desse contacto', async () => {
  const alertCar = await newLead(null, 'alert');
  const alertBike = await newLead(null, 'alert');
  await db.query("update leads set vehicle_type='car' where id=$1", [alertCar]);
  await db.query("update leads set vehicle_type='motorcycle' where id=$1", [alertBike]);
  const match = async (lead, car) => (await one('insert into stock_alert_matches(lead_id,car_id,status) values($1,$2,$3) returning id', [lead, car, 'manual'])).id;
  const carMatch = await match(alertCar, CAR);
  const bikeMatch = await match(alertBike, BIKE);
  const state = async (id) => (await one('select status from stock_alert_matches where id=$1', [id])).status;
  as(moto);
  refused(await alerts.markAlertMatchSent(form({ id: carMatch, lead_id: alertCar })));
  // O id da correspondência de um carro com o contacto (visível) de uma mota.
  assert.equal((await alerts.markAlertMatchSent(form({ id: carMatch, lead_id: alertBike }))).ok, false);
  assert.equal(await state(carMatch), 'manual');
  okay(await alerts.markAlertMatchSent(form({ id: bikeMatch, lead_id: alertBike })));
  assert.equal(await state(bikeMatch), 'sent');
});

// ---- M3: a quem se atribui um contacto -------------------------------------------------
const followup = (id, o) => form({ id, assigned_to: '', car_id: '', next_action: '', next_action_at: '', status: 'new', loss_reason: '', ...o });
const assignee = async (lead) => (await one('select assigned_to from leads where id=$1', [lead])).assigned_to;

await test('ficha do contacto: o admin não atribui um contacto de carro a quem só trabalha motas', async () => {
  as(admin);
  let r = await ops.saveLeadFollowup(followup(LEAD_CAR, { car_id: CAR, assigned_to: moto }));
  assert.equal(r.ok, false);
  assert.match(r.error, /não trabalha este tipo de viatura/);
  assert.equal(await assignee(LEAD_CAR), null);
  okay(await ops.saveLeadFollowup(followup(LEAD_CAR, { car_id: CAR, assigned_to: carros })));
  assert.equal(await assignee(LEAD_CAR), carros);
  // Contacto sem tipo: qualquer um.
  okay(await ops.saveLeadFollowup(followup(LEAD_GENERAL, { assigned_to: moto })));
  assert.equal(await assignee(LEAD_GENERAL), moto);
  // Trocar a viatura muda o tipo do contacto: quem o tem tem de trabalhar o novo.
  okay(await ops.saveLeadFollowup(followup(LEAD_BIKE, { car_id: BIKE, assigned_to: moto })));
  r = await ops.saveLeadFollowup(followup(LEAD_BIKE, { car_id: CAR, assigned_to: moto }));
  assert.match(r.error, /não trabalha este tipo de viatura/);
  assert.deepEqual(await one('select car_id, vehicle_type from leads where id=$1', [LEAD_BIKE]), { car_id: BIKE, vehicle_type: 'motorcycle' });
});

await test('ficha do contacto: um vendedor atribui a um colega com o tipo certo (sem ler o perfil dele)', async () => {
  as(carros);
  okay(await ops.saveLeadFollowup(followup(LEAD_CAR, { car_id: CAR, assigned_to: carros2 })));
  assert.equal(await assignee(LEAD_CAR), carros2);
  const r = await ops.saveLeadFollowup(followup(LEAD_CAR, { car_id: CAR, assigned_to: moto }));
  assert.match(r.error, /não trabalha este tipo de viatura/);
  assert.equal(await assignee(LEAD_CAR), carros2);
});

await test('lista de contactos (atribuição rápida): o vendedor atribui a um colega do mesmo tipo; a quem não o trabalha, não', async () => {
  await db.query('update leads set assigned_to=null where id=any($1)', [[LEAD_CAR, LEAD_GENERAL]]);
  as(carros);
  // Antes lia o perfil do colega, que a RLS esconde: dava sempre «não trabalha este tipo».
  okay(await quick.quickAssign(LEAD_CAR, carros2));
  assert.equal(await assignee(LEAD_CAR), carros2);
  const r = await quick.quickAssign(LEAD_CAR, moto);
  assert.equal(r.ok, false);
  assert.match(r.error, /não trabalha este tipo de viatura/);
  assert.equal(await assignee(LEAD_CAR), carros2);
  okay(await quick.quickAssign(LEAD_GENERAL, moto));
  assert.equal(await assignee(LEAD_GENERAL), moto);
  // O admin também não passa por cima da regra.
  as(admin);
  assert.match((await quick.quickAssign(LEAD_CAR, moto)).error, /não trabalha este tipo de viatura/);
  // Quem só tem motas nem vê o contacto do carro.
  as(moto);
  assert.equal((await quick.quickAssign(LEAD_CAR, moto)).ok, false);
});
