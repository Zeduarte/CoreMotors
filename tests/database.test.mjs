import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const db = new PGlite();
await db.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key, email text,raw_user_meta_data jsonb default '{}');
 -- Lê os DOIS nomes, como o auth.uid() da Supabase: a 0024 define ambos porque
 -- não se sabe qual deles a versão instalada consulta. Um duplo que só lesse um
 -- validaria metade do mecanismo e deixaria passar a outra metade.
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
for(const file of (await readdir('supabase/migrations')).sort()) {
 // gen_random_uuid is built into this PostgreSQL; pgcrypto itself is not needed.
 const sql=(await readFile(`supabase/migrations/${file}`,'utf8')).replace('create extension if not exists "pgcrypto";','');
 await db.exec(sql);
}
const admin='00000000-0000-4000-8000-000000000001';
const seller='00000000-0000-4000-8000-000000000002';
const mechanic='00000000-0000-4000-8000-000000000003';
const limited='00000000-0000-4000-8000-000000000004';
for(const [id,role]of[[admin,'admin'],[seller,'vendedor'],[mechanic,'mecanico'],[limited,'vendedor']]) {
 await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${role}-${id}@example.test`]);
 await db.query('insert into public.profiles(id,role) values($1,$2)',[id,role]);
}
await db.query("update public.profiles set allowed_sections=array['dashboard'] where id=$1",[limited]);
const car=(await db.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price) values('test-car','BMW','320',2020,'Diesel','Manual','Berlina','published',25000) returning id`)).rows[0].id;
const car2=(await db.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price) values('test-car-2','BMW','330',2021,'Diesel','Manual','Berlina','published',35000) returning id`)).rows[0].id;
const lead=(await db.query("insert into leads(car_id,name,email) values($1,'Cliente','client@example.test') returning id",[car])).rows[0].id;
const lead2=(await db.query("insert into leads(car_id,name,email) values($1,'Cliente 2','client2@example.test') returning id",[car])).rows[0].id;
async function asUser(id,fn,role='authenticated') {
 await db.exec(`set role ${role}`);await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id??'']);
 try{return await fn();}finally{await db.exec('reset role');await db.exec("select set_config('request.jwt.claim.sub','',false)");}
}
await test('anonymous registrations cannot create staff or trust role metadata',async()=>{
 const id='00000000-0000-4000-8000-000000000099';
 await db.query(`insert into auth.users(id,raw_user_meta_data) values($1,'{"role":"admin"}')`,[id]);
 assert.equal((await db.query('select * from profiles where id=$1',[id])).rows.length,0);
});
await test('seller cannot promote self, but can edit own name',async()=>asUser(seller,async()=>{
 await assert.rejects(db.query("update profiles set role='admin' where id=$1",[seller]),/permission denied/);
 await db.query("update profiles set full_name='Vendedor' where id=$1",[seller]);
 await assert.rejects(db.query("update profiles set allowed_sections=array['financeiro'] where id=$1",[seller]),/permission denied/);
}));
await test('no staff member can make themselves the account owner',async()=>{
 for(const id of [seller,admin])await asUser(id,async()=>{
  await assert.rejects(db.query("update profiles set is_owner=true where id=$1",[id]),/permission denied/);
 });
 await db.query("update profiles set is_owner=true where id=$1",[admin]);
 await assert.rejects(db.query("update profiles set is_owner=true where id=$1",[seller]),/duplicate key|unique/);
 await db.query("update profiles set is_owner=false where id=$1",[admin]);
});
await test('mechanic and limited seller cannot read leads or modify cars through SQL/API',async()=>{
 for(const id of [mechanic,limited])await asUser(id,async()=>{
  assert.equal((await db.query('select * from leads')).rows.length,0);
  assert.equal((await db.query('update cars set price=1 where id=$1 returning id',[car])).rows.length,0);
  await assert.rejects(db.query("insert into leads(name,email) values('bad','bad@example.test')"),/row-level security/);
 });
});
await test('public submissions cannot bypass server validation via direct API',async()=>asUser(null,async()=>{
 await assert.rejects(db.query("insert into leads(name,email) values('spam','spam@example.test')"),/row-level security/);
 await assert.rejects(db.query('insert into car_views(car_id) values($1)',[car]),/row-level security/);
 await assert.rejects(db.query("insert into testimonials(name,body,published) values('spam','spam',false)"),/row-level security/);
 await assert.rejects(db.query("select consume_submission('x',10,600)"),/permission denied/);
},'anon'));
await test('financial data cannot be read by public, seller or mechanic',async()=>{
 await db.query('insert into vehicle_financials(car_id,purchase_price) values($1,17000)',[car]);
 for(const[id,role]of[[null,'anon'],[seller,'authenticated'],[mechanic,'authenticated']])await asUser(id,async()=>assert.equal((await db.query('select * from vehicle_financials')).rows.length,0),role);
});
await test('workshop intake has unknown specs and cannot be published prematurely',async()=>{
 const id=await asUser(mechanic,async()=>(await db.query("select create_workshop_intake('BMW por identificar','AA-00-AA') id")).rows[0].id);
 const row=(await db.query('select * from cars where id=$1',[id])).rows[0];
 assert.equal(row.fuel,null);assert.equal(row.transmission,null);assert.equal(row.year,null);assert.equal(row.status,'workshop');
 await asUser(admin,async()=>assert.rejects(db.query("update cars set status='published' where id=$1",[id]),/complete_public_car/));
});
await test('workshop vehicle becomes prepared, can go back, and only the right people move it',async()=>{
 const id=await asUser(mechanic,async()=>(await db.query("select create_workshop_intake_for_type('Yamaha R6','AA-11-BB','motorcycle') id")).rows[0].id);
 const status=async()=>(await db.query('select status from cars where id=$1',[id])).rows[0].status;
 assert.equal(await status(),'workshop');
 // Sem o separador Oficina não se dá como preparada.
 await asUser(seller,async()=>assert.rejects(db.query('select mark_vehicle_prepared($1)',[id]),/Sem permissão/));
 await asUser(limited,async()=>assert.rejects(db.query('select return_vehicle_to_workshop($1)',[id]),/Sem permissão/));
 // O mecânico não escreve na tabela cars diretamente — só pela função.
 await asUser(mechanic,async()=>assert.equal((await db.query("update cars set status='prepared' where id=$1 returning id",[id])).rows.length,0));
 await asUser(mechanic,()=>db.query('select mark_vehicle_prepared($1)',[id]));
 assert.equal(await status(),'prepared');
 // Preparada com a ficha incompleta é permitido; publicar continua a exigir os dados.
 await asUser(admin,async()=>assert.rejects(db.query("update cars set status='published' where id=$1",[id]),/complete_public_car/));
 await asUser(mechanic,async()=>assert.rejects(db.query('select mark_vehicle_prepared($1)',[id]),/não está na oficina/));
 await asUser(seller,()=>db.query('select return_vehicle_to_workshop($1)',[id]));
 assert.equal(await status(),'workshop');
 await asUser(admin,async()=>assert.rejects(db.query('select return_vehicle_to_workshop($1)',[car]),/preparada ou em rascunho/));
 await db.query('delete from cars where id=$1',[id]);
});
await test('personal hours: each person sees and edits only their own, admin sees all, totals are computed',async()=>{
 const mine=await asUser(seller,async()=>(await db.query("insert into time_entries(work_date,start_time,end_time,hours,description) values(current_date,'09:00','10:30',99,'Atendimento') returning id,hours,profile_id")).rows[0]);
 assert.equal(Number(mine.hours),1.5);assert.equal(mine.profile_id,seller);
 // Ninguém regista em nome de outro.
 await asUser(seller,async()=>assert.rejects(db.query("insert into time_entries(profile_id,start_time,description) values($1,'09:00','x')",[mechanic]),/row-level security/));
 // Outro utilizador não vê nem apaga.
 await asUser(mechanic,async()=>{
  assert.equal((await db.query('select * from time_entries where id=$1',[mine.id])).rows.length,0);
  assert.equal((await db.query('delete from time_entries where id=$1 returning id',[mine.id])).rows.length,0);
 });
 await asUser(null,async()=>assert.rejects(db.query('select * from time_entries'),/permission denied/),'anon');
 // O administrador vê e corrige.
 await asUser(admin,async()=>{
  assert.equal((await db.query('select * from time_entries where id=$1',[mine.id])).rows.length,1);
  assert.equal(Number((await db.query("update time_entries set end_time='11:00' where id=$1 returning hours",[mine.id])).rows[0].hours),2);
 });
 await asUser(seller,async()=>assert.equal((await db.query('delete from time_entries where id=$1 returning id',[mine.id])).rows.length,1));
});
await test('new segments Utilitário and Moto 4 are accepted by the database, each in its own world',async()=>{
 for(const [slug,body,type,doors] of [['megane-util','Utilitário','car',5],['ltr-quad','Moto 4','motorcycle',0]]){
  const r=await db.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type,doors) values($1,'X','Y',2016,'Diesel','Manual',$2,'draft',1000,$3,$4) returning body`,[slug,body,type,doors]);
  assert.equal(r.rows[0].body,body);
  await db.query('delete from cars where slug=$1',[slug]);
 }
 // Uma moto 4 não pode ser um carro, nem um utilitário uma mota.
 await assert.rejects(db.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type,doors) values('x1','X','Y',2016,'Diesel','Manual','Moto 4','draft',1000,'car',5)`),/cars_vehicle_category_check/);
 await assert.rejects(db.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type,doors) values('x2','X','Y',2016,'Diesel','Manual','Utilitário','draft',1000,'motorcycle',0)`),/cars_vehicle_category_check/);
});
await test('workshop hours are recalculated even when API submits forged totals',async()=>asUser(mechanic,async()=>{
 const row=(await db.query("insert into vehicle_tasks(car_id,work_date,start_time,end_time,hours) values($1,current_date,'22:00','01:30',999) returning *",[car])).rows[0];
 assert.equal(Number(row.hours),3.5);
 const open=(await db.query("insert into vehicle_tasks(car_id,start_time) values($1,'10:00') returning id",[car])).rows[0].id;
 const done=(await db.query("update vehicle_tasks set end_time='11:30' where id=$1 returning hours",[open])).rows[0];
 assert.equal(Number(done.hours),1.5);
}));
await test('reservation blocks duplicate reservation, unrelated sale and direct status edits',async()=>asUser(admin,async()=>{
 await db.query("select reserve_vehicle($1,now()+interval '1 day',500)",[lead]);
 await assert.rejects(db.query("select reserve_vehicle($1,now()+interval '1 day',500)",[lead2]),/disponível/);
 await assert.rejects(db.query("select close_vehicle_sale($1,25000,current_date)",[lead2]),/outro contacto/);
 await assert.rejects(db.query("update cars set status='published' where id=$1",[car]),/Termine a reserva/);
 assert.equal((await db.query('select status from cars where id=$1',[car])).rows[0].status,'reserved');
}));
await test('closing a sale atomically links contact, vehicle, price and reservation',async()=>asUser(admin,async()=>{
 await db.query("select close_vehicle_sale($1,24500,current_date-1)",[lead]);
 assert.equal((await db.query('select status from leads where id=$1',[lead])).rows[0].status,'won');
 assert.equal((await db.query('select status from cars where id=$1',[car])).rows[0].status,'sold');
 assert.equal((await db.query('select sale_price from vehicle_financials where car_id=$1',[car])).rows[0].sale_price,'24500.00');
 assert.equal((await db.query("select status from reservations where lead_id=$1",[lead])).rows[0].status,'completed');
 assert.equal((await db.query('select sold_at::date=current_date-1 correct from cars where id=$1',[car])).rows[0].correct,true);
}));
await test('loss reason is mandatory and audit cannot be rewritten',async()=>asUser(seller,async()=>{
 await assert.rejects(db.query("update leads set status='lost' where id=$1",[lead2]),/motivo de perda/);
 await db.query("update leads set status='lost',loss_reason='Comprou outra viatura' where id=$1",[lead2]);
 assert.equal((await db.query('delete from audit_log returning id')).rows.length,0);
 assert.ok((await db.query("select * from audit_log where entity='leads'")).rows.length>0);
}));
await test('server-side submission quotas persist and reject excess attempts',async()=>asUser(null,async()=>{
 assert.equal((await db.query("select consume_submission('test',2,600) ok")).rows[0].ok,true);
 assert.equal((await db.query("select consume_submission('test',2,600) ok")).rows[0].ok,true);
 assert.equal((await db.query("select consume_submission('test',2,600) ok")).rows[0].ok,false);
},'service_role'));
await test('analytics aggregates more than 1000 views correctly',async()=>{
 await db.query('insert into car_views(car_id) select $1 from generate_series(1,1501)',[car2]);
 await asUser(admin,async()=>assert.equal((await db.query('select analytics_summary() s')).rows[0].s.views,1501));
});
await test('notification jobs are queued transactionally and claimed only once per lease',async()=>asUser(null,async()=>{
 const first=(await db.query('select * from claim_notification_jobs()')).rows;
 assert.ok(first.length>=2);assert.equal(first[0].attempts,1);
 assert.equal((await db.query('select * from claim_notification_jobs()')).rows.length,0);
},'service_role'));
await test('cancelled and expired reservations release availability',async()=>{
 const newLead=(await db.query("insert into leads(car_id,name,email) values($1,'Reserva','reserve@example.test') returning id",[car2])).rows[0].id;
 const reservation=await asUser(admin,async()=>(await db.query("select reserve_vehicle($1,now()+interval '1 day',0) id",[newLead])).rows[0].id);
 await asUser(admin,async()=>db.query('select release_reservation($1)',[reservation]));
 assert.equal((await db.query('select status from cars where id=$1',[car2])).rows[0].status,'published');
 const second=await asUser(admin,async()=>(await db.query("select reserve_vehicle($1,now()+interval '1 day',0) id",[newLead])).rows[0].id);
 await db.query("update reservations set expires_at=now()-interval '1 minute' where id=$1",[second]);
 await asUser(null,async()=>assert.equal((await db.query('select expire_reservations() n')).rows[0].n,1),'service_role');
 assert.equal((await db.query('select status from cars where id=$1',[car2])).rows[0].status,'published');
});
await test('sale cannot be attributed to a different contact through a direct update',async()=>asUser(seller,async()=>{
 await assert.rejects(db.query("update leads set status='won' where id=$1",[lead2]),/Conclua a venda/);
}));
await test("showroom locations cannot leave dangling vehicle references", async () => {
  await db.exec(
    `update site_content set content='{"locations":[{"id":"porto"}]}' where key='showroom'`,
  );
  await db.query(
    "update cars set point_of_sale_id='porto',registration_month=2 where id=$1",
    [car2],
  );
  await assert.rejects(
    db.query("update cars set point_of_sale_id='missing' where id=$1", [car2]),
    /inexistente/,
  );
  await assert.rejects(
    db.exec("update site_content set content='{}' where key='showroom'"),
    /Reatribua/,
  );
  await assert.rejects(
    db.exec("delete from site_content where key='showroom'"),
    /Reatribua/,
  );
  await assert.rejects(
    db.query("update cars set registration_month=13 where id=$1", [car2]),
    /check/,
  );
  await assert.rejects(
    db.query("update cars set vehicle_type='motorcycle' where id=$1", [car2]),
    /check/,
  );
  await db.query(
    "update cars set vehicle_type='motorcycle',body='Scooter',doors=0 where id=$1",
    [car2],
  );
  await db.query("update cars set point_of_sale_id=null where id=$1", [car2]);
  await db.exec("update site_content set content='{}' where key='showroom'");
});
await test('vehicle worlds retain lead classification and separate reporting',async()=>{
 const bike=(await db.query("insert into cars(slug,make,model,vehicle_type,body,doors,status,price_on_request) values('world-bike','Honda','PCX','motorcycle','Scooter',0,'draft',true) returning id")).rows[0].id;
 const enquiry=(await db.query("insert into leads(car_id,vehicle_type,name,email) values($1,'car','Moto','moto@example.test') returning id,vehicle_type",[bike])).rows[0];
 assert.equal(enquiry.vehicle_type,'motorcycle');
 const general=(await db.query("insert into leads(name,email) values('Legacy','legacy@example.test') returning vehicle_type")).rows[0];
 assert.equal(general.vehicle_type,null);
 const cars=await asUser(admin,async()=>(await db.query("select analytics_summary_by_type('car') summary")).rows[0].summary);
 const bikes=await asUser(admin,async()=>(await db.query("select analytics_summary_by_type('motorcycle') summary")).rows[0].summary);
 assert.ok(!cars.by_car.some(c=>c.id===bike));assert.ok(bikes.by_car.some(c=>c.id===bike));
 const actualBikeLeads=(await db.query("select count(*)::int n from leads where vehicle_type='motorcycle'")).rows[0].n;
 assert.equal(bikes.leads,actualBikeLeads);
 await db.query("update cars set vehicle_type='car',body='Berlina',doors=4 where id=$1",[bike]);
 assert.equal((await db.query('select vehicle_type from leads where id=$1',[enquiry.id])).rows[0].vehicle_type,'car');
 await db.query('update leads set car_id=$1 where id=$2',[car2,enquiry.id]);
 assert.equal((await db.query('select vehicle_type from leads where id=$1',[enquiry.id])).rows[0].vehicle_type,'motorcycle');
});
await test('workshop creates the selected category and keeps existing permission checks',async()=>{
 const id=await asUser(mechanic,async()=>(await db.query("select create_workshop_intake_for_type('Honda por identificar','AA-11-AA','motorcycle') id")).rows[0].id);
 const row=(await db.query('select vehicle_type,doors,status from cars where id=$1',[id])).rows[0];
 assert.deepEqual(row,{vehicle_type:'motorcycle',doors:0,status:'workshop'});
 await asUser(mechanic,async()=>assert.rejects(db.query("select create_workshop_intake_for_type('Invalid','AA-11-AA','truck')"),/Tipo inválido/));
 await asUser(limited,async()=>assert.rejects(db.query("select create_workshop_intake_for_type('Honda','AA-11-AA','motorcycle')"),/Sem permissão/));
 await asUser(null,async()=>assert.rejects(db.query("select create_workshop_intake_for_type('Honda','AA-11-AA','motorcycle')"),/permission denied/),'anon');
});

