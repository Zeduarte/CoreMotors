// Percurso completo de uma ordem por WhatsApp, com a base de dados e o modelo
// simulados.
//
// O que estes testes existem para provar é uma promessa concreta do desenho: o
// que é gravado é exactamente a proposta que a pessoa leu, e a confirmação não
// volta a passar pelo modelo. Daí contar-se quantas vezes o modelo é chamado.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
const cache=new Map();
function withExt(base){for(const ext of ['.ts','.tsx','/index.ts'])if(existsSync(base+ext))return base+ext;throw new Error(`não resolvido: ${base}`);}
function resolveAlias(id){return withExt(`src/${id.slice(2)}`);}
function resolveRelative(from,id){return withExt(new URL(id,new URL(from,'file:///')).pathname.slice(1));}
function load(path){
 if(cache.has(path))return cache.get(path);
 const source=readFileSync(path,'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const mod={exports:{}};cache.set(path,mod.exports);
 const localRequire=(id)=>{
  // `server-only` estoura fora de um contexto React Server; aqui só marca
  // intenção, por isso vale um objecto vazio.
  if(id==='server-only')return {};
  return id.startsWith('@/')?load(resolveAlias(id)):id.startsWith('.')?load(resolveRelative(path,id)):require(id);
 };
 new Function('module','exports','require',outputText)(mod,mod.exports,localRequire);
 cache.set(path,mod.exports);return mod.exports;}

const {handleInbound,toActor}=load('src/lib/whatsapp/handle.ts');
const {REPLIES}=load('src/lib/whatsapp/replies.ts');

const CARRO='11111111-1111-4111-8111-111111111111';
const MOTA='22222222-2222-4222-8222-222222222222';
const TELEFONE='351916193337';

/** Base de dados em memória: só o que o handleInbound toca. */
function fakeDb({frota=null,rpc={},now=new Date()}={}) {
 const pendentes=[];
 const chamadas=[];
 const viaturas=frota??[
  {id:CARRO,make:'BMW',model:'320',variant:null,color:'Preto',license_plate:'33-AD-22',status:'published',vehicle_type:'car'},
  {id:MOTA,make:'Honda',model:'CB500',variant:null,color:'Vermelho',license_plate:'55-HH-55',status:'published',vehicle_type:'motorcycle'},
 ];
 const builder=(tabela)=>{
  const filtros={};let patch=null;
  const api={
   select(){return api;},
   eq(col,val){filtros[col]=val;return api;},
   async maybeSingle(){
    const row=pendentes.find(r=>Object.entries(filtros).every(([k,v])=>r[k]===v));
    return {data:row??null,error:null};
   },
   async insert(row){
    chamadas.push({op:'insert',tabela,row});
    if(tabela==='wa_pending_actions'){
     if(pendentes.some(r=>r.from_phone===row.from_phone&&r.status==='pending'))
      return {data:null,error:{message:'duplicate key value violates unique constraint'}};
     pendentes.push({id:`p${pendentes.length+1}`,status:'pending',
      expires_at:new Date(now.getTime()+600000).toISOString(),...row});
    }
    return {data:null,error:null};
   },
   update(p){patch=p;return api;},
  };
  // O update termina num eq, por isso é o eq que aplica quando há patch.
  const eqOriginal=api.eq;
  api.eq=(col,val)=>{
   if(patch){
    const row=pendentes.find(r=>r[col]===val);
    if(row)Object.assign(row,patch);
    chamadas.push({op:'update',tabela,patch});
    return Promise.resolve({data:null,error:null});
   }
   return eqOriginal(col,val);
  };
  return api;
 };
 return {
  from:(t)=>builder(t),
  async rpc(name,args){
   chamadas.push({op:'rpc',name,args});
   if(name==='wa_vehicles_for_actor')return {data:viaturas,error:null};
   if(name in rpc)return rpc[name](args);
   return {data:'00000000-0000-4000-8000-00000000abcd',error:null};
  },
  _pendentes:pendentes,_chamadas:chamadas,
  escritas(){return chamadas.filter(c=>c.op==='rpc'&&c.name.startsWith('wa_')&&c.name!=='wa_vehicles_for_actor'&&c.name!=='wa_vehicle_summary');},
 };
}

/** Modelo simulado: devolve respostas escritas por nós e conta as chamadas. */
function fakeAnthropic(guiao) {
 const fila=[...guiao];
 const fake={chamadas:0,messages:{create:async()=>{
  fake.chamadas++;
  const proxima=fila.shift();
  if(!proxima)throw new Error('o guião acabou — o modelo foi chamado mais vezes do que o esperado');
  if(proxima instanceof Error)throw proxima;
  return proxima;
 }}};
 return fake;
}
const usaFerramenta=(name,input,id='t1')=>({id:'m',type:'message',role:'assistant',model:'x',
 stop_reason:'tool_use',content:[{type:'tool_use',id,name,input}]});
const diz=(text)=>({id:'m',type:'message',role:'assistant',model:'x',
 stop_reason:'end_turn',content:[{type:'text',text}]});

const AGORA=new Date('2026-09-24T18:00:00Z');
const HOJE='2026-09-24';

const chefe=toActor({id:'aaaaaaaa-0000-4000-8000-000000000001',full_name:'Ana',role:'admin'});
const mecanico=toActor({id:'bbbbbbbb-0000-4000-8000-000000000002',full_name:'Bruno',role:'mecanico'});

await test('a cost is proposed first and only written after the person says yes',async()=>{
 const db=fakeDb();
 const ia=fakeAnthropic([
  usaFerramenta('procurar_viatura',{texto:'bmw 320 preto'}),
  usaFerramenta('propor_despesa',{viatura:'V1',categoria:'parts',valor:450,
   descricao:'troca da embraiagem e revisão geral'}),
 ]);
 const pergunta=await handleInbound(
  {from:TELEFONE,text:'coloca uma despesa de 450 de troca de embraiagem e revisao geral ao bmw 320 preto',type:'text'},
  chefe,{db,anthropic:ia});

 // Nada foi gravado ainda, e a frase tem tudo o que vai ser gravado.
 assert.equal(pergunta.wrote,false);
 assert.equal(db.escritas().length,0,'não se escreveu antes de confirmar');
 for(const parte of ['BMW 320','33-AD-22','450','embraiagem','Confirma?'])
  assert.ok(pergunta.reply.includes(parte),`falta "${parte}": ${pergunta.reply}`);
 assert.equal(db._pendentes.length,1);
 assert.equal(db._pendentes[0].status,'pending');

 // Agora o «sim». O modelo NÃO pode ser chamado outra vez — é isso que garante
 // que o valor confirmado é o valor gravado.
 const antes=ia.chamadas;
 const recibo=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefe,{db,anthropic:ia});
 assert.equal(ia.chamadas,antes,'a confirmação não voltou a passar pelo modelo');
 assert.equal(recibo.wrote,true);

 const escritas=db.escritas();
 assert.equal(escritas.length,1,'a RPC de escrita foi chamada exactamente uma vez');
 assert.equal(escritas[0].name,'wa_add_cost');
 assert.deepEqual(
  {car:escritas[0].args.car,kind:escritas[0].args.kind,value:escritas[0].args.value,note:escritas[0].args.note},
  {car:CARRO,kind:'parts',value:450,note:'troca da embraiagem e revisão geral'});
 assert.equal(escritas[0].args.actor,chefe.id,'a ordem é atribuída a quem a deu');
 assert.match(recibo.reply,/Foi adicionada/);
 assert.equal(/Confirma\?/.test(recibo.reply),false);
 assert.equal(db._pendentes[0].status,'confirmed');
});

