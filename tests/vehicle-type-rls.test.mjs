// O tipo de viatura nas tabelas que dependem de viaturas e contactos, no
// histórico de alterações e no Storage (migração 0050), e apagar linhas de
// site_content. Base de dados a sério (PGlite, todas as migrações).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { bootDatabase, addUser, asUserFactory } from './support/pglite.mjs';

const db = await bootDatabase();
const asUser = asUserFactory(db);

const admin = '00000000-0000-4000-8000-0000000005a1';
const motas = '00000000-0000-4000-8000-0000000005b1';
const carros = '00000000-0000-4000-8000-0000000005b2';
const todos = '00000000-0000-4000-8000-0000000005b3';
await addUser(db, admin, 'admin', 'Ana Admin');
await addUser(db, motas, 'vendedor', 'Vendedor Motas');
await addUser(db, carros, 'vendedor', 'Vendedor Carros');
await addUser(db, todos, 'vendedor', 'Vendedor Todos');
// Todos os separadores, para que a única diferença entre eles seja o tipo.
await db.query("update profiles set allowed_sections=array['dashboard','carros','leads','financeiro','oficina'] where id in ($1,$2,$3)", [motas, carros, todos]);
await db.query("update profiles set allowed_vehicle_types=array['motorcycle'] where id=$1", [motas]);
await db.query("update profiles set allowed_vehicle_types=array['car'] where id=$1", [carros]);

const one = async (sql, params) => (await db.query(sql, params)).rows[0];
let n = 0;
const newCar = async (type, status = 'draft') => (await one(
  `insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type,doors,seats)
   values($1,$2,'X',2020,'Gasolina','Manual',$3,$4,9000,$5,$6,$7) returning id`,
  [`rls-${++n}`, type === 'car' ? 'BMW' : 'Ducati', type === 'car' ? 'Berlina' : 'Naked', status, type,
    type === 'car' ? 5 : 0, type === 'car' ? 5 : 2])).id;
const newLead = async (car, name) => (await one(
  "insert into leads(car_id,name,email,phone) values($1,$2,$3,'912345678') returning id",
  [car, name, `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`])).id;

// Uma viatura de cada tipo em rascunho (o que não se vê pelo tipo) e uma de
// cada tipo publicada (o que é público).
const carDraft = await newCar('car');
const motoDraft = await newCar('motorcycle');
const carPub = await newCar('car', 'published');
const motoPub = await newCar('motorcycle', 'published');
const carLead = await newLead(carDraft, 'Bruno Teste');
const motoLead = await newLead(motoDraft, 'Ana Ducati');
const carPubLead = await newLead(carPub, 'Carla Carro');
const motoPubLead = await newLead(motoPub, 'Mário Mota');
const geral = await newLead(null, 'Contacto Geral');

const own = { car: [carDraft, carLead], motorcycle: [motoDraft, motoLead] };
for (const car of [carDraft, motoDraft]) {
  await db.query('insert into car_media(car_id,storage_path) values($1,$2)', [car, `${car}/foto.jpg`]);
  await db.query("insert into vehicle_costs(car_id,category,description,amount) values($1,'parts','Pneus',100)", [car]);
  await db.query('insert into vehicle_financials(car_id,purchase_price) values($1,5000)', [car]);
  await db.query("insert into preparation_tasks(car_id,title) values($1,'Lavar')", [car]);
  await db.query("insert into vehicle_tasks(car_id,start_time,end_time,description,created_by) values($1,'09:00','10:00','Revisão',$2)", [car, admin]);
  await db.query("insert into channel_listings(car_id,channel) values($1,'olx')", [car]);
  await db.query('insert into car_views(car_id) values($1)', [car]);
}
for (const car of [carPub, motoPub]) await db.query('insert into car_media(car_id,storage_path) values($1,$2)', [car, `${car}/capa.jpg`]);
for (const lead of [carLead, motoLead, geral])
  await db.query("insert into lead_activities(lead_id,kind,body,created_by) values($1,'note','Ligou',$2)", [lead, admin]);
