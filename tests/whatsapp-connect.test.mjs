// Ligação do número de WhatsApp no backoffice, contra uma Meta simulada.
//
// O que isto prova: que o `code` é trocado por um token e o número só é gravado
// depois de se confirmar que pertence à conta; que o token nunca volta ao
// browser; que um número já registado não é registado outra vez; e que, sem
// ligação no backoffice, as variáveis do Netlify continuam a responder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);

// ---- Meta simulada ----------------------------------------------------------
const TOKEN='EAAG-token-da-empresa';
const meta={calls:[],sent:[],registered:[],subscribed:[],registerFails:false,
 numbers:{'111':[{id:'222',display_phone_number:'+351 912 345 678',verified_name:'engineLine',platform_type:'NOT_APPLICABLE'}]}};
const server=http.createServer(async(req,res)=>{
 let raw='';for await(const c of req)raw+=c;
 const body=raw?JSON.parse(raw):null;
 const url=new URL(req.url,'http://x');
 meta.calls.push(`${req.method} ${url.pathname}`);
 const send=(code,obj)=>{res.writeHead(code,{'Content-Type':'application/json'});res.end(JSON.stringify(obj));};
 if(url.pathname==='/v25.0/oauth/access_token'){
  const q=url.searchParams;
  if(q.get('client_id')!=='app-1'||q.get('client_secret')!=='segredo-1')return send(400,{error:{message:'Error validating client secret.'}});
  if(q.get('code')!=='code-bom')return send(400,{error:{message:'This authorization code has been used.'}});
  return send(200,{access_token:TOKEN,token_type:'bearer'});
 }
 if(req.headers.authorization!==`Bearer ${TOKEN}`)return send(401,{error:{message:'Invalid OAuth access token.'}});
 let m=url.pathname.match(/^\/v25\.0\/(\d+)\/phone_numbers$/);
 if(m&&req.method==='GET'){
  if(!meta.numbers[m[1]])return send(400,{error:{message:'Unsupported get request.'}});
  return send(200,{data:meta.numbers[m[1]]});
 }
 m=url.pathname.match(/^\/v25\.0\/(\d+)\/subscribed_apps$/);
 if(m&&req.method==='POST'){meta.subscribed.push({waba:m[1],...body});return send(200,{success:true});}
 m=url.pathname.match(/^\/v25\.0\/(\d+)\/register$/);
 if(m&&req.method==='POST'){
  if(meta.registerFails)return send(400,{error:{message:'(#133005) Two step verification PIN Mismatch'}});
  meta.registered.push({id:m[1],...body});return send(200,{success:true});
 }
 m=url.pathname.match(/^\/v25\.0\/(\d+)\/messages$/);
 if(m&&req.method==='POST'){meta.sent.push({id:m[1],...body});return send(200,{messages:[{id:'wamid.1'}]});}
 send(404,{error:{message:'not simulated'}});
});
await new Promise(r=>server.listen(0,r));
process.env.WHATSAPP_GRAPH_BASE_URL=`http://127.0.0.1:${server.address().port}`;
delete process.env.WHATSAPP_GRAPH_VERSION;
process.env.WHATSAPP_APP_ID='app-1';
process.env.WHATSAPP_APP_SECRET='segredo-1';
process.env.WHATSAPP_VERIFY_TOKEN='verifica-1';
process.env.WHATSAPP_CONFIG_ID='config-1';
delete process.env.WHATSAPP_PHONE_NUMBER_ID;
delete process.env.WHATSAPP_ACCESS_TOKEN;

// ---- Base de dados em memória: só a tabela da ligação -----------------------
function makeDb(rows=[]){
 const t={whatsapp_connection:[...rows]};
 const from=(table)=>{
  const f=[];let op='select';
  const run=()=>{
   const hit=(r)=>f.every(([c,v])=>r[c]===v);
   if(op==='delete'){t[table]=t[table].filter(r=>!hit(r));return {data:null,error:null};}
   return {data:t[table].filter(hit),error:null};
  };
  const api={
   select(){return api;},eq(c,v){f.push([c,v]);return api;},delete(){op='delete';return api;},
   async maybeSingle(){return {data:run().data[0]??null,error:null};},
   upsert(row){const i=t[table].findIndex(r=>r.id===row.id);if(i>=0)t[table][i]=row;else t[table].push(row);
    return Promise.resolve({data:null,error:null});},
   then(res,rej){return Promise.resolve(run()).then(res,rej);},
  };
  return api;
 };
 return {from,_t:t};
}

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
const {connectAccount,disconnectAccount,whatsAppNumber,embeddedSignup}=load('src/lib/whatsapp/account.ts');
const {sendWhatsAppText}=load('src/lib/whatsapp/send.ts');