await test('"sim, mas muda para 500" is a new request, not a confirmation',async()=>{
 const db=fakeDb();
 const ia=fakeAnthropic([
  usaFerramenta('procurar_viatura',{texto:'bmw 320 preto'}),
  usaFerramenta('propor_despesa',{viatura:'V1',categoria:'parts',valor:450,descricao:'Embraiagem'}),
  // Segunda volta: a proposta anterior é substituída por uma de 500.
  usaFerramenta('procurar_viatura',{matricula:'33-AD-22'},'t2'),
  usaFerramenta('propor_despesa',{viatura:'V1',categoria:'parts',valor:500,descricao:'Embraiagem'},'t3'),
 ]);
 await handleInbound({from:TELEFONE,text:'despesa de 450 de embraiagem no bmw 320 preto',type:'text'},chefe,{db,anthropic:ia});
 const segunda=await handleInbound({from:TELEFONE,text:'sim, mas muda para 500',type:'text'},chefe,{db,anthropic:ia});

 assert.equal(db.escritas().length,0,'não gravou os 450');
 assert.equal(db._pendentes[0].status,'superseded','a proposta antiga foi substituída');
 assert.match(segunda.reply,/500/);
 assert.equal(segunda.wrote,false);
});

await test('a yes with nothing pending, and a yes after it expired, write nothing',async()=>{
 const db=fakeDb();
 const ia=fakeAnthropic([]);
 const nada=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefe,{db,anthropic:ia});
 assert.equal(nada.reply,REPLIES.nadaPendente);
 assert.equal(ia.chamadas,0,'nem vale uma chamada ao modelo');

 // Uma proposta fora do prazo.
 db._pendentes.push({id:'p1',from_phone:TELEFONE,status:'pending',kind:'add_cost',
  expires_at:new Date(Date.now()-1000).toISOString(),
  payload:{kind:'add_cost',carId:CARRO,veiculo:'BMW 320',categoria:'parts',
   descricao:'x',valor:10,data:HOJE},summary:'x'});
 const tarde=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefe,{db,anthropic:ia});
 assert.equal(tarde.reply,REPLIES.expirou);
 assert.equal(tarde.wrote,false);
 assert.equal(db.escritas().length,0);
 assert.equal(db._pendentes[0].status,'expired');
});

