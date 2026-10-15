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

const LEAD='44444444-4444-4444-8444-444444444444';
const TESTEMUNHO='55555555-5555-4555-8555-555555555555';
const ANA='66666666-6666-4666-8666-666666666666';

/** O que as procuras novas (0038) devolvem por defeito, já filtrado como no SQL. */
const CONTACTOS=[{id:LEAD,name:'João Silva',phone:'912 345 678',email:null,status:'new',car_label:'BMW 320',
 vehicle_type:'car',assigned_to:null,assigned_name:null,active_reservation:false,created_at:'2026-09-20T10:00:00Z',total:1}];
const TESTEMUNHOS=[{id:TESTEMUNHO,name:'Maria',rating:5,role:null,body:'Excelente serviço, recomendo.',published:false,
 created_at:'2026-09-20T10:00:00Z',total:1}];
const EQUIPA=[{id:ANA,full_name:'Ana Costa',total:1}];
/** A ficha da viatura como está gravada (lida ao propor uma alteração). */
const FICHA={id:CARRO,status:'draft',price:25000,price_on_request:false,mileage:120000,tagline:null,description:null,
 year:2019,fuel:'Diesel',transmission:'Manual',body:'Berlina',model:'320'};

/** Base de dados em memória: só o que o handleInbound toca. */
function fakeDb({frota=null,rpc={},now=new Date(),tabelas={}}={}) {
 const pendentes=[];
 const chamadas=[];
 const viaturas=frota??[
  {id:CARRO,make:'BMW',model:'320',variant:null,color:'Preto',license_plate:'33-AD-22',status:'published',vehicle_type:'car'},
  {id:MOTA,make:'Honda',model:'CB500',variant:null,color:'Vermelho',license_plate:'55-HH-55',status:'published',vehicle_type:'motorcycle'},
 ];
 const outras={cars:[FICHA],reservations:[],site_settings:[{id:1,company_name:'Stand Teste',accent:'#112233'}],...tabelas};
 const builder=(tabela)=>{
  const filtros={};let patch=null;
  const api={
   select(){return api;},
   eq(col,val){filtros[col]=val;return api;},
   async maybeSingle(){
    const linhas=tabela==='wa_pending_actions'?pendentes:(outras[tabela]??[]);
    const row=linhas.find(r=>Object.entries(filtros).every(([k,v])=>r[k]===v));
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
   if(name in rpc)return rpc[name](args);
   if(name==='wa_vehicles_for_actor')return {data:viaturas,error:null};
   if(name==='wa_leads_for_actor')return {data:CONTACTOS,error:null};
   if(name==='wa_testimonials_for_actor')return {data:TESTEMUNHOS,error:null};
   if(name==='wa_staff_for_actor')return {data:EQUIPA,error:null};
   return {data:'00000000-0000-4000-8000-00000000abcd',error:null};
  },
  _pendentes:pendentes,_chamadas:chamadas,
  // Escritas = RPCs wa_* que não são leituras (procuras e resumo).
  escritas(){return chamadas.filter(c=>c.op==='rpc'&&c.name.startsWith('wa_')&&!c.name.endsWith('_for_actor')&&c.name!=='wa_vehicle_summary');},
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
 for(const parte of ['BMW 320','33-AD-22','450','embraiagem','Confirmar?'])
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
 assert.equal(/Confirmar\?/.test(recibo.reply),false);
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
 assert.match(p.reply,/Audi A1.*00-TE-00.*Confirmar\?/s);
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

// ---------------------------------------------------------------------------
// Fase 2: a proposta vai como imagem, e há mais ordens (viaturas, leads,
// testemunhos). O percurso é o mesmo: procura → proposta → imagem → «sim»
// lido por igualdade → RPC em nome de quem confirmou.
// ---------------------------------------------------------------------------

const {verifyPreview}=load('src/lib/whatsapp/preview-link.ts');
const {loadPreview}=load('src/lib/whatsapp/preview.ts');
const {WA_TOOLS}=load('src/lib/whatsapp/tools.ts');
const ORIGEM='https://stand.example.pt';
const SEGREDO='segredo-de-teste-do-servidor';
const ligacao=(url)=>{const u=new URL(url);return {id:u.pathname.split('/').pop(),exp:u.searchParams.get('exp'),sig:u.searchParams.get('sig')};};
const espacos=(s)=>s.replace(/\s/g,' ');
const vendedor=toActor({id:'cccccccc-0000-4000-8000-000000000003',full_name:'Carla',role:'vendedor'});
process.env.WHATSAPP_APP_SECRET=SEGREDO;

await test('a price change goes out as an image of the form, and is written by whoever said yes',async()=>{
 const db=fakeDb({now:AGORA,tabelas:{cars:[{...FICHA,status:'published'}]}});
 const ia=fakeAnthropic([
  usaFerramenta('procurar_viatura',{texto:'bmw 320 preto'}),
  usaFerramenta('propor_editar_viatura',{viatura:'V1',preco:23500}),
 ]);
 const deps={db,anthropic:ia,now:AGORA,origin:ORIGEM};
 const p=await handleInbound({from:TELEFONE,text:'baixa o preço do bmw 320 preto para 23 500',type:'text'},chefe,deps);
 assert.equal(p.wrote,false);
 assert.equal(db.escritas().length,0,'nada gravado antes do «sim»');
 // O texto (legenda e recurso) tem o antes e o depois.
 for(const parte of ['BMW 320','33-AD-22','23 500','25 000','Confirmar? Responda sim ou não.'])
  assert.ok(espacos(p.reply).includes(parte),`falta "${parte}": ${p.reply}`);
 // A imagem: link da origem do pedido, assinado, para ESTA proposta.
 assert.ok(p.image,'há imagem');
 assert.ok(p.image.url.startsWith(`${ORIGEM}/api/whatsapp/preview/`));
 assert.equal(p.image.pendingId,db._pendentes[0].id);
 const {id,exp,sig}=ligacao(p.image.url);
 assert.equal(id,db._pendentes[0].id);
 assert.equal(verifyPreview(id,exp,sig,AGORA,SEGREDO),true);
 // O que a rota desenha: o formulário da viatura, sem ids internos.
 const img=await loadPreview(db,id,exp,sig,AGORA,SEGREDO);
 assert.equal(img.card.title,'Viaturas · editar viatura');
 assert.equal(img.companyName,'Stand Teste');
 assert.equal(img.accent,'#112233');
 assert.deepEqual(img.card.fields.map(f=>[f.label,espacos(f.before),espacos(f.value)]),[['Preço','25 000 €','23 500 €']]);
 assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-/.test(JSON.stringify(img.card)),false);

 // «sim»: o modelo não é chamado, a RPC recebe exactamente a proposta.
 const antes=ia.chamadas;
 const r=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefe,deps);
 assert.equal(ia.chamadas,antes);
 assert.equal(r.wrote,true);
 const escritas=db.escritas();
 assert.equal(escritas.length,1);
 assert.deepEqual(escritas[0],{op:'rpc',name:'wa_update_car',args:{actor:chefe.id,car:CARRO,changes:{price:23500}}});
 assert.match(espacos(r.reply),/Alterada a viatura BMW 320.*23 500/);
 assert.equal(r.image,undefined,'o recibo vai em texto');
 assert.deepEqual(r.changed,{kind:'update_car',carId:CARRO},'para limpar a cache do site e avisar o OLX');
 // Já respondida, a imagem deixa de existir.
 assert.equal(await loadPreview(db,id,exp,sig,AGORA,SEGREDO),null);
});

await test('an image link that is forged, expired or for an answered proposal shows nothing',async()=>{
 const db=fakeDb({now:AGORA});
 const ia=fakeAnthropic([
  usaFerramenta('procurar_viatura',{matricula:'33-AD-22'}),
  usaFerramenta('propor_estado_viatura',{viatura:'V1',estado:'published'}),
 ]);
 const p=await handleInbound({from:TELEFONE,text:'publica o 33-AD-22',type:'text'},chefe,{db,anthropic:ia,now:AGORA,origin:ORIGEM});
 const {id,exp,sig}=ligacao(p.image.url);
 assert.ok(await loadPreview(db,id,exp,sig,AGORA,SEGREDO),'o link verdadeiro abre');
 const outra=sig.replace(/^./,c=>c==='0'?'1':'0');
 assert.equal(await loadPreview(db,id,exp,outra,AGORA,SEGREDO),null,'assinatura errada');
 assert.equal(await loadPreview(db,id,String(Number(exp)+1),sig,AGORA,SEGREDO),null,'prazo mexido');
 assert.equal(await loadPreview(db,id,exp,sig,new Date(AGORA.getTime()+16*60000),SEGREDO),null,'expirado');
 // A proposta caduca aos 10 minutos, antes do link: também já não se mostra.
 assert.equal(await loadPreview(db,id,exp,sig,new Date(AGORA.getTime()+11*60000),SEGREDO),null,'proposta caducada');
 // Respondida com «não»: já não está pendente.
 await handleInbound({from:TELEFONE,text:'não',type:'text'},chefe,{db,anthropic:ia,now:AGORA});
 assert.equal(await loadPreview(db,id,exp,sig,AGORA,SEGREDO),null,'já respondida');
 assert.equal(db.escritas().length,0);
});

await test('without an origin or a server secret the proposal still goes out, as text',async()=>{
 const semOrigem=await handleInbound({from:TELEFONE,text:'publica o 33-AD-22',type:'text'},chefe,{db:fakeDb({now:AGORA}),now:AGORA,anthropic:fakeAnthropic([
  usaFerramenta('procurar_viatura',{matricula:'33-AD-22'}),usaFerramenta('propor_estado_viatura',{viatura:'V1',estado:'published'})])});
 assert.equal(semOrigem.image,undefined);
 assert.match(semOrigem.reply,/Confirmar\?/);
 delete process.env.WHATSAPP_APP_SECRET;const chave=process.env.SUPABASE_SERVICE_ROLE_KEY;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
 try{
  const semSegredo=await handleInbound({from:TELEFONE,text:'publica o 33-AD-22',type:'text'},chefe,{db:fakeDb({now:AGORA}),now:AGORA,origin:ORIGEM,anthropic:fakeAnthropic([
   usaFerramenta('procurar_viatura',{matricula:'33-AD-22'}),usaFerramenta('propor_estado_viatura',{viatura:'V1',estado:'published'})])});
  assert.equal(semSegredo.image,undefined);
  assert.match(semSegredo.reply,/Confirmar\?/);
 }finally{process.env.WHATSAPP_APP_SECRET=SEGREDO;if(chave)process.env.SUPABASE_SERVICE_ROLE_KEY=chave;}
});

await test('a new stock vehicle is created as a draft, attributed to whoever confirmed',async()=>{
 const db=fakeDb({now:AGORA});
 const ia=fakeAnthropic([
  usaFerramenta('propor_viatura_rascunho',{tipo:'car',marca:'bmw',modelo:'320d',versao:'M Sport',ano:2019,km:120000,
   combustivel:'Diesel',caixa:'Automática',segmento:'Berlina',preco:23500,matricula:'12-ab-34',cor:'Preto'}),
 ]);
 const deps={db,anthropic:ia,now:AGORA,origin:ORIGEM};
 const p=await handleInbound({from:TELEFONE,text:'cria um bmw 320d m sport de 2019...',type:'text'},chefe,deps);
 assert.match(espacos(p.reply),/criada em rascunho a viatura BMW 320d M Sport \(2019\).*120 000 km.*23 500/);
 const {id,exp,sig}=ligacao(p.image.url);
 const img=await loadPreview(db,id,exp,sig,AGORA,SEGREDO);
 assert.equal(img.card.title,'Viaturas · nova viatura');
 assert.ok(img.card.fields.some(f=>f.label==='Estado'&&f.value==='Rascunho'));
 const r=await handleInbound({from:TELEFONE,text:'ok',type:'text'},chefe,deps);
 assert.equal(r.wrote,true);
 const [w]=db.escritas();
 assert.equal(w.name,'wa_create_draft_car');
 assert.deepEqual(w.args,{actor:chefe.id,selected_type:'car',vehicle_make:'BMW',vehicle_model:'320d',vehicle_variant:'M Sport',
  vehicle_year:2019,km:120000,fuel_kind:'Diesel',gearbox:'Automática',body_kind:'Berlina',asking_price:23500,on_request:false,
  plate:'12-AB-34',paint:'Preto',door_count:5,seat_count:5,slug_base:'bmw-320d-m-sport-2019'});
 assert.equal(r.changed.kind,'create_draft_car');
 assert.equal(r.changed.carId,'00000000-0000-4000-8000-00000000abcd','o id da viatura criada');
});

await test('reserving or selling by message is explained, never proposed',async()=>{
 for(const [estado,frase] of [['reserved',REPLIES.reservaNoBackoffice],['sold',REPLIES.vendaNoBackoffice]]){
  const db=fakeDb({now:AGORA});
  const ia=fakeAnthropic([
   usaFerramenta('procurar_viatura',{matricula:'33-AD-22'}),
   usaFerramenta('propor_estado_viatura',{viatura:'V1',estado}),
  ]);
  const r=await handleInbound({from:TELEFONE,text:`marca o 33-AD-22 como ${estado}`,type:'text'},chefe,{db,anthropic:ia,now:AGORA,origin:ORIGEM});
  assert.equal(r.reply,frase);
  assert.equal(r.image,undefined);
  assert.equal(db._pendentes.length,0);
  assert.equal(db.escritas().length,0);
 }
});

await test('a lead is marked lost with its reason, and the person reads our words',async()=>{
 const db=fakeDb({now:AGORA});
 let visto='';
 const fila=[
  usaFerramenta('procurar_contacto',{texto:'joão silva'}),
  usaFerramenta('propor_estado_contacto',{contacto:'C1',estado:'lost',motivo:'Comprou noutro stand'}),
 ];
 const ia={chamadas:0,messages:{create:async(p)=>{ia.chamadas++;visto=JSON.stringify(p.messages);return fila.shift();}}};
 const deps={db,anthropic:ia,now:AGORA,origin:ORIGEM};
 const p=await handleInbound({from:TELEFONE,text:'o joão silva perdeu-se, comprou noutro stand',type:'text'},chefe,deps);
 assert.match(visto,/C1 · João Silva \(BMW 320\) · 912 345 678 · Novo/,'o modelo recebeu o contacto com identificador curto');
 assert.equal(visto.includes(LEAD),false,'nunca o id real');
 assert.match(p.reply,/João Silva.*«Novo» a «Perdido» — motivo: Comprou noutro stand/);
 assert.ok(p.image);
 const r=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefe,deps);
 assert.equal(r.wrote,true);
 assert.deepEqual(db.escritas().map(c=>[c.name,c.args]),[['wa_set_lead_status',{actor:chefe.id,lead:LEAD,new_status:'lost',reason:'Comprou noutro stand'}]]);
 assert.deepEqual(db._chamadas.find(c=>c.name==='wa_leads_for_actor').args,{actor:chefe.id,search:'joão silva',only_status:null});
});