const ADMIN='00000000-0000-4000-8000-000000000001';
const SITE='https://stand-a.example.pt';
const escolha={code:'code-bom',wabaId:'111',phoneNumberId:'222'};
const reset=()=>{meta.calls.length=0;meta.sent.length=0;meta.registered.length=0;meta.subscribed.length=0;meta.registerFails=false;
 meta.numbers['111'][0].platform_type='NOT_APPLICABLE';};

await test('connecting stores the chosen number and never hands the token back',async()=>{
 reset();const db=makeDb();
 const r=await connectAccount(db,escolha,ADMIN,SITE);
 assert.equal(r.ok,true,r.error);
 assert.equal(r.number,'+351 912 345 678');assert.equal(r.name,'engineLine');
 assert.match(r.pin,/^\d{6}$/,'PIN de seis algarismos');
 assert.doesNotMatch(JSON.stringify(r),new RegExp(TOKEN),'o token não sai do servidor');
 const row=db._t.whatsapp_connection[0];
 assert.equal(row.id,1);assert.equal(row.waba_id,'111');assert.equal(row.phone_number_id,'222');
 assert.equal(row.access_token,TOKEN);assert.equal(row.registration_pin,r.pin);
 assert.equal(row.register_warning,null);assert.equal(row.connected_by,ADMIN);
 // A conta fica subscrita, com as mensagens encaminhadas para ESTE site, e o
 // número registado com o PIN que foi mostrado.
 assert.deepEqual(meta.subscribed,[{waba:'111',override_callback_uri:'https://stand-a.example.pt/api/whatsapp',verify_token:'verifica-1'}]);
 assert.deepEqual(meta.registered,[{id:'222',messaging_product:'whatsapp',pin:r.pin}]);
});

await test('a number from another account is refused and nothing is written',async()=>{
 reset();const db=makeDb();
 const r=await connectAccount(db,{...escolha,phoneNumberId:'999'},ADMIN,SITE);
 assert.equal(r.ok,false);assert.match(r.error,/não pertence/);
 assert.equal(db._t.whatsapp_connection.length,0);
 assert.ok(!meta.calls.some(c=>/subscribed_apps|register/.test(c)),'nada mudou na Meta');
});

await test('a used or expired code stops before touching the account',async()=>{
 reset();const db=makeDb();
 const r=await connectAccount(db,{...escolha,code:'code-velho'},ADMIN,SITE);
 assert.equal(r.ok,false);assert.match(r.error,/não aceitou a autorização/);
 assert.match(r.error,/authorization code has been used/,'o motivo da Meta chega ao administrador');
 assert.deepEqual(meta.calls,['GET /v25.0/oauth/access_token']);
 assert.equal(db._t.whatsapp_connection.length,0);
});

await test('a number already on the Cloud API is not registered again',async()=>{
 reset();meta.numbers['111'][0].platform_type='CLOUD_API';const db=makeDb();
 const r=await connectAccount(db,escolha,ADMIN,SITE);
 assert.equal(r.ok,true,r.error);assert.equal(r.pin,undefined);
 assert.ok(!meta.calls.some(c=>c.endsWith('/register')));
 assert.equal(db._t.whatsapp_connection[0].registration_pin,null);
});

await test('a failed registration still connects, with the reason written down',async()=>{
 reset();meta.registerFails=true;const db=makeDb();
 const r=await connectAccount(db,escolha,ADMIN,SITE);
 assert.equal(r.ok,true,r.error);assert.equal(r.pin,undefined,'um PIN que não ficou definido não se mostra');
 assert.match(r.warning,/registo na Cloud API falhou.*PIN Mismatch/);
 const row=db._t.whatsapp_connection[0];
 assert.equal(row.registration_pin,null);assert.match(row.register_warning,/PIN Mismatch/);
});

await test('two stands on the same Meta app each get their own messages',async()=>{
 // O fornecedor tem uma app; cada cliente tem o seu site e o seu número.
 reset();meta.numbers['444']=[{id:'555',display_phone_number:'+351 221 000 000',verified_name:'Stand B',platform_type:'CLOUD_API'}];
 try{
  assert.equal((await connectAccount(makeDb(),escolha,ADMIN,'https://stand-a.example.pt/')).ok,true);
  assert.equal((await connectAccount(makeDb(),{code:'code-bom',wabaId:'444',phoneNumberId:'555'},ADMIN,'https://stand-b.example.pt')).ok,true);
  assert.deepEqual(meta.subscribed.map(s=>[s.waba,s.override_callback_uri]),[
   ['111','https://stand-a.example.pt/api/whatsapp'],
   ['444','https://stand-b.example.pt/api/whatsapp'],
  ]);
 }finally{delete meta.numbers['444'];}
});

