// Avisos por WhatsApp aos colaboradores, de ponta a ponta: a base de dados a
// sério (PGlite, com todas as migrações) agenda os avisos, o código envia-os a
// uma Meta simulada.
//
// O que isto prova: que cada aviso sai no modelo certo, com as variáveis certas
// e no idioma certo; que uma falha do WhatsApp não impede o contacto de ficar
// gravado e que o aviso sai na volta seguinte; que nada chega duas vezes — nem
// depois de uma falha, nem depois de um envio sem resposta; e que o catálogo do
// código, o da base de dados e a documentação dos modelos dizem o mesmo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';
const require=createRequire(import.meta.url);

// ---- Meta simulada ----------------------------------------------------------
const TOKEN='EAAG-token-da-empresa';
const meta={sent:[],fail:null};
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;
 const body=raw?JSON.parse(raw):null;
 const url=new URL(req.url,'http://x');
 const send=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
 if(req.headers.authorization!==`Bearer ${TOKEN}`)return send(401,{error:{message:'Invalid OAuth access token.',code:190}});
 const m=url.pathname.match(/^\/v25\.0\/(\d+)\/messages$/);
 if(!m||req.method!=='POST')return send(404,{error:{message:'not simulated'}});
 const failure=meta.fail?.(body);
 if(failure)return send(failure.status,{error:failure.error});
 meta.sent.push({id:m[1],...body});
 return send(200,{messaging_product:'whatsapp',contacts:[{input:body.to,wa_id:body.to}],messages:[{id:`wamid.${meta.sent.length}`}]});
});
await new Promise(r=>server.listen(0,r));
process.env.WHATSAPP_GRAPH_BASE_URL=`http://127.0.0.1:${server.address().port}`;
for(const v of ['WHATSAPP_GRAPH_VERSION','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_ACCESS_TOKEN','WHATSAPP_TEMPLATE_LANGUAGE',
 'WHATSAPP_TEMPLATE_LEAD','WHATSAPP_TEMPLATE_VIATURA','WHATSAPP_TEMPLATE_TESTEMUNHO','WHATSAPP_TEMPLATE_AVISO'])delete process.env[v];

// ---- Carregador, com `server-only` neutralizado ----------------------------
const cache=new Map();
function withExt(base){for(const ext of ['.ts','.tsx','/index.ts'])if(existsSync(base+ext))return base+ext;throw new Error(`não resolvido: ${base}`);}
function load(path){
 if(cache.has(path))return cache.get(path);
 const {outputText}=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const mod={exports:{}};cache.set(path,mod.exports);
 const r=(id)=>id==='server-only'?{}:id.startsWith('@/')?load(withExt(`src/${id.slice(2)}`)):id.startsWith('.')?load(withExt(new URL(id,new URL(path,'file:///')).pathname.slice(1))):require(id);
 new Function('module','exports','require',outputText)(mod,mod.exports,r);
 cache.set(path,mod.exports);return mod.exports;}
const {NOTIFICATION_EVENTS,buildNotification,templateParam}=load('src/lib/notification-events.ts');
const {NOTIFICATION_TEMPLATES,sendWhatsAppTemplate,templateName}=load('src/lib/whatsapp/send-template.ts');
const {processWhatsAppNotifications}=load('src/lib/notifications.ts');

// ---- Base de dados a sério, com todas as migrações --------------------------
const pg=new PGlite();
await pg.exec(`
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
for(const file of (await readdir('supabase/migrations')).sort())
 await pg.exec((await readFile(`supabase/migrations/${file}`,'utf8')).replace('create extension if not exists "pgcrypto";',''));

/**
 * O pedaço do supabase-js que o envio usa, sobre o PGlite, com o papel do
 * servidor (service_role): se uma função não estiver concedida a esse papel, o
 * teste falha como falharia em produção.
 */
const asServer=(sql,params)=>pg.transaction(async tx=>{await tx.exec('set local role service_role');return tx.query(sql,params);});
const wrap=async(fn)=>{try{return {data:await fn(),error:null};}catch(e){return {data:null,error:{message:e.message,code:e.code}};}};
const adapter={
 from(table){
  const filters=[];let columns='*';let inFilter=null;
  const api={
   select(c){columns=c;return api;},
   eq(c,v){filters.push([c,v]);return api;},
   in(c,vs){inFilter=[c,vs];return api;},
   then(ok,fail){return wrap(async()=>(await asServer(`select ${columns} from public.${table} where ${inFilter[0]}=any($1::uuid[])`,[inFilter[1]])).rows).then(ok,fail);},
   maybeSingle(){return wrap(async()=>{
    const where=filters.map(([c],i)=>`${c}=$${i+1}`).join(' and ');
    return (await asServer(`select ${columns} from public.${table}${where?` where ${where}`:''} limit 1`,filters.map(f=>f[1]))).rows[0]??null;
   });},
  };
  return api;
 },
 rpc(name,args={}){
  const keys=Object.keys(args);
  return wrap(async()=>(await asServer(`select * from public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')})`,keys.map(k=>args[k]))).rows);
 },
};

