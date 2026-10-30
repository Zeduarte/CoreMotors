// Regras da base de dados da oficina, horas e férias (migração 0046).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootDatabase, addUser, asUserFactory } from './support/pglite.mjs';

const db = await bootDatabase();
const asUser = asUserFactory(db);

const admin = '00000000-0000-4000-8000-0000000000a1';
const chefe = '00000000-0000-4000-8000-0000000000c1';
const chefe2 = '00000000-0000-4000-8000-0000000000c2';
const seller = '00000000-0000-4000-8000-0000000000b1';
const mech1 = '00000000-0000-4000-8000-0000000000d1';
const mech2 = '00000000-0000-4000-8000-0000000000d2';
await addUser(db, admin, 'admin', 'Ana Admin');
await addUser(db, chefe, 'chefe', 'Carlos Chefe');
await addUser(db, chefe2, 'chefe', 'Clara Chefe');
await addUser(db, seller, 'vendedor', 'Vasco Vendedor');
await addUser(db, mech1, 'mecanico', 'Mário Mecânico');
await addUser(db, mech2, 'mecanico', 'Miguel Mecânico');
// O chefe com a Oficina, para poder corrigir as horas dos mecânicos.
await db.query("update profiles set allowed_sections=array['dashboard','oficina'] where id=$1", [chefe]);

const car = (await db.query("insert into cars(slug,make,model,year,fuel,transmission,body,status,price) values('oficina-teste','BMW','320',2020,'Diesel','Manual','Berlina','workshop',1) returning id")).rows[0].id;

// ---- 1. Entrada na oficina ------------------------------------------------

await test('oficina: um carro entra na oficina (antes falhava em portas/lugares NULL)', async () => {
  const id = (await asUser(mech1, () => db.query("select create_workshop_intake_for_type('BMW 320d','AA-00-AA','car') id"))).rows[0].id;
  const row = (await db.query('select vehicle_type,status,doors,seats,model,year,created_by from cars where id=$1', [id])).rows[0];
  assert.equal(row.vehicle_type, 'car');
  assert.equal(row.status, 'workshop');
  // Os valores por defeito da tabela, os mesmos que a ficha propõe.
  assert.equal(row.doors, 5);
  assert.equal(row.seats, 5);
  // O resto continua por preencher: não se inventa ano nem modelo.
  assert.equal(row.model, '—');
  assert.equal(row.year, null);
  assert.equal(row.created_by, mech1);
  const moto = (await asUser(mech1, () => db.query("select create_workshop_intake_for_type('Yamaha MT-07','AA-00-AB','motorcycle') id"))).rows[0].id;
  assert.deepEqual((await db.query('select doors,seats from cars where id=$1', [moto])).rows[0], { doors: 0, seats: 2 });
});

await test('oficina: o mesmo carro entra pelo WhatsApp', async () => {
  const id = (await db.query("select wa_create_workshop_vehicle($1,'Audi A3','BB-00-BB','car') id", [mech1])).rows[0].id;
  assert.equal((await db.query('select doors from cars where id=$1', [id])).rows[0].doors, 5);
});

// ---- 2. Férias: ninguém aprova o próprio pedido ---------------------------

await test('férias: o vendedor não aprova nem recusa o próprio pedido pela API', async () => {
  await asUser(seller, () => db.query("insert into leave_days(profile_id,day,status) values($1,'2031-12-15','pending')", [seller]));
  for (const status of ['approved', 'rejected']) {
    await assert.rejects(
      asUser(seller, () => db.query('update leave_days set status=$2, decided_by=$1, decided_at=now() where profile_id=$1', [seller, status])),
      /row-level security/,
    );
  }
  // Inserir já aprovado também não.
  await assert.rejects(
    asUser(seller, () => db.query("insert into leave_days(profile_id,day,status) values($1,'2031-12-16','approved')", [seller])),
    /row-level security/,
  );
  assert.equal((await db.query("select status from leave_days where profile_id=$1 and day='2031-12-15'", [seller])).rows[0].status, 'pending');
  // Meio dia em vez de dia inteiro continua a ser do próprio.
  const r = await asUser(seller, () => db.query("update leave_days set half=true where profile_id=$1 and day='2031-12-15' returning half", [seller]));
  assert.equal(r.rows[0].half, true);
});

