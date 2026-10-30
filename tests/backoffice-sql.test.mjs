// Viaturas, contactos, vendas e visitas na base de dados (migração 0047), sobre
// a base de dados a sério (PGlite, todas as migrações).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key, email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select coalesce(
   nullif(current_setting('request.jwt.claim.sub',true),''),
   nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant usage,select on sequences to anon,authenticated,service_role;
 grant all on storage.objects to anon,authenticated,service_role;
`);
for (const file of (await readdir('supabase/migrations')).sort())
  await db.exec((await readFile(`supabase/migrations/${file}`, 'utf8')).replace('create extension if not exists "pgcrypto";', ''));

const admin = '00000000-0000-4000-8000-0000000000a1';
const seller = '00000000-0000-4000-8000-0000000000b1';
const motoSeller = '00000000-0000-4000-8000-0000000000b2';
for (const [id, role] of [[admin, 'admin'], [seller, 'vendedor'], [motoSeller, 'vendedor']]) {
  await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${role}-${id.slice(-2)}@example.test`]);
  await db.query('insert into public.profiles(id,role,full_name) values($1,$2,$3)', [id, role, role]);
}
await db.query("update profiles set allowed_vehicle_types=array['motorcycle'] where id=$1", [motoSeller]);

async function asUser(id, fn, role = 'authenticated') {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
  try { return await fn(); } finally { await db.exec('reset role'); await db.exec("select set_config('request.jwt.claim.sub','',false)"); }
}
let n = 0;
const newCar = async (status = 'published', type = 'car') => (await db.query(
  `insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type,doors,seats)
   values($1,'BMW','320',2020,'Diesel','Manual',$4,$2,20000,$3,$5,$6) returning id`,
  [`car-${++n}`, status, type, type === 'car' ? 'Berlina' : 'Naked', type === 'car' ? 5 : 0, type === 'car' ? 5 : 2])).rows[0].id;
const newLead = async (car, extra = {}) => (await db.query(
  "insert into leads(car_id,name,email,phone,message,notes) values($1,'Maria Silva','maria@example.test','912345678','Olá','Cliente VIP') returning id",
  [car])).rows[0].id;
const one = async (sql, params) => (await db.query(sql, params)).rows[0];

// ---- OLX ------------------------------------------------------------------
await test('selling, reserving, releasing and expiring a car mark its OLX advert for syncing', async () => {
  const car = await newCar();
  await db.query("insert into channel_listings(car_id,channel,status,external_id,remote_status,sync_state) values($1,'olx','published','901','active','idle')", [car]);
  const state = async () => (await one("select sync_state, attempts from channel_listings where car_id=$1 and channel='olx'", [car]));
  const reset = () => db.query("update channel_listings set sync_state='idle', attempts=3 where car_id=$1", [car]);

  const lead = await newLead(car);
  await reset();
  const reservation = (await asUser(admin, () => one("select reserve_vehicle($1, now()+interval '1 day', 0) id", [lead]))).id;
  assert.deepEqual(await state(), { sync_state: 'pending', attempts: 0 }, 'reservada');

  await reset();
  await asUser(admin, () => db.query('select release_reservation($1)', [reservation]));
  assert.equal((await state()).sync_state, 'pending', 'reserva cancelada');

  await asUser(admin, () => db.query("select reserve_vehicle($1, now()+interval '1 day', 0)", [lead]));
  await db.query("update reservations set expires_at=now()-interval '1 minute' where lead_id=$1 and status='active'", [lead]);
  await reset();
  await asUser(null, () => db.query('select expire_reservations()'), 'service_role');
  assert.equal((await state()).sync_state, 'pending', 'reserva expirada');

  await reset();
  await asUser(admin, () => db.query("select close_vehicle_sale($1, 19000, (now() at time zone 'Europe/Lisbon')::date)", [lead]));
  assert.equal((await state()).sync_state, 'pending', 'vendida');

  // Gravar sem mudar o estado não mexe no anúncio (isso é com o queueOlxSync).
  await reset();
  await db.query('update cars set price=price where id=$1', [car]);
  assert.equal((await state()).sync_state, 'idle');
});