for (const [car, lead] of [[carPub, carPubLead], [motoPub, motoPubLead]]) {
  await db.query("insert into reservations(car_id,lead_id,expires_at,status) values($1,$2,now()+interval '1 day','cancelled')", [car, lead]);
  await db.query('insert into stock_alert_matches(lead_id,car_id) values($1,$2)', [lead, car]);
}
await db.query(`insert into storage.objects(bucket_id,name) values
  ('car-media',$1),('car-media',$2),('car-media',$3),('car-media',$4),
  ('car-media','_originais/'||$1),('car-media','_originais/'||$2),('car-media','branding/logo.png'),('wa-media',$1)`,
[`${carDraft}/foto.jpg`, `${motoDraft}/foto.jpg`, `${carPub}/capa.jpg`, `${motoPub}/capa.jpg`]);

// As tabelas que dependem de uma viatura (`car_id`) ou de um contacto (`lead_id`).
const byCar = ['car_media', 'vehicle_costs', 'vehicle_financials', 'preparation_tasks', 'vehicle_tasks', 'channel_listings', 'car_views', 'vehicle_task_totals'];
const ids = async (sql, params) => (await db.query(sql, params)).rows.map((r) => Object.values(r)[0]);

// ---- (a) e (b) ler ---------------------------------------------------------

await test('0050: cada vendedor só lê fotos, custos, financeiro, preparação, horas, anúncios e visitas das viaturas do seu tipo', async () => {
  for (const [user, mine, other] of [[motas, motoDraft, carDraft], [carros, carDraft, motoDraft]])
    await asUser(user, async () => {
      for (const table of byCar) {
        const seen = await ids(`select car_id from ${table} where car_id in ($1,$2)`, [mine, other]);
        assert.deepEqual(seen, [mine], `${table} (${user === motas ? 'motas' : 'carros'})`);
      }
    });
  // Sem restrição de tipo e administrador: tudo, como antes.
  for (const user of [todos, admin]) await asUser(user, async () => {
    for (const table of byCar)
      assert.equal((await ids(`select car_id from ${table} where car_id in ($1,$2)`, [carDraft, motoDraft])).length, 2, table);
  });
});

await test('0050: atividades, reservas e alertas de stock só do tipo do contacto; contactos gerais para todos', async () => {
  await asUser(motas, async () => {
    assert.deepEqual((await ids('select lead_id from lead_activities where lead_id in ($1,$2,$3) order by lead_id', [carLead, motoLead, geral])).sort(), [motoLead, geral].sort());
    assert.deepEqual(await ids('select car_id from reservations where car_id in ($1,$2)', [carPub, motoPub]), [motoPub]);
    assert.deepEqual(await ids('select car_id from stock_alert_matches where car_id in ($1,$2)', [carPub, motoPub]), [motoPub]);
  });
  await asUser(carros, async () => {
    assert.deepEqual((await ids('select lead_id from lead_activities where lead_id in ($1,$2,$3)', [carLead, motoLead, geral])).sort(), [carLead, geral].sort());
    assert.deepEqual(await ids('select car_id from reservations where car_id in ($1,$2)', [carPub, motoPub]), [carPub]);
    assert.deepEqual(await ids('select car_id from stock_alert_matches where car_id in ($1,$2)', [carPub, motoPub]), [carPub]);
  });
  await asUser(admin, async () => {
    assert.equal((await ids('select lead_id from lead_activities where lead_id in ($1,$2,$3)', [carLead, motoLead, geral])).length, 3);
    assert.equal((await ids('select car_id from reservations where car_id in ($1,$2)', [carPub, motoPub])).length, 2);
  });
});

await test('0050: as fotos de viaturas no site continuam visíveis a toda a equipa e ao público', async () => {
  // Como a própria viatura publicada (0047): é o que o site mostra.
  for (const user of [motas, carros]) await asUser(user, async () =>
    assert.equal((await ids('select car_id from car_media where car_id in ($1,$2)', [carPub, motoPub])).length, 2));
  // (d) O anónimo lê as fotos das publicadas, nunca as dos rascunhos.
  await asUser(null, async () => {
    assert.deepEqual((await ids('select car_id from car_media where car_id in ($1,$2,$3,$4)', [carPub, motoPub, carDraft, motoDraft])).sort(), [carPub, motoPub].sort());
    assert.deepEqual((await ids("select name from storage.objects where bucket_id='car-media' order by name")).sort(),
      [`${carPub}/capa.jpg`, `${motoPub}/capa.jpg`].sort());
  }, 'anon');
});

// ---- (a) e (b) escrever ----------------------------------------------------