await test('assigning a lead needs a contact AND a colleague from a search',async()=>{
 const db=fakeDb({now:AGORA});
 const ia=fakeAnthropic([
  usaFerramenta('procurar_contacto',{texto:'912345678'}),
  usaFerramenta('procurar_colaborador',{nome:'ana'},'t2'),
  usaFerramenta('propor_responsavel_contacto',{contacto:'C1',responsavel:'P1'},'t3'),
 ]);
 const deps={db,anthropic:ia,now:AGORA,origin:ORIGEM};
 const p=await handleInbound({from:TELEFONE,text:'passa o 912345678 para a ana',type:'text'},chefe,deps);
 assert.match(p.reply,/Ana Costa como responsável \(antes: Por atribuir\)/);
 await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefe,deps);
 assert.deepEqual(db.escritas().map(c=>[c.name,c.args]),[['wa_assign_lead',{actor:chefe.id,lead:LEAD,assignee:ANA}]]);

 // Um colaborador que nenhuma procura devolveu não existe.
 const db2=fakeDb({now:AGORA});
 const ia2=fakeAnthropic([
  usaFerramenta('procurar_contacto',{texto:'joão'}),
  usaFerramenta('propor_responsavel_contacto',{contacto:'C1',responsavel:'P9'},'t2'),
  diz('A quem atribuo?'),
 ]);
 const r=await handleInbound({from:TELEFONE,text:'atribui o joão',type:'text'},chefe,{db:db2,anthropic:ia2,now:AGORA});
 assert.equal(r.reply,'A quem atribuo?');
 assert.equal(db2._pendentes.length,0);
});

