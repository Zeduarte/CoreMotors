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
// Com um webhook configurado: desde a 0045, sem ele os contactos não entram na fila do webhook.
await db.query(`update integration_secrets set data=data||'{"lead_webhook":"https://hooks.slack.com/services/x"}' where id=1`);
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

await test('the WhatsApp conversation memory is server-only and short-lived',async()=>{
 // Mensagens de colaboradores: nenhuma sessão as lê pela API, nem um administrador.
 await asUser(admin,async()=>assert.rejects(db.query('select * from public.wa_conversation'),/permission denied/));
 await asServer(async()=>{
  await db.query(`insert into wa_conversation(from_phone,role,content,created_at) values
   ('351916193337','user','quanto gastei no bmw?',now()-interval '3 days'),
   ('351916193337','assistant','Qual BMW?',now())`);
  await assert.rejects(db.query("insert into wa_conversation(from_phone,role,content) values('1','system','x')"),/check/i);
  await assert.rejects(db.query("insert into wa_conversation(from_phone,role,content) values('1','user','')"),/check/i);
  // A limpeza da manutenção apaga o que tem mais de dois dias.
  await db.query('select public.prune_whatsapp()');
  const left=(await db.query('select content from wa_conversation')).rows.map(r=>r.content);
  assert.deepEqual(left,['Qual BMW?']);
  await db.query('delete from wa_conversation');
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

// ---------------------------------------------------------------------------
// 0038 — mais ordens pelo WhatsApp (viaturas, leads, testemunhos). Como na
// 0024: a chave de serviço ignora a RLS, por isso estas funções são a barreira.
// ---------------------------------------------------------------------------

const draftCar=(actor,extra={})=>{
 const v={type:'car',make:'BMW',model:'320d',variant:'M Sport',year:2019,km:120000,fuel:'Diesel',gear:'Automática',body:'Berlina',
  price:23500,onRequest:false,plate:'12-AB-34',paint:'Preto',doors:5,seats:5,slug:'bmw-320d-m-sport-2019',...extra};
 return db.query(`select public.wa_create_draft_car($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) id`,
  [actor,v.type,v.make,v.model,v.variant,v.year,v.km,v.fuel,v.gear,v.body,v.price,v.onRequest,v.plate,v.paint,v.doors,v.seats,v.slug]);
};
const lastAudit=async(entity,id)=>(await db.query(
 'select actor_id,action,changed_fields from audit_log where entity=$1 and record_id=$2 order by id desc limit 1',[entity,id])).rows[0];

await test('the new WhatsApp RPCs are closed to logged-in users',async()=>{
 const id='00000000-0000-4000-8000-0000000000aa';
 for(const call of [
  `public.wa_leads_for_actor('${seller}','x',null)`,
  `public.wa_testimonials_for_actor('${seller}','x',false)`,
  `public.wa_staff_for_actor('${seller}','x')`,
  `public.wa_create_draft_car('${seller}','car','BMW','320',null,2019,1,'Diesel','Manual','Berlina',1,false,null,null,5,5,'x')`,
  `public.wa_update_car('${seller}','${id}','{"price":1}')`,
  `public.wa_set_car_status('${seller}','${id}','draft')`,
  `public.wa_set_lead_status('${seller}','${id}','closed',null)`,
  `public.wa_assign_lead('${seller}','${id}','${seller}')`,
  `public.wa_add_lead_note('${seller}','${id}','note','x')`,
  `public.wa_set_testimonial('${seller}','${id}',true)`,
 ]) await asUser(seller,async()=>assert.rejects(db.query(`select ${call}`),/permission denied/,call));
});

let waCar;
await test('a draft car from WhatsApp follows the form rules and is attributed to who ordered it',async()=>{
 await asServer(async()=>{
  waCar=(await draftCar(seller)).rows[0].id;
  const row=(await db.query('select status,slug,created_by,price,price_on_request,license_plate,doors from cars where id=$1',[waCar])).rows[0];
  assert.deepEqual(row,{status:'draft',slug:'bmw-320d-m-sport-2019',created_by:seller,price:23500,price_on_request:false,license_plate:'12-AB-34',doors:5});
  const audit=await lastAudit('cars',waCar);
  assert.equal(audit.actor_id,seller,'o histórico da viatura tem autor');
  assert.equal(audit.action,'INSERT');
  // Slug repetido: fica único, como no formulário.
  const dup=(await draftCar(seller)).rows[0].id;
  assert.equal((await db.query('select slug from cars where id=$1',[dup])).rows[0].slug,'bmw-320d-m-sport-2019-2');
  await db.query('delete from cars where id=$1',[dup]);
  // Sob consulta: sem preço.
  const pedido=(await draftCar(seller,{price:999,onRequest:true,slug:'sob-consulta'})).rows[0].id;
  assert.deepEqual((await db.query('select price,price_on_request from cars where id=$1',[pedido])).rows[0],{price:null,price_on_request:true});
  await db.query('delete from cars where id=$1',[pedido]);
  // Secção: o mecânico só tem a Oficina; o vendedor limitado só o dashboard.
  for(const quem of [mechanic,limited])await assert.rejects(draftCar(quem),/Sem permissão/);
  // As regras do formulário, repetidas no SQL.
  await assert.rejects(draftCar(seller,{year:1900}),/Ano inválido/);
  await assert.rejects(draftCar(seller,{price:null}),/Preço inválido/);
  await assert.rejects(draftCar(seller,{type:'motorcycle',body:'Naked',doors:4}),/Portas ou lugares/);
  await assert.rejects(draftCar(seller,{body:'Naked'}),/cars_vehicle_category_check/);
  await assert.rejects(draftCar(seller,{fuel:'Vapor'}),/invalid input value|fuel_type/);
  await assert.rejects(draftCar(seller,{plate:'12AB34'}),/Matrícula inválida/);
  await assert.rejects(draftCar(seller,{slug:'../x'}),/Slug inválido/);
  await assert.rejects(draftCar(seller,{model:'—'}),/Marca ou modelo/);
  // Tipo de viatura: limitado a motas, não cria carros.
  await db.query("update profiles set allowed_vehicle_types=array['motorcycle'] where id=$1",[seller]);
  try{await assert.rejects(draftCar(seller),/Sem acesso a este tipo de viatura/);}
  finally{await db.query('update profiles set allowed_vehicle_types=null where id=$1',[seller]);}
 });
});

await test('editing a car from WhatsApp is one attributed change, limited to price, km and texts',async()=>{
 await asServer(async()=>{
  await db.query(`select public.wa_update_car($1,$2,'{"price":21000,"mileage":121000,"tagline":"Nova frase"}')`,[seller,waCar]);
  const row=(await db.query('select price,mileage,tagline,description,status from cars where id=$1',[waCar])).rows[0];
  assert.deepEqual(row,{price:21000,mileage:121000,tagline:'Nova frase',description:null,status:'draft'});
  const audit=await lastAudit('cars',waCar);
  assert.equal(audit.actor_id,seller);
  assert.deepEqual(Object.keys(audit.changed_fields).sort(),['mileage','price','tagline'],'uma só alteração, com tudo');
  await db.query(`select public.wa_update_car($1,$2,'{"price":null}')`,[seller,waCar]);
  assert.deepEqual((await db.query('select price,price_on_request from cars where id=$1',[waCar])).rows[0],{price:null,price_on_request:true});
  await db.query(`select public.wa_update_car($1,$2,'{"price":22000}')`,[seller,waCar]);
  for(const [changes,erro] of [
   ['{"status":"sold"}',/Campo não permitido/],['{"price":1.5}',/Preço inválido/],['{"price":"22000"}',/Preço inválido/],
   ['{"mileage":-1}',/Quilómetros inválidos/],['{"description":""}',/Descrição inválida/],['{"tagline":"   "}',/destaque inválida/],
   ['{}',/Nada para alterar/],
  ]) await assert.rejects(db.query('select public.wa_update_car($1,$2,$3)',[seller,waCar,changes]),erro,changes);
  await assert.rejects(db.query(`select public.wa_update_car($1,$2,'{"price":1}')`,[mechanic,waCar]),/Sem permissão/);
  await assert.rejects(db.query(`select public.wa_update_car($1,'00000000-0000-4000-8000-0000000000aa','{"price":1}')`,[seller]),/Viatura inexistente/);
 });
});

let waLead;
await test('car status from WhatsApp: only publish or draft, never past a reservation or an incomplete record',async()=>{
 await asServer(async()=>{
  await db.query("select public.wa_set_car_status($1,$2,'published')",[seller,waCar]);
  assert.equal((await db.query('select status from cars where id=$1',[waCar])).rows[0].status,'published');
  assert.equal((await lastAudit('cars',waCar)).actor_id,seller);
  await assert.rejects(db.query("select public.wa_set_car_status($1,$2,'published')",[seller,waCar]),/Já está nesse estado/);
  for(const st of ['sold','reserved','workshop'])
   await assert.rejects(db.query('select public.wa_set_car_status($1,$2,$3)',[seller,waCar,st]),/Estado não permitido/,st);
  const incompleto=(await db.query("insert into cars(slug,make,model,status,price_on_request) values('wa-incompleto','BMW','—','draft',true) returning id")).rows[0].id;
  await assert.rejects(db.query("select public.wa_set_car_status($1,$2,'published')",[seller,incompleto]),/Ficha incompleta/);
  await db.query("update cars set status='workshop' where id=$1",[incompleto]);
  await assert.rejects(db.query("select public.wa_set_car_status($1,$2,'draft')",[seller,incompleto]),/Estado atual não se altera/);
  await db.query('delete from cars where id=$1',[incompleto]);
 });
 // Uma reserva activa (feita pelo fluxo próprio, no contacto) bloqueia.
 waLead=(await db.query("insert into leads(car_id,name,email,phone) values($1,'João Silva','joao@example.test','912 345 678') returning id",[waCar])).rows[0].id;
 await asUser(admin,()=>db.query("select reserve_vehicle($1,now()+interval '1 day',0)",[waLead]));
 await asServer(async()=>{
  await assert.rejects(db.query("select public.wa_set_car_status($1,$2,'draft')",[seller,waCar]),/Termine a reserva/);
  await assert.rejects(db.query("select public.wa_set_lead_status($1,$2,'closed',null)",[seller,waLead]),/Termine a reserva/,
   'nem fechar o contacto que tem a viatura reservada');
 });
});

await test('leads from WhatsApp: found without accents, changed by the CRM rules, attributed',async()=>{
 const outro=(await db.query("insert into leads(name,email) values('Joana Ribeiro','joana@example.test') returning id")).rows[0].id;
 await asServer(async()=>{
  const procura=async(quem,texto,estado=null)=>(await db.query('select id,active_reservation from public.wa_leads_for_actor($1,$2,$3)',[quem,texto,estado])).rows;
  assert.deepEqual((await procura(seller,'joao silva')).map(r=>r.id),[waLead],'«João» encontra-se como «joao»');
  assert.equal((await procura(seller,'joao silva'))[0].active_reservation,true);
  assert.deepEqual((await procura(seller,'912345678')).map(r=>r.id),[waLead],'telefone sem espaços');
  assert.equal((await procura(seller,'%')).length,0,'um curinga não devolve tudo');
  assert.equal((await procura(seller,'')).length,0,'sem pistas não se devolve nada');
  for(const quem of [mechanic,limited])assert.equal((await procura(quem,'joao')).length,0,'sem Leads não vê contactos');

  await assert.rejects(db.query("select public.wa_set_lead_status($1,$2,'lost',null)",[seller,outro]),/motivo de perda/);
  await assert.rejects(db.query("select public.wa_set_lead_status($1,$2,'won',null)",[seller,outro]),/Estado não permitido/);
  await db.query("select public.wa_set_lead_status($1,$2,'lost','Comprou noutro stand')",[seller,outro]);
  assert.deepEqual((await db.query('select status,loss_reason from leads where id=$1',[outro])).rows[0],{status:'lost',loss_reason:'Comprou noutro stand'});
  assert.equal((await lastAudit('leads',outro)).actor_id,seller);
  await db.query("select public.wa_set_lead_status($1,$2,'contacted',null)",[seller,outro]);
  assert.equal((await db.query('select loss_reason from leads where id=$1',[outro])).rows[0].loss_reason,null,'o motivo sai com o perdido');

  // Responsável: qualquer colaborador menos o mecânico.
  assert.deepEqual((await db.query("select id from public.wa_staff_for_actor($1,'example')",[seller])).rows.map(r=>r.id).includes(mechanic),false);
  await assert.rejects(db.query('select public.wa_assign_lead($1,$2,$3)',[seller,outro,mechanic]),/Responsável inválido/);
  await db.query('select public.wa_assign_lead($1,$2,$3)',[seller,outro,admin]);
  assert.equal((await db.query('select assigned_to from leads where id=$1',[outro])).rows[0].assigned_to,admin);
  await assert.rejects(db.query('select public.wa_assign_lead($1,$2,$3)',[seller,outro,admin]),/Já está nesse estado/);

  const nota=(await db.query("select public.wa_add_lead_note($1,$2,'call','Ligou a pedir o IUC') id",[seller,outro])).rows[0].id;
  assert.deepEqual((await db.query('select kind,body,created_by from lead_activities where id=$1',[nota])).rows[0],
   {kind:'call',body:'Ligou a pedir o IUC',created_by:seller});
  await assert.rejects(db.query("select public.wa_add_lead_note($1,$2,'note','')",[seller,outro]),/Texto inválido/);
  await assert.rejects(db.query("select public.wa_add_lead_note($1,$2,'note','x')",[mechanic,outro]),/Sem permissão/);
 });
});

await test('testimonials from WhatsApp: approve or take off the site, only with the section',async()=>{
 const t=(await db.query("insert into testimonials(name,body,published) values('Maria','Excelente serviço, recomendo.',false) returning id")).rows[0].id;
 await asServer(async()=>{
  // O vendedor não tem Testemunhos: nem os vê por aqui, nem os aprova.
  assert.equal((await db.query('select * from public.wa_testimonials_for_actor($1,null,true)',[seller])).rows.length,0);
  await assert.rejects(db.query('select public.wa_set_testimonial($1,$2,true)',[seller,t]),/Sem permissão/);
  assert.ok((await db.query('select id from public.wa_testimonials_for_actor($1,null,true)',[admin])).rows.some(r=>r.id===t));
  await db.query('select public.wa_set_testimonial($1,$2,true)',[admin,t]);
  assert.equal((await db.query('select published from testimonials where id=$1',[t])).rows[0].published,true);
  await assert.rejects(db.query('select public.wa_set_testimonial($1,$2,true)',[admin,t]),/Já está nesse estado/);
  await db.query('select public.wa_set_testimonial($1,$2,false)',[admin,t]);
  assert.equal((await db.query('select count(*)::int n from testimonials where id=$1',[t])).rows[0].n,1,'rejeitar não apaga');
 });
});

await test('pending proposals accept the new kinds, and nothing in the WhatsApp functions deletes',async()=>{
 await asServer(async()=>{
  const ok=(await db.query(`insert into wa_pending_actions(actor_id,from_phone,kind,payload,summary,image_wamid)
   values($1,'351900000038','update_car','{}','x','wamid.1') returning id`,[seller])).rows[0].id;
  assert.ok(ok);
  await assert.rejects(db.query(`insert into wa_pending_actions(actor_id,from_phone,kind,payload,summary)
   values($1,'351900000039','delete_car','{}','x')`,[seller]),/check/i);
 });
 const {rows}=await db.query(`select proname,prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and proname like 'wa\\_%'`);
 assert.ok(rows.length>=15);
 for(const r of rows)assert.doesNotMatch(r.prosrc,/\bdelete\b/i,r.proname);
});

// ---------------------------------------------------------------------------
// 0039 — fotografias por WhatsApp. As fotografias por confirmar ficam num
// bucket privado e numa tabela só do servidor; juntá-las a uma viatura passa
// pela RPC, que autoriza com o id explícito e usa a regra de capa do backoffice.
// ---------------------------------------------------------------------------

let fotoN=0;
/** Uma fotografia recebida (como o servidor a guarda), por defeito do vendedor. */
const stagedPhoto=async(actor=seller,extra={})=>{
 fotoN++;
 const id=`00000000-0000-4000-8000-${String(900000000000+fotoN)}`;
 await db.query(`insert into wa_media(id,from_phone,actor_id,media_id,storage_path,width,height,bytes,created_at)
  values($1,'351900000039',$2,$3,$4,1600,1200,1000,coalesce($5::timestamptz,now()))`,
  [id,actor,`media-${fotoN}`,`${actor}/${id}.jpg`,extra.created_at??null]);
 return id;
};
const photoItem=(carId,media,i=0)=>({media,path:`${carId}/00000000-0000-4000-8000-${String(800000000000+fotoN*10+i)}.jpg`,width:1600,height:1200});

await test('photos waiting for a yes are server-only and their bucket is private',async()=>{
 await asUser(admin,async()=>assert.rejects(db.query('select * from public.wa_media'),/permission denied/));
 await asUser(null,async()=>assert.rejects(db.query('select * from public.wa_media'),/permission denied/),'anon');
 assert.equal((await db.query("select public from storage.buckets where id='wa-media'")).rows[0].public,false);
 for(const call of [
  `public.wa_add_car_media('${seller}','${car}','[]')`,
  `public.prune_wa_media(array[]::uuid[])`,
 ]) await asUser(seller,async()=>assert.rejects(db.query(`select ${call}`),/permission denied/,call));
 await asServer(async()=>{
  // A proposta nova cabe na tabela de propostas.
  assert.ok((await db.query(`insert into wa_pending_actions(actor_id,from_phone,kind,payload,summary)
   values($1,'351900000040','add_car_media','{}','x') returning id`,[seller])).rows[0].id);
  // Uma legenda gigante ou um caminho fora da pasta do colaborador são recusados.
  await assert.rejects(db.query(`insert into wa_media(from_phone,actor_id,media_id,storage_path)
   values('1',$1,'m-x','../x.jpg')`,[seller]),/check/i);
 });
});

await test('photos join a vehicle with the backoffice order and cover rule, once',async()=>{
 const novo=(await db.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price)
  values('test-fotos','Audi','A3',2020,'Diesel','Manual','Berlina','draft',20000) returning id`)).rows[0].id;
 const a=await stagedPhoto(),b=await stagedPhoto();
 const r=await asServer(async()=>(await db.query('select public.wa_add_car_media($1,$2,$3) id',
  [seller,novo,JSON.stringify([photoItem(novo,a,0),photoItem(novo,b,1)])])).rows[0].id);
 assert.equal(r,novo);
 const media=(await db.query('select position,is_cover,kind,width from car_media where car_id=$1 order by position',[novo])).rows;
 assert.deepEqual(media.map(m=>[m.position,m.is_cover,m.kind]),[[0,true,'image'],[1,false,'image']]);
 const estado=(await db.query('select status,car_media_id from wa_media where id=any($1) order by id',[[a,b]])).rows;
 assert.ok(estado.every(e=>e.status==='attached'&&e.car_media_id));
 // A mesma fotografia não entra duas vezes.
 await asServer(async()=>assert.rejects(db.query('select public.wa_add_car_media($1,$2,$3)',
  [seller,novo,JSON.stringify([photoItem(novo,a,5)])]),/indisponível/));
 // As seguintes vão para o fim, e a capa fica onde estava.
 const c=await stagedPhoto();
 await asServer(()=>db.query('select public.wa_add_car_media($1,$2,$3)',[seller,novo,JSON.stringify([photoItem(novo,c,0)])]));
 const depois=(await db.query('select position,is_cover from car_media where car_id=$1 order by position',[novo])).rows;
 assert.deepEqual(depois.map(m=>[m.position,m.is_cover]),[[0,true],[1,false],[2,false]]);
 await db.query('delete from cars where id=$1',[novo]);
});

await test('only someone with Vehicles and the vehicle type attaches photos, and only their own',async()=>{
 const mota=(await db.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type,doors,seats)
  values('test-fotos-mota','Honda','CB500',2020,'Gasolina','Manual','Naked','draft',6000,'motorcycle',0,2) returning id`)).rows[0].id;
 await asServer(async()=>{
  // Sem o separador Viaturas: nem o mecânico nem quem só tem o dashboard.
  for(const who of [mechanic,limited]){
   const f=await stagedPhoto(who);
   await assert.rejects(db.query('select public.wa_add_car_media($1,$2,$3)',[who,car,JSON.stringify([photoItem(car,f)])]),/Sem permissão/,who);
  }
  // Com Viaturas mas sem motas.
  await db.query("update profiles set allowed_vehicle_types=array['car'] where id=$1",[seller]);
  const f=await stagedPhoto();
  await assert.rejects(db.query('select public.wa_add_car_media($1,$2,$3)',[seller,mota,JSON.stringify([photoItem(mota,f)])]),/Sem acesso a este tipo/);
  await db.query('update profiles set allowed_vehicle_types=null where id=$1',[seller]);
  // A fotografia de outra pessoa não se junta em nome desta.
  const alheia=await stagedPhoto(admin);
  await assert.rejects(db.query('select public.wa_add_car_media($1,$2,$3)',[seller,car,JSON.stringify([photoItem(car,alheia)])]),/indisponível/);
  // O ficheiro tem de estar na pasta DESTA viatura.
  await assert.rejects(db.query('select public.wa_add_car_media($1,$2,$3)',[seller,car,JSON.stringify([photoItem(car2,f)])]),/Caminho inválido/);
  await assert.rejects(db.query('select public.wa_add_car_media($1,$2,$3)',[seller,car,'[]']),/inválidas/);
  // Nada ficou a meio: a fotografia continua por juntar.
  assert.equal((await db.query('select status from wa_media where id=$1',[f])).rows[0].status,'staged');
 });
 assert.equal((await db.query('select count(*)::int n from car_media where car_id=$1',[mota])).rows[0].n,0);
 await db.query('delete from cars where id=$1',[mota]);
});

await test('the cleanup removes only old photo rows it was told about',async()=>{
 const velha=await stagedPhoto(seller,{created_at:new Date(Date.now()-3*86400000).toISOString()});
 const outraVelha=await stagedPhoto(seller,{created_at:new Date(Date.now()-3*86400000).toISOString()});
 const nova=await stagedPhoto();
 const n=await asServer(async()=>(await db.query('select public.prune_wa_media($1) n',[[velha,nova]])).rows[0].n);
 assert.equal(n,1,'a recente fica, mesmo pedida');
 const ficam=(await db.query('select id from wa_media where id=any($1)',[[velha,outraVelha,nova]])).rows.map(r=>r.id).sort();
 assert.deepEqual(ficam,[outraVelha,nova].sort(),'a que não foi pedida fica: o ficheiro dela ainda não saiu');
});

// ---------------------------------------------------------------------------
// 0036 — avisos por WhatsApp. Quem recebe decide-se na base de dados, com as
// permissões do backoffice: estes testes vigiam que ninguém recebe o que não
// podia abrir, que nada chega duas vezes à mesma pessoa e que agendar um aviso
// nunca impede a gravação.
// ---------------------------------------------------------------------------

const chefe='00000000-0000-4000-8000-000000000007';
const soMotas='00000000-0000-4000-8000-000000000005';
const semTelefone='00000000-0000-4000-8000-000000000006';
for(const [id,role]of[[chefe,'chefe'],[soMotas,'vendedor'],[semTelefone,'vendedor']]){
 await db.query('insert into auth.users(id,email) values($1,$2)',[id,`${role}-${id}@example.test`]);
 await db.query('insert into public.profiles(id,role) values($1,$2)',[id,role]);
}
await db.query("update profiles set allowed_vehicle_types=array['motorcycle'] where id=$1",[soMotas]);
for(const [id,phone]of[[admin,'912000001'],[seller,'+351 912 000 002'],[mechanic,'916193337'],[limited,'912000004'],[soMotas,'912000005'],[chefe,'912 000 007']])
 await db.query('update profiles set phone=$2 where id=$1',[id,phone]);
/** Quem tem um aviso agendado para este acontecimento. */
const recipients=async(event,subject)=>(await db.query(
 "select recipient_id from notification_jobs where channel='whatsapp' and event=$1 and subject_id=$2",[event,subject])).rows.map(r=>r.recipient_id).sort();
/** Um contacto vindo do site (sem sessão, como o servidor o grava). */
const newLead=async(kind,vtype,name='Cliente')=>(await db.query(
 'insert into leads(name,email,kind,vehicle_type) values($1,$2,$3,$4) returning id',[name,'cliente@example.test',kind,vtype])).rows[0].id;

await test('with WhatsApp notices switched off, nothing is queued for anyone',async()=>{
 const id=await newLead('contact','car');
 assert.deepEqual(await recipients('lead_contact',id),[]);
 // O webhook da 0013 continua com o seu envio por contacto.
 assert.equal((await db.query("select count(*)::int n from notification_jobs where channel='webhook' and lead_id=$1",[id])).rows[0].n,1);
});

await test('only an administrator switches the WhatsApp notices on',async()=>{
 await asUser(seller,async()=>assert.equal((await db.query('update notification_settings set whatsapp_enabled=true returning id')).rows.length,0));
 await asUser(admin,async()=>assert.equal((await db.query('update notification_settings set whatsapp_enabled=true returning id')).rows.length,1));
});

await test('a new lead reaches exactly the people who could open it in the backoffice',async()=>{
 const carro=await newLead('offer','car');
 // Vendedor e chefe têm Leads; o mecânico e o vendedor limitado não; quem só
 // trabalha com motas não vê um contacto de carros; sem telefone não há destino.
 assert.deepEqual(await recipients('lead_offer',carro),[admin,seller,chefe].sort());
 const mota=await newLead('test_drive','motorcycle');
 assert.deepEqual(await recipients('lead_test_drive',mota),[admin,seller,soMotas,chefe].sort());
 // Um contacto sem tipo de viatura é de toda a equipa comercial.
 const geral=await newLead('contact',null);
 assert.deepEqual(await recipients('lead_contact',geral),[admin,seller,soMotas,chefe].sort());
 // Cada tipo de pedido do site tem o seu aviso.
 for(const [kind,event] of [['finance','lead_contact'],['trade_in','lead_trade_in'],['order','lead_order'],['alert','lead_alert'],['reservation','lead_reservation']])
  assert.deepEqual(await recipients(event,await newLead(kind,'car')),[admin,seller,chefe].sort(),kind);
 // O email e o telefone do cliente não vão para o WhatsApp.
 const {payload}=(await db.query("select payload from notification_jobs where channel='whatsapp' and subject_id=$1 limit 1",[carro])).rows[0];
 assert.equal(payload.name,'Cliente');assert.equal(payload.kind,'offer');
 assert.equal(payload.email,undefined);assert.equal(payload.phone,undefined);
});

await test('a notice switched off in the profile is not sent, and only that one',async()=>{
 await asUser(seller,()=>db.query("insert into notification_preferences(profile_id,event,enabled) values($1,'lead_offer',false)",[seller]));
 assert.ok(!(await recipients('lead_offer',await newLead('offer','car'))).includes(seller));
 assert.ok((await recipients('lead_contact',await newLead('contact','car'))).includes(seller));
});

await test('the same event never reaches the same person twice',async()=>{
 const id=await newLead('alert','car');
 const before=await recipients('lead_alert',id);
 const again=await asServer(async()=>(await db.query("select public.queue_whatsapp_event('lead_alert',$1,'car','{}'::jsonb,$1) n",[id])).rows[0].n);
 assert.equal(again,0);
 assert.deepEqual(await recipients('lead_alert',id),before);
 // Nem inserido à mão: o índice único é a garantia final.
 await assert.rejects(db.query("insert into notification_jobs(channel,event,subject_id,recipient_id) values('whatsapp','lead_alert',$1,$2)",[id,admin]),/duplicate key|unique/i);
});

await test('a failure while scheduling a notice never stops the lead from being saved',async()=>{
 const sql=await readFile('supabase/migrations/0036_whatsapp_notifications.sql','utf8');
 const original=sql.match(/create or replace function public\.notification_recipients[\s\S]*?\n\$\$;/)[0];
 await db.exec(`create or replace function public.notification_recipients(ev text, vtype text, actor uuid)
  returns table (profile_id uuid, phone text) language plpgsql as $$ begin raise exception 'avaria simulada'; end $$;`);
 try{
  const id=await newLead('contact','car','Gravado na mesma');
  assert.equal((await db.query('select name from leads where id=$1',[id])).rows[0].name,'Gravado na mesma');
  assert.deepEqual(await recipients('lead_contact',id),[]);
 }finally{await db.exec(original);}
 assert.equal((await recipients('lead_contact',await newLead('contact','car'))).length,3,'reposta a função, tudo volta ao normal');
});

await test('a testimonial waiting for approval reaches whoever approves testimonials',async()=>{
 const pendente=(await db.query("insert into testimonials(name,body,rating,published) values('Rui','Atendimento impecável',5,false) returning id")).rows[0].id;
 assert.deepEqual(await recipients('testimonial_pending',pendente),[admin,chefe].sort());
 // Os criados no backoffice já vêm aprovados.
 const aprovado=(await db.query("insert into testimonials(name,body) values('Staff','Criado no backoffice') returning id")).rows[0].id;
 assert.deepEqual(await recipients('testimonial_pending',aprovado),[]);
});

await test('vehicles: workshop entries reach the workshop, the rest reaches sales, never the author',async()=>{
 // Entrada na oficina pelo backoffice: o mecânico não é avisado do que fez.
 const oficina=await asUser(mechanic,async()=>(await db.query("select create_workshop_intake_for_type('Honda por identificar','AA-22-BB','motorcycle') id")).rows[0].id);
 assert.deepEqual(await recipients('vehicle_workshop',oficina),[admin]);
 // Pelo assistente do WhatsApp, o autor é quem deu a ordem (wa_begin_as, 0024).
 const peloBot=await asServer(async()=>(await db.query("select public.wa_create_workshop_vehicle($1,'Yamaha por identificar','BB-33-CC','motorcycle') id",[admin])).rows[0].id);
 assert.deepEqual(await recipients('vehicle_workshop',peloBot),[mechanic]);
 // Dada como preparada: quem tem Viaturas (e acesso a motas) fica a saber.
 await asUser(mechanic,()=>db.query('select mark_vehicle_prepared($1)',[oficina]));
 // (Desde a 0041, o registo deste aviso é a saída da oficina, não a viatura.)
 assert.deepEqual((await db.query("select recipient_id from notification_jobs where event='vehicle_prepared' and payload->>'car_id'=$1",[oficina])).rows.map(r=>r.recipient_id).sort(),[admin,seller,soMotas,chefe].sort());
 // Publicada pela primeira vez pelo administrador: avisa os outros.
 await asUser(admin,()=>db.query("update cars set model='PCX',year=2021,fuel='Gasolina',transmission='Automática',body='Scooter',status='published' where id=$1",[oficina]));
 assert.deepEqual(await recipients('vehicle_published',oficina),[seller,soMotas,chefe].sort());
 // Tirar do site e voltar a publicar não é novidade.
 await asUser(admin,()=>db.query("update cars set status='draft' where id=$1",[oficina]));
 await asUser(admin,()=>db.query("update cars set status='published' where id=$1",[oficina]));
 assert.equal((await recipients('vehicle_published',oficina)).length,3);
 // Criada em Viaturas, por um chefe, em rascunho.
 const nova=await asUser(chefe,async()=>(await db.query("insert into cars(slug,make,model,status,vehicle_type,price_on_request) values('wa-nova','Peugeot','208','draft','car',true) returning id")).rows[0].id);
 assert.deepEqual(await recipients('vehicle_created',nova),[admin,seller].sort());
});

await test('a reservation confirmed by a colleague reaches the rest of the sales team',async()=>{
 const carro=(await db.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type)
  values('wa-reserva','Audi','A3',2019,'Diesel','Manual','Berlina','published',21000,'car') returning id`)).rows[0].id;
 const cliente=(await db.query("insert into leads(car_id,name,email) values($1,'Reserva','reserva-wa@example.test') returning id",[carro])).rows[0].id;
 const reserva=await asUser(admin,async()=>(await db.query("select reserve_vehicle($1,now()+interval '3 days',500) id",[cliente])).rows[0].id);
 assert.deepEqual(await recipients('vehicle_reserved',reserva),[seller,chefe].sort());
 const {payload}=(await db.query("select payload from notification_jobs where event='vehicle_reserved' and subject_id=$1 limit 1",[reserva])).rows[0];
 assert.equal(payload.lead_id,cliente);assert.equal(Number(payload.deposit),500);assert.equal(payload.make,'Audi');
});

await test('sending re-checks who may receive, and a doubtful send is never repeated',async()=>{
 const before=(await db.query('select allowed_sections from profiles where id=$1',[seller])).rows[0].allowed_sections;
 // Entre agendar e enviar, o vendedor perdeu o separador Leads.
 await db.query("update profiles set allowed_sections=array['dashboard','carros'] where id=$1",[seller]);
 try{
  const claimed=[];
  for(;;){const rows=(await asServer(()=>db.query('select * from public.claim_whatsapp_notifications(50)'))).rows;if(!rows.length)break;claimed.push(...rows);}
  assert.ok(claimed.length>10);
  assert.ok(claimed.every(c=>/^\d{9,15}$/.test(c.to_phone)),'telefones normalizados, com indicativo');
  assert.ok(claimed.some(c=>c.to_phone==='351912000002'&&c.event_kind.startsWith('vehicle_')),'as viaturas continuam a chegar-lhe');
  const leadsDoVendedor=(await db.query("select cancelled_at,last_error from notification_jobs where channel='whatsapp' and recipient_id=$1 and event like 'lead_%'",[seller])).rows;
  assert.ok(leadsDoVendedor.length>0);
  assert.ok(leadsDoVendedor.every(r=>r.cancelled_at&&r.last_error==='Sem acesso a este separador'));

  const [enviado,falhou,definitivo,incerto]=claimed.map(c=>c.job_id);
  await asServer(async()=>{
   await db.query("select public.finish_whatsapp_notification($1,'sent',null,'wamid.1')",[enviado]);
   await db.query("select public.finish_whatsapp_notification($1,'failed','HTTP 500 — (#1) erro temporário')",[falhou]);
   await db.query("select public.finish_whatsapp_notification($1,'permanent','HTTP 404 — (#132001) Template name does not exist')",[definitivo]);
   await db.query("select public.finish_whatsapp_notification($1,'uncertain','A Meta não respondeu a tempo')",[incerto]);
  });
  const job=async id=>(await db.query('select * from notification_jobs where id=$1',[id])).rows[0];
  assert.ok((await job(enviado)).delivered_at);assert.equal((await job(enviado)).wa_message_id,'wamid.1');
  assert.ok((await job(definitivo)).attempts>=8,'fica para o administrador');
  assert.ok((await job(incerto)).claimed_at,'fica reclamado: pode ter chegado');
  // Nada é reclamado outra vez: o que falhou espera pela próxima tentativa.
  assert.equal((await asServer(()=>db.query('select * from public.claim_whatsapp_notifications(50)'))).rows.length,0);
  await db.query('update notification_jobs set next_attempt_at=now() where id in ($1,$2,$3)',[falhou,incerto,definitivo]);
  const retry=(await asServer(()=>db.query('select * from public.claim_whatsapp_notifications(50)'))).rows;
  assert.deepEqual(retry.map(r=>r.job_id),[falhou],'só o que falhou volta a ser tentado');
  assert.equal(retry[0].attempt,2);

  // Um aviso que ficou mais de um dia sem ser tentado já não é novidade.
  const velho=await newLead('contact','car','Antigo');
  await db.query("update notification_jobs set next_attempt_at=now()-interval '25 hours' where subject_id=$1 and channel='whatsapp'",[velho]);
  assert.equal((await asServer(()=>db.query('select * from public.claim_whatsapp_notifications(50)'))).rows.length,0);
  const expirados=(await db.query("select last_error from notification_jobs where subject_id=$1 and channel='whatsapp'",[velho])).rows;
  assert.ok(expirados.length>0&&expirados.every(r=>/Expirou/.test(r.last_error)));
 }finally{await db.query('update profiles set allowed_sections=$2 where id=$1',[seller,before]);}
});

await test('notice preferences are personal, and the queue stays server-only',async()=>{
 await asUser(seller,async()=>{
  assert.ok((await db.query('select * from notification_preferences')).rows.every(r=>r.profile_id===seller));
  // Ninguém desliga os avisos de outra pessoa, nem inventa avisos.
  await assert.rejects(db.query("insert into notification_preferences(profile_id,event,enabled) values($1,'lead_contact',false)",[admin]),/row-level security/);
  await assert.rejects(db.query("insert into notification_preferences(profile_id,event,enabled) values($1,'aviso_inventado',false)",[seller]),/check/i);
  // O interruptor geral vê-se (o perfil diz se está ligado), mas não se muda.
  assert.equal((await db.query('select whatsapp_enabled from notification_settings')).rows[0].whatsapp_enabled,true);
  // A fila tem nomes de clientes: é só do administrador.
  assert.equal((await db.query("select * from notification_jobs where channel='whatsapp'")).rows.length,0);
 });
 await asUser(admin,async()=>{
  assert.equal((await db.query('select * from notification_preferences where profile_id=$1',[seller])).rows.length,0,'nem o administrador vê as escolhas dos outros');
  assert.ok((await db.query("select * from notification_jobs where channel='whatsapp'")).rows.length>0);
 });
 await asUser(null,async()=>assert.rejects(db.query('select * from notification_settings'),/permission denied/),'anon');
 // Agendar, reclamar e registar envios: só o servidor.
 for(const call of [
  'public.claim_whatsapp_notifications(10)',
  `public.finish_whatsapp_notification('${admin}','sent')`,
  `public.queue_whatsapp_event('lead_contact','${admin}',null,'{}'::jsonb)`,
  'public.queue_whatsapp_expiry_warning()',
  `public.notification_block_reason('${admin}','lead_contact',null)`,
 ]) await asUser(admin,async()=>assert.rejects(db.query(`select ${call}`),/permission denied/,call));
});

await test('the WhatsApp access about to expire is announced once, to whoever manages integrations',async()=>{
 await db.query("insert into whatsapp_connection(waba_id,phone_number_id,access_token,token_expires_at) values('111','222','t',now()+interval '3 days')");
 try{
  const queue=async()=>(await asServer(()=>db.query('select public.queue_whatsapp_expiry_warning() n'))).rows[0].n;
  assert.equal(await queue(),1);
  assert.equal(await queue(),0,'uma vez só');
  assert.deepEqual((await db.query("select recipient_id from notification_jobs where event='whatsapp_expiring'")).rows.map(r=>r.recipient_id),[admin]);
  // Longe do fim, não há aviso.
  await db.query("update whatsapp_connection set token_expires_at=now()+interval '30 days'");
  assert.equal(await queue(),0);
 }finally{await db.query('delete from whatsapp_connection');}
});

await test('old WhatsApp notices are pruned and the webhook queue is left alone',async()=>{
 const webhook=async()=>(await db.query("select count(*)::int n from notification_jobs where channel='webhook'")).rows[0].n;
 const antes=await webhook();
 await db.query("update notification_jobs set created_at=now()-interval '31 days' where channel='whatsapp' and event='testimonial_pending'");
 await asServer(()=>db.query('select public.prune_notification_jobs()'));
 assert.equal((await db.query("select count(*)::int n from notification_jobs where event='testimonial_pending'")).rows[0].n,0);
 assert.ok((await db.query("select count(*)::int n from notification_jobs where channel='whatsapp'")).rows[0].n>0);
 assert.equal(await webhook(),antes);
 await db.query('update notification_settings set whatsapp_enabled=false');
});

// ---------------------------------------------------------------------------
// 0040 — Página inicial e Definições por WhatsApp. O que se vigia: a mesma
// permissão do backoffice (separador; e administrador nas Definições), a
// lista branca de chaves (um segredo ou o logótipo nunca passam), nada se
// retira, e as funções só são chamáveis pelo servidor.
// ---------------------------------------------------------------------------

const botao={label:'Ver stock',href:'/carros'};
const homeContent=()=>({
 hero:{eyebrow:'Stand',title:'Carros com história',subtitle:'Usados escolhidos',primaryCta:botao,secondaryCta:botao,media:'auto'},
 motoHero:{eyebrow:'Motas',title:'Motas escolhidas',subtitle:'',primaryCta:botao},
 brands:['BMW','Audi'],
 trust:{eyebrow:'',title:'Confiança',pillars:[{kpi:'150+',title:'Viaturas',body:'Vendidas'}]},
 cta:{eyebrow:'',title:'Fale connosco',whatsappLabel:'WhatsApp',secondary:botao},
});
const servico=(id)=>({id,title:id,summary:'Resumo',body:'Texto',enabled:true});
const showroomContent=()=>({
 locations:[{id:'sede',name:'Sede',address:'Rua 1',city:'Lisboa',postalCode:'1000-001',phone:'21 000 0000',
  email:'geral@example.test',hours:'Seg–Sex 9h–19h; Sáb 10h–13h',latitude:null,longitude:null}],
 faqs:[{question:'Posso visitar?',answer:'Sim.',category:'geral'}],
 services:['financiamento','garantia','oficina','encomendas'].map(servico),
 google:{enabled:false,placeId:'',mapsUrl:''},
});
const siteCall=(fn,actor,value)=>db.query(`select public.${fn}($1,$2)`,[actor,JSON.stringify(value)]);

await test('the WhatsApp site RPCs are closed to logged-in users',async()=>{
 for(const call of [
  `public.wa_update_home('${admin}','{}')`,
  `public.wa_update_showroom('${admin}','{}')`,
  `public.wa_update_badges('${admin}','{}')`,
  `public.wa_update_site_settings('${admin}','{"company_name":"X"}')`,
  `public.wa_require_admin('${admin}')`,
  `public.wa_json_fits('{}','{}')`,
 ]) await asUser(admin,async()=>assert.rejects(db.query(`select ${call}`),/permission denied/,call));
});

await test('settings from WhatsApp: only an administrator, only the whitelisted columns',async()=>{
 await asServer(async()=>{
  await siteCall('wa_update_site_settings',admin,{company_name:'Stand Novo',tagline:'',whatsapp:'351910000000',workshop_hourly_rate:42.5});
  assert.deepEqual((await db.query('select company_name,tagline,whatsapp,workshop_hourly_rate::float r from site_settings where id=1')).rows[0],
   {company_name:'Stand Novo',tagline:null,whatsapp:'351910000000',r:42.5});
  // Sem o separador: recusado pelo wa_begin_as.
  await assert.rejects(siteCall('wa_update_site_settings',seller,{company_name:'X'}),/Sem permissão/);
  // Com o separador mas sem ser administrador: recusado, como o requireAdmin.
  await db.query("update profiles set allowed_sections=array['dashboard','pagina-inicial','definicoes'] where id=$1",[chefe]);
  try{
   await assert.rejects(siteCall('wa_update_site_settings',chefe,{company_name:'X'}),/Apenas administradores/);
   await assert.rejects(siteCall('wa_update_badges',chefe,{items:[]}),/Apenas administradores/);
  }finally{await db.query('update profiles set allowed_sections=null where id=$1',[chefe]);}
  // Lista branca: segredos, integrações, logótipo e contactos antigos nunca.
  for(const k of ['stripe_secret','feed_token','ga4_id','pixel_id','reservation_enabled','logo_url','phone','id'])
   await assert.rejects(siteCall('wa_update_site_settings',admin,{[k]:'x'}),/Campo não permitido/,k);
  for(const [changes,erro] of [
   [{accent:'red'},/Cor inválida/],[{company_name:'   '},/Nome inválido/],[{whatsapp:'910000000'},/WhatsApp inválido/],
   [{workshop_hourly_rate:1001},/Valor inválido/],[{workshop_hourly_rate:'40'},/Valor inválido/],[{},/Nada para alterar/],
  ]) await assert.rejects(siteCall('wa_update_site_settings',admin,changes),erro,JSON.stringify(changes));
  assert.equal((await db.query('select company_name from site_settings where id=1')).rows[0].company_name,'Stand Novo');
 });
});

await test('homepage texts from WhatsApp: the section, and exactly the form keys',async()=>{
 await asServer(async()=>{
  await siteCall('wa_update_home',chefe,homeContent());
  assert.equal((await db.query("select content->'hero'->>'title' t from site_content where key='home'")).rows[0].t,'Carros com história');
  await assert.rejects(siteCall('wa_update_home',seller,homeContent()),/Sem permissão/);
  await assert.rejects(siteCall('wa_update_home',mechanic,homeContent()),/Sem permissão/);
  const extra=homeContent();extra.stripe_secret='sk_live_x';
  const escondida=homeContent();escondida.hero.logo_url='branding/x.png';
  const semTitulo=homeContent();semTitulo.hero.title=' ';
  const falta=homeContent();delete falta.cta;
  const media=homeContent();media.hero.media='gif';
  for(const c of [extra,escondida,semTitulo,falta,media])
   await assert.rejects(siteCall('wa_update_home',chefe,c),/Conteúdo inválido/);
  assert.equal((await db.query("select content->'hero'->>'title' t from site_content where key='home'")).rows[0].t,'Carros com história');
 });
});

await test('showroom from WhatsApp: fields of what exists, never a point of sale more or less',async()=>{
 await db.query("update site_content set content=$1 where key='showroom'",[JSON.stringify(showroomContent())]);
 await asServer(async()=>{
  const novo=showroomContent();novo.locations[0].phone='21 111 1111';novo.locations[0].hours='Sáb 10h–13h';
  await siteCall('wa_update_showroom',chefe,novo);
  assert.equal((await db.query("select content->'locations'->0->>'phone' p from site_content where key='showroom'")).rows[0].p,'21 111 1111');
  await assert.rejects(siteCall('wa_update_showroom',seller,novo),/Sem permissão/);
  const mais=showroomContent();mais.locations.push({...mais.locations[0],id:'filial',name:'Filial'});
  await assert.rejects(siteCall('wa_update_showroom',chefe,mais),/Pontos de venda diferentes/);
  const menos=showroomContent();menos.locations=[];
  await assert.rejects(siteCall('wa_update_showroom',chefe,menos),/Pontos de venda diferentes/);
  const semPergunta=showroomContent();semPergunta.faqs=[];
  await assert.rejects(siteCall('wa_update_showroom',chefe,semPergunta),/Conteúdo mudou/);
  const chave=showroomContent();chave.google.apiKey='AIza-x';
  const telefone=showroomContent();telefone.locations[0].phone='ligue já!';
  const servicos=showroomContent();servicos.services[3]=servico('financiamento');
  for(const c of [chave,telefone,servicos])await assert.rejects(siteCall('wa_update_showroom',chefe,c),/Conteúdo inválido/);
 });
});

await test('card badges from WhatsApp: an administrator edits the existing ones, none goes away',async()=>{
 await db.query("insert into site_content(key,content) values('badges',$1) on conflict(key) do update set content=excluded.content",
  [JSON.stringify({items:[{id:'iva',label:'IVA dedutível',color:'#111111',enabled:true}]})]);
 await asServer(async()=>{
  const items=[{id:'new',label:'Acabado de chegar',color:'#E67E22',enabled:true},{id:'iva',label:'IVA',color:'#111111',enabled:false}];
  await siteCall('wa_update_badges',admin,{items});
  assert.deepEqual((await db.query("select content from site_content where key='badges'")).rows[0].content,{items});
  await assert.rejects(siteCall('wa_update_badges',admin,{items:[items[0]]}),/Conteúdo mudou/,'a do stand não sai');
  await assert.rejects(siteCall('wa_update_badges',admin,{items:[...items,{id:'nova',label:'Nova',color:'#000000',enabled:true}]}),/Conteúdo mudou/);
  await assert.rejects(siteCall('wa_update_badges',admin,{items:[{...items[1],token:'x'}]}),/Conteúdo inválido/);
  await assert.rejects(siteCall('wa_update_badges',seller,{items}),/Sem permissão/);
 });
});

await test('pending proposals accept the site kinds and keep every earlier one',async()=>{
 await asServer(async()=>{
  for(const [i,kind] of ['update_homepage','update_showroom','update_site_settings','update_badges','update_car','register_vehicle','set_testimonial'].entries())
   await db.query(`insert into wa_pending_actions(actor_id,from_phone,kind,payload,summary) values($1,$2,$3,'{}','x')`,[admin,`35190000400${i}`,kind]);
  await assert.rejects(db.query(`insert into wa_pending_actions(actor_id,from_phone,kind,payload,summary)
   values($1,'351900004099','update_integrations','{}','x')`,[admin]),/check/i);
 });
});

// ---------------------------------------------------------------------------
// 0041 — mais avisos por WhatsApp: férias, contactos atribuídos, vendas,
// reservas que terminam, preços e viaturas que saem da oficina. As mesmas
// garantias da 0036: quem recebe segue as permissões (aqui, também a hierarquia
// das férias), o autor fica de fora, nada chega duas vezes, nada entra na fila
// com o interruptor desligado, e agendar nunca impede a gravação.
// ---------------------------------------------------------------------------

/** Quem tem um aviso agendado, procurando pelo conteúdo (registo = a mudança). */
const recipientsBy=async(event,key,value)=>(await db.query(
 "select recipient_id from notification_jobs where channel='whatsapp' and event=$1 and payload->>$2=$3",[event,key,value])).rows.map(r=>r.recipient_id).sort();
const leaveRecipients=async(event,who)=>recipientsBy(event,'profile_id',who);
await db.query('update notification_settings set whatsapp_enabled=true');

await test('0041: with the switch off nothing new is queued either',async()=>{
 await db.query('update notification_settings set whatsapp_enabled=false');
 try{
  const id=await newLead('contact','car','Desligado');
  await asUser(admin,()=>db.query('update leads set assigned_to=$2 where id=$1',[id,seller]));
  await asUser(seller,()=>db.query("insert into leave_days(profile_id,day,status) values($1,'2031-06-02','pending')",[seller]));
  assert.equal((await asServer(()=>db.query("select public.queue_whatsapp_leave_upcoming('2031-05-28T10:00:00Z') n"))).rows[0].n,0);
  assert.deepEqual(await recipientsBy('lead_assigned','lead_id',id),[]);
  assert.deepEqual(await leaveRecipients('leave_requested',seller),[]);
 }finally{
  await db.query("delete from leave_days where profile_id=$1",[seller]);
  await db.query('update notification_settings set whatsapp_enabled=true');
 }
});

await test('0041: a leave request reaches exactly who may decide it (the 0022 hierarchy)',async()=>{
 // Vendedor: o administrador e o chefe. Mecânico: também. Chefe: só o administrador.
 await asUser(seller,()=>db.query("insert into leave_days(profile_id,day,status) values($1,'2031-07-07','pending'),($1,'2031-07-08','pending')",[seller]));
 assert.deepEqual(await leaveRecipients('leave_requested',seller),[admin,chefe].sort());
 await asUser(mechanic,()=>db.query("insert into leave_days(profile_id,day,status) values($1,'2031-07-09','pending')",[mechanic]));
 assert.deepEqual(await leaveRecipients('leave_requested',mechanic),[admin,chefe].sort());
 await asUser(chefe,()=>db.query("insert into leave_days(profile_id,day,status) values($1,'2031-07-10','pending')",[chefe]));
 assert.deepEqual(await leaveRecipients('leave_requested',chefe),[admin]);
 // O administrador aprova o próprio plano ao submetê-lo: não há pedido.
 await asUser(admin,()=>db.query("insert into leave_days(profile_id,day,status,decided_by) values($1,'2031-07-11','approved',$1)",[admin]));
 assert.deepEqual(await leaveRecipients('leave_requested',admin),[]);
 // Um pedido de vários dias é UM aviso por pessoa, com o período todo.
 const {payload}=(await db.query("select payload from notification_jobs where event='leave_requested' and payload->>'profile_id'=$1 limit 1",[seller])).rows[0];
 assert.equal(payload.start,'2031-07-07');assert.equal(payload.end,'2031-07-08');assert.equal(Number(payload.days),2);
 // Marcar de uma vez dias novos e um rascunho (insert + update na mesma
 // instrução) continua a ser um aviso só, com os dois dias.
 await asUser(limited,()=>db.query("insert into leave_days(profile_id,day,status) values($1,'2031-07-15','draft')",[limited]));
 assert.deepEqual(await leaveRecipients('leave_requested',limited),[],'um rascunho não é um pedido');
 await asUser(limited,()=>db.query("insert into leave_days(profile_id,day,status) values($1,'2031-07-14','pending'),($1,'2031-07-15','pending') on conflict(profile_id,day) do update set status=excluded.status",[limited]));
 const jobs=(await db.query("select recipient_id,payload from notification_jobs where event='leave_requested' and payload->>'profile_id'=$1",[limited])).rows;
 assert.deepEqual(jobs.map(j=>j.recipient_id).sort(),[admin,chefe].sort());
 assert.ok(jobs.every(j=>j.payload.start==='2031-07-14'&&j.payload.end==='2031-07-15'));
});

await test('0041: the decision reaches the requester, never the one who decided',async()=>{
 await asUser(chefe,()=>db.query("update leave_days set status='approved',decided_by=$2,decided_at=now() where profile_id=$1 and status='pending'",[seller,chefe]));
 assert.deepEqual(await recipientsBy('leave_decided','profile_id',seller),[seller]);
 await asUser(admin,()=>db.query("update leave_days set status='rejected',decided_by=$2,decided_at=now() where profile_id=$1 and status='pending'",[chefe,admin]));
 assert.deepEqual(await recipientsBy('leave_decided','profile_id',chefe),[chefe]);
 const {payload}=(await db.query("select payload from notification_jobs where event='leave_decided' and payload->>'profile_id'=$1",[chefe])).rows[0];
 assert.equal(payload.decision,'rejected');
 // Um chefe não decide o plano de outro chefe: a RLS não o deixa, e não há aviso.
 await asUser(chefe,()=>db.query("update leave_days set status='approved' where profile_id=$1",[chefe]));
 assert.equal((await db.query("select count(*)::int n from notification_jobs where event='leave_decided' and payload->>'profile_id'=$1",[chefe])).rows[0].n,1);
});

await test('0041: weekends and holidays do not split a leave period',async()=>{
 const q=async(sql,params)=>(await asServer(()=>db.query(sql,params))).rows[0].v;
 assert.equal(await q("select public.easter_sunday(2026)::text v"),'2026-04-05');
 assert.equal(await q("select public.is_day_off('2026-04-03') v"),true,'Sexta-feira Santa');
 assert.equal(await q("select public.is_day_off('2026-06-04') v"),true,'Corpo de Deus');
 assert.equal(await q("select public.is_day_off('2026-10-05') v"),true,'5 de Outubro');
 assert.equal(await q("select public.is_day_off('2026-10-17') v"),true,'sábado');
 assert.equal(await q("select public.is_day_off('2026-10-14') v"),false);
 await db.query("insert into company_days(day,kind,label) values('2026-10-14','holiday','Feriado municipal')");
 try{assert.equal(await q("select public.is_day_off('2026-10-14') v"),true,'feriado do stand');}
 finally{await db.query("delete from company_days where day='2026-10-14'");}
});

await test('0041: a colleague going on leave next week is announced once, to the whole team but them',async()=>{
 const upcoming=async(at)=>(await asServer(()=>db.query('select public.queue_whatsapp_leave_upcoming($1) n',[at]))).rows[0].n;
 // Quinta e sexta, fim de semana, segunda e terça: UM período (6 a 11 de março).
 await db.query("insert into leave_days(profile_id,day,status) values($1,'2031-03-06','approved'),($1,'2031-03-07','approved'),($1,'2031-03-10','approved'),($1,'2031-03-11','approved')",[seller]);
 // Pedidos, recusados e longe de mais não contam.
 await db.query("insert into leave_days(profile_id,day,status) values($1,'2031-03-04','pending')",[mechanic]);
 await db.query("insert into leave_days(profile_id,day,status) values($1,'2031-03-05','rejected')",[chefe]);
 await db.query("insert into leave_days(profile_id,day,status) values($1,'2031-03-20','approved')",[soMotas]);
 // De noite não se agenda (sai às 9h).
 assert.equal(await upcoming('2031-03-01T03:00:00Z'),0);
 assert.equal(await upcoming('2031-03-01T10:00:00Z'),5);
 assert.equal(await upcoming('2031-03-02T10:00:00Z'),0,'uma vez por período');
 // Toda a equipa que vê «Férias colegas», menos o próprio; sem telefone, nada.
 assert.deepEqual(await leaveRecipients('leave_upcoming',seller),[admin,mechanic,limited,soMotas,chefe].sort());
 for(const who of [mechanic,chefe,soMotas])assert.deepEqual(await leaveRecipients('leave_upcoming',who),[]);
 const {payload}=(await db.query("select payload from notification_jobs where event='leave_upcoming' and payload->>'profile_id'=$1 limit 1",[seller])).rows[0];
 assert.equal(payload.start,'2031-03-06');assert.equal(payload.end,'2031-03-11');assert.equal(Number(payload.days),4);
 // Com um dia de trabalho pelo meio, são dois períodos.
 await db.query("insert into leave_days(profile_id,day,status) values($1,'2031-03-24','approved'),($1,'2031-03-26','approved')",[limited]);
 assert.equal(await upcoming('2031-03-21T10:00:00Z'),10,'dois períodos, cinco colegas cada');
 // Desmarcadas antes do envio: o envio volta a verificar e não as anuncia.
 await db.query("delete from leave_days where profile_id=$1 and day='2031-03-26'",[limited]);
 for(;;){if(!(await asServer(()=>db.query('select * from public.claim_whatsapp_notifications(50)'))).rows.length)break;}
 const canceladas=(await db.query("select last_error from notification_jobs where event='leave_upcoming' and payload->>'start'='2031-03-26'")).rows;
 assert.equal(canceladas.length,5);assert.ok(canceladas.every(r=>r.last_error==='As férias foram desmarcadas'));
 assert.ok((await db.query("select cancelled_at from notification_jobs where event='leave_upcoming' and payload->>'start'='2031-03-24'")).rows.every(r=>!r.cancelled_at));
});

await test('0041: a lead assigned to someone reaches only them, and only while it is theirs',async()=>{
 const id=await newLead('contact','car','Atribuído');
 // A si próprio: não é novidade.
 await asUser(seller,()=>db.query('update leads set assigned_to=$2 where id=$1',[id,seller]));
 assert.deepEqual(await recipientsBy('lead_assigned','lead_id',id),[]);
 await asUser(admin,()=>db.query('update leads set assigned_to=$2 where id=$1',[id,chefe]));
 assert.deepEqual(await recipientsBy('lead_assigned','lead_id',id),[chefe]);
 // Gravar outra vez sem mudar o responsável não repete.
 await asUser(admin,()=>db.query("update leads set assigned_to=$2,notes='x' where id=$1",[id,chefe]));
 assert.deepEqual(await recipientsBy('lead_assigned','lead_id',id),[chefe]);
 // Reatribuído antes do envio: o aviso ao chefe já não sai; o vendedor recebe o seu.
 await asUser(admin,()=>db.query('update leads set assigned_to=$2 where id=$1',[id,seller]));
 for(;;){if(!(await asServer(()=>db.query('select * from public.claim_whatsapp_notifications(50)'))).rows.length)break;}
 const jobs=(await db.query("select recipient_id,cancelled_at,last_error from notification_jobs where event='lead_assigned' and payload->>'lead_id'=$1",[id])).rows;
 assert.equal(jobs.find(j=>j.recipient_id===chefe).last_error,'O contacto já não está atribuído a esta pessoa');
 assert.equal(jobs.find(j=>j.recipient_id===seller).cancelled_at,null);
 // Perdido por outra pessoa: o responsável fica a saber.
 await asUser(admin,()=>db.query("update leads set status='lost',loss_reason='Desistiu' where id=$1",[id]));
 assert.deepEqual(await recipientsBy('lead_outcome','lead_id',id),[seller]);
 // Um contacto de motas não chega a quem só trabalha com carros.
 const mota=await newLead('contact','motorcycle','Mota');
 await db.query("update profiles set allowed_vehicle_types=array['car'] where id=$1",[chefe]);
 try{
  await asUser(admin,()=>db.query('update leads set assigned_to=$2 where id=$1',[mota,chefe]));
  assert.deepEqual(await recipientsBy('lead_assigned','lead_id',mota),[]);
 }finally{await db.query('update profiles set allowed_vehicle_types=null where id=$1',[chefe]);}
});

await test('0041: a sale reaches the sales team and the contact owner; a cancelled or expired reservation too',async()=>{
 const carro=(await db.query("insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type) values('wa-venda-41','Seat','Leon',2018,'Gasolina','Manual','Berlina','published',14000,'car') returning id")).rows[0].id;
 const cliente=(await db.query("insert into leads(car_id,name,email,assigned_to) values($1,'Comprador','comprador-41@example.test',$2) returning id",[carro,seller])).rows[0].id;
 // Reserva cancelada pelo administrador: a equipa comercial (menos ele) volta a oferecê-la.
 const r1=await asUser(admin,async()=>(await db.query("select reserve_vehicle($1,now()+interval '3 days',0) id",[cliente])).rows[0].id);
 await asUser(admin,()=>db.query('select release_reservation($1)',[r1]));
 assert.deepEqual(await recipients('reservation_ended',r1),[seller,chefe].sort());
 // Expirada na manutenção (sem autor): toda a equipa comercial de carros.
 const r2=await asUser(admin,async()=>(await db.query("select reserve_vehicle($1,now()+interval '3 days',0) id",[cliente])).rows[0].id);
 await db.query("update reservations set expires_at=now()-interval '1 minute' where id=$1",[r2]);
 await asServer(()=>db.query('select public.expire_reservations()'));
 assert.deepEqual(await recipients('reservation_ended',r2),[admin,seller,chefe].sort());
 assert.equal((await db.query("select payload->>'outcome' o from notification_jobs where event='reservation_ended' and subject_id=$1 limit 1",[r2])).rows[0].o,'expired');
 // Vendida pelo administrador: quem vende carros, e o responsável do contacto (ganho).
 await asUser(admin,()=>db.query("select close_vehicle_sale($1,13500,current_date)",[cliente]));
 assert.deepEqual(await recipientsBy('vehicle_sold','car_id',carro),[seller,chefe].sort());
 assert.deepEqual(await recipientsBy('lead_outcome','lead_id',cliente),[seller]);
});

await test('0041: a price change is off by default, and only for a vehicle on sale',async()=>{
 const carro=(await db.query("insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type) values('wa-preco-41','Fiat','Panda',2017,'Gasolina','Manual','Citadino','published',8000,'car') returning id")).rows[0].id;
 await asUser(admin,()=>db.query('update cars set price=7500 where id=$1',[carro]));
 assert.deepEqual(await recipientsBy('vehicle_price_changed','car_id',carro),[],'desligado para quem nunca escolheu');
 await asUser(chefe,()=>db.query("insert into notification_preferences(profile_id,event,enabled) values($1,'vehicle_price_changed',true)",[chefe]));
 await asUser(admin,()=>db.query('update cars set price=7000 where id=$1',[carro]));
 assert.deepEqual(await recipientsBy('vehicle_price_changed','car_id',carro),[chefe]);
 const {payload}=(await db.query("select payload from notification_jobs where event='vehicle_price_changed' and payload->>'car_id'=$1",[carro])).rows[0];
 assert.equal(Number(payload.old_price),7500);assert.equal(Number(payload.new_price),7000);
 // Num rascunho, ou na mesma gravação em que muda o estado, não.
 await asUser(admin,()=>db.query("update cars set status='draft',price=6000 where id=$1",[carro]));
 await asUser(admin,()=>db.query('update cars set price=5000 where id=$1',[carro]));
 assert.equal((await recipientsBy('vehicle_price_changed','car_id',carro)).length,1);
});

await test('0041: leaving the workshop is announced every time, also when changed in the vehicle form',async()=>{
 const id=await asUser(mechanic,async()=>(await db.query("select create_workshop_intake_for_type('Kawasaki Z900','ZZ-90-00','motorcycle') id")).rows[0].id);
 // Pela ficha (estado «Na oficina» → «Rascunho»), por quem tem Viaturas.
 await asUser(chefe,()=>db.query("update cars set status='draft' where id=$1",[id]));
 assert.deepEqual(await recipientsBy('vehicle_prepared','car_id',id),[admin,seller,soMotas].sort());
 // Volta à oficina e sai pelo botão da Oficina: outra vez.
 await asUser(chefe,()=>db.query('select return_vehicle_to_workshop($1)',[id]));
 await asUser(mechanic,()=>db.query('select mark_vehicle_prepared($1)',[id]));
 assert.equal((await db.query("select count(*)::int n from notification_jobs where event='vehicle_prepared' and payload->>'car_id'=$1",[id])).rows[0].n,7);
});

await test('0041: the same change never reaches the same person twice',async()=>{
 const id=await newLead('contact','car','Duas vezes');
 await asUser(admin,()=>db.query('update leads set assigned_to=$2 where id=$1',[id,seller]));
 const [{subject_id}]=(await db.query("select subject_id from notification_jobs where event='lead_assigned' and payload->>'lead_id'=$1",[id])).rows;
 const again=await asServer(async()=>(await db.query("select public.queue_whatsapp_notice('lead_assigned',$1,'car',jsonb_build_object('lead_id',$2::text),$2::uuid,array[$3::uuid]) n",[subject_id,id,seller])).rows[0].n);
 assert.equal(again,0);
 // Uma transação dá sempre o mesmo registo; outra transação, outro.
 const pair=await asServer(async()=>{await db.exec('begin');try{return (await db.query("select public.notification_subject('x',$1) a, public.notification_subject('x',$1) b",[id])).rows[0];}finally{await db.exec('commit');}});
 assert.equal(pair.a,pair.b);
 const other=await asServer(async()=>(await db.query("select public.notification_subject('x',$1) a",[id])).rows[0].a);
 assert.notEqual(other,pair.a);
 assert.deepEqual(await recipientsBy('lead_assigned','lead_id',id),[seller]);
});

await test('0041: a failure while scheduling never stops the change from being saved',async()=>{
 const sql=await readFile('supabase/migrations/0041_more_notifications.sql','utf8');
 const original=sql.match(/create or replace function public\.queue_whatsapp_notice[\s\S]*?\nend \$\$;/)[0];
 await db.exec(`create or replace function public.queue_whatsapp_notice(ev text, subject uuid, vtype text, details jsonb, lead uuid, candidates uuid[])
  returns int language plpgsql as $$ begin raise exception 'avaria simulada'; end $$;`);
 try{
  const id=await newLead('contact','car','Gravado');
  await asUser(admin,()=>db.query('update leads set assigned_to=$2 where id=$1',[id,seller]));
  assert.equal((await db.query('select assigned_to from leads where id=$1',[id])).rows[0].assigned_to,seller);
  await asUser(soMotas,()=>db.query("insert into leave_days(profile_id,day,status) values($1,'2031-09-01','pending')",[soMotas]));
  assert.equal((await db.query("select count(*)::int n from leave_days where profile_id=$1 and day='2031-09-01'",[soMotas])).rows[0].n,1);
  assert.deepEqual(await recipientsBy('lead_assigned','lead_id',id),[]);
 }finally{await db.exec(original);}
});

await test('0041: the new functions are server-only',async()=>{
 for(const call of [
  `public.queue_whatsapp_notice('lead_assigned','${admin}',null,'{}'::jsonb,null,array['${admin}'::uuid])`,
  'public.queue_whatsapp_leave_upcoming()',
  `public.queue_whatsapp_leave_request('${admin}')`,
  `public.notification_job_block_reason('${admin}','lead_contact','{}'::jsonb)`,
  `public.can_decide_leave_as('${admin}','${seller}')`,
  `public.notification_subject('x','${admin}')`,
  "public.is_day_off('2031-01-01')",
  'public.easter_sunday(2031)',
 ]) for(const [id,role] of [[admin,'authenticated'],[null,'anon']])
  await asUser(id,async()=>assert.rejects(db.query(`select ${call}`),/permission denied/,call),role);
 // A regra da 0022 continua a valer para quem está na sessão.
 await asUser(chefe,async()=>{
  assert.equal((await db.query('select public.can_decide_leave_for($1) v',[seller])).rows[0].v,true);
  assert.equal((await db.query('select public.can_decide_leave_for($1) v',[admin])).rows[0].v,false);
 });
 assert.equal((await asServer(()=>db.query('select public.notification_event_default($1) v',['vehicle_price_changed']))).rows[0].v,false);
});

await test('0041: old notices of the new kinds are pruned too',async()=>{
 await db.query("update notification_jobs set created_at=now()-interval '31 days' where channel='whatsapp' and event in ('leave_upcoming','lead_assigned','vehicle_sold')");
 await asServer(()=>db.query('select public.prune_notification_jobs()'));
 assert.equal((await db.query("select count(*)::int n from notification_jobs where event in ('leave_upcoming','lead_assigned','vehicle_sold')")).rows[0].n,0);
 assert.ok((await db.query("select count(*)::int n from notification_jobs where event='leave_requested'")).rows[0].n>0);
 await db.query('update notification_settings set whatsapp_enabled=false');
});

await test('0042: visits need a date and a state, and stock alert matches are staff-only and never duplicated',async()=>{
 await assert.rejects(db.query("insert into leads(name,email,visit_at) values('Sem estado','',now())"),/leads_visit_shape/);
 await assert.rejects(db.query("insert into leads(name,email,visit_at,visit_status) values('Estado errado','',now(),'talvez')"),/leads_visit_status_check/);
 const visit=(await db.query("insert into leads(kind,car_id,name,email,phone,visit_at,visit_status) values('visit',$1,'Visita','','912345678',now()+interval '1 day','requested') returning id",[car])).rows[0].id;
 const alert=(await db.query("insert into leads(kind,name,email,car_details) values('alert','Alerta','a@example.test','{\"criteria\":{\"vehicle_type\":\"car\",\"make\":\"BMW\"}}') returning id")).rows[0].id;
 await db.query('insert into stock_alert_matches(lead_id,car_id) values($1,$2)',[alert,car]);
 await assert.rejects(db.query('insert into stock_alert_matches(lead_id,car_id) values($1,$2)',[alert,car]),/duplicate key|unique/i);
 await asUser(null,async()=>{
  await assert.rejects(db.query('select * from stock_alert_matches'),/permission denied/);
  await assert.rejects(db.query('select * from customer_settings'),/permission denied/);
 },'anon');
 await asUser(seller,async()=>{
  assert.equal((await db.query('select count(*)::int n from stock_alert_matches where lead_id=$1',[alert])).rows[0].n,1);
  await db.query("update stock_alert_matches set status='sent',sent_at=now() where lead_id=$1",[alert]);
  await assert.rejects(db.query("update stock_alert_matches set car_id=$2 where lead_id=$1",[alert,car2]),/permission denied/);
  await db.query("update leads set visit_status='confirmed' where id=$1",[visit]);
  // Só o administrador muda as definições das visitas e das mensagens aos clientes.
  assert.equal((await db.query('update customer_settings set customer_whatsapp=true returning id')).rows.length,0);
 });
 await asUser(mechanic,async()=>{
  assert.equal((await db.query('select count(*)::int n from stock_alert_matches')).rows[0].n,0,'sem acesso aos contactos');
 });
 await asUser(admin,async()=>{
  assert.equal((await db.query('update customer_settings set visits_enabled=false returning id')).rows.length,1);
 });
 assert.equal((await db.query('select visit_status from leads where id=$1',[visit])).rows[0].visit_status,'confirmed');
 await db.query('delete from leads where id = any($1)',[[visit,alert]]);
 assert.equal((await db.query('select count(*)::int n from stock_alert_matches where lead_id=$1',[alert])).rows[0].n,0,'apagar o contacto apaga as correspondências');
});

await db.close();