await test('0050: o vendedor só de motas não escreve nas tabelas dependentes de carros, e escreve nas de motas', async () => {
  await asUser(motas, async () => {
    const rls = /row-level security/;
    // Inserir: recusado num carro, aceite numa mota.
    const inserts = [
      ['insert into car_media(car_id,storage_path) values($1,$2)', (c) => [c, `${c}/nova.jpg`]],
      ["insert into vehicle_costs(car_id,category,description,amount) values($1,'other','Teste',1)", (c) => [c]],
      ["insert into preparation_tasks(car_id,title) values($1,'Polir')", (c) => [c]],
      ["insert into vehicle_tasks(car_id,start_time,description) values($1,'11:00','Óleo')", (c) => [c]],
      ["insert into channel_listings(car_id,channel) values($1,'standvirtual')", (c) => [c]],
    ];
    for (const [sql, params] of inserts) {
      await assert.rejects(db.query(sql, params(carDraft)), rls, sql);
      await db.query(sql, params(motoDraft));
    }
    await assert.rejects(db.query("insert into lead_activities(lead_id,kind,body,created_by) values($1,'note','x',$2)", [carLead, motas]), rls);
    await db.query("insert into lead_activities(lead_id,kind,body,created_by) values($1,'note','x',$2)", [motoLead, motas]);
    await db.query("insert into lead_activities(lead_id,kind,body,created_by) values($1,'note','x',$2)", [geral, motas]);

    // Alterar e apagar: nada num carro, tudo numa mota.
    for (const [sql, expected] of [
      ['update vehicle_financials set purchase_price=1 where car_id=$1 returning car_id', 1],
      ["update car_media set alt='x' where car_id=$1 returning car_id", 2],
      ["update stock_alert_matches set status='manual' where car_id=$1 returning car_id", 1],
      ['delete from preparation_tasks where car_id=$1 returning car_id', 2],
      ['delete from channel_listings where car_id=$1 returning car_id', 2],
    ]) {
      const carro = sql.includes('stock_alert') ? carPub : carDraft;
      const mota = sql.includes('stock_alert') ? motoPub : motoDraft;
      assert.equal((await db.query(sql, [carro])).rows.length, 0, `carro: ${sql}`);
      assert.equal((await db.query(sql, [mota])).rows.length, expected, `mota: ${sql}`);
    }
    // Uma linha de mota não passa para um carro.
    await assert.rejects(db.query('update vehicle_costs set car_id=$1 where car_id=$2', [carDraft, motoDraft]), rls);
  });
  // Os dados do carro ficaram intactos.
  assert.equal(Number((await one('select purchase_price from vehicle_financials where car_id=$1', [carDraft])).purchase_price), 5000);
  assert.equal((await one('select count(*)::int n from preparation_tasks where car_id=$1', [carDraft])).n, 1);
  assert.equal((await one('select status from stock_alert_matches where car_id=$1', [carPub])).status, 'pending');
});

await test('0050: o vendedor só de carros não escreve nas tabelas dependentes de motas', async () => {
  await asUser(carros, async () => {
    await assert.rejects(db.query("insert into vehicle_costs(car_id,category,description,amount) values($1,'other','Teste',1)", [motoDraft]), /row-level security/);
    assert.equal((await db.query('update vehicle_financials set purchase_price=2 where car_id=$1 returning car_id', [motoDraft])).rows.length, 0);
    assert.equal((await db.query('delete from vehicle_tasks where car_id=$1 returning car_id', [motoDraft])).rows.length, 0);
    assert.equal((await db.query('update vehicle_financials set purchase_price=2 where car_id=$1 returning car_id', [carDraft])).rows.length, 1);
  });
});