// ---------------------------------------------------------------------------
// 0024 — ordens vindas do WhatsApp. A chave de serviço ignora a RLS, por isso a
// autorização destas RPCs é a única barreira: é ela que estes testes vigiam.
// ---------------------------------------------------------------------------

/** Corre como o servidor (service_role), que é quem chama estas RPCs. */
async function asServer(fn) {
 await db.exec('set role service_role');
 try { return await fn(); } finally { await db.exec('reset role'); }
}

await test('wa_begin_as authorizes by explicit id and really assumes the identity',async()=>{
 // Não basta não estourar: verifica-se que o auth.uid() passou a ser o mecânico
 // dentro da mesma transacção — é disso que depende o autor da auditoria.
 await asServer(async()=>{
  const {rows}=await db.query(`do $$ begin
    perform public.wa_begin_as('${mechanic}', array['oficina']);
    if auth.uid() <> '${mechanic}'::uuid then raise exception 'não impersonou'; end if;
  end $$`).then(()=>({rows:[]}));
  assert.deepEqual(rows,[]);
 });
});

await test('wa_begin_as refuses the wrong section, an unknown profile and a null actor',async()=>{
 await asServer(async()=>{
  await assert.rejects(db.query("select public.wa_begin_as($1,array['financeiro'])",[mechanic]),/Sem permissão/);
  await assert.rejects(db.query("select public.wa_begin_as('00000000-0000-4000-8000-0000000000ff',array['oficina'])"),/Colaborador desconhecido/);
  await assert.rejects(db.query("select public.wa_begin_as(null,array['oficina'])"),/Ator em falta/);
  // O vendedor limitado só tem o dashboard.
  await assert.rejects(db.query("select public.wa_begin_as($1,array['financeiro'])",[limited]),/Sem permissão/);
 });
});

