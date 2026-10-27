// O pedido de visita pelo WhatsApp, de ponta a ponta no código (a base de dados
// de SQL está em visit-confirm-sql.test.mjs): o JSON dos botões que a Meta
// entrega, o modelo com botões que sai, o texto com a hora em Lisboa, o que o
// vendedor e o cliente recebem ao carregar, e os modelos novos.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);

// ---- Meta simulada ----------------------------------------------------------
const TOKEN='EAAG-token-da-empresa';
const meta={sent:[]};
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;
 const body=raw?JSON.parse(raw):null;
 meta.sent.push({url:req.url,...body});
 res.writeHead(200,{'Content-Type':'application/json'});
 res.end(JSON.stringify({messaging_product:'whatsapp',messages:[{id:`wamid.${meta.sent.length}`}]}));
});
await new Promise(r=>server.listen(0,r));
process.env.WHATSAPP_GRAPH_BASE_URL=`http://127.0.0.1:${server.address().port}`;
for(const v of ['WHATSAPP_GRAPH_VERSION','WHATSAPP_PHONE_NUMBER_ID','WHATSAPP_ACCESS_TOKEN','WHATSAPP_TEMPLATE_LANGUAGE',
 'WHATSAPP_TEMPLATE_VISITA','WHATSAPP_TEMPLATE_VISITA_EQUIPA','WHATSAPP_TEMPLATE_VISITA_CANCELADA','WHATSAPP_TEMPLATE_VISITA_PEDIDO'])delete process.env[v];

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
const {extractMessages}=load('src/lib/whatsapp/payload.ts');
const {NOTIFICATION_TEMPLATES,sendWhatsAppTemplate}=load('src/lib/whatsapp/send-template.ts');
const {CUSTOMER_TEMPLATES}=load('src/lib/customer-templates.ts');
const {buildNotification}=load('src/lib/notification-events.ts');
const {handleVisitButton,VISIT_BUTTON_FALLBACK}=load('src/lib/whatsapp/visit-button.ts');
const {planDeliveries}=load('src/lib/notifications.ts');

const ID='3f2a9c1e-5b7d-4e8a-9c2f-1a2b3c4d5e6f';

// ---- (a) O que a Meta entrega ----------------------------------------------
const envelope=(message)=>({object:'whatsapp_business_account',entry:[{id:'1',changes:[{field:'messages',value:{
 messaging_product:'whatsapp',metadata:{display_phone_number:'351210000000',phone_number_id:'222'},
 contacts:[{profile:{name:'Rui Vendedor'},wa_id:'351912000001'}],messages:[message]}}]}]});

await test('a quick-reply button of a template is read with its payload and the message it answers',()=>{
 const [m]=extractMessages(envelope({context:{from:'351210000000',id:'wamid.AVISO'},from:'351912000001',id:'wamid.BTN1',timestamp:'1',
  type:'button',button:{payload:`visit:ok:${ID}`,text:'Confirmar visita'}}));
 assert.equal(m.type,'button');assert.equal(m.wamId,'wamid.BTN1');assert.equal(m.phoneNumberId,'222');
 assert.deepEqual(m.button,{payload:`visit:ok:${ID}`,text:'Confirmar visita'});
 assert.equal(m.contextId,'wamid.AVISO');assert.equal(m.text,'');
});

await test('an interactive button_reply is read the same way',()=>{
 const [m]=extractMessages(envelope({context:{from:'351210000000',id:'wamid.AVISO'},from:'351912000001',id:'wamid.BTN2',timestamp:'1',
  type:'interactive',interactive:{type:'button_reply',button_reply:{id:`visit:no:${ID}`,title:'Não posso nessa hora'}}}));
 assert.equal(m.type,'interactive');
 assert.deepEqual(m.button,{payload:`visit:no:${ID}`,text:'Não posso nessa hora'});
 assert.equal(m.contextId,'wamid.AVISO');
});