await test('férias: o administrador continua a aprovar o próprio plano', async () => {
  const r = await asUser(admin, () => db.query("insert into leave_days(profile_id,day,status,decided_by,decided_at) values($1,'2031-12-17','approved',$1,now()) returning status,decided_by", [admin]));
  assert.deepEqual(r.rows[0], { status: 'approved', decided_by: admin });
});

// ---- 3. Férias: o chefe decide quem está abaixo ---------------------------

await test('férias: o chefe com os separadores por defeito decide o vendedor, não o par', async () => {
  await asUser(chefe2, () => db.query("insert into leave_days(profile_id,day,status) values($1,'2031-12-18','pending')", [chefe2]));
  // É isto que a app usa em vez de ler o papel em `profiles` (que o chefe não lê).
  const pode = async (who, target) => (await asUser(who, () => db.query('select can_decide_leave_for($1) ok', [target]))).rows[0].ok;
  assert.equal(await pode(chefe, seller), true);
  assert.equal(await pode(chefe, mech1), true);
  assert.equal(await pode(chefe, chefe2), false);
  assert.equal(await pode(chefe, chefe), false);
  assert.equal(await pode(seller, mech1), false);
  const ok = await asUser(chefe, () => db.query("update leave_days set status='approved', decided_by=$2, decided_at=now() where profile_id=$1 and status='pending' returning day", [seller, chefe]));
  assert.equal(ok.rows.length, 1);
  const par = await asUser(chefe, () => db.query("update leave_days set status='approved' where profile_id=$1 and status='pending' returning day", [chefe2]));
  assert.equal(par.rows.length, 0, 'o par fica por decidir');
});

// ---- 4. Férias: voltar a pedir um dia recusado ----------------------------

await test('férias: um dia recusado volta a ser pedido e perde a decisão anterior', async () => {
  await db.query("insert into leave_days(profile_id,day,status,decided_by,decided_at) values($1,'2031-12-22','rejected',$2,now()),($1,'2031-12-23','approved',$2,now())", [seller, chefe]);
  const r = await asUser(seller, () => db.query(
    "insert into leave_days(profile_id,day,half,status) values($1,'2031-12-22',false,'pending') on conflict (profile_id,day) do update set status=excluded.status, half=excluded.half returning status, decided_by, decided_at",
    [seller]));
  assert.deepEqual(r.rows[0], { status: 'pending', decided_by: null, decided_at: null });
  // Um dia aprovado não se retira pelo próprio: 0 linhas (a app avisa).
  const apagado = await asUser(seller, () => db.query("delete from leave_days where profile_id=$1 and day='2031-12-23' returning day", [seller]));
  assert.equal(apagado.rows.length, 0);
  // Nem se transforma noutro pedido por cima.
  await assert.rejects(
    asUser(seller, () => db.query("insert into leave_days(profile_id,day,status) values($1,'2031-12-23','pending') on conflict (profile_id,day) do update set status=excluded.status", [seller])),
    /row-level security/,
  );
});

// ---- 5. Horas da oficina: cada um as suas ---------------------------------

await test('horas da oficina: um mecânico não apaga nem fecha as horas de outro', async () => {
  const task = (await asUser(mech2, () => db.query("insert into vehicle_tasks(car_id,start_time) values($1,'09:00') returning id,created_by", [car]))).rows[0];
  assert.equal(task.created_by, mech2, 'o autor vem da sessão');
  // Registar em nome de outro também não.
  await assert.rejects(asUser(mech1, () => db.query("insert into vehicle_tasks(car_id,start_time,created_by) values($1,'09:00',$2)", [car, mech2])), /row-level security/);
  assert.equal((await asUser(mech1, () => db.query('delete from vehicle_tasks where id=$1 returning id', [task.id]))).rows.length, 0);
  assert.equal((await asUser(mech1, () => db.query("update vehicle_tasks set end_time='12:00' where id=$1 returning id", [task.id]))).rows.length, 0);
  // Mas vê-as (o total da viatura é de toda a oficina).
  assert.equal((await asUser(mech1, () => db.query('select id from vehicle_tasks where id=$1', [task.id]))).rows.length, 1);
  // O próprio fecha o turno; o chefe (acima) e o administrador corrigem.
  assert.equal(Number((await asUser(mech2, () => db.query("update vehicle_tasks set end_time='12:00' where id=$1 returning hours", [task.id]))).rows[0].hours), 3);
  assert.equal((await asUser(chefe, () => db.query("update vehicle_tasks set description='Revisão' where id=$1 returning id", [task.id]))).rows.length, 1);
  const deChefe = (await asUser(chefe, () => db.query("insert into vehicle_tasks(car_id,start_time) values($1,'08:00') returning id", [car]))).rows[0].id;
  assert.equal((await asUser(mech2, () => db.query('delete from vehicle_tasks where id=$1 returning id', [deChefe]))).rows.length, 0, 'o mecânico não mexe no chefe');
  assert.equal((await asUser(admin, () => db.query('delete from vehicle_tasks where id=$1 returning id', [deChefe]))).rows.length, 1);
  assert.equal((await asUser(mech2, () => db.query('delete from vehicle_tasks where id=$1 returning id', [task.id]))).rows.length, 1);
  // Sem a Oficina, nada.
  assert.equal((await asUser(seller, () => db.query('select can_manage_hours_of($1) ok', [seller]))).rows[0].ok, true);
  await assert.rejects(asUser(seller, () => db.query("insert into vehicle_tasks(car_id,start_time) values($1,'09:00')", [car])), /row-level security/);
});

