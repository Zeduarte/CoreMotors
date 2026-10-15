// Fotografias das viaturas pelo WhatsApp, contra uma Meta, uma base de dados e
// um Storage simulados.
//
// O que isto prova: que a fotografia é descarregada da Meta com o token do
// número e guardada num bucket PRIVADO; que formatos e tamanhos fora do
// permitido são recusados antes de se guardar o que quer que seja; que várias
// fotografias seguidas dão UMA proposta (e as seguintes juntam-se a ela); que a
// imagem da proposta mostra a viatura e as miniaturas; que só o «sim» as põe na
// galeria, com a regra de capa do backoffice; que o «não» as descarta; e que um
// número desconhecido não chega sequer a descarregar nada.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import http from 'node:http';
import sharp from 'sharp';
import { createHmac, randomUUID } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);

// ---- Meta simulada ----------------------------------------------------------
const TOKEN='EAAG-token-da-empresa';
const meta={calls:[],sent:[],files:new Map()};
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;
 const url=new URL(req.url,'http://x');
 meta.calls.push(`${req.method} ${url.pathname}`);
 const send=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
 if(req.headers.authorization!==`Bearer ${TOKEN}`)return send(401,{error:{message:'Invalid OAuth access token.'}});
 let m=url.pathname.match(/^\/v25\.0\/(\d+)\/messages$/);
 if(m&&req.method==='POST'){meta.sent.push(JSON.parse(raw));return send(200,{messages:[{id:`wamid.out${meta.sent.length}`}]});}
 // GET /{media-id}: o link curto para o ficheiro.
 m=url.pathname.match(/^\/v25\.0\/(\d+)$/);
 if(m&&req.method==='GET'){
  const f=meta.files.get(m[1]);
  if(!f)return send(404,{error:{message:'Unsupported get request.'}});
  return send(200,{url:`${process.env.WHATSAPP_GRAPH_BASE_URL}/media/${m[1]}`,mime_type:f.mime,
   ...(f.declared!==null?{file_size:f.declared??f.buf.length}:{}),id:m[1]});
 }
 m=url.pathname.match(/^\/media\/(\d+)$/);
 if(m&&req.method==='GET'){
  const f=meta.files.get(m[1]);
  res.writeHead(200,{'Content-Type':f.mime});return res.end(f.buf);
 }
 send(404,{error:{message:'not simulated'}});
});
await new Promise(r=>server.listen(0,r));
process.env.WHATSAPP_GRAPH_BASE_URL=`http://127.0.0.1:${server.address().port}`;
delete process.env.WHATSAPP_GRAPH_VERSION;
process.env.WHATSAPP_APP_SECRET='segredo-de-teste';
delete process.env.ANTHROPIC_API_KEY;
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.SUPABASE_SERVICE_ROLE_KEY;
const NUMERO={phoneNumberId:'222',accessToken:TOKEN,source:'backoffice'};

let mediaN=0;
/** Põe um ficheiro na Meta e devolve o `media` como vem no webhook. */
function naMeta(buf,{mime='image/jpeg',caption='',declared}={}){
 const id=String(7000+(++mediaN));
 meta.files.set(id,{buf,mime,declared});
 return {id,mime,caption};
}
const foto=(w=640,h=480,cor={r:200,g:20,b:20})=>sharp({create:{width:w,height:h,channels:3,background:cor}}).jpeg().toBuffer();
const png=()=>sharp({create:{width:300,height:200,channels:4,background:{r:0,g:0,b:255,alpha:0.5}}}).png().toBuffer();

// ---- Base de dados e Storage em memória ------------------------------------
const CARRO='11111111-1111-4111-8111-111111111111';
const OUTRO='33333333-3333-4333-8333-333333333333';
const MOTA='22222222-2222-4222-8222-222222222222';
const TELEFONE='351916193337';