await test('the WhatsApp write RPCs are closed to logged-in users',async()=>{
 // Se estas chegassem ao `authenticated`, qualquer utilizador podia passar o id
 // de outra pessoa e escrever em nome dela.
 for(const call of [
  `public.wa_begin_as('${mechanic}',array['oficina'])`,
  `public.wa_add_cost('${mechanic}','${car}','parts','x',1,current_date)`,
  `public.wa_log_hours('${mechanic}','${car}',current_date,'09:00','10:00',null)`,
  `public.wa_create_workshop_vehicle('${mechanic}','Honda','AA-11-AA','car')`,
 ]) await asUser(mechanic,async()=>assert.rejects(db.query(`select ${call}`),/permission denied/,call));
});

await test('a cost written from WhatsApp is attributed to the person who ordered it',async()=>{
 const id=await asServer(async()=>(await db.query(
  "select public.wa_add_cost($1,$2,'parts','Embraiagem nova',450.50,current_date) id",
  [mechanic,car])).rows[0].id);
 const cost=(await db.query('select created_by,amount,description from vehicle_costs where id=$1',[id])).rows[0];
 assert.equal(cost.created_by,mechanic,'created_by é o colaborador');
 assert.equal(Number(cost.amount),450.5,'os cêntimos não se perdem');
 // A razão de existir de toda a impersonação: o histórico mostra quem deu a ordem.
 const audit=(await db.query(
  "select actor_id from audit_log where entity='vehicle_costs' and record_id=$1 order by created_at desc limit 1",
  [car])).rows[0];
 assert.equal(audit.actor_id,mechanic,'a auditoria tem autor, e é o certo');
});