const admin='00000000-0000-4000-8000-000000000001';
const vendedor='00000000-0000-4000-8000-000000000002';
const mecanico='00000000-0000-4000-8000-000000000003';
const soMotas='00000000-0000-4000-8000-000000000005';
for(const [id,role,phone]of[[admin,'admin','912000001'],[vendedor,'vendedor','912 000 002'],[mecanico,'mecanico','912000003'],[soMotas,'vendedor','912000005']]){
 await pg.query('insert into auth.users(id,email) values($1,$2)',[id,`${role}@example.test`]);
 await pg.query('insert into public.profiles(id,role,phone) values($1,$2,$3)',[id,role,phone]);
}
await pg.query("update profiles set allowed_vehicle_types=array['motorcycle'] where id=$1",[soMotas]);
await pg.query("insert into whatsapp_connection(waba_id,phone_number_id,access_token) values('111','222',$1)",[TOKEN]);
await pg.query('update notification_settings set whatsapp_enabled=true');

const SITE='https://stand.example.pt';
const run=(options={})=>processWhatsAppNotifications(adapter,{...options});
/** Um contacto do site, gravado como o servidor o grava. */
const newLead=async(fields)=>(await pg.query(
 `insert into leads(name,email,kind,vehicle_type,car_label,car_details,phone,message) values($1,'cliente@example.test',$2,$3,$4,$5,$6,$7) returning id`,
 [fields.name??'Maria Silva',fields.kind??'contact',fields.vtype??'car',fields.car_label??null,fields.details??{},fields.phone??null,fields.message??null])).rows[0].id;
const jobsOf=async(subject)=>(await pg.query("select * from notification_jobs where channel='whatsapp' and subject_id=$1 order by recipient_id",[subject])).rows;
const dueNow=()=>pg.query("update notification_jobs set next_attempt_at=now() where channel='whatsapp' and delivered_at is null");

// ---- Catálogo e modelos -----------------------------------------------------

await test('every notice has the same section in the code and in the database',async()=>{
 // A definição em vigor é a da última migração que a escreve (0036, depois 0041…).
 let sql='';
 for(const file of (await readdir('supabase/migrations')).sort()){
  const text=await readFile(`supabase/migrations/${file}`,'utf8');
  if(/function public\.notification_event_section/.test(text))sql=text;
 }
 const body=sql.match(/function public\.notification_event_section[\s\S]*?\$\$;/)[0];
 const naBase=Object.fromEntries([...body.matchAll(/when '([a-z_]+)'\s+then '([a-z-]+)'/g)].map(m=>[m[1],m[2]]));
 const noCodigo=Object.fromEntries(NOTIFICATION_EVENTS.map(e=>[e.key,e.section]));
 assert.deepEqual(noCodigo,naBase);
 for(const e of NOTIFICATION_EVENTS)
  assert.equal((await pg.query('select public.notification_event_section($1) s',[e.key])).rows[0].s,e.section,e.key);
 // E o valor por defeito (ligado ou desligado para quem nunca escolheu) também.
 for(const e of NOTIFICATION_EVENTS)
  assert.equal((await pg.query('select public.notification_event_default($1) d',[e.key])).rows[0].d,e.defaultOn,e.key);
});