function fakeDb({frota,cars,media=[]}={}){
 const t={wa_media:[],wa_pending_actions:[],wa_conversation:[],wa_messages:[],car_media:[...media],
  cars:cars??[{id:CARRO,make:'Bmw',model:'320',variant:'d',year:2019,price:23500,price_on_request:false,status:'published',license_plate:'33-AD-22',vehicle_type:'car'},
   {id:OUTRO,make:'BMW',model:'320',variant:null,year:2018,price:21000,price_on_request:false,status:'published',license_plate:'44-VS-23',vehicle_type:'car'},
   {id:MOTA,make:'Honda',model:'CB500',variant:null,year:2021,price:6000,price_on_request:false,status:'draft',license_plate:'55-HH-55',vehicle_type:'motorcycle'}],
  site_settings:[{id:1,company_name:'Stand Teste',accent:'#112233'}],reservations:[],profiles:[],whatsapp_connection:[]};
 const viaturas=frota??[
  {id:CARRO,make:'BMW',model:'320',variant:'d',color:'Preto',license_plate:'33-AD-22',status:'published',vehicle_type:'car'},
  {id:MOTA,make:'Honda',model:'CB500',variant:null,color:'Vermelho',license_plate:'55-HH-55',status:'draft',vehicle_type:'motorcycle'},
 ];
 const rpcs=[];let seq=0;
 const buckets={'wa-media':new Map(),'car-media':new Map()};
 const from=(table)=>{
  const f=[];let op='select',patch=null,rows=null,order=null,limit=null,returning=false;
  const hit=(r)=>f.every(fn=>fn(r));
  const run=()=>{
   const all=t[table]??=[];
   if(op==='insert'){
    for(const raw of rows){
     const row={...raw};
     if(table==='wa_media'){
      if(all.some(r=>r.media_id===row.media_id))return {data:null,error:{message:'duplicate key value violates unique constraint'}};
      Object.assign(row,{seq:++seq,status:'staged',created_at:new Date().toISOString(),caption:row.caption??'',settled_at:null,car_media_id:null},raw);
     }
     if(table==='wa_pending_actions'){
      if(all.some(r=>r.from_phone===row.from_phone&&r.status==='pending'))return {data:null,error:{message:'duplicate key value violates unique constraint'}};
      Object.assign(row,{status:'pending',created_at:new Date().toISOString(),expires_at:new Date(Date.now()+600000).toISOString(),settled_at:null,result_id:null},raw);
     }
     if(table==='wa_messages'&&all.some(r=>r.wam_id===row.wam_id))return {data:null,error:{message:'duplicate key'}};
     // Por ordem estrita, como o id da tabela (bigserial).
     if(table==='wa_conversation')row.created_at=new Date(Date.now()-60000+(++seq)).toISOString();
     all.push(row);
    }
    return {data:null,error:null};
   }
   let out=all.filter(hit);
   if(op==='update'){for(const r of out)Object.assign(r,patch);return {data:returning?out.map(r=>({...r})):null,error:null};}
   if(order)out=[...out].sort((a,b)=>(a[order.col]>b[order.col]?1:a[order.col]<b[order.col]?-1:0)*(order.asc?1:-1));
   if(limit!==null)out=out.slice(0,limit);
   return {data:out.map(r=>({...r})),error:null};
  };
  const api={
   select(){if(op==='update')returning=true;return api;},
   eq(c,v){f.push(r=>r[c]===v);return api;},
   in(c,v){f.push(r=>v.includes(r[c]));return api;},
   gte(c,v){f.push(r=>r[c]!=null&&r[c]>=v);return api;},
   lt(c,v){f.push(r=>r[c]!=null&&r[c]<v);return api;},
   order(c,o={}){order={col:c,asc:o.ascending!==false};return api;},
   limit(n){limit=n;return api;},
   insert(r){op='insert';rows=Array.isArray(r)?r:[r];return api;},
   update(p){op='update';patch=p;return api;},
   upsert(r){op='insert';rows=[r];return api;},
   async maybeSingle(){const {data,error}=run();return {data:Array.isArray(data)?data[0]??null:data,error};},
   then(res,rej){return Promise.resolve(run()).then(res,rej);},
  };
  return api;
 };
 const storage={from:(b)=>({
  async upload(path,buf,opts){
   const m=buckets[b];if(!m)return {error:{message:'Bucket not found'}};
   if(m.has(path)&&!opts?.upsert)return {error:{message:'The resource already exists'}};
   m.set(path,{buf:Buffer.isBuffer(buf)?buf:Buffer.from(buf),opts});return {data:{path},error:null};
  },
  async download(path){const o=buckets[b]?.get(path);return o?{data:new Blob([o.buf]),error:null}:{data:null,error:{message:'Object not found'}};},
  async remove(paths){for(const p of paths)buckets[b]?.delete(p);return {data:[],error:null};},
 })};
 const rpc=async(name,args)=>{
  rpcs.push({name,args});
  if(name==='wa_vehicles_for_actor')return {data:viaturas,error:null};
  if(name==='wa_actor_for_phone')return {data:t.profiles.find(p=>p.phone===args.raw_phone)?.id??null,error:null};
  if(name==='prune_wa_media'){
   const antes=t.wa_media.length;
   t.wa_media=t.wa_media.filter(r=>!(args.ids.includes(r.id)&&r.created_at<new Date(Date.now()-2*86400000).toISOString()));
   return {data:antes-t.wa_media.length,error:null};
  }
  if(name==='wa_add_car_media'){
   // As regras da 0039 (testadas a sério em database.test.mjs), em miniatura.
   const existentes=t.car_media.filter(m=>m.car_id===args.car);
   let pos=existentes.reduce((m,r)=>Math.max(m,r.position),-1)+1;
   const capa=!existentes.some(m=>m.is_cover||m.kind==='image');
   args.items.forEach((it,i)=>{
    const m=t.wa_media.find(r=>r.id===it.media);
    if(!m||m.status!=='staged'||m.actor_id!==args.actor)throw new Error('teste: fotografia inválida');
    if(!it.path.startsWith(`${args.car}/`))throw new Error('teste: caminho');
    const id=randomUUID();
    t.car_media.push({id,car_id:args.car,kind:'image',storage_path:it.path,width:it.width,height:it.height,position:pos++,is_cover:capa&&i===0});
    Object.assign(m,{status:'attached',car_media_id:id});
   });
   return {data:args.car,error:null};
  }
  return {data:null,error:{message:`rpc não simulada: ${name}`}};
 };
 return {from,rpc,storage,_t:t,_rpcs:rpcs,_buckets:buckets};
}