await test('no is honoured and writes nothing',async()=>{
 const db=fakeDb();
 const ia=fakeAnthropic([
  usaFerramenta('procurar_viatura',{matricula:'33-AD-22'}),
  usaFerramenta('propor_despesa',{viatura:'V1',categoria:'parts',valor:450,descricao:'Embraiagem'}),
 ]);
 await handleInbound({from:TELEFONE,text:'despesa de 450 no 33-AD-22',type:'text'},chefe,{db,anthropic:ia});
 const nao=await handleInbound({from:TELEFONE,text:'cancela',type:'text'},chefe,{db,anthropic:ia});
 assert.equal(nao.reply,REPLIES.cancelado);
 assert.equal(db.escritas().length,0);
 assert.equal(db._pendentes[0].status,'cancelled');
});

await test('a vehicle the model never received cannot be charged',async()=>{
 const db=fakeDb();
 // O modelo tenta propor sem ter procurado, inventando um identificador.
 const ia=fakeAnthropic([
  usaFerramenta('propor_despesa',{viatura:'V7',categoria:'parts',valor:450,descricao:'Embraiagem'}),
  diz('Qual é a viatura?'),
 ]);
 const r=await handleInbound({from:TELEFONE,text:'despesa de 450',type:'text'},chefe,{db,anthropic:ia});
 assert.equal(db.escritas().length,0);
 assert.equal(db._pendentes.length,0,'nenhuma proposta foi guardada');
 assert.equal(r.reply,'Qual é a viatura?');
});

await test('permissions are enforced with our own words, before any write',async()=>{
 const db=fakeDb();
 const ia=fakeAnthropic([
  usaFerramenta('procurar_viatura',{matricula:'33-AD-22'}),
  usaFerramenta('propor_despesa',{viatura:'V1',categoria:'labour',valor:450,descricao:'Mão de obra'}),
 ]);
 const r=await handleInbound({from:TELEFONE,text:'mão de obra de 450 no 33-AD-22',type:'text'},mecanico,{db,anthropic:ia});
 // O mecânico só tem Oficina: mão de obra sai das horas.
 assert.match(r.reply,/horas/);
 assert.equal(db.escritas().length,0);
 assert.equal(db._pendentes.length,0);
});

await test('anyone recognised can ask, but writing still needs the section',async()=>{
 // Decisão do dono: qualquer colaborador reconhecido pode perguntar. Escrever
 // continua a exigir Oficina ou Custos e margens — e quem diz que não é o
 // nosso código, não o modelo.
 const db=fakeDb();
 const vendedor=toActor({id:'cccccccc-0000-4000-8000-000000000003',full_name:'Carla',role:'vendedor'});
 const ia=fakeAnthropic([
  usaFerramenta('procurar_viatura',{texto:'bmw 320 preto'}),
  usaFerramenta('propor_despesa',{viatura:'V1',categoria:'parts',valor:450,descricao:'Embraiagem'}),
 ]);
 const r=await handleInbound({from:TELEFONE,text:'despesa de 450 no bmw 320 preto',type:'text'},vendedor,{db,anthropic:ia});
 assert.match(r.reply,/Não tem acesso a Custos e margens/);
 assert.equal(db._pendentes.length,0,'nada fica à espera de confirmação');
 assert.equal(db.escritas().length,0);
});

await test('the channel degrades cleanly when the model is missing or failing',async()=>{
 const semChave=await handleInbound({from:TELEFONE,text:'despesa de 450',type:'text'},chefe,
  {db:fakeDb(),anthropic:null});
 assert.equal(semChave.reply,REPLIES.semAssistente);

 const db=fakeDb();
 const emBaixo=fakeAnthropic([new Error('503 overloaded')]);
 const r=await handleInbound({from:TELEFONE,text:'despesa de 450',type:'text'},chefe,{db,anthropic:emBaixo});
 assert.equal(r.reply,REPLIES.falhou);
 assert.equal(db._pendentes.length,0);
 assert.equal(db.escritas().length,0);
});