await test('0050: Storage — a pasta de uma viatura (e a cópia em _originais) segue o tipo; o logótipo fica como estava', async () => {
  const names = async (user) => asUser(user, async () => (await ids("select name from storage.objects where bucket_id='car-media'")).sort());
  assert.deepEqual(await names(motas), [`${carPub}/capa.jpg`, `${motoDraft}/foto.jpg`, `${motoPub}/capa.jpg`, `_originais/${motoDraft}/foto.jpg`, 'branding/logo.png'].sort());
  assert.deepEqual(await names(carros), [`${carDraft}/foto.jpg`, `${carPub}/capa.jpg`, `${motoPub}/capa.jpg`, `_originais/${carDraft}/foto.jpg`, 'branding/logo.png'].sort());
  assert.equal((await names(admin)).length, 7);
  assert.equal((await names(todos)).length, 7);

  await asUser(motas, async () => {
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('car-media',$1)", [`${carDraft}/intrusa.jpg`]), /row-level security/);
    await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('car-media',$1)", [`_originais/${carDraft}/intrusa.jpg`]), /row-level security/);
    await db.query("insert into storage.objects(bucket_id,name) values('car-media',$1)", [`${motoDraft}/nova.jpg`]);
    // Nem apagar nem mudar as fotos de um carro (nem as de um carro publicado).
    assert.equal((await db.query("delete from storage.objects where bucket_id='car-media' and name like $1 returning name", [`${carPub}/%`])).rows.length, 0);
    assert.equal((await db.query("update storage.objects set name=name where bucket_id='car-media' and name like $1 returning name", [`${carDraft}/%`])).rows.length, 0);
    assert.equal((await db.query("delete from storage.objects where bucket_id='car-media' and name=$1 returning name", [`${motoDraft}/nova.jpg`])).rows.length, 1);
  });
  assert.equal((await one("select count(*)::int n from storage.objects where name like $1", [`${carPub}/%`])).n, 1);
  // O service_role (servidor, WhatsApp) não passa pela RLS.
  await asUser(null, async () => assert.equal((await ids("select name from storage.objects where bucket_id='car-media'")).length, 7), 'service_role');
});

// ---- (c) Histórico de alterações -------------------------------------------

const auditLeads = (user) => asUser(user, async () => ids("select record_id from audit_log where entity='leads'"));

await test('0050: o histórico dos contactos e das viaturas só mostra o que o tipo deixa ver', async () => {
  const motasVe = await auditLeads(motas);
  assert.ok(!motasVe.includes(carLead), 'o contacto do carro (Bruno Teste) não aparece');
  assert.ok(motasVe.includes(motoLead) && motasVe.includes(geral), 'o da mota e o geral aparecem');
  // Nem pela ficha: nada do rascunho do carro nem dos seus custos/horas.
  await asUser(motas, async () => {
    assert.equal((await db.query('select 1 from audit_log where record_id=$1', [carDraft])).rows.length, 0);
    assert.ok((await db.query('select 1 from audit_log where record_id=$1', [motoDraft])).rows.length > 0);
    assert.equal((await db.query("select 1 from audit_log where entity='leads' and changed_fields::text like '%bruno%'")).rows.length, 0);
    // Também a reserva de um carro publicado (a reserva leva à viatura).
    const r = (await one('select id from reservations where car_id=$1', [carPub])) ?? { id: null };
    assert.equal(r.id, null, 'a reserva do carro nem se lê');
  });
  const resCarro = (await one('select id from reservations where car_id=$1', [carPub])).id;
  const resMota = (await one('select id from reservations where car_id=$1', [motoPub])).id;
  await asUser(motas, async () => {
    assert.deepEqual(await ids("select distinct record_id from audit_log where entity='reservations' and record_id in ($1,$2)", [resCarro, resMota]), [resMota]);
  });

  const carrosVe = await auditLeads(carros);
  assert.ok(carrosVe.includes(carLead) && carrosVe.includes(geral) && !carrosVe.includes(motoLead));
  const adminVe = await auditLeads(admin);
  for (const lead of [carLead, motoLead, geral]) assert.ok(adminVe.includes(lead));
  assert.deepEqual((await auditLeads(todos)).sort(), adminVe.sort(), 'sem restrição: o mesmo que antes');
});

await test('0050: o que a pessoa altera fica no histórico (o gatilho continua a gravar) e ela vê-o', async () => {
  await asUser(motas, () => db.query('update cars set price=7777 where id=$1', [motoDraft]));
  const row = await asUser(motas, () => one("select actor_id, changed_fields from audit_log where entity='cars' and record_id=$1 and action='UPDATE' order by id desc limit 1", [motoDraft]));
  assert.equal(row.actor_id, motas);
  assert.deepEqual(row.changed_fields.price, { before: 9000, after: 7777 });
});