await test('a note on a lead and a testimonial approval follow the same two steps',async()=>{
 const db=fakeDb({now:AGORA});
 const deps={db,now:AGORA,origin:ORIGEM,anthropic:fakeAnthropic([
  usaFerramenta('procurar_contacto',{texto:'joão silva'}),
  usaFerramenta('propor_nota_contacto',{contacto:'C1',texto:'Ligou a pedir o IUC',tipo:'call'}),
 ])};
 const p=await handleInbound({from:TELEFONE,text:'regista que o joão silva ligou a pedir o IUC',type:'text'},vendedor,deps);
 assert.match(p.reply,/Vai ser registada uma chamada no contacto João Silva/);
 await handleInbound({from:TELEFONE,text:'sim',type:'text'},vendedor,deps);
 assert.deepEqual(db.escritas().map(c=>[c.name,c.args]),[['wa_add_lead_note',{actor:vendedor.id,lead:LEAD,note_kind:'call',note:'Ligou a pedir o IUC'}]]);

 const chefeT=toActor({id:'dddddddd-0000-4000-8000-000000000004',full_name:'Rui',role:'chefe'});
 const db2=fakeDb({now:AGORA});
 const deps2={db:db2,now:AGORA,origin:ORIGEM,anthropic:fakeAnthropic([
  usaFerramenta('procurar_testemunho',{por_aprovar:true}),
  usaFerramenta('propor_testemunho',{testemunho:'T1',acao:'aprovar'}),
 ])};
 const t=await handleInbound({from:TELEFONE,text:'aprova o testemunho da maria',type:'text'},chefeT,deps2);
 assert.match(t.reply,/aprovado e publicado no site o testemunho de Maria \(5\/5\)/);
 const {id,exp,sig}=ligacao(t.image.url);
 assert.equal((await loadPreview(db2,id,exp,sig,AGORA,SEGREDO)).card.title,'Testemunhos · aprovar');
 const r=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefeT,deps2);
 assert.deepEqual(db2.escritas().map(c=>[c.name,c.args]),[['wa_set_testimonial',{actor:chefeT.id,testimonial:TESTEMUNHO,publish:true}]]);
 assert.deepEqual(r.changed,{kind:'set_testimonial'});
});