await test('messages without a button carry no button and no context',()=>{
 const [t]=extractMessages(envelope({from:'351912000001',id:'wamid.T',type:'text',text:{body:'olá'}}));
 assert.equal(t.button,undefined);assert.equal(t.contextId,undefined);assert.equal(t.text,'olá');
 const [b]=extractMessages(envelope({from:'351912000001',id:'wamid.B',type:'button',button:{text:'sem payload'}}));
 assert.equal(b.button,undefined);
 const [i]=extractMessages(envelope({from:'351912000001',id:'wamid.I',type:'interactive',interactive:{type:'list_reply',list_reply:{id:'x',title:'y'}}}));
 assert.equal(i.button,undefined);
});

// ---- (b) O modelo com botões -------------------------------------------------
const numero={phoneNumberId:'222',accessToken:TOKEN,source:'backoffice'};

await test('a template with buttons goes out with one quick_reply component per button',async()=>{
 meta.sent.length=0;
 const r=await sendWhatsAppTemplate('351912000001',{name:'engineline_visita_equipa',language:'pt_PT',params:['a','b','c','d','e'],
  buttons:[{payload:`visit:ok:${ID}`},{payload:`visit:no:${ID}`}]},numero);
 assert.equal(r.ok,true);
 assert.deepEqual(meta.sent[0].template.components,[
  {type:'body',parameters:['a','b','c','d','e'].map(text=>({type:'text',text}))},
  {type:'button',sub_type:'quick_reply',index:'0',parameters:[{type:'payload',payload:`visit:ok:${ID}`}]},
  {type:'button',sub_type:'quick_reply',index:'1',parameters:[{type:'payload',payload:`visit:no:${ID}`}]},
 ]);
});

await test('an invalid button payload is refused before anything is sent',async()=>{
 meta.sent.length=0;
 for(const payload of ['visit ok','visit:ok:ñ','x'.repeat(257),'']){
  const r=await sendWhatsAppTemplate('351912000001',{name:'engineline_visita_equipa',language:'pt_PT',params:['a'],buttons:[{payload}]},numero);
  assert.equal(r.ok,false,JSON.stringify(payload));assert.equal(r.permanent,true);
 }
 assert.equal(meta.sent.length,0);
 // Sem botões, o corpo sai como sempre.
 const sem=await sendWhatsAppTemplate('351912000001',{name:'engineline_aviso_geral',language:'pt_PT',params:['x']},numero);
 assert.equal(sem.ok,true);assert.equal(meta.sent[0].template.components.length,1);
});

// ---- (c) O aviso da visita ---------------------------------------------------
await test('the visit notice carries the date and the hour in Lisbon time (summer and winter)',()=>{
 const base={lead_id:ID,name:'Maria Silva',phone:'+351 912 345 678',car_label:'Honda CB500F 2021',message:'Ao fim da tarde.',kind:'visit'};
 // 27 de outubro de 2026: já é hora de inverno (UTC+0). 10:30 UTC = 10:30 em Lisboa.
 const winter=buildNotification('lead_visit',ID,{...base,visit_at:'2026-10-27T10:30:00Z'});
 assert.equal(winter.family,'visita_equipa');
 assert.equal(winter.params[0],'terça-feira, 27 de outubro, às 10:30');
 assert.deepEqual(winter.params.slice(1),['Maria Silva','+351 912 345 678','Honda CB500F 2021','Ao fim da tarde.']);
 // Em julho Lisboa está em UTC+1: 09:30 UTC são 10:30.
 const summer=buildNotification('lead_visit',ID,{...base,visit_at:'2026-07-14T09:30:00Z'});
 assert.equal(summer.params[0],'terça-feira, 14 de julho, às 10:30');
 // Sem a hora, vai pelo menos o dia pedido.
 const semHora=buildNotification('lead_visit',ID,{...base,preferred_date:'2026-10-27'});
 assert.match(semHora.params[0],/27\/10\/2026/);
 // A família nova não é a do «Responda ao cliente…».
 assert.doesNotMatch(NOTIFICATION_TEMPLATES[winter.family].body,/Responda ao cliente/);
 assert.match(NOTIFICATION_TEMPLATES[winter.family].body,/Pode receber esta visita/);
 assert.equal(winter.params.length,[...NOTIFICATION_TEMPLATES.visita_equipa.body.matchAll(/\{\{\d+\}\}/g)].length);
 for(const p of winter.params)assert.doesNotMatch(p,/[\n\t]| {5}/);
});

