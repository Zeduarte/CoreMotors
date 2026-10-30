// O código da app (ações e leituras) da oficina, horas e férias, a correr
// contra as migrações verdadeiras em PGlite, com o RLS de cada utilizador.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootDatabase, addUser } from './support/pglite.mjs';
import { createPgliteClient, MAX_ROWS } from './support/pglite-client.mjs';
import { createLoader } from './support/load-ts.mjs';

const db = await bootDatabase();
const admin = '00000000-0000-4000-8000-0000000000a1';
const chefe = '00000000-0000-4000-8000-0000000000c1';
const chefe2 = '00000000-0000-4000-8000-0000000000c2';
const seller = '00000000-0000-4000-8000-0000000000b1';
const seller2 = '00000000-0000-4000-8000-0000000000b2';
const mech1 = '00000000-0000-4000-8000-0000000000d1';
const mech2 = '00000000-0000-4000-8000-0000000000d2';
await addUser(db, admin, 'admin', 'Ana Admin');
await addUser(db, chefe, 'chefe', 'Carlos Chefe');
await addUser(db, chefe2, 'chefe', 'Clara Chefe');
await addUser(db, seller, 'vendedor', 'Vasco Vendedor');
await addUser(db, seller2, 'vendedor', 'Vera Vendedora');
await addUser(db, mech1, 'mecanico', 'Mário Mecânico');
await addUser(db, mech2, 'mecanico', 'Miguel Mecânico');

let current = null;
const as = (id) => { current = createPgliteClient(db, id); };
const redirects = [];
const load = createLoader({
  '@/lib/supabase/server': { createClient: async () => current },
  'next/cache': { revalidatePath() {} },
  'next/navigation': { redirect(to) { redirects.push(to); throw new Error(`redirect ${to}`); } },
  '@/lib/notifications-kick': { deliverNotificationsSoon() {} },
  '@/lib/public-cache': { revalidatePublic() {} },
  '@/lib/vehicle-context': { getAdminVehicleType: async () => 'car' },
});

const leave = load('src/lib/actions/leave.ts');
const leaveQ = load('src/lib/leave-queries.ts');
const status = async (who, day) => (await db.query('select status from leave_days where profile_id=$1 and day=$2', [who, day])).rows[0]?.status ?? null;

// ---- Férias: pedidos e decisões -------------------------------------------

await test('férias: retirar um dia pendente funciona; um aprovado é recusado com motivo', async () => {
  as(seller);
  let r = await leave.applyLeaveChanges({ year: 2031, add: [{ day: '2031-02-03', half: false }, { day: '2031-02-04', half: false }], remove: [] });
  assert.deepEqual(r, { ok: true, approved: false });
  assert.equal(await status(seller, '2031-02-03'), 'pending');
  r = await leave.applyLeaveChanges({ year: 2031, add: [], remove: ['2031-02-04'] });
  assert.equal(r.ok, true);
  assert.equal(await status(seller, '2031-02-04'), null);

  await db.query("update leave_days set status='approved' where profile_id=$1 and day='2031-02-03'", [seller]);
  r = await leave.applyLeaveChanges({ year: 2031, add: [], remove: ['2031-02-03'] });
  assert.equal(r.ok, false, 'antes dizia "guardado" sem ter mudado nada');
  assert.match(r.error, /aprovados/);
  assert.equal(await status(seller, '2031-02-03'), 'approved');
  // Pedir por cima de um dia aprovado também não.
  r = await leave.applyLeaveChanges({ year: 2031, add: [{ day: '2031-02-03', half: true }], remove: [] });
  assert.equal(r.ok, false);
  assert.equal(await status(seller, '2031-02-03'), 'approved');
});

await test('férias: um dia recusado volta a ser pedido (antes falhava no RLS)', async () => {
  await db.query("insert into leave_days(profile_id,day,status,decided_by,decided_at) values($1,'2031-02-05','rejected',$2,now())", [seller, chefe]);
  as(seller);
  const r = await leave.applyLeaveChanges({ year: 2031, add: [{ day: '2031-02-05', half: false }], remove: [] });
  assert.deepEqual(r, { ok: true, approved: false });
  const row = (await db.query("select status,decided_by from leave_days where profile_id=$1 and day='2031-02-05'", [seller])).rows[0];
  assert.deepEqual(row, { status: 'pending', decided_by: null });
});