await test('non-text messages get one honest answer',async()=>{
 const ia=fakeAnthropic([]);
 const r=await handleInbound({from:TELEFONE,text:'',type:'image'},chefe,{db:fakeDb(),anthropic:ia});
 assert.equal(r.reply,REPLIES.soTexto);
 assert.equal(ia.chamadas,0);
});

await test('ambiguity is asked about, never guessed',async()=>{
 const db=fakeDb({frota:[
  {id:CARRO,make:'BMW',model:'320',color:'Preto',license_plate:'33-AD-22',status:'published',vehicle_type:'car'},
  {id:MOTA,make:'BMW',model:'320',color:'Cinzento',license_plate:'44-VS-23',status:'published',vehicle_type:'car'},
 ]});
 let visto='';
 const ia={chamadas:0,messages:{create:async(p)=>{
  ia.chamadas++;
  if(ia.chamadas===1)return usaFerramenta('procurar_viatura',{texto:'bmw 320'});
  // O que o modelo recebeu de volta tem de conter as duas, com matrícula.
  visto=JSON.stringify(p.messages);
  return diz('Encontrei duas. Qual? Indique a matrícula.');
 }}};
 const r=await handleInbound({from:TELEFONE,text:'despesa de 450 no bmw 320',type:'text'},chefe,{db,anthropic:ia});
 assert.match(visto,/33-AD-22/);
 assert.match(visto,/44-VS-23/);
 assert.match(r.reply,/Qual/);
 assert.equal(db._pendentes.length,0);
 assert.equal(db.escritas().length,0);
});

await test('registering a vehicle and logging hours follow the same two steps',async()=>{
 const db=fakeDb();
 const ia=fakeAnthropic([
  usaFerramenta('propor_registo_viatura',{nome:'Audi A1',matricula:'00-TE-00',tipo:'car'}),
 ]);
 const p=await handleInbound({from:TELEFONE,text:'registaa um novo audi a1 com a matricula 00-teste-00',type:'text'},chefe,{db,anthropic:ia});
 assert.match(p.reply,/Audi A1.*00-TE-00.*Confirma\?/s);
 assert.equal(db.escritas().length,0);
 await handleInbound({from:TELEFONE,text:'ok',type:'text'},chefe,{db,anthropic:ia});
 const reg=db.escritas();
 assert.equal(reg.length,1);
 assert.equal(reg[0].name,'wa_create_workshop_vehicle');
 assert.equal(reg[0].args.plate,'00-TE-00');

 const db2=fakeDb({now:AGORA});
 const ia2=fakeAnthropic([
  usaFerramenta('procurar_viatura',{matricula:'33-AD-22'}),
  usaFerramenta('propor_horas',{viatura:'V1',data:HOJE,inicio:'09:00',fim:'17:30',descricao:'Travões'}),
 ]);
 const deps2={db:db2,anthropic:ia2,now:AGORA};
 const h=await handleInbound({from:TELEFONE,text:'das 9 às 17h30 no 33-AD-22, travões',type:'text'},chefe,deps2);
 assert.match(h.reply,/8,5 h/);
 const conf=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefe,deps2);
 assert.equal(conf.wrote,true,conf.reply);
 const horas=db2.escritas();
 assert.equal(horas.length,1);
 assert.equal(horas[0].name,'wa_log_hours');
 assert.deepEqual([horas[0].args.starts,horas[0].args.ends],['09:00','17:30']);
});

await test('a write that no longer applies is reported, not retried',async()=>{
 const db=fakeDb({rpc:{wa_add_cost:async()=>({data:null,error:{message:'Viatura inexistente'}})}});
 const ia=fakeAnthropic([
  usaFerramenta('procurar_viatura',{matricula:'33-AD-22'}),
  usaFerramenta('propor_despesa',{viatura:'V1',categoria:'parts',valor:450,descricao:'Embraiagem'}),
 ]);
 await handleInbound({from:TELEFONE,text:'despesa de 450 no 33-AD-22',type:'text'},chefe,{db,anthropic:ia});
 const r=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefe,{db,anthropic:ia});
 assert.equal(r.reply,REPLIES.jaNaoDa);
 assert.equal(r.wrote,false);
 assert.equal(db._pendentes[0].status,'cancelled');
});