await test('an old visit notice still queued as a contact request also shows the hour',()=>{
 const msg=buildNotification('lead_contact',ID,{kind:'visit',name:'Maria',visit_at:'2026-10-27T10:30:00Z',preferred_date:'2026-10-27'});
 assert.equal(msg.family,'lead');
 assert.match(msg.params[0],/pedido de visita ao stand para terça-feira, 27 de outubro, às 10:30/);
});

await test('visit notices are never grouped and carry the buttons of their own contact',()=>{
 const job=(i,details)=>({job_id:`j${i}`,to_phone:'351912000001',event_kind:'lead_visit',subject:ID,details});
 const jobs=[1,2,3,4].map(i=>job(i,{lead_id:`3f2a9c1e-5b7d-4e8a-9c2f-1a2b3c4d5e6${i}`,name:`C${i}`,visit_at:'2026-10-27T10:30:00Z'}));
 const plan=planDeliveries(jobs);
 assert.equal(plan.length,4);
 for(const [i,d] of plan.entries()){
  assert.equal(d.jobs.length,1);assert.equal(d.message.family,'visita_equipa');
  assert.deepEqual(d.buttons,[{payload:`visit:ok:3f2a9c1e-5b7d-4e8a-9c2f-1a2b3c4d5e6${i+1}`},{payload:`visit:no:3f2a9c1e-5b7d-4e8a-9c2f-1a2b3c4d5e6${i+1}`}]);
 }
 // Sem identificação do contacto os botões não funcionariam: não se envia.
 const [semId]=planDeliveries([job(9,{name:'X'})]);
 assert.ok(semId.skip);assert.equal(semId.buttons,undefined);
});

// ---- (d) O que acontece quando o vendedor carrega -----------------------------
/** O pedaço do supabase-js que o tratamento usa, com a resposta da função escolhida. */
function fakeDb({outcome,lead,rpcError}){
 const calls={rpc:[],updates:[],inserts:[],reads:0};
 const db={
  rpc:async(name,args)=>{calls.rpc.push({name,args});return rpcError?{data:null,error:{message:rpcError}}:{data:outcome,error:null};},
  from:(table)=>({
   select:()=>({eq:()=>({maybeSingle:async()=>{calls.reads++;return {data:table==='leads'?lead:null,error:null};}})}),
   update:(patch)=>({eq:async()=>{calls.updates.push({table,patch});return {error:null};}}),
   insert:async(row)=>{calls.inserts.push({table,row});return {error:null};},
  }),
 };
 return {db,calls};
}
const LEAD={id:ID,name:'Maria Silva',phone:'+351 912 345 678',car_label:'Honda CB500F 2021',car_details:{whatsapp_opt_in_at:'2026-10-20T10:00:00Z'},visit_at:'2026-10-27T10:30:00Z'};
function fakeDeps(result){
 const sent=[];
 return {sent,deps:{sendToCustomer:async(_db,kind,lead)=>{sent.push({kind,lead});return result;}}};
}
const NOW=new Date('2026-10-26T09:00:00Z');
const press=(db,which,deps,payload)=>handleVisitButton({db,actorId:'actor-1',phone:'351912000001',payload:payload??`visit:${which}:${ID}`,now:NOW,deps});

await test('confirm: the customer gets the confirmation and the salesperson is told it was sent',async()=>{
 const {db,calls}=fakeDb({outcome:'confirmed',lead:LEAD});
 const {sent,deps}=fakeDeps({ok:true,messageId:'wamid.9'});
 const reply=await press(db,'ok',deps);
 assert.deepEqual(calls.rpc,[{name:'wa_set_visit',args:{actor:'actor-1',lead:ID,outcome:'confirm'}}]);
 assert.deepEqual(sent.map(s=>s.kind),['visita']);
 assert.equal(reply,'Visita de Maria confirmada para terça-feira, 27 de outubro, às 10:30. Enviei-lhe a confirmação por WhatsApp.');
 const upd=calls.updates.find(u=>u.table==='leads');
 assert.equal(upd.patch.car_details.visit_message_sent_at,NOW.toISOString());
 assert.equal(upd.patch.car_details.visit_message_error,null);
 assert.equal(upd.patch.car_details.whatsapp_opt_in_at,'2026-10-20T10:00:00Z','o resto dos detalhes mantém-se');
});