await test('férias: um dia recusado que se volta a pedir conta no saldo', async () => {
  await db.query("insert into leave_balances(profile_id,year,base_days,carried_days,birthday_day) values($1,2031,1,0,0)", [seller2]);
  await db.query("insert into leave_days(profile_id,day,status) values($1,'2031-02-06','approved'),($1,'2031-02-07','rejected')", [seller2]);
  as(seller2);
  const r = await leave.applyLeaveChanges({ year: 2031, add: [{ day: '2031-02-07', half: false }], remove: [] });
  assert.equal(r.ok, false);
  assert.match(r.error, /saldo/);
  assert.equal(await status(seller2, '2031-02-07'), 'rejected');
});

await test('férias: o chefe com os separadores por defeito vê e decide os pedidos de baixo, não os do par', async () => {
  as(chefe2);
  assert.equal((await leave.applyLeaveChanges({ year: 2031, add: [{ day: '2031-02-10', half: false }], remove: [] })).ok, true);
  as(mech1);
  assert.equal((await leave.applyLeaveChanges({ year: 2031, add: [{ day: '2031-02-11', half: false }], remove: [] })).ok, true);

  as(chefe);
  const pedidos = await leaveQ.getPendingRequests();
  const quem = pedidos.map((p) => p.name).sort();
  assert.deepEqual(quem, ['Mário Mecânico', 'Vasco Vendedor'], 'o pedido da outra chefe não aparece');

  let r = await leave.decideLeave({ profileId: seller, days: ['2031-02-05'], approve: true });
  assert.deepEqual(r, { ok: true }, 'antes: "Só pode decidir pedidos de quem está abaixo de si."');
  assert.equal(await status(seller, '2031-02-05'), 'approved');
  // Decidir o que já foi decidido não é sucesso.
  r = await leave.decideLeave({ profileId: seller, days: ['2031-02-05'], approve: false });
  assert.equal(r.ok, false);
  assert.equal(await status(seller, '2031-02-05'), 'approved');
  // A par: recusado, e o dia fica pendente.
  r = await leave.decideLeave({ profileId: chefe2, days: ['2031-02-10'], approve: true });
  assert.equal(r.ok, false);
  assert.equal(await status(chefe2, '2031-02-10'), 'pending');

  as(admin);
  assert.ok((await leaveQ.getPendingRequests()).some((p) => p.profileId === chefe2), 'o administrador vê o da chefe');
  as(seller);
  assert.deepEqual(await leaveQ.getPendingRequests(), [], 'o vendedor não decide ninguém');
});

// ---- Férias: saldos e dias da empresa -------------------------------------

const form = (o) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, String(v)); return f; };

await test('férias: o chefe ajusta o saldo de quem está abaixo, não o do par nem o seu', async () => {
  as(chefe);
  const geridos = await leaveQ.getManagedBalances(2031);
  assert.deepEqual(geridos.map((p) => p.name).sort(), ['Miguel Mecânico', 'Mário Mecânico', 'Vasco Vendedor', 'Vera Vendedora']);
  assert.deepEqual(geridos.find((p) => p.id === seller2).balance, { baseDays: 1, carriedDays: 0, birthdayDay: 0 });
  let r = await leave.saveBalance(form({ profile_id: seller, year: 2031, base_days: 23, carried_days: 2.5, birthday_day: 'on' }));
  assert.deepEqual(r, { ok: true });
  assert.deepEqual((await db.query('select base_days::float b, carried_days::float c, birthday_day::float d from leave_balances where profile_id=$1 and year=2031', [seller])).rows[0], { b: 23, c: 2.5, d: 1 });
  r = await leave.saveBalance(form({ profile_id: chefe2, year: 2031, base_days: 30, carried_days: 0 }));
  assert.equal(r.ok, false);
  r = await leave.saveBalance(form({ profile_id: chefe, year: 2031, base_days: 30, carried_days: 0 }));
  assert.equal(r.ok, false);
  r = await leave.saveBalance(form({ profile_id: seller, year: 2031, base_days: 22.3, carried_days: 0 }));
  assert.match(r.error, /meios dias/);
  as(seller);
  assert.equal((await leave.saveBalance(form({ profile_id: seller, year: 2031, base_days: 60, carried_days: 0 }))).ok, false);
});