await test('a missing section is refused in our words before anything is searched or proposed',async()=>{
 // O vendedor tem Viaturas e Leads, mas não Testemunhos: nem a procura corre.
 const db=fakeDb({now:AGORA});
 const ia=fakeAnthropic([usaFerramenta('procurar_testemunho',{por_aprovar:true})]);
 const r=await handleInbound({from:TELEFONE,text:'aprova os testemunhos',type:'text'},vendedor,{db,anthropic:ia,now:AGORA});
 assert.equal(r.reply,'Não tem acesso a Testemunhos. Fale com o responsável.');
 assert.equal(ia.chamadas,1,'a recusa é nossa, o modelo não volta a ser chamado');
 assert.equal(db._chamadas.some(c=>c.name==='wa_testimonials_for_actor'),false);
 // O mecânico só tem a Oficina: não cria nem altera viaturas do stock — e é
 // recusado logo, não depois de lhe perguntarem o ano e os quilómetros.
 for(const [ferramenta,input] of [
  ['propor_viatura_rascunho',{marca:'BMW'}],
  ['propor_editar_viatura',{viatura:'V1',preco:1}],
  ['propor_estado_contacto',{contacto:'C1',estado:'closed'}],
 ]){
  const db2=fakeDb({now:AGORA});
  const r2=await handleInbound({from:TELEFONE,text:'x',type:'text'},mecanico,{db:db2,anthropic:fakeAnthropic([usaFerramenta(ferramenta,input)]),now:AGORA});
  assert.match(r2.reply,/^Não tem acesso a (Viaturas|Leads)\./,ferramenta);
  assert.equal(db2._pendentes.length,0);
  assert.equal(db2.escritas().length,0);
 }
});