await test('confirm without automatic messages: the salesperson is asked to tell the customer',async()=>{
 const {db,calls}=fakeDb({outcome:'confirmed',lead:LEAD});
 const {deps}=fakeDeps(null);
 const reply=await press(db,'ok',deps);
 assert.match(reply,/^Visita de Maria confirmada para terça-feira, 27 de outubro, às 10:30\./);
 assert.match(reply,/O cliente não tem mensagens automáticas ligadas: avise-o por telefone ou WhatsApp\.$/);
 assert.equal(calls.updates.find(u=>u.table==='leads').patch.car_details.visit_message_sent_at,undefined);
});

await test('confirm when the send to the customer fails: the error is recorded, the reply does not lie',async()=>{
 const {db,calls}=fakeDb({outcome:'confirmed',lead:LEAD});
 const {deps}=fakeDeps({ok:false,error:'HTTP 400 — (#132001) Template name does not exist'});
 const reply=await press(db,'ok',deps);
 assert.doesNotMatch(reply,/Enviei-lhe/);
 assert.match(calls.updates.find(u=>u.table==='leads').patch.car_details.visit_message_error,/132001/);
});

await test('decline: the customer is asked to arrange another hour (template visita_cancelada)',async()=>{
 const {db,calls}=fakeDb({outcome:'declined',lead:LEAD});
 const {sent,deps}=fakeDeps({ok:true});
 const reply=await press(db,'no',deps);
 assert.equal(calls.rpc[0].args.outcome,'decline');
 assert.deepEqual(sent.map(s=>s.kind),['visita_cancelada']);
 assert.equal(reply,'Visita de Maria recusada. Combine outra hora com o cliente (+351 912 345 678).');
});

await test('already handled, past or unknown: clear answer and nothing is sent to the customer',async()=>{
 const esperado={
  already_confirmed:/já estava confirmada/,already_declined:/já tinha sido recusada/,already_handled:/já foi tratado/,
  past:/já passou/,not_found:/Não encontrei/,
 };
 for(const [outcome,re] of Object.entries(esperado)){
  const {db,calls}=fakeDb({outcome,lead:LEAD});
  const {sent,deps}=fakeDeps({ok:true});
  const reply=await press(db,outcome==='already_declined'?'no':'ok',deps);
  assert.match(reply,re,outcome);assert.equal(sent.length,0,outcome);
  assert.equal(calls.updates.length,0,outcome);
 }
});

await test('an invalid payload is answered with an error and never touches the database',async()=>{
 for(const payload of ['visit:ok:','visit:ok:não-é-um-uuid','visit:maybe:'+ID,'visit:ok:'+ID+'x','visit:ok:'+ID.toUpperCase(),'visit:teste:0']){
  const {db,calls}=fakeDb({outcome:'confirmed',lead:LEAD});
  const {sent,deps}=fakeDeps({ok:true});
  const reply=await press(db,'ok',deps,payload);
  assert.equal(reply,VISIT_BUTTON_FALLBACK,payload);
  assert.equal(calls.rpc.length+calls.reads+calls.updates.length,0,payload);assert.equal(sent.length,0);
 }
});

await test('it never throws: a database error or an unexpected answer gives the generic reply',async()=>{
 const falha=fakeDb({rpcError:'boom',lead:LEAD});
 assert.equal(await press(falha.db,'ok',fakeDeps(null).deps),VISIT_BUTTON_FALLBACK);
 const estranho=fakeDb({outcome:'qualquer_coisa',lead:LEAD});
 assert.equal(await press(estranho.db,'ok',fakeDeps(null).deps),VISIT_BUTTON_FALLBACK);
 const rebenta={rpc:async()=>{throw new Error('rede');},from:()=>{throw new Error('rede');}};
 assert.equal(await press(rebenta,'ok',fakeDeps(null).deps),VISIT_BUTTON_FALLBACK);
 // Uma falha ao escrever ao cliente não impede a resposta ao vendedor.
 const {db}=fakeDb({outcome:'confirmed',lead:LEAD});
 const reply=await press(db,'ok',{sendToCustomer:async()=>{throw new Error('Meta em baixo');}});
 assert.match(reply,/^Visita de Maria confirmada/);
});