await test('each notice fills its template with exactly the variables the template has',()=>{
 const payload={kind:'offer',name:'Maria',car_label:'BMW 320d',offer_amount:18500,make:'Honda',model:'PCX',plate:'AA-00-BB',
  rating:5,expires_at:'2026-12-12T10:00:00Z',deposit:500,lead_id:'3f2a9c1e-5b7d-4e8a-9c2f-1a2b3c4d5e6f'};
 for(const e of NOTIFICATION_EVENTS){
  const msg=buildNotification(e.key,'7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f',payload);
  assert.ok(msg,e.key);assert.equal(msg.family,e.family,e.key);
  const placeholders=[...NOTIFICATION_TEMPLATES[msg.family].body.matchAll(/\{\{(\d+)\}\}/g)].map(m=>Number(m[1]));
  assert.deepEqual(placeholders,placeholders.map((_,i)=>i+1),'variáveis seguidas, a começar em 1');
  assert.equal(msg.params.length,placeholders.length,e.key);
  for(const p of msg.params){
   assert.ok(p.length>0,e.key);
   assert.doesNotMatch(p,/[\n\t]| {5}/,'a Meta recusa estas variáveis');
  }
  assert.doesNotMatch(msg.params.join(' '),/https?:\/\//,'nenhum aviso leva links');
 }
 assert.equal(buildNotification('aviso_que_nao_existe','x',{}),null);
 // A Meta recusa modelos que comecem ou acabem numa variável.
 for(const t of Object.values(NOTIFICATION_TEMPLATES)){
  assert.doesNotMatch(t.body,/^\{\{|\}\}$/);
  assert.equal(t.example.length,[...t.body.matchAll(/\{\{\d+\}\}/g)].length,t.name);
 }
});

await test('text from a public form cannot break a template',()=>{
 assert.equal(templateParam('  Maria\n\nSilva\t  '),'Maria Silva');
 assert.equal(templateParam('a      b'),'a b');
 assert.equal(templateParam(''),'—');assert.equal(templateParam(null),'—');
 const longo=templateParam('x'.repeat(500),60);
 assert.equal(longo.length,60);assert.ok(longo.endsWith('…'));
});

await test('the documentation shows every template exactly as the code sends it',async()=>{
 const doc=(await readFile('docs/WHATSAPP_TEMPLATES.md','utf8')).replace(/\r\n/g,'\n');
 assert.match(doc,/pt_PT/);assert.match(doc,/Utility/i);
 for(const t of Object.values(NOTIFICATION_TEMPLATES)){
  assert.ok(doc.includes(t.name),t.name);
  assert.ok(doc.includes(t.env),t.env);
  assert.ok(doc.includes(t.body),`o texto de ${t.name} na documentação é o mesmo do código`);
  for(const v of t.example)assert.ok(doc.includes(v),`exemplo de ${t.name}: ${v}`);
 }
});

// ---- Envio de um modelo -----------------------------------------------------

const numero={phoneNumberId:'222',accessToken:TOKEN,source:'backoffice'};

await test('a template goes out with the right name, language and variables',async()=>{
 meta.sent.length=0;meta.fail=null;
 const r=await sendWhatsAppTemplate('351912000001',{name:'engineline_lead',language:'pt_PT',params:['proposta de preço','Maria','BMW']},numero);
 assert.deepEqual(r,{ok:true,messageId:'wamid.1'});
 assert.deepEqual(meta.sent,[{id:'222',messaging_product:'whatsapp',recipient_type:'individual',to:'351912000001',type:'template',
  template:{name:'engineline_lead',language:{code:'pt_PT'},components:[{type:'body',parameters:[
   {type:'text',text:'proposta de preço'},{type:'text',text:'Maria'},{type:'text',text:'BMW'}]}]}}]);
 // Sem número válido ou sem token, nem se tenta.
 assert.equal((await sendWhatsAppTemplate('91234',{name:'engineline_lead',language:'pt_PT',params:[]},numero)).permanent,true);
 assert.equal((await sendWhatsAppTemplate('351912000001',{name:'engineline_lead',language:'pt_PT',params:[]},{...numero,accessToken:null})).ok,false);
 assert.equal((await sendWhatsAppTemplate('351912000001',{name:'../me',language:'pt_PT',params:[]},numero)).ok,false);
 assert.equal(meta.sent.length,1);
});

await test('a refused template says why in Meta\'s words, never with the token',async()=>{
 meta.fail=()=>({status:404,error:{message:'Template name does not exist in the translation',code:132001,error_data:{details:'template name (engineline_lead) does not exist in pt_PT'}}});
 const r=await sendWhatsAppTemplate('351912000001',{name:'engineline_lead',language:'pt_PT',params:['a']},numero);
 assert.equal(r.ok,false);assert.equal(r.permanent,true);
 assert.equal(r.error,'HTTP 404 — (#132001) Template name does not exist in the translation template name (engineline_lead) does not exist in pt_PT');
 assert.doesNotMatch(r.error,new RegExp(TOKEN));
 // Um erro passageiro da Meta volta a ser tentado.
 meta.fail=()=>({status:503,error:{message:'Service temporarily unavailable',code:2}});
 const r2=await sendWhatsAppTemplate('351912000001',{name:'engineline_lead',language:'pt_PT',params:['a']},numero);
 assert.equal(r2.ok,false);assert.equal(r2.permanent,false);assert.equal(r2.uncertain,undefined);
 meta.fail=null;
});

await test('no answer from Meta in time is reported as uncertain, not as a failure',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw new DOMException('The operation timed out.','TimeoutError');};
 try{
  const r=await sendWhatsAppTemplate('351912000001',{name:'engineline_lead',language:'pt_PT',params:['a']},numero);
  assert.equal(r.ok,false);assert.equal(r.uncertain,true);assert.match(r.error,/pode ter chegado/);
 }finally{globalThis.fetch=original;}
});