await test('férias: quem tem Definições junta e retira dias da empresa; os outros não', async () => {
  as(admin);
  let r = await leave.addCompanyDay(form({ day: '2031-06-13', kind: 'holiday', label: 'Santo António' }));
  assert.deepEqual(r, { ok: true });
  const dias = await leaveQ.getCompanyDayRows(2031);
  assert.equal(dias.length, 1);
  assert.equal(dias[0].label, 'Santo António');
  // Aparece no calendário de toda a gente.
  as(seller);
  assert.deepEqual((await leaveQ.getCompanyDays(2031)).map((d) => d.day), ['2031-06-13']);
  assert.equal((await leave.addCompanyDay(form({ day: '2031-06-14', kind: 'holiday', label: '' }))).ok, false);
  assert.equal((await leave.removeCompanyDay(dias[0].id)).ok, false);
  as(admin);
  assert.equal((await leave.addCompanyDay(form({ day: '2031-13-01', kind: 'holiday', label: '' }))).ok, false);
  assert.deepEqual(await leave.removeCompanyDay(dias[0].id), { ok: true });
  assert.equal((await leave.removeCompanyDay(dias[0].id)).ok, false, 'já não existe: não é sucesso');
});

// ---- Oficina e horas -------------------------------------------------------

const workshop = load('src/lib/actions/workshop.ts');
const workshopQ = load('src/lib/workshop.ts');
const hoursQ = load('src/lib/hours-queries.ts');

await test('oficina: o mecânico regista um carro (antes falhava com portas NULL)', async () => {
  as(mech1);
  const r = await workshop.createWorkshopVehicle(form({ name: 'Renault Clio', plate: 'cc 00 cc' }));
  assert.equal(r.ok, true);
  const row = (await db.query('select vehicle_type,status,license_plate from cars where id=$1', [r.id])).rows[0];
  assert.deepEqual(row, { vehicle_type: 'car', status: 'workshop', license_plate: 'CC00CC' });
});

await test('oficina: só apaga e vê o ✕ nos próprios registos; o chefe/admin nos de baixo', async () => {
  const car = (await db.query("select id from cars where license_plate='CC00CC'")).rows[0].id;
  const de = async (who, start) => (await db.query("insert into vehicle_tasks(car_id,start_time,end_time,created_by) values($1,$2,'18:00',$3) returning id", [car, start, who])).rows[0].id;
  const t1 = await de(mech1, '08:00');
  const t2 = await de(mech2, '09:00');
  as(mech1);
  assert.deepEqual((await workshopQ.getWorkshopVehicle(car)).manageable, [t1]);
  let r = await workshop.deleteWorklog(t2);
  assert.equal(r.ok, false);
  assert.match(r.error, /que registou/);
  assert.equal((await workshop.deleteWorklog('não-é-uuid')).ok, false);
  assert.equal((await db.query('select count(*)::int n from vehicle_tasks where id=$1', [t2])).rows[0].n, 1);
  as(admin);
  assert.deepEqual((await workshopQ.getWorkshopVehicle(car)).manageable.sort(), [t1, t2].sort());
  r = await workshop.deleteWorklog(t2);
  assert.deepEqual(r, { ok: true });
  as(mech1);
  assert.deepEqual(await workshop.deleteWorklog(t1), { ok: true });
});

await test(`oficina e horas: totais certos com mais de ${MAX_ROWS} registos`, async () => {
  const car = (await db.query("select id from cars where license_plate='CC00CC'")).rows[0].id;
  await db.query("insert into vehicle_tasks(car_id,work_date,start_time,end_time,created_by) select $1,'2031-03-10','09:00','10:00',$2 from generate_series(1,1300)", [car, mech1]);
  await db.query("insert into time_entries(profile_id,work_date,start_time,end_time,description) select $1,'2031-03-11','09:00','09:30','Limpeza' from generate_series(1,1100)", [mech1]);
  as(mech1);
  const lista = await workshopQ.getWorkshopVehicles();
  const v = lista.find((x) => x.id === car);
  assert.deepEqual({ h: v.totalHours, n: v.logCount }, { h: 1300, n: 1300 });
  const { entries } = await hoursQ.getHours('2031-03-01', '2031-03-31', mech1);
  assert.equal(entries.length, 2400);
  assert.equal(entries.reduce((s, e) => s + e.hours, 0), 1300 + 550);
});