// ---- A mensagem ao cliente, de verdade, contra a Meta simulada ------------------
const {sendVisitTemplate}=load('src/lib/visit-run.ts');
function settingsDb({customerWhatsApp=true}={}){
 const rows={
  customer_settings:{visits_enabled:true,visit_schedule:null,customer_whatsapp:customerWhatsApp},
  whatsapp_connection:{phone_number_id:'222',access_token:TOKEN},
 };
 return {from:(t)=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:rows[t]??null,error:null})})})})};
}
const CTX={companyName:'Supermotas',address:'Av. da Liberdade 100, 1250-096 Lisboa'};

await test('the customer templates go out in the right model, with the right variables, and only with consent',async()=>{
 meta.sent.length=0;
 await sendVisitTemplate(settingsDb(),'visita_cancelada',LEAD,CTX);
 await sendVisitTemplate(settingsDb(),'visita_pedido',LEAD,CTX);
 await sendVisitTemplate(settingsDb(),'visita',LEAD,CTX);
 const quando='terça-feira, 27 de outubro, às 10:30';
 const [cancelada,pedido,confirmada]=meta.sent.map(s=>({name:s.template.name,params:s.template.components[0].parameters.map(p=>p.text),to:s.to}));
 assert.deepEqual(cancelada,{name:'engineline_visita_cancelada',params:['Maria','Supermotas',quando],to:'351912345678'});
 assert.deepEqual(pedido,{name:'engineline_visita_pedido',params:['Maria','Supermotas',quando],to:'351912345678'});
 assert.equal(confirmada.name,'engineline_visita');assert.equal(confirmada.params.length,5);
 // Sem opt-in, com as mensagens desligadas ou sem hora: nem se tenta.
 meta.sent.length=0;
 assert.equal(await sendVisitTemplate(settingsDb(),'visita_pedido',{...LEAD,car_details:{}},CTX),null);
 assert.equal(await sendVisitTemplate(settingsDb({customerWhatsApp:false}),'visita_pedido',LEAD,CTX),null);
 assert.equal(await sendVisitTemplate(settingsDb(),'visita_pedido',{...LEAD,visit_at:null},CTX),null);
 assert.equal(meta.sent.length,0);
});

// ---- (e) Os modelos novos ------------------------------------------------------
await test('the new templates are well formed for Meta: matching variables and examples, no variable at the edges',()=>{
 const defs=[NOTIFICATION_TEMPLATES.visita_equipa,CUSTOMER_TEMPLATES.visita_cancelada,CUSTOMER_TEMPLATES.visita_pedido];
 for(const t of defs){
  const vars=[...t.body.matchAll(/\{\{(\d+)\}\}/g)].map(m=>Number(m[1]));
  assert.deepEqual(vars,vars.map((_,i)=>i+1),`${t.name}: variáveis seguidas a partir de 1`);
  assert.equal(t.example.length,vars.length,`${t.name}: um exemplo por variável`);
  assert.doesNotMatch(t.body,/^\{\{|\}\}$/,`${t.name}: sem variável no início nem no fim`);
  assert.doesNotMatch(t.body,/\{\{\d+\}\}\s*\{\{\d+\}\}/,`${t.name}: sem variáveis coladas`);
  for(const e of t.example)assert.doesNotMatch(e,/[\n\t]| {5}/);
  assert.match(t.name,/^[a-z0-9_]+$/);
 }
 assert.deepEqual(NOTIFICATION_TEMPLATES.visita_equipa.buttons,['Confirmar visita','Não posso nessa hora']);
 assert.equal(NOTIFICATION_TEMPLATES.visita_equipa.name,'engineline_visita_equipa');
 assert.equal(NOTIFICATION_TEMPLATES.visita_equipa.env,'WHATSAPP_TEMPLATE_VISITA_EQUIPA');
 assert.equal(CUSTOMER_TEMPLATES.visita_cancelada.name,'engineline_visita_cancelada');
 assert.equal(CUSTOMER_TEMPLATES.visita_pedido.name,'engineline_visita_pedido');
 // Os botões do modelo cabem no limite da Meta (25 caracteres cada, até 10 botões).
 for(const b of NOTIFICATION_TEMPLATES.visita_equipa.buttons)assert.ok(b.length<=25,b);
});

server.close();