// ---- De ponta a ponta -------------------------------------------------------

await test('a lead is saved even when WhatsApp fails, and the notice goes out on the next run',async()=>{
 meta.sent.length=0;
 meta.fail=()=>({status:503,error:{message:'Service temporarily unavailable',code:2}});
 const id=await newLead({kind:'offer',car_label:'BMW 320d',details:{offer_amount:18500},phone:'912 345 678',message:'Posso ver a viatura\nno sábado?'});
 const falhou=await run();
 assert.deepEqual({ok:falhou.ok,sent:falhou.sent,failed:falhou.failed},{ok:true,sent:0,failed:2});
 assert.equal((await pg.query('select name from leads where id=$1',[id])).rows[0].name,'Maria Silva','o contacto está gravado');
 for(const job of await jobsOf(id)){
  assert.equal(job.delivered_at,null);assert.equal(job.claimed_at,null);
  assert.equal(job.last_error,'HTTP 503 — (#2) Service temporarily unavailable');
 }
 // A Meta volta; na volta seguinte (já com a nova tentativa vencida) sai.
 meta.fail=null;await dueNow();
 const ok=await run();
 assert.equal(ok.sent,2);
 assert.deepEqual(meta.sent.map(m=>m.to).sort(),['351912000001','351912000002'],'administrador e vendedor; o mecânico não tem Leads e o outro só motas');
 for(const m of meta.sent){
  assert.equal(m.template.name,'engineline_contacto');assert.equal(m.template.language.code,'pt_PT');
  const [o,cliente,telemovel,email,viatura,mensagem]=m.template.components[0].parameters.map(p=>p.text);
  assert.match(o,/^proposta de preço de 18\s500\s€$/u);
  assert.equal(cliente,'Maria Silva');assert.equal(viatura,'BMW 320d');
  assert.equal(telemovel,'912 345 678','o telemóvel do cliente vai no aviso');
  assert.equal(email,'cliente@example.test');
  assert.equal(mensagem,'Posso ver a viatura no sábado?','a mensagem vai numa só linha');
 }
 for(const job of await jobsOf(id)){assert.ok(job.delivered_at);assert.match(job.wa_message_id,/^wamid\./);}
 // E não volta a sair: nem noutra volta, nem se o mesmo acontecimento for agendado outra vez.
 assert.equal((await run()).sent,0);
 assert.equal((await asServer("select public.queue_whatsapp_event('lead_offer',$1,'car','{}'::jsonb,$1) n",[id])).rows[0].n,0);
 assert.equal((await run()).sent,0);
 assert.equal(meta.sent.length,2);
});