await test('a site without HTTPS is refused before anything changes at Meta',async()=>{
 reset();const db=makeDb();
 for(const url of ['http://stand-a.example.pt','','https://stand-a.example.pt/caminho']){
  const r=await connectAccount(db,escolha,ADMIN,url);
  assert.equal(r.ok,false,url);assert.match(r.error,/HTTPS/);
 }
 assert.deepEqual(meta.calls,[]);assert.equal(db._t.whatsapp_connection.length,0);
});

await test('ids that are not digits never reach a Graph URL',async()=>{
 reset();const db=makeDb();
 for(const ids of [{wabaId:'../me'},{phoneNumberId:'222/messages'},{wabaId:''}]){
  const r=await connectAccount(db,{...escolha,...ids},ADMIN,SITE);
  assert.equal(r.ok,false);
 }
 assert.deepEqual(meta.calls,[]);
});

await test('without the app id, secret or verify token the connection is not offered',async()=>{
 reset();
 assert.deepEqual(embeddedSignup(),{appId:'app-1',configId:'config-1',graphVersion:'v25.0'});
 for(const nome of ['WHATSAPP_APP_ID','WHATSAPP_APP_SECRET','WHATSAPP_VERIFY_TOKEN']){
  const antes=process.env[nome];delete process.env[nome];
  try{
   assert.equal(embeddedSignup(),null,nome);
   const r=await connectAccount(makeDb(),escolha,ADMIN,SITE);
   assert.equal(r.ok,false);assert.match(r.error,/WHATSAPP_APP_ID, WHATSAPP_APP_SECRET e WHATSAPP_VERIFY_TOKEN/);
  }finally{process.env[nome]=antes;}
 }
 assert.deepEqual(meta.calls,[]);
});

await test('the number connected here wins over the Netlify variables, which stay as the fallback',async()=>{
 const ligado=makeDb([{id:1,waba_id:'111',phone_number_id:'222',access_token:TOKEN}]);
 assert.equal(await whatsAppNumber(makeDb()),null,'nada configurado');
 process.env.WHATSAPP_PHONE_NUMBER_ID='333';process.env.WHATSAPP_ACCESS_TOKEN='env-token';
 try{
  assert.deepEqual(await whatsAppNumber(ligado),{phoneNumberId:'222',accessToken:TOKEN,source:'backoffice'});
  assert.deepEqual(await whatsAppNumber(makeDb()),{phoneNumberId:'333',accessToken:'env-token',source:'variaveis'});
  // Sem chave de serviço não há base de dados, mas as variáveis valem.
  assert.equal((await whatsAppNumber(null)).source,'variaveis');
  // Só o ID: recebe e regista, mas não tem com que responder.
  delete process.env.WHATSAPP_ACCESS_TOKEN;
  assert.equal((await whatsAppNumber(makeDb())).accessToken,null);
 }finally{delete process.env.WHATSAPP_PHONE_NUMBER_ID;delete process.env.WHATSAPP_ACCESS_TOKEN;}
});

await test('replies go out from the connected number, with its token',async()=>{
 reset();
 const numero=await whatsAppNumber(makeDb([{id:1,waba_id:'111',phone_number_id:'222',access_token:TOKEN}]));
 assert.deepEqual(await sendWhatsAppText('351916193337','Registado.',numero),{ok:true});
 assert.equal(meta.sent.length,1);
 assert.equal(meta.sent[0].id,'222');assert.equal(meta.sent[0].to,'351916193337');
 assert.equal(meta.sent[0].text.body,'Registado.');
 // Sem número, não se tenta enviar nada.
 assert.equal((await sendWhatsAppText('351916193337','x',null)).ok,false);
 assert.equal((await sendWhatsAppText('351916193337','x',{phoneNumberId:'222',accessToken:null,source:'variaveis'})).ok,false);
 assert.equal(meta.sent.length,1);
});

await test('disconnecting forgets the number here',async()=>{
 const db=makeDb([{id:1,waba_id:'111',phone_number_id:'222',access_token:TOKEN}]);
 assert.deepEqual(await disconnectAccount(db),{ok:true});
 assert.equal(db._t.whatsapp_connection.length,0);
 assert.equal(await whatsAppNumber(db),null);
});

server.close();