await test('cost categories follow the same rule as the backoffice',async()=>{
 await asServer(async()=>{
  // Mão de obra sai das horas: é dinheiro de gestão e exige Financeiro.
  await assert.rejects(db.query("select public.wa_add_cost($1,$2,'labour','x',10,current_date)",[mechanic,car]),/Sem permissão/);
  await assert.rejects(db.query("select public.wa_add_cost($1,$2,'transport','x',10,current_date)",[mechanic,car]),/Sem permissão/);
  // Material, sim.
  assert.ok((await db.query("select public.wa_add_cost($1,$2,'other','Consumíveis',10,current_date) id",[mechanic,car])).rows[0].id);
  // E o administrador pode tudo.
  assert.ok((await db.query("select public.wa_add_cost($1,$2,'labour','Mão de obra',10,current_date) id",[admin,car])).rows[0].id);
  // Valores e datas impossíveis não passam.
  await assert.rejects(db.query("select public.wa_add_cost($1,$2,'parts','x',0,current_date)",[admin,car]),/Valor inválido/);
  await assert.rejects(db.query("select public.wa_add_cost($1,$2,'parts','',10,current_date)",[admin,car]),/Descrição inválida/);
  await assert.rejects(db.query("select public.wa_add_cost($1,$2,'parts','x',10,current_date+1)",[admin,car]),/Data inválida/);
  await assert.rejects(db.query("select public.wa_add_cost($1,$2,'seguro','x',10,current_date)",[admin,car]),/Categoria inválida/);
 });
});