await test('each stand can use its own template names',async()=>{
 meta.sent.length=0;
 process.env.WHATSAPP_TEMPLATE_LEAD='stand_novo_pedido';
 try{
  assert.equal(templateName('lead'),'stand_novo_pedido');
  await newLead({kind:'test_drive',vtype:'motorcycle',car_label:'Honda CB500F'});
  assert.equal((await run()).sent,3);
  assert.ok(meta.sent.every(m=>m.template.name==='stand_novo_pedido'));
  assert.ok(meta.sent.every(m=>m.template.components[0].parameters[0].text==='pedido de test drive'));
 }finally{delete process.env.WHATSAPP_TEMPLATE_LEAD;}
});

await test('a template Meta does not know stops at once and waits for the administrator',async()=>{
 meta.sent.length=0;
 meta.fail=()=>({status:404,error:{message:'Template name does not exist in the translation',code:132001}});
 const id=await newLead({kind:'alert'});
 assert.equal((await run()).failed,2);
 for(const job of await jobsOf(id)){assert.equal(job.attempts,8);assert.match(job.last_error,/#132001/);}
 meta.fail=null;await dueNow();
 assert.equal((await run()).sent,0,'não se repete sozinho');
 assert.equal(meta.sent.length,0);
});

await test('a send with no answer from Meta is never repeated automatically',async()=>{
 meta.sent.length=0;
 const id=await newLead({kind:'order',car_label:'Encomenda de viatura'});
 const original=globalThis.fetch;
 globalThis.fetch=async()=>{throw new DOMException('The operation timed out.','TimeoutError');};
 try{assert.equal((await run()).failed,2);}finally{globalThis.fetch=original;}
 for(const job of await jobsOf(id)){assert.ok(job.claimed_at);assert.match(job.last_error,/pode ter chegado/);}
 await dueNow();
 assert.equal((await run()).sent,0);
 assert.equal(meta.sent.length,0,'pode ter chegado: só o administrador decide repetir');
});

await test('publishing many vehicles at once sends one message per person',async()=>{
 meta.sent.length=0;
 const {rows}=await pg.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type) values
  ('lote-1','BMW','320d',2020,'Diesel','Manual','Berlina','published',25000,'car'),
  ('lote-2','Audi','A3',2019,'Diesel','Manual','Berlina','published',21000,'car'),
  ('lote-3','Seat','Leon',2018,'Gasolina','Manual','Berlina','published',14000,'car'),
  ('lote-4','Fiat','500',2017,'Gasolina','Manual','Citadino','published',9000,'car') returning id`);
 const r=await run();
 assert.equal(r.sent,8,'quatro viaturas, duas pessoas');
 assert.equal(meta.sent.length,2,'mas uma mensagem por pessoa');
 for(const m of meta.sent){
  assert.equal(m.template.name,'engineline_novidade');
  const [o,viaturas]=m.template.components[0].parameters.map(p=>p.text);
  assert.equal(o,'4 viaturas publicadas no site');
  assert.match(viaturas,/ e mais 1$/);assert.equal(m.template.components[0].parameters.length,2);
 }
 const jobs=(await pg.query("select delivered_at,wa_message_id from notification_jobs where subject_id = any($1)",[rows.map(x=>x.id)])).rows;
 assert.equal(jobs.length,8);assert.ok(jobs.every(j=>j.delivered_at&&j.wa_message_id));
 // Uma viatura sozinha leva o seu próprio aviso, sem link.
 meta.sent.length=0;
 const [{id}]=(await pg.query(`insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type,doors,license_plate)
  values('sozinha','Honda','PCX',2021,'Gasolina','Automática','Scooter','published',3500,'motorcycle',0,'AA-00-BB') returning id`)).rows;
 assert.equal((await run()).sent,3);
 for(const m of meta.sent)assert.deepEqual(m.template.components[0].parameters.map(p=>p.text),
  ['viatura publicada no site','Honda PCX · AA-00-BB']);
});

await test('switched off, or without a connected number, nothing is sent',async()=>{
 meta.sent.length=0;
 await pg.query('update notification_settings set whatsapp_enabled=false');
 // Desligado, nem se agenda.
 const id=await newLead({kind:'contact'});
 assert.equal((await jobsOf(id)).length,0);
 assert.match((await run()).skipped,/desligados/);
 // Ligado mas sem número: fica na fila, sem tentativas gastas.
 await pg.query('update notification_settings set whatsapp_enabled=true');
 const id2=await newLead({kind:'contact'});
 await pg.query('delete from whatsapp_connection');
 try{
  assert.equal((await run()).skipped,'WhatsApp não configurado.');
  for(const job of await jobsOf(id2)){assert.equal(job.attempts,0);assert.equal(job.delivered_at,null);}
 }finally{await pg.query("insert into whatsapp_connection(waba_id,phone_number_id,access_token) values('111','222',$1)",[TOKEN]);}
 assert.equal(meta.sent.length,0);
 assert.equal((await run()).sent,2,'com o número ligado outra vez, sai');
});

// ---- 0041: mais avisos -------------------------------------------------------

/** Uma ação no backoffice, com a sessão de quem a faz (o autor não é avisado). */
const asStaff=(id,sql,params=[])=>pg.transaction(async tx=>{
 await tx.exec('set local role authenticated');
 await tx.query("select set_config('request.jwt.claim.sub',$1,true)",[id]);
 return tx.query(sql,params);
});
const paramsOf=m=>m.template.components[0].parameters.map(p=>p.text);
/** Envia o que está na fila e esquece as mensagens: o teste só olha para as seguintes. */
const flush=async()=>{await run();meta.sent.length=0;};

await test('a motorbike that leaves the workshop is announced as ready at the stand, every time it leaves',async()=>{
 meta.fail=null;await flush();
 const [{id}]=(await asStaff(mecanico,"select create_workshop_intake_for_type('Honda CB650R','AA-11-BB','motorcycle') id")).rows;
 await flush();
 await asStaff(mecanico,'select mark_vehicle_prepared($1)',[id]);
 assert.equal((await run()).sent,3,'administrador e os dois vendedores (um só de motas); o mecânico fez a ação');
 assert.deepEqual([...new Set(meta.sent.map(m=>m.template.name))],['engineline_novidade']);
 for(const m of meta.sent)assert.deepEqual(paramsOf(m),
  ['a mota Honda CB650R saiu da oficina e está pronta no stand','Honda CB650R · AA-11-BB']);
 // Volta à oficina e sai outra vez: é outra vez novidade.
 meta.sent.length=0;
 await asStaff(admin,'select return_vehicle_to_workshop($1)',[id]);
 await asStaff(mecanico,'select mark_vehicle_prepared($1)',[id]);
 assert.equal((await run()).sent,3);
 assert.equal((await run()).sent,0,'e uma vez só');
});

await test('a lead assigned to someone reaches them even with new-lead notices switched off',async()=>{
 await flush();
 await pg.query("insert into notification_preferences(profile_id,event,enabled) values($1,'lead_contact',false)",[vendedor]);
 try{
  const id=await newLead({kind:'contact',name:'João Cliente',car_label:'BMW 320d'});
  assert.deepEqual((await jobsOf(id)).map(j=>j.recipient_id),[admin],'o vendedor desligou os contactos novos');
  await flush();
  await asStaff(admin,'update leads set assigned_to=$2 where id=$1',[id,vendedor]);
  assert.equal((await run()).sent,1);
  const [m]=meta.sent;
  assert.equal(m.to,'351912000002');assert.equal(m.template.name,'engineline_contacto');
  assert.deepEqual(paramsOf(m),['contacto atribuído a si (pedido de contacto)','João Cliente','não indicado','cliente@example.test','BMW 320d','sem mensagem']);
  // Dado como perdido por outra pessoa: o responsável fica a saber porquê.
  meta.sent.length=0;
  await asStaff(admin,"update leads set status='lost',loss_reason='Comprou noutro stand' where id=$1",[id]);
  assert.equal((await run()).sent,1);
  assert.deepEqual(paramsOf(meta.sent[0]),
   ['o contacto de João Cliente, atribuído a si, foi dado como perdido (motivo: Comprou noutro stand)','BMW 320d']);
 }finally{await pg.query('delete from notification_preferences where profile_id=$1',[vendedor]);}
});

await test('a sale and a cancelled reservation reach the sales team; a price change only who asked for it',async()=>{
 await flush();
 const [{id:car}]=(await pg.query("insert into cars(slug,make,model,year,fuel,transmission,body,status,price,vehicle_type,license_plate) values('venda-0041','Audi','A3',2019,'Diesel','Manual','Berlina','published',21000,'car','CC-44-DD') returning id")).rows;
 const cliente=await newLead({kind:'contact',name:'Ana Reserva'});
 await pg.query('update leads set car_id=$2 where id=$1',[cliente,car]);
 await flush();
 // Reserva feita e cancelada pelo administrador: o vendedor volta a poder oferecê-la.
 const [{id:reserva}]=(await asStaff(admin,"select reserve_vehicle($1,now()+interval '3 days',500) id",[cliente])).rows;
 await flush();
 await asStaff(admin,'select release_reservation($1)',[reserva]);
 assert.equal((await run()).sent,1);
 assert.deepEqual(paramsOf(meta.sent[0]),['reserva de Ana Reserva cancelada; a viatura voltou a estar disponível','Audi A3 · CC-44-DD']);
 // O preço vem desligado por defeito: só quem o ligou recebe.
 meta.sent.length=0;
 await pg.query("insert into notification_preferences(profile_id,event,enabled) values($1,'vehicle_price_changed',true)",[vendedor]);
 try{
  await asStaff(admin,'update cars set price=19900 where id=$1',[car]);
  assert.equal((await run()).sent,1);
  assert.equal(meta.sent[0].to,'351912000002');
  assert.match(paramsOf(meta.sent[0])[0],/^preço alterado de 21\s000\s€ para 19\s900\s€$/u);
 }finally{await pg.query('delete from notification_preferences where profile_id=$1',[vendedor]);}
 // Vendida.
 meta.sent.length=0;
 await asStaff(admin,"update cars set status='sold' where id=$1",[car]);
 assert.equal((await run()).sent,1);
 assert.deepEqual(paramsOf(meta.sent[0]),['viatura vendida, já não está disponível','Audi A3 · CC-44-DD']);
});

await test('leave: the request reaches who decides, the decision the requester, the week before the whole team',async()=>{
 await flush();
 await pg.query("update profiles set full_name='Rita Vendedora' where id=$1",[vendedor]);
 await pg.query("update profiles set full_name='Ana Admin' where id=$1",[admin]);
 // Segunda a quarta (2 a 4 de dezembro de 2030), pedidos pela vendedora.
 await asStaff(vendedor,"insert into leave_days(profile_id,day,status) values ($1,'2030-12-02','pending'),($1,'2030-12-03','pending'),($1,'2030-12-04','pending')",[vendedor]);
 assert.equal((await run()).sent,1,'só o administrador decide as férias de um vendedor');
 assert.equal(meta.sent[0].to,'351912000001');assert.equal(meta.sent[0].template.name,'engineline_aviso_geral');
 assert.deepEqual(paramsOf(meta.sent[0]),['Rita Vendedora pediu férias de 2 a 4 de dezembro (3 dias) e aguarda a sua decisão']);
 meta.sent.length=0;
 await asStaff(admin,"update leave_days set status='approved',decided_by=$2,decided_at=now() where profile_id=$1 and status='pending'",[vendedor,admin]);
 assert.equal((await run()).sent,1);
 assert.equal(meta.sent[0].to,'351912000002');
 assert.deepEqual(paramsOf(meta.sent[0]),['o seu pedido de férias de 2 a 4 de dezembro (3 dias) foi aprovado por Ana Admin']);
 // Na semana anterior, às 10h de Lisboa, a equipa fica a saber — uma vez.
 meta.sent.length=0;
 const upcoming=async(at)=>(await asServer('select public.queue_whatsapp_leave_upcoming($1) n',[at])).rows[0].n;
 assert.equal(await upcoming('2030-11-27T10:00:00Z'),3);
 assert.equal(await upcoming('2030-11-28T10:00:00Z'),0,'uma vez por período');
 assert.equal((await run()).sent,3);
 assert.deepEqual(meta.sent.map(m=>m.to).sort(),['351912000001','351912000003','351912000005'],'todos menos a própria');
 for(const m of meta.sent)assert.deepEqual(paramsOf(m),['Rita Vendedora vai estar de férias de 2 a 4 de dezembro (3 dias)']);
});

server.close();
await pg.close();