await test('a refusal from the database at confirmation is explained, never shown raw',async()=>{
 const db=fakeDb({now:AGORA,rpc:{wa_set_car_status:async()=>({data:null,error:{message:'Termine a reserva antes de alterar a disponibilidade'}})}});
 const ia=fakeAnthropic([
  usaFerramenta('procurar_viatura',{matricula:'33-AD-22'}),
  usaFerramenta('propor_estado_viatura',{viatura:'V1',estado:'published'}),
 ]);
 const deps={db,anthropic:ia,now:AGORA};
 await handleInbound({from:TELEFONE,text:'publica o 33-AD-22',type:'text'},chefe,deps);
 const r=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefe,deps);
 assert.equal(r.reply,REPLIES.reservaAtiva);
 assert.equal(r.wrote,false);
 assert.equal(r.changed,undefined);
 assert.equal(db._pendentes[0].status,'cancelled');
});

await test('nothing can be deleted through this channel',async()=>{
 // Nem ferramenta, nem acção, nem código que apague.
 for(const t of WA_TOOLS)assert.doesNotMatch(t.name+' '+t.description,/apag[ae]r?\b|elimin|delete|remov/i,t.name);
 // O percurso de uma mensagem (account.ts fica de fora: é o «Desligar número»
 // do backoffice, que não passa pelo assistente).
 for(const f of ['handle','actions','tools','describe','data','memory','delivery','preview','confirm','match']){
  const src=readFileSync(`src/lib/whatsapp/${f}.ts`,'utf8');
  assert.doesNotMatch(src,/\.delete\(/,f);
 }
 assert.doesNotMatch(readFileSync('src/app/api/whatsapp/route.ts','utf8'),/\.delete\(/);
});

// ---------------------------------------------------------------------------
// Página inicial e Definições (0040): ver_site → propor_alterar_site → imagem
// com «antes → depois» de cada campo que muda → «sim» → RPC com o formulário
// validado pelo mesmo esquema do backoffice.
// ---------------------------------------------------------------------------

const {SITE_REPLIES}=load('src/lib/whatsapp/site.ts');
const SHOWROOM={
 locations:[{id:'sede',name:'Sede',address:'Rua 1',city:'Lisboa',postalCode:'1000-001',phone:'21 000 0000',
  email:'geral@example.test',hours:'Seg a Sex 9h-19h; Sáb 9h-13h',latitude:null,longitude:null}],
 faqs:[{question:'Posso visitar?',answer:'Sim.',category:'geral'}],
 services:['financiamento','garantia','oficina','encomendas'].map(id=>({id,title:id,summary:'Resumo',body:'Texto',enabled:true})),
 google:{enabled:false,placeId:'',mapsUrl:''},
};
const DEFINICOES={id:1,company_name:'Stand Teste',tagline:null,accent:'#112233',accent_soft:'#0E1C2A',
 whatsapp:'351910000000',messenger:null,workshop_hourly_rate:35};
const siteDb=()=>fakeDb({now:AGORA,tabelas:{
 site_settings:[DEFINICOES],
 site_content:[{key:'showroom',content:structuredClone(SHOWROOM)},{key:'home',content:{hero:{title:'Carros com história'}}}],
}});
const chefeSite=toActor({id:'eeeeeeee-0000-4000-8000-000000000005',full_name:'Rita',role:'chefe'});
/** Um chefe a quem deram o separador Definições: continua a não ser administrador. */
const chefeDefinicoes=toActor({id:'eeeeeeee-0000-4000-8000-000000000006',full_name:'Rui',role:'chefe',
 allowed_sections:['pagina-inicial','definicoes']});

await test('a phone and opening hours change shows before → after, and is written only after yes',async()=>{
 const db=siteDb();
 let visto='';
 const fila=[
  usaFerramenta('ver_site',{area:'stand',procura:'ponto de venda 1'}),
  usaFerramenta('propor_alterar_site',{area:'stand',alteracoes:[
   {campo:'locations.0.phone',valor:'21 999 9999'},
   {campo:'locations.0.hours',valor:'Seg a Sex 9h-19h; Sáb 10h-13h'},
  ]},'t2'),
 ];
 const ia={chamadas:0,messages:{create:async(p)=>{ia.chamadas++;visto=JSON.stringify(p.messages);return fila.shift();}}};
 const deps={db,anthropic:ia,now:AGORA,origin:ORIGEM};
 const p=await handleInbound({from:TELEFONE,text:'muda o horário de sábado para 10h–13h e põe o telefone 21 999 9999 no site',type:'text'},chefeSite,deps);
 assert.match(visto,/locations\.0\.phone · Telefone · ponto de venda 1 \(principal\) «Sede»: «21 000 0000»/,'o modelo leu o campo e o valor atual');
 assert.equal(db.escritas().length,0,'nada gravado antes do «sim»');
 assert.match(p.reply,/Vai ser alterado em Página inicial · serviços e pontos de venda:/);
 assert.match(p.reply,/Telefone · .*: «21 000 0000» → «21 999 9999»/);
 assert.match(p.reply,/Horários · .*Sáb 9h-13h» → «Seg a Sex 9h-19h; Sáb 10h-13h»/);
 assert.match(p.reply,/Confirmar\? Responda sim ou não\./);
 // A imagem: o formulário com SÓ os campos que mudam, atual e novo.
 const {id,exp,sig}=ligacao(p.image.url);
 const img=await loadPreview(db,id,exp,sig,AGORA,SEGREDO);
 assert.equal(img.card.title,'Página inicial · serviços e pontos de venda');
 assert.deepEqual(img.card.fields.map(f=>[f.before,f.value]),[
  ['21 000 0000','21 999 9999'],['Seg a Sex 9h-19h; Sáb 9h-13h','Seg a Sex 9h-19h; Sáb 10h-13h']]);
 assert.ok(img.card.fields.every(f=>f.label.startsWith('Telefone')||f.label.startsWith('Horários')));

 const antes=ia.chamadas;
 const r=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefeSite,deps);
 assert.equal(ia.chamadas,antes,'a confirmação não volta ao modelo');
 assert.equal(r.wrote,true,r.reply);
 assert.match(r.reply,/^Alterado em Página inicial/);
 const [w,...resto]=db.escritas();
 assert.equal(resto.length,0);
 assert.equal(w.name,'wa_update_showroom');
 assert.equal(w.args.actor,chefeSite.id);
 const esperado=structuredClone(SHOWROOM);
 esperado.locations[0].phone='21 999 9999';esperado.locations[0].hours='Seg a Sex 9h-19h; Sáb 10h-13h';
 assert.deepEqual(w.args.new_content,esperado,'o formulário inteiro, só com os dois campos mudados');
 assert.deepEqual(r.changed,{kind:'update_showroom'});
});

await test('a homepage title change can be declined, and nothing is written',async()=>{
 const db=siteDb();
 const ia=fakeAnthropic([
  usaFerramenta('ver_site',{area:'pagina_inicial',procura:'título'}),
  usaFerramenta('propor_alterar_site',{area:'pagina_inicial',alteracoes:[{campo:'hero.title',valor:'Os melhores usados de Lisboa'}]},'t2'),
 ]);
 const deps={db,anthropic:ia,now:AGORA,origin:ORIGEM};
 const p=await handleInbound({from:TELEFONE,text:'altera o título da página inicial para Os melhores usados de Lisboa',type:'text'},chefeSite,deps);
 assert.match(p.reply,/Título · topo \(carros\): «Carros com história» → «Os melhores usados de Lisboa»/);
 const {id,exp,sig}=ligacao(p.image.url);
 assert.equal((await loadPreview(db,id,exp,sig,AGORA,SEGREDO)).card.title,'Página inicial · textos');
 const nao=await handleInbound({from:TELEFONE,text:'não',type:'text'},chefeSite,deps);
 assert.equal(nao.reply,REPLIES.cancelado);
 assert.equal(db.escritas().length,0);
 assert.equal(db._pendentes[0].status,'cancelled');
 assert.equal(await loadPreview(db,id,exp,sig,AGORA,SEGREDO),null);
});

await test('settings: an administrator changes the site WhatsApp with the backoffice rule',async()=>{
 const db=siteDb();
 const ia=fakeAnthropic([
  usaFerramenta('propor_alterar_site',{area:'definicoes',alteracoes:[{campo:'whatsapp',valor:'912345678'},{campo:'messenger',valor:''}]}),
 ]);
 const deps={db,anthropic:ia,now:AGORA,origin:ORIGEM};
 const p=await handleInbound({from:TELEFONE,text:'o whatsapp do site passa a ser 912345678',type:'text'},chefe,deps);
 // O 351 vem do companySchema, como no formulário; o Messenger já estava vazio.
 assert.match(p.reply,/WhatsApp \(com indicativo\) · contactos: «351910000000» → «351912345678»/);
 assert.doesNotMatch(p.reply,/Messenger/);
 await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefe,deps);
 assert.deepEqual(db.escritas().map(c=>[c.name,c.args]),[['wa_update_site_settings',{actor:chefe.id,changes:{whatsapp:'351912345678'}}]]);
});