await test('hours from WhatsApp are attributed and recomputed by the trigger',async()=>{
 const id=await asServer(async()=>(await db.query(
  "select public.wa_log_hours($1,$2,current_date,'09:00','17:30','Travões') id",[mechanic,car])).rows[0].id);
 const row=(await db.query('select created_by,hours from vehicle_tasks where id=$1',[id])).rows[0];
 assert.equal(row.created_by,mechanic);
 assert.equal(Number(row.hours),8.5,'as horas vêm do gatilho, não de nós');
 await asServer(async()=>{
  await assert.rejects(db.query("select public.wa_log_hours($1,$2,current_date,'10:53','10:53',null)",[mechanic,car]),/Fim igual ao início/);
  await assert.rejects(db.query("select public.wa_log_hours($1,$2,current_date+1,'09:00','10:00',null)",[mechanic,car]),/Data inválida/);
 });
});

await test('impersonation does not leak out of the transaction',async()=>{
 await asServer(async()=>{
  await db.query("select public.wa_add_cost($1,$2,'parts','Filtros',20,current_date)",[mechanic,car]);
  // Instrução nova, transacção nova: a identidade assumida não sobreviveu.
  assert.equal((await db.query('select auth.uid() who')).rows[0].who,null);
 });
});

await test('a phone identifies exactly one person, or nobody',async()=>{
 await db.query("update profiles set phone='916193337' where id=$1",[mechanic]);
 await asServer(async()=>{
  // Com ou sem indicativo, com ou sem espaços: é a mesma pessoa.
  for(const p of ['916193337','351916193337','+351 916 193 337','916 193 337'])
   assert.equal((await db.query('select public.wa_actor_for_phone($1) id',[p])).rows[0].id,mechanic,p);
  assert.equal((await db.query("select public.wa_actor_for_phone('351999999999') id")).rows[0].id,null,'desconhecido');
  assert.equal((await db.query("select public.wa_actor_for_phone('') id")).rows[0].id,null);
  assert.equal((await db.query('select public.wa_actor_for_phone(null) id')).rows[0].id,null);
 });
 // Dois perfis com o mesmo número: falha fechada, para não atribuir a ordem à
 // pessoa errada.
 await db.query("update profiles set phone='+351 916 193 337' where id=$1",[seller]);
 await asServer(async()=>assert.equal(
  (await db.query("select public.wa_actor_for_phone('916193337') id")).rows[0].id,null,'ambíguo'));
 await db.query('update profiles set phone=null where id=$1',[seller]);
});

