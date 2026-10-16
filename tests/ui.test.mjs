import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require=createRequire(import.meta.url);
const car='10000000-0000-4000-8000-000000000001',lead='20000000-0000-4000-8000-000000000001';
let role='admin';
let pathname='/inventario';
const fixtures={
 cars:[{id:car,make:'BMW',model:'320',license_plate:'AA-00-AA',price:25000,status:'published'}],
 profiles:[],
 leads:[{id:lead,car_id:car,name:'Cliente de teste',email:'cliente@example.test',phone:'910000000',car_label:'BMW 320',status:'new',message:'Gostava de marcar uma visita',assigned_to:null,next_action:'Confirmar visita',next_action_at:'2026-09-15T09:00:00Z',loss_reason:null}],
 vehicle_financials:[{car_id:car,purchase_price:17000,acquired_on:'2026-06-01',sale_price:null,sold_on:null}],
 vehicle_costs:[{id:'cost1',car_id:car,category:'parts',description:'Travões',amount:500,incurred_on:'2026-06-02'}],
 preparation_tasks:[{id:'task1',car_id:car,title:'Revisão de travões',stage:'preparation',status:'waiting_parts',assigned_to:null,parts:'Pastilhas',due_on:null}],
 reservations:[],lead_activities:[],audit_log:[],
};
function query(table){let single=false;let from=0,to=999;const api=new Proxy({}, {get(_,key){if(key==='then')return(resolve)=>{const rows=(fixtures[table]??[]).slice(from,to+1);return Promise.resolve(resolve({data:single?rows[0]??null:rows,error:null,count:rows.length}));};return(...args)=>{if(key==='single'||key==='maybeSingle')single=true;if(key==='range')[from,to]=args;return api;};}});return api;}
const db={from:query,auth:{getUser:async()=>({data:{user:{id:'me'}},error:null})},rpc:async(name)=>({data:name==='staff_directory'?[{id:'staff1',full_name:'Equipa',role:'vendedor'}]:true,error:null})};
const cache=new Map();
function load(file){file=resolve(file);if(cache.has(file))return cache.get(file);const mod={exports:{}};cache.set(file,mod.exports);
 const source=readFileSync(file,'utf8');const {outputText}=ts.transpileModule(source,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const custom=(id)=>{
  if(id==='server-only')return {};
  // CSS modules: cada classe devolve o próprio nome.
  if(id.endsWith('.css'))return new Proxy({}, {get:(_,key)=>key==='__esModule'?undefined:String(key)});
  if(id==='next/headers')return {cookies:async()=>({get:()=>({value:'car'})})};
  if(id==='next/navigation')return {usePathname:()=>pathname,useRouter:()=>({refresh(){}}),notFound(){throw Error('404');}};
  if(id==='next/link')return {__esModule:true,default:({href,children,scroll,...props})=>React.createElement('a',{href,...props},children)};
  if(id==='@/lib/supabase/server')return {createClient:async()=>db};
  if(id==='@/lib/guard')return {requireSection:async()=>({id:'me',role,allowed_sections:null})};
  if(id.startsWith('@/lib/actions/'))return new Proxy({}, {get:()=>async()=>({ok:true})});
  if(id==='sonner')return {toast:{success(){}}};
  if(id.startsWith('@/')||id.startsWith('.')){
    let path=id.startsWith('@/')?resolve('src',id.slice(2)):resolve(dirname(file),id);
    if(!existsSync(path))path=existsSync(path+'.tsx')?path+'.tsx':path+'.ts';
    return load(path);
  }
  return require(id);
 };
 new Function('module','exports','require',outputText)(mod,mod.exports,custom);cache.set(file,mod.exports);return mod.exports;
}
async function expand(node){if(Array.isArray(node))return Promise.all(node.map(async(child,i)=>{const el=await expand(child);return React.isValidElement(el)&&el.key===null?React.cloneElement(el,{key:`fixture-${i}`}):el;}));if(!React.isValidElement(node))return node;if(typeof node.type==='function'&&node.type.constructor.name==='AsyncFunction')return expand(await node.type(node.props));if(node.props.children!==undefined)return React.cloneElement(node,{},await expand(node.props.children));return node;}
async function render(file,props={}){const Page=load(file).default;return renderToStaticMarkup(await expand(await Page(props)));}
await test('CRM detail renders linked forms and administrative sale controls',async()=>{
 role='admin';const html=await render('src/app/admin/(dashboard)/leads/[id]/page.tsx',{params:Promise.resolve({id:lead})});
 for(const text of ['Cliente de teste','Guardar acompanhamento','Confirmar reserva','Concluir venda','Registar atividade'])assert.ok(html.includes(text),text);
 assert.ok(html.includes('name="car_id"'));assert.ok(html.includes('name="loss_reason"'));
});
await test('seller can follow up and reserve but cannot access finance sale controls',async()=>{
 role='vendedor';const html=await render('src/app/admin/(dashboard)/leads/[id]/page.tsx',{params:Promise.resolve({id:lead})});
 assert.ok(html.includes('Guardar acompanhamento'));assert.ok(html.includes('Confirmar reserva'));assert.ok(!html.includes('Concluir venda'));
});
await test('financial detail shows recorded costs and does not fabricate realized margin',async()=>{
 role='admin';const html=await render('src/app/admin/(dashboard)/financeiro/[id]/page.tsx',{params:Promise.resolve({id:car})});
 assert.ok(html.includes('Travões'));assert.ok(html.includes('Venda por concluir'));assert.ok(html.includes('Adicionar custo'));
});
await test('preparation surface shows waiting parts with editable checklist',async()=>{
 const Panel=load('src/components/admin/PreparationPanel.tsx').PreparationPanel;
 const html=renderToStaticMarkup(await expand(await Panel({carId:car})));
 assert.ok(html.includes('A aguardar peças'));assert.ok(html.includes('Revisão de travões'));assert.ok(html.includes('name="stage"'));
});

await test('new advert requires a vehicle type before exposing any form fields',()=>{
 const Form=load('src/components/admin/CarForm.tsx').CarForm;
 const html=renderToStaticMarkup(React.createElement(Form));
 assert.ok(html.includes('O que pretende anunciar?'));
 assert.ok(html.includes('>Carro</button>'));
 assert.ok(html.includes('>Mota</button>'));
 assert.ok(!html.includes('<form'));
 assert.ok(!html.includes('aria-pressed="true"'));
});
await test('editing a motorcycle restores its type and hides car-specific doors',()=>{
 const Form=load('src/components/admin/CarForm.tsx').CarForm;
 const html=renderToStaticMarkup(React.createElement(Form,{carId:car,defaults:{vehicle_type:'motorcycle',make:'Honda',model:'PCX',body:'Scooter',doors:0,seats:2}}));
 assert.ok(html.includes('Anúncio de mota'));
 assert.ok(html.includes('Categoria da mota'));
 assert.ok(html.includes('type="hidden" name="vehicle_type"'));
 assert.ok(html.includes('type="hidden" name="doors"'));
 assert.ok(!html.includes('<option value="Berlina"'));
});
await test('world switch offers only the other world, and not on shared pages',()=>{
 const Switch=load('src/components/site/WorldSwitch.tsx').WorldSwitch;
 pathname='/inventario';
 const fromCars=renderToStaticMarkup(React.createElement(Switch,{world:'car'}));
 assert.ok(fromCars.includes('type=motorcycle&amp;target=%2Finventario'),'aponta para as motas');
 assert.ok(!fromCars.includes('type=car&amp;'),'não repete o mundo atual');
 assert.ok(fromCars.includes('Ver stock de motas'));

 const fromMotos=renderToStaticMarkup(React.createElement(Switch,{world:'motorcycle'}));
 assert.ok(fromMotos.includes('type=car&amp;target=%2Finventario'));
 assert.ok(fromMotos.includes('Ver stock de carros'));

 // Numa ficha, trocar de mundo leva ao stock — o slug é do mundo antigo.
 pathname='/viaturas/bmw-116d';
 assert.ok(renderToStaticMarkup(React.createElement(Switch,{world:'car'}))
   .includes('target=%2Finventario'));

 // Páginas comuns aos dois mundos não mostram o seletor.
 for(const common of ['/sobre','/servicos','/contactos','/politica-de-cookies']){
  pathname=common;
  assert.equal(renderToStaticMarkup(React.createElement(Switch,{world:'car'})),'',common);
 }
 pathname='/inventario';
});

await test('admin world bar hides on shared sections and without access to the other type',()=>{
 const Bar=load('src/components/admin/AdminWorldBar.tsx').AdminWorldBar;
 pathname='/admin/carros';
 const both=renderToStaticMarkup(React.createElement(Bar,{world:'car',allowed:['car','motorcycle']}));
 assert.ok(both.includes('Passar para motas'));

 const onlyCars=renderToStaticMarkup(React.createElement(Bar,{world:'car',allowed:['car']}));
 assert.ok(onlyCars.includes('A gerir'),'continua a dizer onde está');
 assert.ok(!onlyCars.includes('Passar para'),'sem passagem para o que não pode ver');

 for(const shared of ['/admin/utilizadores','/admin/testemunhos','/admin/definicoes','/admin/integracoes','/admin/anuncios','/admin/horas']){
  pathname=shared;
  assert.equal(renderToStaticMarkup(React.createElement(Bar,{world:'car',allowed:['car','motorcycle']})),'',shared);
 }
 pathname='/inventario';
});

await test('the personal area is common to both vehicle worlds',()=>{
 const {adminPathHasWorld}=load('src/lib/world.ts');
 assert.equal(adminPathHasWorld('/admin/carros'),true);
 assert.equal(adminPathHasWorld('/admin/perfil'),false,'perfil não é de carros nem de motas');
 assert.equal(adminPathHasWorld('/admin/perfil/ferias'),false);
 assert.equal(adminPathHasWorld('/admin/utilizadores'),false);
});

// ---- Avisos por WhatsApp (0036) ---------------------------------------------
async function renderComponent(file,name,props={}){const C=load(file)[name];return renderToStaticMarkup(await expand(await C(props)));}
/** A caixa deste aviso vem marcada? (a ordem dos atributos não interessa) */
const checked=(html,name)=>/\schecked=/.test(html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`))?.[0]??'');

await test('the profile lists only the notices of the sections the person has, all on by default',async()=>{
 fixtures.notification_settings=[{whatsapp_enabled:true}];
 fixtures.notification_preferences=[{event:'lead_offer',enabled:false}];
 try{
  const vendedor={id:'me',role:'vendedor',allowed_sections:null,allowed_vehicle_types:['motorcycle'],phone:'912 345 678'};
  const html=await renderComponent('src/components/admin/NotificationPreferences.tsx','NotificationPreferences',{me:vendedor});
  for(const text of ['Avisos por WhatsApp','Pedidos de test drive','Viaturas publicadas no site','Só recebe avisos de motas'])assert.ok(html.includes(text),text);
  // Separadores que o vendedor não tem: esses avisos nunca lhe chegariam.
  for(const text of ['Testemunhos à espera','Viaturas novas na oficina','Acesso ao WhatsApp'])assert.ok(!html.includes(text),text);
  assert.ok(checked(html,'lead_test_drive'),'ligado por defeito');
  assert.ok(!checked(html,'lead_offer'),'o que a pessoa desligou');
  assert.ok(!html.includes('ainda não ligou'));assert.ok(!html.includes('Sem telefone'));
  // Sem telefone e com o canal desligado, diz-se porquê.
  fixtures.notification_settings=[{whatsapp_enabled:false}];
  const semNada=await renderComponent('src/components/admin/NotificationPreferences.tsx','NotificationPreferences',{me:{...vendedor,phone:null}});
  assert.ok(semNada.includes('ainda não ligou os avisos'));assert.ok(semNada.includes('Sem telefone no perfil'));
  // O mecânico só tem a Oficina.
  const mecanico=await renderComponent('src/components/admin/NotificationPreferences.tsx','NotificationPreferences',{me:{...vendedor,role:'mecanico',allowed_vehicle_types:null}});
  assert.ok(mecanico.includes('Viaturas novas na oficina'));assert.ok(!mecanico.includes('Pedidos de test drive'));
 }finally{delete fixtures.notification_settings;delete fixtures.notification_preferences;}
});

await test('Integrations shows the templates to submit and the latest notices with Meta\'s reason',async()=>{
 fixtures.notification_settings=[{whatsapp_enabled:true}];
 fixtures.profiles=[{id:'p1',full_name:'Vendedor Um'}];
 fixtures.notification_jobs=[
  {id:'j1',event:'lead_offer',recipient_id:'p1',attempts:1,last_error:null,created_at:'2026-10-01T10:00:00Z',delivered_at:'2026-10-01T10:00:02Z',cancelled_at:null,claimed_at:null},
  {id:'j2',event:'testimonial_pending',recipient_id:'p1',attempts:8,last_error:'HTTP 404 — (#132001) Template name does not exist in the translation',created_at:'2026-10-01T11:00:00Z',delivered_at:null,cancelled_at:null,claimed_at:null},
  {id:'j3',event:'vehicle_published',recipient_id:'p1',attempts:1,last_error:'Sem acesso a este separador',created_at:'2026-10-01T12:00:00Z',delivered_at:null,cancelled_at:'2026-10-01T12:01:00Z',claimed_at:null},
 ];
 try{
  const html=await renderComponent('src/components/admin/NotificationStatus.tsx','NotificationStatus');
  for(const name of ['engineline_lead','engineline_viatura','engineline_testemunho','engineline_aviso'])assert.ok(html.includes(name),name);
  assert.ok(html.includes('pt_PT'));assert.ok(html.includes('Enviar teste para o meu telefone'));
  assert.ok(html.includes('Vendedor Um'));assert.ok(html.includes('Propostas de preço'));
  assert.ok(html.includes('Enviado'));
  assert.ok(html.includes('Falhou — HTTP 404 — (#132001) Template name does not exist in the translation'));
  assert.ok(html.includes('Não enviado — Sem acesso a este separador'));
  assert.ok(html.includes('Voltar a tentar'));
 }finally{delete fixtures.notification_settings;delete fixtures.notification_jobs;fixtures.profiles=[];}
});

// ---- Avisos por WhatsApp (0041) ---------------------------------------------
await test('the profile groups the new notices, shows leave notices only to who can get them, and keeps the noisy one off',async()=>{
 fixtures.notification_settings=[{whatsapp_enabled:true}];
 fixtures.notification_preferences=[];
 try{
  const base={id:'me',allowed_sections:null,allowed_vehicle_types:null,phone:'912 345 678'};
  const vendedor=await renderComponent('src/components/admin/NotificationPreferences.tsx','NotificationPreferences',{me:{...base,role:'vendedor'}});
  for(const text of ['Férias','Contactos atribuídos a mim','Viaturas vendidas','Reservas canceladas ou expiradas','Viaturas que saem da oficina e ficam prontas no stand','Decisões sobre os meus pedidos de férias','Colegas que vão de férias nos próximos 7 dias','Preço alterado numa viatura à venda'])
   assert.ok(vendedor.includes(text),text);
  // Só decide férias quem está acima: o vendedor não recebe pedidos.
  assert.ok(!vendedor.includes('Pedidos de férias à espera da minha decisão'));
  assert.ok(checked(vendedor,'lead_assigned'));assert.ok(checked(vendedor,'leave_upcoming'));
  assert.ok(!checked(vendedor,'vehicle_price_changed'),'o preço vem desligado por defeito');
  // Ligado por escolha da pessoa, aparece ligado.
  fixtures.notification_preferences=[{event:'vehicle_price_changed',enabled:true},{event:'leave_upcoming',enabled:false}];
  const escolhas=await renderComponent('src/components/admin/NotificationPreferences.tsx','NotificationPreferences',{me:{...base,role:'vendedor'}});
  assert.ok(checked(escolhas,'vehicle_price_changed'));assert.ok(!checked(escolhas,'leave_upcoming'));
  fixtures.notification_preferences=[];
  // O chefe decide férias e também pede; o administrador só decide (aprova o próprio plano).
  const chefe=await renderComponent('src/components/admin/NotificationPreferences.tsx','NotificationPreferences',{me:{...base,role:'chefe'}});
  assert.ok(chefe.includes('Pedidos de férias à espera da minha decisão'));assert.ok(chefe.includes('Decisões sobre os meus pedidos de férias'));
  const admin=await renderComponent('src/components/admin/NotificationPreferences.tsx','NotificationPreferences',{me:{...base,role:'admin'}});
  assert.ok(admin.includes('Pedidos de férias à espera da minha decisão'));assert.ok(!admin.includes('Decisões sobre os meus pedidos de férias'));
  // O mecânico: a Oficina e as férias, nada de Leads nem de Viaturas.
  const mecanico=await renderComponent('src/components/admin/NotificationPreferences.tsx','NotificationPreferences',{me:{...base,role:'mecanico'}});
  for(const text of ['Viaturas novas na oficina','Colegas que vão de férias nos próximos 7 dias','Decisões sobre os meus pedidos de férias'])assert.ok(mecanico.includes(text),text);
  for(const text of ['Contactos atribuídos a mim','Viaturas que saem da oficina','Pedidos de férias à espera'])assert.ok(!mecanico.includes(text),text);
 }finally{delete fixtures.notification_settings;delete fixtures.notification_preferences;}
});

await test('visit agenda lists the requests to confirm and the lead page shows the stock alert matches',async()=>{
 role='admin';
 const visit={id:'30000000-0000-4000-8000-000000000001',car_id:car,kind:'visit',name:'Maria Visita',email:'',phone:'912345678',car_label:'BMW 320 2020',status:'new',assigned_to:null,next_action:'Confirmar a visita ao stand',next_action_at:new Date().toISOString(),loss_reason:null,car_details:{whatsapp_opt_in_at:'2026-10-16T10:00:00Z'},visit_at:new Date(Date.now()+86400000).toISOString(),visit_status:'requested'};
 const saved=fixtures.leads;
 fixtures.leads=[visit];
 try{
  const html=await render('src/app/admin/(dashboard)/leads/agenda/page.tsx',{searchParams:Promise.resolve({})});
  for(const text of ['Agenda de visitas','Maria Visita','Por confirmar','Confirmar','Realizada','Não veio','Nova visita','https://wa.me/351912345678'])assert.ok(html.includes(text),text);
  const page=await render('src/app/admin/(dashboard)/leads/[id]/page.tsx',{params:Promise.resolve({id:visit.id})});
  for(const text of ['Visita ao stand','Por confirmar','Confirmar visita','Enviar confirmação pelo WhatsApp','Mudar a visita'])assert.ok(page.includes(text),text);
  fixtures.leads=[{...visit,kind:'alert',visit_at:null,visit_status:null,car_details:{criteria:{vehicle_type:'car',make:'BMW',max_price:30000},whatsapp_opt_in_at:'x'}}];
  fixtures.stock_alert_matches=[{id:'m1',lead_id:visit.id,car_id:car,status:'manual',sent_at:null,error:null,created_at:'2026-10-16T10:00:00Z'}];
  fixtures.cars=[{id:car,slug:'bmw-320',make:'BMW',model:'320',year:2020,mileage:40000,price:25000,price_on_request:false,status:'published',license_plate:'AA-00-AA'}];
  const alert=await render('src/app/admin/(dashboard)/leads/[id]/page.tsx',{params:Promise.resolve({id:visit.id})});
  for(const text of ['Alerta de stock','BMW · até 30','Por avisar (à mão)','Enviar pelo WhatsApp','Marcar como avisado','Sem visita marcada'])assert.ok(alert.replace(/\s/g,' ').includes(text),text);
  assert.ok(!alert.includes('"vehicle_type"'),'os critérios não aparecem em JSON cru');
 }finally{fixtures.leads=saved;delete fixtures.stock_alert_matches;fixtures.cars=[{id:car,make:'BMW',model:'320',license_plate:'AA-00-AA',price:25000,status:'published'}];}
});