// ---- 6. Totais por viatura sem o limite de 1000 linhas --------------------

await test('horas da oficina: a vista soma mais de 1000 registos e respeita o RLS', async () => {
  const outro = (await db.query("insert into cars(slug,make,model,status,price) values('oficina-muitas','Opel','Corsa','workshop',1) returning id")).rows[0].id;
  await db.query("insert into vehicle_tasks(car_id,start_time,end_time,created_by) select $1,'09:00','09:30',$2 from generate_series(1,1250)", [outro, mech1]);
  const r = await asUser(mech1, () => db.query('select total_hours,log_count from vehicle_task_totals where car_id=$1', [outro]));
  assert.deepEqual({ total: Number(r.rows[0].total_hours), count: r.rows[0].log_count }, { total: 625, count: 1250 });
  assert.equal((await asUser(seller, () => db.query('select * from vehicle_task_totals'))).rows.length, 0, 'sem Oficina não vê totais');
  await assert.rejects(asUser(null, () => db.query('select * from vehicle_task_totals'), 'anon'), /permission denied/);
});

// ---- 7. Apagar um utilizador não apaga as horas ---------------------------

await test('utilizadores: apagar alguém guarda as horas dele, com o nome', async () => {
  const quem = '00000000-0000-4000-8000-0000000000e1';
  await addUser(db, quem, 'mecanico', 'Ernesto Saído');
  const t = (await asUser(quem, () => db.query("insert into time_entries(start_time,end_time,description) values('09:00','11:00','Limpeza') returning id"))).rows[0].id;
  const v = (await asUser(quem, () => db.query("insert into vehicle_tasks(car_id,start_time,end_time) values($1,'14:00','15:00') returning id", [car]))).rows[0].id;
  await db.query('delete from auth.users where id=$1', [quem]);
  assert.equal((await db.query('select count(*)::int n from profiles where id=$1', [quem])).rows[0].n, 0);
  assert.deepEqual((await db.query('select profile_id,profile_name,hours::float h from time_entries where id=$1', [t])).rows[0], { profile_id: null, profile_name: 'Ernesto Saído', h: 2 });
  assert.deepEqual((await db.query('select created_by,created_by_name from vehicle_tasks where id=$1', [v])).rows[0], { created_by: null, created_by_name: 'Ernesto Saído' });
  // As horas sem dono só o administrador as vê e corrige.
  assert.equal((await asUser(admin, () => db.query('select id from time_entries where id=$1', [t]))).rows.length, 1);
  assert.equal((await asUser(mech1, () => db.query('delete from vehicle_tasks where id=$1 returning id', [v]))).rows.length, 0);
  // E ninguém regista horas sem dono.
  await assert.rejects(asUser(mech1, () => db.query("insert into time_entries(profile_id,start_time,description) values(null,'09:00','x')")), /row-level security/);
});

// ---- A migração pode ser corrida outra vez --------------------------------

await test('0046 pode ser corrida duas vezes sem mudar nada', async () => {
  const { readFile } = await import('node:fs/promises');
  const snapshot = async () => (await db.query(
    "select tablename, policyname, cmd, qual, with_check from pg_policies where tablename in ('leave_days','vehicle_tasks','time_entries') order by 1,2")).rows;
  const antes = await snapshot();
  await db.exec(await readFile('supabase/migrations/0046_backoffice_rules.sql', 'utf8'));
  assert.deepEqual(await snapshot(), antes);
});