// ---- Modelo simulado ---------------------------------------------------------
function fakeAnthropic(guiao){
 const fila=[...guiao];
 const fake={chamadas:0,pedidos:[],messages:{create:async(p)=>{
  fake.chamadas++;fake.pedidos.push(JSON.parse(JSON.stringify(p)));
  const proxima=fila.shift();
  if(!proxima)throw new Error('o guião acabou');
  return proxima;
 }}};
 return fake;
}
const usaFerramenta=(name,input,id='t1')=>({id:'m',type:'message',role:'assistant',model:'x',stop_reason:'tool_use',content:[{type:'tool_use',id,name,input}]});
const diz=(text)=>({id:'m',type:'message',role:'assistant',model:'x',stop_reason:'end_turn',content:[{type:'text',text}]});

// ---- Carregador, com `server-only` neutralizado e módulos substituíveis ----
const cache=new Map();
const stubs=new Map();
function withExt(base){for(const ext of ['.ts','.tsx','/index.ts'])if(existsSync(base+ext))return base+ext;throw new Error(`não resolvido: ${base}`);}
function load(path){
 if(cache.has(path))return cache.get(path);
 const {outputText}=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}});
 const mod={exports:{}};cache.set(path,mod.exports);
 const r=(id)=>stubs.has(id)?stubs.get(id):id==='server-only'?{}:id.startsWith('@/')?load(withExt(`src/${id.slice(2)}`)):id.startsWith('.')?load(withExt(new URL(id,new URL(path,'file:///')).pathname.slice(1))):require(id);
 new Function('module','exports','require',outputText)(mod,mod.exports,r);
 cache.set(path,mod.exports);return mod.exports;}

const {handleInbound,toActor}=load('src/lib/whatsapp/handle.ts');
const {PHOTO_REPLIES,downloadMedia,pruneWaMedia}=load('src/lib/whatsapp/photos.ts');
const {extractMessages}=load('src/lib/whatsapp/payload.ts');
const {loadPreview}=load('src/lib/whatsapp/preview.ts');
const {REPLIES}=load('src/lib/whatsapp/replies.ts');