await test('0050: registos apagados — o administrador vê tudo; os outros só os do seu tipo, pelo tipo gravado no histórico', async () => {
  const goneCar = await newCar('car');
  await asUser(admin, () => db.query('update cars set price=8000 where id=$1', [goneCar]));
  const goneLead = await newLead(goneCar, 'Lead Apagado');
  const goneMoto = await newCar('motorcycle');
  const goneMotoLead = await newLead(goneMoto, 'Mota Apagada');
  await asUser(admin, async () => {
    await db.query("insert into vehicle_costs(car_id,category,description,amount) values($1,'parts','Travões',50)", [goneCar]);
    for (const id of [goneLead, goneMotoLead]) await db.query('delete from leads where id=$1', [id]);
    for (const id of [goneCar, goneMoto]) await db.query('delete from cars where id=$1', [id]);
  });
  // Sem tipo conhecido no histórico (registo de antes de haver tipos).
  const semTipo = '00000000-0000-4000-8000-00000000dead';
  await db.query(`insert into audit_log(entity,record_id,action,changed_fields) values('cars',$1,'UPDATE','{"price":{"before":1,"after":2}}')`, [semTipo]);

  const seen = (user) => asUser(user, async () => new Set(await ids(
    'select distinct record_id from audit_log where record_id in ($1,$2,$3,$4,$5)', [goneCar, goneLead, goneMoto, goneMotoLead, semTipo])));
  const a = await seen(admin);
  assert.deepEqual([...a].sort(), [goneCar, goneLead, goneMoto, goneMotoLead, semTipo].sort(), 'o administrador vê tudo, apagado incluído');
  assert.deepEqual([...await seen(todos)].sort(), [...a].sort());
  assert.deepEqual([...await seen(motas)].sort(), [goneMoto, goneMotoLead].sort());
  assert.deepEqual([...await seen(carros)].sort(), [goneCar, goneLead].sort());
  // Os custos do carro apagado (record_id = viatura) e a alteração de preço,
  // que não tem o tipo na própria linha: decide a linha DELETE da viatura.
  await asUser(carros, async () => {
    assert.ok((await db.query("select 1 from audit_log where entity='vehicle_costs' and record_id=$1", [goneCar])).rows.length > 0);
    assert.ok((await db.query("select 1 from audit_log where entity='cars' and record_id=$1 and action='UPDATE'", [goneCar])).rows.length > 0);
  });
  await asUser(motas, async () =>
    assert.equal((await db.query("select 1 from audit_log where entity in ('vehicle_costs','cars') and record_id=$1", [goneCar])).rows.length, 0));
  // Ninguém escreve no histórico pela API.
  await asUser(admin, () => assert.rejects(db.query(`insert into audit_log(entity,record_id,action,changed_fields) values('cars','x','UPDATE','{}')`), /row-level security/));
});

await test('0050: RGPD — o contacto apagado pelo administrador continua no histórico só para quem vê o tipo', async () => {
  const lead = await newLead(motoDraft, 'Cliente RGPD');
  assert.equal(await asUser(admin, async () => (await one('select erase_lead_personal_data($1) r', [lead])).r), 'deleted');
  assert.ok((await auditLeads(motas)).includes(lead));
  assert.ok(!(await auditLeads(carros)).includes(lead));
  assert.ok((await auditLeads(admin)).includes(lead));
});

await test('0050: as RPCs SECURITY DEFINER continuam a gravar (reserva de uma mota pelo vendedor de motas)', async () => {
  const lead = await newLead(motoPub, 'Reserva Mota');
  const id = await asUser(motas, async () => (await one("select reserve_vehicle($1, now()+interval '1 day', 0) id", [lead])).id);
  await asUser(motas, async () => {
    assert.equal((await db.query('select 1 from reservations where id=$1', [id])).rows.length, 1);
    assert.ok((await db.query("select 1 from audit_log where entity='reservations' and record_id=$1", [id])).rows.length > 0);
  });
  await asUser(carros, async () => assert.equal((await db.query('select 1 from reservations where id=$1', [id])).rows.length, 0));
  await asUser(admin, () => db.query('select release_reservation($1)', [id]));
});