await test('the vehicle list a person sees respects their sections and vehicle types',async()=>{
 const bike=(await db.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type,doors,seats)
   values('wa-bike','Honda','CB500',2022,'Gasolina','Manual','Naked','published',6000,'motorcycle',0,2) returning id`)).rows[0].id;
 await asServer(async()=>{
  // O mecânico tem Oficina e nenhum limite de tipo: vê as duas.
  const todas=(await db.query('select id from public.wa_vehicles_for_actor($1)',[mechanic])).rows.map(r=>r.id);
  assert.ok(todas.includes(car)&&todas.includes(bike));
  // Limitado a motas: o carro desaparece — nem sabe que existe.
  await db.query("update profiles set allowed_vehicle_types=array['motorcycle'] where id=$1",[mechanic]);
  const so=(await db.query('select id from public.wa_vehicles_for_actor($1)',[mechanic])).rows.map(r=>r.id);
  assert.ok(so.includes(bike)&&!so.includes(car),'só motas');
  // E não consegue escrever no que não vê.
  await assert.rejects(db.query("select public.wa_add_cost($1,$2,'parts','x',10,current_date)",[mechanic,car]),
   /Sem acesso a este tipo de viatura/);
  // O resumo também é filtrado.
  assert.equal((await db.query('select public.wa_vehicle_summary($1,$2) s',[mechanic,car])).rows[0].s,null);
  assert.ok((await db.query('select public.wa_vehicle_summary($1,$2) s',[mechanic,bike])).rows[0].s);
  await db.query('update profiles set allowed_vehicle_types=null where id=$1',[mechanic]);
  // Quem só tem o dashboard não vê viatura nenhuma.
  assert.equal((await db.query('select count(*)::int n from public.wa_vehicles_for_actor($1)',[limited])).rows[0].n,0);
 });
});

await test('the WhatsApp state tables are unreachable from a logged-in session',async()=>{
 for(const t of ['wa_messages','wa_pending_actions'])
  await asUser(admin,async()=>assert.rejects(db.query(`select * from public.${t}`),/permission denied/,t));
 // E o servidor guarda uma proposta por número: a nova substitui a anterior.
 await asServer(async()=>{
  await db.query(`insert into wa_pending_actions(actor_id,from_phone,kind,payload,summary)
   values($1,'351916193337','add_cost','{}','primeira')`,[mechanic]);
  await assert.rejects(db.query(`insert into wa_pending_actions(actor_id,from_phone,kind,payload,summary)
   values($1,'351916193337','add_cost','{}','segunda')`,[mechanic]),/duplicate key|unique/i);
  await db.query("update wa_pending_actions set status='superseded' where from_phone='351916193337'");
  assert.ok((await db.query(`insert into wa_pending_actions(actor_id,from_phone,kind,payload,summary)
   values($1,'351916193337','add_cost','{}','segunda') returning id`,[mechanic])).rows[0].id);
 });
});

await test('the WhatsApp number token is unreachable from any logged-in session',async()=>{
 // O token envia mensagens em nome da empresa: nem um administrador o lê pela API.
 await asUser(admin,async()=>assert.rejects(db.query('select * from public.whatsapp_connection'),/permission denied/));
 await asServer(async()=>{
  await db.query("insert into whatsapp_connection(waba_id,phone_number_id,access_token) values('111','222','t')");
  // Uma ligação só, e os IDs são algarismos: entram em caminhos do Graph API.
  await assert.rejects(db.query("insert into whatsapp_connection(id,waba_id,phone_number_id,access_token) values(2,'1','2','t')"),/check/i);
  await assert.rejects(db.query("update whatsapp_connection set phone_number_id='../me' where id=1"),/check/i);
  await db.query('delete from whatsapp_connection');
 });
});

await test('OLX tokens and cache are unreachable from any logged-in session',async()=>{
 // Os tokens dão acesso total à conta do OLX do stand: nem um administrador
 // os pode ler pela API.
 for(const t of ['olx_connection','olx_category_cache'])
  await asUser(admin,async()=>assert.rejects(db.query(`select * from public.${t}`),/permission denied/,t));
 // O servidor sim, e só há uma ligação.
 await asServer(async()=>{
  await db.query("insert into olx_connection(access_token,refresh_token,expires_at) values('a','r',now())");
  await assert.rejects(db.query("insert into olx_connection(id,access_token,refresh_token,expires_at) values(2,'a','r',now())"),/check/i);
 });
 // A sincronização guarda o estado na tabela que já existia.
 const r=(await db.query(`insert into channel_listings(car_id,channel,sync_state) values($1,'olx','pending') returning sync_state,attempts`,[car])).rows[0];
 assert.deepEqual(r,{sync_state:'pending',attempts:0});
 await assert.rejects(db.query(`update channel_listings set sync_state='qualquer' where car_id=$1`,[car]),/check/i);
});

await db.close();