const chefe=toActor({id:'aaaaaaaa-0000-4000-8000-000000000001',full_name:'Ana',role:'admin'});
const mecanico=toActor({id:'bbbbbbbb-0000-4000-8000-000000000002',full_name:'Bruno',role:'mecanico'});
const ORIGEM='https://stand.example.pt';

/** Uma espera que só acaba quando `n` fotografias lá chegaram: a rajada inteira. */
function rajada(n){let k=0,abre;const todas=new Promise(r=>abre=r);return async()=>{if(++k>=n)abre();await todas;};}
const semEspera=async()=>{};
const deps=(db,extra={})=>({db,anthropic:fakeAnthropic([]),origin:ORIGEM,number:NUMERO,wait:semEspera,...extra});
const recebe=(db,media,actor=chefe,extra={})=>handleInbound({from:TELEFONE,text:'',type:'image',media},actor,deps(db,extra));
const ligacao=(url)=>{const u=new URL(url);return {id:u.pathname.split('/').pop(),exp:u.searchParams.get('exp'),sig:u.searchParams.get('sig')};};
const espacos=(s)=>s.replace(/\s/g,' ');

await test('WhatsApp image and image documents are read as photos, with the caption',()=>{
 const env=(msgs)=>({entry:[{changes:[{value:{metadata:{phone_number_id:'222'},messages:msgs}}]}]});
 const [img,doc,pdf]=extractMessages(env([
  {id:'w1',from:TELEFONE,type:'image',image:{id:'1',mime_type:'image/jpeg',caption:'fotos do bmw'}},
  {id:'w2',from:TELEFONE,type:'document',document:{id:'2',mime_type:'image/png',filename:'a.png'}},
  {id:'w3',from:TELEFONE,type:'document',document:{id:'3',mime_type:'application/pdf'}},
 ]));
 assert.deepEqual(img.media,{id:'1',mime:'image/jpeg',caption:'fotos do bmw'});
 assert.deepEqual(doc.media,{id:'2',mime:'image/png',caption:''});
 assert.equal(pdf.media,undefined,'um PDF não é uma fotografia');
});

await test('a photo is downloaded with the number token, reduced and kept in the private bucket',async()=>{
 meta.calls.length=0;
 const db=fakeDb();
 const media=naMeta(await foto(3000,2000),{caption:'fotos do bmw 320 preto'});
 const r=await recebe(db,media);
 // A Meta: primeiro o link, depois o ficheiro — os dois com o token.
 assert.deepEqual(meta.calls,[`GET /v25.0/${media.id}`,`GET /media/${media.id}`]);
 const [path,obj]=[...db._buckets['wa-media'].entries()][0];
 assert.match(path,new RegExp(`^${chefe.id}/[0-9a-f-]{36}\\.jpg$`));
 const info=await sharp(obj.buf).metadata();
 assert.equal(info.format,'jpeg');assert.equal(Math.max(info.width,info.height),2400,'reduzida como no backoffice');
 assert.equal(db._buckets['car-media'].size,0,'nada na galeria antes do «sim»');
 // A legenda chegou para saber a viatura: proposta, com imagem, sem o modelo.
 assert.equal(r.wrote,false);
 assert.ok(espacos(r.reply).startsWith('Vai ser juntada 1 fotografia à viatura BMW 320, matrícula 33-AD-22. Passa a ser a capa. A viatura está publicada: aparecem logo no site.'),r.reply);
 assert.match(r.reply,/Confirmar\? Responda sim ou não\.$/);
 assert.ok(r.image.url.startsWith(`${ORIGEM}/api/whatsapp/preview/`));
 const p=db._t.wa_pending_actions[0];
 assert.equal(p.kind,'add_car_media');assert.equal(p.payload.carId,CARRO);
 assert.deepEqual(p.payload.fotos,[db._t.wa_media[0].id]);
 assert.equal(db._t.wa_media[0].caption,'fotos do bmw 320 preto');
});