// ---- Apagar viaturas --------------------------------------------------------
await test('a car with reservations or a sale cannot be deleted, with a clear message; one without history can', async () => {
  const reserved = await newCar();
  const lead = await newLead(reserved);
  const r = (await asUser(admin, () => one("select reserve_vehicle($1, now()+interval '1 day', 0) id", [lead]))).id;
  await asUser(admin, () => db.query('select release_reservation($1)', [r]));
  await asUser(admin, () => assert.rejects(db.query('delete from cars where id=$1', [reserved]), /reservas ou venda registadas/));

  const sold = await newCar();
  const buyer = await newLead(sold);
  await asUser(admin, () => db.query("select close_vehicle_sale($1, 19000, (now() at time zone 'Europe/Lisbon')::date)", [buyer]));
  await asUser(admin, () => assert.rejects(db.query('delete from cars where id=$1', [sold]), /reservas ou venda registadas/));
  assert.equal(await asUser(admin, async () => (await one('select car_has_sales_history($1) h', [sold])).h), true);

  // Sem histórico: apaga, e os contactos ficam sem viatura (como antes).
  const plain = await newCar();
  const lost = await newLead(plain);
  await asUser(admin, () => db.query('delete from cars where id=$1', [plain]));
  assert.equal((await one('select car_id from leads where id=$1', [lost])).car_id, null);
});

// ---- RGPD -------------------------------------------------------------------
await test('erasing a lead without history deletes it and leaves no personal data in the audit log', async () => {
  const lead = await newLead(await newCar());
  await db.query("insert into lead_activities(lead_id,kind,body) values($1,'call','Ligou a Maria')", [lead]);
  await asUser(seller, () => assert.rejects(db.query('select erase_lead_personal_data($1)', [lead]), /Apenas administradores/));
  assert.equal(await asUser(admin, async () => (await one('select erase_lead_personal_data($1) r', [lead])).r), 'deleted');
  assert.equal((await db.query('select 1 from leads where id=$1', [lead])).rows.length, 0);
  const audit = (await db.query("select action, changed_fields::text f from audit_log where entity='leads' and record_id=$1", [lead])).rows;
  assert.ok(audit.some((a) => a.action === 'ERASE'), 'fica registado');
  assert.ok(audit.every((a) => !/Maria|maria@|912345678|VIP/.test(a.f)), 'sem dados pessoais no histórico');
});

await test('erasing a lead with a sale anonymises it and keeps the sale', async () => {
  const car = await newCar();
  const lead = await newLead(car);
  await db.query("insert into lead_activities(lead_id,kind,body) values($1,'call','Ligou a Maria')", [lead]);
  await asUser(admin, () => db.query("select close_vehicle_sale($1, 19000, (now() at time zone 'Europe/Lisbon')::date)", [lead]));
  // Antes não se apagava de todo: a venda aponta para o contacto.
  await asUser(admin, () => assert.rejects(db.query('delete from leads where id=$1', [lead])));
  assert.equal(await asUser(admin, async () => (await one('select erase_lead_personal_data($1) r', [lead])).r), 'anonymised');
  const row = await one('select name,email,phone,message,notes,status from leads where id=$1', [lead]);
  assert.deepEqual(row, { name: 'Dados apagados (RGPD)', email: '', phone: null, message: null, notes: null, status: 'won' });
  assert.equal((await one('select sale_lead_id from vehicle_financials where car_id=$1', [car])).sale_lead_id, lead);
  assert.doesNotMatch((await one('select body from lead_activities where lead_id=$1', [lead])).body, /Maria/);
  const audit = (await db.query("select changed_fields::text f from audit_log where entity='leads' and record_id=$1", [lead])).rows;
  assert.ok(audit.every((a) => !/Maria|maria@|912345678|VIP/.test(a.f)));
});