await test('0050: reservar, cancelar, confirmar o sinal e fechar a venda verificam o tipo da viatura na base de dados', async () => {
  const today = "(now() at time zone 'Europe/Lisbon')::date";
  // Um carro: o vendedor só de motas não reserva nem vende, mesmo chamando a função direto.
  const carro = await newCar('car', 'published');
  const carroLead = await newLead(carro, 'Comprador Carro');
  await asUser(motas, async () => {
    await assert.rejects(db.query("select reserve_vehicle($1, now()+interval '1 day', 0)", [carroLead]), /Sem permissão/);
    await assert.rejects(db.query(`select close_vehicle_sale($1, 9000, ${today})`, [carroLead]), /Sem permissão/);
  });
  assert.equal((await one('select status from cars where id=$1', [carro])).status, 'published');
  assert.equal((await one('select count(*)::int n from reservations where car_id=$1', [carro])).n, 0);
  // Uma reserva de carro feita por quem pode: o de motas não a cancela nem confirma o sinal.
  const reserva = await asUser(carros, async () => (await one("select reserve_vehicle($1, now()+interval '1 day', 100) id", [carroLead])).id);
  await asUser(motas, async () => {
    await assert.rejects(db.query('select release_reservation($1)', [reserva]), /Sem permissão/);
    await assert.rejects(db.query('select confirm_reservation_deposit($1)', [reserva]), /Sem permissão/);
  });
  assert.deepEqual(await one('select status, deposit_received from reservations where id=$1', [reserva]), { status: 'active', deposit_received: false });
  await asUser(carros, () => db.query('select confirm_reservation_deposit($1)', [reserva]));
  await asUser(admin, () => db.query('select release_reservation($1)', [reserva]));
  assert.equal((await one('select status from reservations where id=$1', [reserva])).status, 'cancelled');

  // Uma mota: o vendedor de motas reserva, confirma o sinal, cancela e vende.
  const mota = await newCar('motorcycle', 'published');
  const motaLead = await newLead(mota, 'Comprador Mota');
  await asUser(motas, async () => {
    const r = (await one("select reserve_vehicle($1, now()+interval '1 day', 100) id", [motaLead])).id;
    await db.query('select confirm_reservation_deposit($1)', [r]);
    await db.query('select release_reservation($1)', [r]);
    await db.query(`select close_vehicle_sale($1, 8500, ${today})`, [motaLead]);
  });
  assert.equal((await one('select status from cars where id=$1', [mota])).status, 'sold');
  assert.equal((await one('select status from leads where id=$1', [motaLead])).status, 'won');
  // O administrador vende um carro; sem sessão continua recusado como antes.
  await asUser(admin, () => db.query(`select close_vehicle_sale($1, 9000, ${today})`, [carroLead]));
  assert.equal((await one('select status from cars where id=$1', [carro])).status, 'sold');
  const outro = await newLead(await newCar('motorcycle', 'published'), 'Sem Sessão');
  await asUser(null, () => assert.rejects(db.query("select reserve_vehicle($1, now()+interval '1 day', 0)", [outro]), /É necessário acesso/));
  for (const role of ['service_role', 'anon'])
    await asUser(null, () => assert.rejects(db.query("select reserve_vehicle($1, now()+interval '1 day', 0)", [outro]), /permission denied/), role);
});

// ---- (e) site_content -------------------------------------------------------

await test('0050: apagar uma linha de site_content funciona; o ponto de venda em uso continua protegido', async () => {
  await db.query(`insert into site_content(key,content) values('teste-apagar','{}') on conflict (key) do nothing`);
  assert.equal((await db.query("delete from site_content where key='teste-apagar' returning key")).rows.length, 1, 'postgres');
  await db.query(`insert into site_content(key,content) values('teste-apagar','{}')`);
  assert.equal((await asUser(null, () => db.query("delete from site_content where key='teste-apagar' returning key"), 'service_role')).rows.length, 1, 'service_role');
  // Quem tem «Página inicial» apaga os textos, pela API.
  await db.query(`insert into site_content(key,content) values('teste-apagar','{}')`);
  assert.equal((await asUser(admin, () => db.query("delete from site_content where key='teste-apagar' returning key"))).rows.length, 1, 'administrador');
  // O resto do gatilho: atualizar continua a funcionar e o showroom com uma
  // viatura associada a um ponto de venda não se apaga.
  await db.query(`update site_content set content='{"locations":[{"id":"lx"}]}' where key='showroom'`);
  await db.query("update cars set point_of_sale_id='lx' where id=$1", [carPub]);
  await assert.rejects(db.query("delete from site_content where key='showroom'"), /Reatribua/);
  await db.query('update cars set point_of_sale_id=null where id=$1', [carPub]);
});

await test('0050: a migração pode correr outra vez', async () => {
  await db.exec(await readFile('supabase/migrations/0050_vehicle_type_rls.sql', 'utf8'));
  assert.equal((await auditLeads(motas)).includes(carLead), false);
});