await test('several photos in a row become one proposal, answered once; later ones join it',async()=>{
 const db=fakeDb();
 const espera=rajada(3);
 const medias=[naMeta(await foto(),{caption:'bmw 320 preto'}),naMeta(await foto()),naMeta(await png(),{mime:'image/png'})];
 const respostas=await Promise.all(medias.map(m=>recebe(db,m,chefe,{wait:espera})));
 const ditas=respostas.filter(r=>r.reply);
 assert.equal(ditas.length,1,'uma resposta para a rajada inteira');
 assert.match(espacos(ditas[0].reply),/Vão ser juntadas 3 fotografias à viatura BMW 320/);
 assert.equal(db._t.wa_pending_actions.length,1);
 const p=db._t.wa_pending_actions[0];
 assert.deepEqual(p.payload.fotos,db._t.wa_media.map(m=>m.id),'pela ordem de chegada');

 // Mais uma, a seguir: junta-se à mesma proposta, que é actualizada.
 const quarta=await recebe(db,naMeta(await foto()));
 assert.equal(db._t.wa_pending_actions.length,1,'não se cria outra proposta');
 assert.equal(p.payload.fotos.length,4);
 assert.match(espacos(quarta.reply),/Vão ser juntadas 4 fotografias/);
 assert.equal(quarta.image.pendingId,p.id);
 assert.equal(p.summary,quarta.reply);

 // A imagem da proposta: a viatura e as miniaturas das quatro.
 const {id,exp,sig}=ligacao(quarta.image.url);
 const img=await loadPreview(db,id,exp,sig,new Date());
 assert.equal(img.card.title,'Viaturas · fotografias');
 const campos=Object.fromEntries(img.card.fields.map(f=>[f.label,espacos(f.value)]));
 assert.equal(campos['Matrícula'],'33-AD-22');assert.equal(campos['Ano'],'2019');
 assert.equal(campos['Preço'],'23 500 €');assert.equal(campos['Fotografias novas'],'4');
 assert.equal(campos['Capa'],'A primeira destas');
 assert.equal(img.card.photos.length,4);
 for(const ph of img.card.photos){
  assert.match(ph,/^data:image\/jpeg;base64,/,'desenhada a partir do bucket, nunca por link');
  const meta=await sharp(Buffer.from(ph.split(',')[1],'base64')).metadata();
  assert.equal(meta.width,240);
 }
 assert.doesNotMatch(JSON.stringify(img.card.fields)+img.card.subject,/wa-media|https?:/);

 // «sim»: copiadas para a galeria da viatura, pela RPC, com a capa.
 const antes=db._rpcs.length;
 const recibo=await handleInbound({from:TELEFONE,text:'sim',type:'text'},chefe,deps(db));
 assert.equal(recibo.wrote,true);
 assert.deepEqual(recibo.changed,{kind:'add_car_media',carId:CARRO},'para limpar a cache do site e avisar o OLX');
 assert.match(espacos(recibo.reply),/Juntadas 4 fotografias à viatura BMW 320, matrícula 33-AD-22\. A primeira ficou como capa\. Já aparecem no site\./);
 const chamada=db._rpcs.slice(antes).find(c=>c.name==='wa_add_car_media');
 assert.equal(chamada.args.actor,chefe.id,'atribuída a quem confirmou');
 assert.equal(chamada.args.car,CARRO);
 assert.deepEqual(chamada.args.items.map(i=>i.media),p.payload.fotos);
 for(const it of chamada.args.items){
  assert.match(it.path,new RegExp(`^${CARRO}/[0-9a-f-]{36}\\.jpg$`),'o caminho do backoffice');
  const o=db._buckets['car-media'].get(it.path);
  assert.ok(o,'o ficheiro está na galeria');
  assert.equal(o.opts.cacheControl,'31536000');
 }
 assert.deepEqual(db._t.car_media.map(m=>[m.position,m.is_cover]),[[0,true],[1,false],[2,false],[3,false]]);
 assert.equal(db._buckets['wa-media'].size,0,'a cópia privada saiu');
 assert.equal(p.status,'confirmed');
 assert.equal(await loadPreview(db,id,exp,sig,new Date()),null,'respondida, a imagem deixa de existir');
});

