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