await test('forbidden fields are refused in our words, before anything is proposed',async()=>{
 for(const [quem,area,campo,valor,frase] of [
  [chefe,'definicoes','stripe_secret','sk_live_x',SITE_REPLIES.integracoes],
  [chefe,'definicoes','olx.token','x',SITE_REPLIES.integracoes],
  [chefe,'definicoes','ga4_id','G-ABC',SITE_REPLIES.integracoes],
  [chefe,'definicoes','logo_url','branding/x.png',SITE_REPLIES.imagens],
  [chefe,'definicoes','allowed_sections','x',SITE_REPLIES.utilizadores],
  // Admin-only no backoffice → admin-only aqui, mesmo com o separador.
  [chefeDefinicoes,'definicoes','company_name','Outro Stand',SITE_REPLIES.soAdmin],
  [chefeDefinicoes,'etiquetas','items.0.label','Outra',SITE_REPLIES.soAdmin],
  [chefeSite,'definicoes','company_name','Outro Stand','Não tem acesso a Definições. Fale com o responsável.'],
  [vendedor,'pagina_inicial','hero.title','x','Não tem acesso a Página inicial. Fale com o responsável.'],
  // Uma entrada nova numa lista é no backoffice.
  [chefeSite,'stand','locations.1.phone','21 000 0001',SITE_REPLIES.listas],
  // A validação é a do formulário.
  [chefeSite,'pagina_inicial','hero.title','  ','Não dá para alterar assim: Título obrigatório.'],
 ]){
  const db=siteDb();
  const ia=fakeAnthropic([usaFerramenta('propor_alterar_site',{area,alteracoes:[{campo,valor}]})]);
  const r=await handleInbound({from:TELEFONE,text:'x',type:'text'},quem,{db,anthropic:ia,now:AGORA,origin:ORIGEM});
  assert.equal(r.reply,frase,campo);
  assert.equal(r.image,undefined);
  assert.equal(db._pendentes.length,0,campo);
  assert.equal(db.escritas().length,0,campo);
 }
 // Nem a leitura se abre a quem não pode alterar.
 const db=siteDb();
 const ia=fakeAnthropic([usaFerramenta('ver_site',{area:'definicoes'})]);
 const r=await handleInbound({from:TELEFONE,text:'que cor tem o site?',type:'text'},chefeDefinicoes,{db,anthropic:ia,now:AGORA});
 assert.equal(r.reply,SITE_REPLIES.soAdmin);
 assert.equal(ia.chamadas,1);
});

await test('a site change that no longer fits at confirmation is explained, not forced',async()=>{
 const db=siteDb();
 const ia=fakeAnthropic([
  usaFerramenta('propor_alterar_site',{area:'stand',alteracoes:[{campo:'locations.0.phone',valor:'21 999 9999'}]}),
 ]);
 const deps={db,anthropic:ia,now:AGORA};
 await handleInbound({from:TELEFONE,text:'telefone 21 999 9999',type:'text'},chefeSite,deps);
 // Entretanto alguém retirou o ponto de venda no backoffice.
 const conteudo=structuredClone(SHOWROOM);conteudo.locations=[];
 const linhas=db._pendentes;assert.equal(linhas.length,1);
 const outra=fakeDb({now:AGORA,tabelas:{site_settings:[DEFINICOES],site_content:[{key:'showroom',content:conteudo}]}});
 outra._pendentes.push(...linhas);
 const r=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefeSite,{db:outra,anthropic:ia,now:AGORA});
 assert.equal(r.reply,SITE_REPLIES.mudou);
 assert.equal(r.wrote,false);
 assert.equal(outra.escritas().length,0);
});