await test('"não" discards the photos and puts nothing in the gallery',async()=>{
 const db=fakeDb();
 await recebe(db,naMeta(await foto(),{caption:'bmw 320'}),chefe);
 // Só um BMW 320 na frota por defeito: proposta directa.
 assert.equal(db._t.wa_pending_actions.length,1);
 const r=await handleInbound({from:TELEFONE,text:'não',type:'text'},chefe,deps(db));
 assert.equal(r.reply,REPLIES.cancelado);
 assert.equal(db._t.wa_media[0].status,'discarded');
 assert.equal(db._buckets['wa-media'].size,0,'o ficheiro saiu do bucket privado');
 assert.equal(db._t.car_media.length,0);
 assert.equal(db._rpcs.some(c=>c.name==='wa_add_car_media'),false);
});

await test('an ambiguous caption is asked about, listing the candidates; the answer proposes',async()=>{
 const db=fakeDb({frota:[
  {id:CARRO,make:'BMW',model:'320',color:'Preto',license_plate:'33-AD-22',status:'published',vehicle_type:'car'},
  {id:OUTRO,make:'BMW',model:'320',color:'Cinzento',license_plate:'44-VS-23',status:'published',vehicle_type:'car'},
 ]});
 const espera=rajada(2);
 const ia=fakeAnthropic([
  usaFerramenta('procurar_viatura',{matricula:'44-VS-23'}),
  usaFerramenta('propor_fotos_viatura',{viatura:'V1'},'t2'),
 ]);
 const rs=await Promise.all([naMeta(await foto(),{caption:'bmw 320'}),naMeta(await foto())]
  .map(m=>handleInbound({from:TELEFONE,text:'',type:'image',media:m},chefe,deps(db,{anthropic:ia,wait:espera}))));
 const pergunta=rs.find(r=>r.reply).reply;
 assert.equal(ia.chamadas,0,'a pergunta é nossa, não do modelo');
 assert.match(pergunta,/^Para que viatura são estas 2 fotografias\?/);
 assert.match(pergunta,/33-AD-22/);assert.match(pergunta,/44-VS-23/);
 assert.equal(db._t.wa_pending_actions.length,0,'nada se propõe sem saber a viatura');
 // A memória fica com as fotografias e a pergunta.
 assert.deepEqual(db._t.wa_conversation.map(c=>c.role),['user','assistant']);
 assert.match(db._t.wa_conversation[0].content,/2 fotografias recebidas/);

 // A resposta da pessoa é texto normal: o modelo sabe que há fotografias à espera.
 const r=await handleInbound({from:TELEFONE,text:'é o 44-VS-23',type:'text'},chefe,deps(db,{anthropic:ia}));
 const sistema=JSON.stringify(ia.pedidos[0].system);
 assert.match(sistema,/FOTOGRAFIAS À ESPERA/);assert.match(sistema,/2 fotografias/);
 assert.match(JSON.stringify(ia.pedidos[0].messages),/Para que viatura são estas 2 fotografias/);
 assert.match(espacos(r.reply),/Vão ser juntadas 2 fotografias à viatura BMW 320, matrícula 44-VS-23/);
 assert.equal(db._t.wa_pending_actions[0].payload.carId,OUTRO);
 assert.equal(db._t.wa_pending_actions[0].payload.fotos.length,2);
});

await test('without a caption, the car just handled in this conversation is proposed',async()=>{
 const db=fakeDb();
 // «cria o BMW» → «sim» há cinco minutos.
 db._t.wa_pending_actions.push({id:randomUUID(),from_phone:TELEFONE,kind:'create_draft_car',payload:{},status:'confirmed',
  result_id:CARRO,settled_at:new Date(Date.now()-300000).toISOString(),expires_at:new Date().toISOString()});
 const ia=fakeAnthropic([]);
 const r=await recebe(db,naMeta(await foto()),chefe,{anthropic:ia});
 assert.equal(ia.chamadas,0);
 assert.match(espacos(r.reply),/Vai ser juntada 1 fotografia à viatura BMW 320, matrícula 33-AD-22/);
});