// ---- Tipo de viatura ----------------------------------------------------------
await test('a motorcycle-only seller cannot read car leads nor write cars through the API', async () => {
  const car = await newCar('draft');
  const moto = await newCar('draft', 'motorcycle');
  await newLead(car);
  const motoLead = await newLead(moto);
  await asUser(motoSeller, async () => {
    assert.equal((await db.query("select 1 from leads where vehicle_type='car'")).rows.length, 0);
    assert.ok((await db.query('select 1 from leads where id=$1', [motoLead])).rows.length === 1);
    assert.equal((await db.query('select 1 from cars where id=$1', [car])).rows.length, 0, 'rascunho de carro invisível');
    assert.equal((await db.query('update cars set price=1 where id=$1 returning id', [car])).rows.length, 0);
    await assert.rejects(db.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type)
      values('x-moto-seller','BMW','Y',2020,'Diesel','Manual','Berlina','draft',20000,'car')`), /row-level security/);
    assert.equal((await db.query('update cars set price=1 where id=$1 returning id', [moto])).rows.length, 1);
    // Não muda uma mota para carro.
    await assert.rejects(db.query("update cars set vehicle_type='car', body='Berlina', doors=5, seats=5 where id=$1", [moto]), /row-level security/);
  });
  // Sem restrição (nulo) e administrador: tudo, como antes.
  for (const id of [seller, admin]) await asUser(id, async () => {
    assert.ok((await db.query("select 1 from leads where vehicle_type='car'")).rows.length > 0);
    assert.equal((await db.query('update cars set price=2 where id=$1 returning id', [car])).rows.length, 1);
  });
  // O público continua a ver as viaturas publicadas, de qualquer tipo.
  const pub = await newCar('published');
  await asUser(motoSeller, async () => assert.equal((await db.query('select 1 from cars where id=$1', [pub])).rows.length, 1));
});

// ---- Data da venda ------------------------------------------------------------
await test('the sale date is checked against today in Lisbon, whatever the session time zone', async () => {
  // Numa destas duas zonas o dia é diferente do de Lisboa, seja qual for a hora
  // a que o teste corre: antes, «hoje em Lisboa» era recusado (ou «amanhã»
  // aceite) conforme a zona da sessão.
  try {
    for (const tz of ['Etc/GMT+12', 'Pacific/Kiritimati']) {
      await db.query(`set timezone='${tz}'`);
      const today = (await one("select (now() at time zone 'Europe/Lisbon')::date::text d")).d;
      const lead = await newLead(await newCar());
      await asUser(admin, () => assert.rejects(db.query("select close_vehicle_sale($1, 1000, $2::date + 1)", [lead, today]), /data inválida/));
      await asUser(admin, () => db.query('select close_vehicle_sale($1, 1000, $2::date)', [lead, today]));
    }
  } finally {
    await db.query("set timezone='UTC'");
  }
});

// ---- Visitas ------------------------------------------------------------------
await test('a full visit slot refuses another request from the site; the team can still book it', async () => {
  const car = await newCar();
  const at = new Date(Date.now() + 72 * 3600e3);
  at.setUTCMinutes(0, 0, 0);
  const visit = (status) => db.query(
    `insert into leads(kind,car_id,name,email,phone,visit_at,visit_status,preferred_date) values('visit',$1,'Cliente','','912000000',$2,$3,current_date)`,
    [car, at.toISOString(), status]);
  await asUser(null, () => visit('requested'), 'service_role');
  await asUser(null, () => assert.rejects(visit('requested'), /acabou de ficar ocupada/), 'service_role');
  // Outra hora continua livre.
  const later = new Date(at.getTime() + 30 * 60e3).toISOString();
  await asUser(null, () => db.query(
    `insert into leads(kind,car_id,name,email,phone,visit_at,visit_status) values('visit',$1,'Outro','','913000000',$2,'requested')`, [car, later]), 'service_role');
  // Lotação 2: o segundo pedido entra, o terceiro não.
  await db.query(`update customer_settings set visit_schedule = visit_schedule || '{"capacity":2}'::jsonb`);
  await asUser(null, () => visit('requested'), 'service_role');
  await asUser(null, () => assert.rejects(visit('requested'), /ocupada/), 'service_role');
  // A equipa marca por cima, de propósito (estado confirmada).
  await asUser(admin, () => visit('confirmed'));
  await db.query(`update customer_settings set visit_schedule = visit_schedule - 'capacity'`);
});

await test('two visit requests in parallel transactions: the second waits for the first and is refused', async () => {
  // O PGlite tem uma só ligação: simula-se a ordem que o bloqueio impõe — o
  // primeiro pedido grava dentro da transação e o segundo, depois do COMMIT,
  // já o conta. E confirma-se que o gatilho pede o bloqueio da vaga.
  const car = await newCar();
  const at = new Date(Date.now() + 96 * 3600e3);
  at.setUTCMinutes(30, 0, 0);
  const insert = () => db.query(
    `insert into leads(kind,car_id,name,email,phone,visit_at,visit_status) values('visit',$1,'Cliente','','912000000',$2,'requested')`,
    [car, at.toISOString()]);
  await db.exec('begin');
  await insert();
  const locks = (await db.query("select count(*)::int n from pg_locks where locktype='advisory' and granted")).rows[0].n;
  await db.exec('commit');
  assert.ok(locks >= 1, 'bloqueio da vaga pedido');
  await assert.rejects(insert(), /ocupada/);
});