await test('with no clue at all, the model gets the photos and the conversation, and asks',async()=>{
 const db=fakeDb();
 const ia=fakeAnthropic([diz('Para que viatura é esta fotografia? Indique a matrícula.')]);
 const r=await recebe(db,naMeta(await foto()),chefe,{anthropic:ia});
 assert.equal(ia.chamadas,1);
 assert.match(JSON.stringify(ia.pedidos[0].messages),/\[Fotografias\] A pessoa mandou 1 fotografia/);
 assert.match(JSON.stringify(ia.pedidos[0].system),/propor_fotos_viatura/);
 assert.equal(r.reply,'Para que viatura é esta fotografia? Indique a matrícula.');
 assert.equal(db._t.wa_media[0].status,'staged','fica à espera da resposta');
});

await test('formats and sizes outside the allowlist are refused before anything is stored',async()=>{
 const db=fakeDb();
 meta.calls.length=0;
 // HEIC (o servidor não o sabe reduzir): recusado sem ir à Meta.
 const heic=await recebe(db,{id:'9001',mime:'image/heic',caption:''});
 assert.equal(heic.reply,PHOTO_REPLIES.formato);
 assert.equal(meta.calls.length,0);
 // Grande demais, pelo tamanho que a Meta indica: o ficheiro nem se descarrega.
 const grande=naMeta(await foto(),{declared:20*1024*1024});
 assert.equal((await recebe(db,grande)).reply,PHOTO_REPLIES.grande);
 assert.equal(meta.calls.includes(`GET /media/${grande.id}`),false);
 // Sem tamanho indicado: corta-se a meio da leitura.
 const semTamanho=naMeta(Buffer.alloc(5000,1),{declared:null});
 const d=await downloadMedia(semTamanho.id,NUMERO,1000);
 assert.deepEqual([d.ok,d.reason],[false,'grande']);
 // Diz que é JPEG mas não é uma imagem.
 assert.equal((await recebe(db,naMeta(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>')))).reply,PHOTO_REPLIES.ilegivel);
 // Sem token: não se descarrega nada.
 assert.equal((await handleInbound({from:TELEFONE,text:'',type:'image',media:naMeta(await foto())},chefe,deps(db,{number:null}))).reply,PHOTO_REPLIES.naoDescarregou);
 assert.equal(db._t.wa_media.length,0);
 assert.equal(db._buckets['wa-media'].size,0);
});

await test('without Vehicles the photo is refused in our words, before any download',async()=>{
 meta.calls.length=0;
 const db=fakeDb();
 const r=await recebe(db,naMeta(await foto()),mecanico);
 assert.equal(r.reply,REPLIES.semSecao('Viaturas'));
 assert.equal(meta.calls.length,0);
 // E um vendedor só de carros não junta fotografias a uma mota.
 const soCarros=toActor({id:'cccccccc-0000-4000-8000-000000000003',full_name:'Carla',role:'vendedor',allowed_vehicle_types:['car']});
 const m=await recebe(db,naMeta(await foto(),{caption:'honda cb500'}),soCarros);
 assert.match(m.reply,/Não tem acesso a motas/);
 assert.equal(db._t.wa_pending_actions.length,0);
});

await test('a photo while another question is waiting does not replace that question',async()=>{
 const db=fakeDb();
 db._t.wa_pending_actions.push({id:randomUUID(),from_phone:TELEFONE,kind:'add_cost',payload:{},summary:'x',status:'pending',
  expires_at:new Date(Date.now()+60000).toISOString()});
 const r=await recebe(db,naMeta(await foto(),{caption:'bmw 320'}));
 assert.equal(r.reply,PHOTO_REPLIES.primeiroResponda(1));
 assert.equal(db._t.wa_pending_actions.length,1);
 assert.equal(db._t.wa_pending_actions[0].status,'pending','a pergunta anterior continua de pé');
 assert.equal(db._t.wa_media[0].status,'staged');
});

await test('the maintenance removes old photos with their files, and only those',async()=>{
 const db=fakeDb();
 const velho=new Date(Date.now()-3*86400000).toISOString();
 db._t.wa_media.push({id:'a',storage_path:'x/a.jpg',created_at:velho,status:'staged'},{id:'b',storage_path:'x/b.jpg',created_at:new Date().toISOString(),status:'staged'});
 db._buckets['wa-media'].set('x/a.jpg',{buf:Buffer.alloc(1)});db._buckets['wa-media'].set('x/b.jpg',{buf:Buffer.alloc(1)});
 assert.equal(await pruneWaMedia(db),1);
 assert.deepEqual([...db._buckets['wa-media'].keys()],['x/b.jpg']);
 assert.deepEqual(db._t.wa_media.map(r=>r.id),['b']);
 assert.deepEqual(db._rpcs.at(-1),{name:'prune_wa_media',args:{ids:['a']}});
});

await test('nothing in the photo path deletes rows',()=>{
 for(const f of ['photos','thumbnails'])assert.doesNotMatch(readFileSync(`src/lib/whatsapp/${f}.ts`,'utf8'),/\.delete\(/,f);
});

// ---- O webhook inteiro -------------------------------------------------------
// A rota com a base de dados simulada: um número desconhecido não descarrega
// nada; um conhecido recebe a proposta em imagem.
class FakeResponse extends Response{static json(b,i){return Response.json(b,i);}}
stubs.set('next/server',{NextResponse:FakeResponse});
let rotaDb=null;
stubs.set('@/lib/supabase/admin',{createAdminClient:()=>rotaDb});
stubs.set('@/lib/public-submissions',{publicSubmissionClient:async()=>null});
stubs.set('@/lib/whatsapp/after-write',{afterWrite:async()=>{}});
const {POST}=load('src/app/api/whatsapp/route.ts');
const webhook=(from,media)=>{
 const raw=JSON.stringify({entry:[{changes:[{value:{metadata:{phone_number_id:'222'},
  messages:[{id:`wamid.in.${randomUUID()}`,from,type:'image',image:{id:media.id,mime_type:media.mime,caption:media.caption}}]}}]}]});
 const sig='sha256='+createHmac('sha256',process.env.WHATSAPP_APP_SECRET).update(raw,'utf8').digest('hex');
 return new Request('https://stand.example.pt/api/whatsapp',{method:'POST',body:raw,headers:{'x-hub-signature-256':sig}});
};

await test('the webhook ignores photos from unknown numbers and answers known staff once',async()=>{
 rotaDb=fakeDb();
 rotaDb._t.whatsapp_connection.push({id:1,phone_number_id:'222',access_token:TOKEN});
 rotaDb._t.profiles.push({id:chefe.id,full_name:'Ana',role:'admin',phone:TELEFONE,allowed_sections:null,allowed_vehicle_types:null});
 meta.calls.length=0;meta.sent.length=0;
 const estranha=naMeta(await foto(),{caption:'bmw 320'});
 const r=await POST(webhook('351999999999',estranha));
 assert.equal(r.status,200);
 assert.equal(meta.calls.some(c=>c.includes(estranha.id)),false,'nada descarregado');
 assert.equal(meta.sent.length,0,'nem resposta, nem vistos');
 assert.equal(rotaDb._t.wa_media.length,0);
 assert.match(rotaDb._t.wa_messages[0].last_error,/sem perfil/);

 const boa=naMeta(await foto(),{caption:'bmw 320 preto'});
 const ok=await POST(webhook(TELEFONE,boa));
 assert.equal(ok.status,200);
 assert.ok(meta.calls.includes(`GET /media/${boa.id}`));
 const imagem=meta.sent.find(s=>s.type==='image');
 assert.ok(imagem,'a proposta foi em imagem');
 assert.equal(imagem.to,TELEFONE);
 assert.match(imagem.image.link,/^https:\/\/stand\.example\.pt\/api\/whatsapp\/preview\//);
 assert.match(espacos(imagem.image.caption),/Vai ser juntada 1 fotografia à viatura BMW 320/);
 assert.equal(rotaDb._t.wa_pending_actions[0].image_wamid,imagem?`wamid.out${meta.sent.indexOf(imagem)+1}`:null);
});

server.close();
