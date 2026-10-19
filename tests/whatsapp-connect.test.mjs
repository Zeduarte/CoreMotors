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
const EXPIRA=Math.floor(Date.UTC(2026,11,12)/1000);
const meta={templates:[],existing:new Set(),calls:[],sent:[],registered:[],subscribed:[],registerFails:false,debugFails:false,
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
 if(url.pathname==='/v25.0/debug_token'){
  // Pedido com o token da app (id|segredo), não com o da empresa.
  if(url.searchParams.get('access_token')!=='app-1|segredo-1'||meta.debugFails)return send(400,{error:{message:'Invalid OAuth access token.'}});
  return send(200,{data:{app_id:'app-1',is_valid:true,expires_at:EXPIRA}});
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
 m=url.pathname.match(/^\/v25\.0\/(\d+)\/message_templates$/);
 if(m&&req.method==='POST'){
  if(meta.existing.has(body.name))return send(400,{error:{message:'Message template already exists in this language',code:100}});
  if(meta.dupSub?.has(body.name))return send(400,{error:{message:'Invalid parameter',code:100,error_subcode:meta.dupSub.get(body.name),error_user_msg:'There is already Portuguese (POR) content for this template.'}});
  meta.templates.push({waba:m[1],...body});return send(200,{id:'1',status:'PENDING',category:'UTILITY'});
 }
 m=url.pathname.match(/^\/v25\.0\/(\d+)\/messages$/);
 if(m&&req.method==='POST'){
  // Um destinatário para o qual a Meta recusa, como faz com um token sem permissão.
  if(body.to==='351000000403')return send(403,{error:{message:'Application does not have permission for this action',code:10}});
  // Uma imagem que a Meta recusa logo no envio (link que não aceita).
  if(body.type==='image'&&String(body.image?.link).includes('quebrada'))
   return send(400,{error:{message:'Param image[\'link\'] is not a valid URI',code:100}});
  meta.sent.push({id:m[1],...body});return send(200,{messages:[{id:'wamid.1'}]});
 }
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
const reset=()=>{meta.calls.length=0;meta.sent.length=0;meta.registered.length=0;meta.subscribed.length=0;meta.registerFails=false;meta.debugFails=false;
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
 // A validade vem da Meta, para o painel avisar antes dos 60 dias.
 const fim=new Date(EXPIRA*1000).toISOString();
 assert.equal(row.token_expires_at,fim);assert.equal(r.expiresAt,fim);
});

await test('if Meta does not say when access ends, the number still connects',async()=>{
 reset();meta.debugFails=true;const db=makeDb();
 const r=await connectAccount(db,escolha,ADMIN,SITE);
 assert.equal(r.ok,true,r.error);assert.equal(r.expiresAt,undefined);
 assert.equal(db._t.whatsapp_connection[0].token_expires_at,null);
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

await test('a refused reply says why, in Meta\'s words, without the token',async()=>{
 const numero={phoneNumberId:'222',accessToken:TOKEN,source:'variaveis'};
 const r=await sendWhatsAppText('351000000403','x',numero);
 assert.equal(r.ok,false);
 assert.equal(r.error,'HTTP 403 — (#10) Application does not have permission for this action');
 assert.doesNotMatch(r.error,new RegExp(TOKEN));
});

await test('the person sees the message read and "typing…" while the assistant thinks',async()=>{
 reset();
 const {markReadAndTyping}=load('src/lib/whatsapp/send.ts');
 const numero={phoneNumberId:'222',accessToken:TOKEN,source:'variaveis'};
 assert.deepEqual(await markReadAndTyping('wamid.ABC',numero),{ok:true});
 assert.deepEqual(meta.sent,[{id:'222',messaging_product:'whatsapp',status:'read',message_id:'wamid.ABC',typing_indicator:{type:'text'}}]);
 // Sem token não se tenta nada.
 assert.equal((await markReadAndTyping('wamid.ABC',{phoneNumberId:'222',accessToken:null,source:'variaveis'})).ok,false);
 assert.equal(meta.sent.length,1);
});

// ---- A proposta como imagem ------------------------------------------------
const {sendWhatsAppImage}=load('src/lib/whatsapp/send.ts');
const {deliverReply,recoverFailedImages}=load('src/lib/whatsapp/delivery.ts');
const NUMERO={phoneNumberId:'222',accessToken:TOKEN,source:'backoffice'};
const PERGUNTA='Vai ser alterada a viatura BMW 320: preço 23 500 € (era 25 000 €).\n\nConfirmar? Responda sim ou não.';
const LINK='https://stand.example.pt/api/whatsapp/preview/3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f?exp=1&sig=ab';
/** Só a tabela das propostas: update…eq, e update…eq…select…maybeSingle. */
function pendDb(rows){
 const t=rows.map(r=>({...r}));
 return {_t:t,from:()=>{let patch=null;const f=[];const hit=(x)=>f.every(([c,v])=>x[c]===v);const api={
  update(p){patch=p;return api;},eq(c,v){f.push([c,v]);return api;},select(){return api;},
  async maybeSingle(){const r=t.find(hit);if(r&&patch)Object.assign(r,patch);return {data:r?{...r}:null,error:null};},
  then(res,rej){t.filter(hit).forEach(x=>patch&&Object.assign(x,patch));return Promise.resolve({data:null,error:null}).then(res,rej);},
 };return api;}};
}

await test('a proposal goes out as an image, with the confirmation question as the caption',async()=>{
 reset();
 const db=pendDb([{id:'p1',image_wamid:null}]);
 const d=await deliverReply(db,'351916193337',PERGUNTA,{url:LINK,pendingId:'p1'},NUMERO);
 assert.deepEqual(d,{sent:{ok:true,id:'wamid.1'}});
 assert.deepEqual(meta.sent,[{id:'222',messaging_product:'whatsapp',recipient_type:'individual',to:'351916193337',
  type:'image',image:{link:LINK,caption:PERGUNTA}}]);
 // Guarda-se o id da mensagem, para um recibo «failed» posterior a encontrar.
 assert.equal(db._t[0].image_wamid,'wamid.1');
 // Sem número, ou com um link que não é HTTPS, a imagem nem é tentada.
 assert.equal((await sendWhatsAppImage('351916193337',LINK,'x',null)).ok,false);
 assert.match((await sendWhatsAppImage('351916193337','http://localhost:3000/x','x',NUMERO)).error,/HTTPS/);
 assert.equal(meta.sent.length,1);
});

await test('if the image cannot go, the same question goes as text',async()=>{
 for(const link of [LINK.replace('preview','quebrada'),'http://localhost:3000/api/whatsapp/preview/x']){
  reset();
  const db=pendDb([{id:'p1',image_wamid:null}]);
  const d=await deliverReply(db,'351916193337',PERGUNTA,{url:link,pendingId:'p1'},NUMERO);
  assert.equal(d.sent.ok,true,link);
  assert.ok(d.imageError,'o painel fica a saber porquê');
  assert.deepEqual(meta.sent.map(m=>[m.type,m.text?.body]),[['text',PERGUNTA]],'a pessoa recebe a pergunta na mesma');
  assert.equal(db._t[0].image_wamid,null);
 }
 assert.match((await deliverReply(pendDb([]),'351916193337',PERGUNTA,{url:LINK.replace('preview','quebrada'),pendingId:'p1'},NUMERO)).imageError,/not a valid URI/);
 // Uma legenda que a Meta cortaria: vai só o texto, inteiro.
 reset();
 const longa='x'.repeat(1100);
 const d=await deliverReply(pendDb([]),'351916193337',longa,{url:LINK,pendingId:'p1'},NUMERO);
 assert.equal(d.imageError,undefined);
 assert.deepEqual(meta.sent.map(m=>[m.type,m.text?.body.length]),[['text',1100]]);
 // Sem imagem (respostas normais): texto, como sempre.
 reset();
 await deliverReply(pendDb([]),'351916193337','Registado.',undefined,NUMERO);
 assert.deepEqual(meta.sent.map(m=>m.type),['text']);
});

await test('when Meta fails to fetch the image later, the question is resent as text, once',async()=>{
 reset();
 const futuro=new Date(Date.now()+5*60000).toISOString();
 const db=pendDb([
  {id:'p1',from_phone:'351916193337',summary:PERGUNTA,status:'pending',expires_at:futuro,image_wamid:'wamid.IMG'},
  {id:'p2',from_phone:'351916193338',summary:'outra',status:'confirmed',expires_at:futuro,image_wamid:'wamid.VELHA'},
 ]);
 const falha=[{id:'wamid.IMG',error:'(#131053) Media upload error'}];
 assert.equal(await recoverFailedImages(db,falha,NUMERO),1);
 assert.deepEqual(meta.sent.map(m=>[m.to,m.type,m.text.body]),[['351916193337','text',PERGUNTA]]);
 // Uma reentrega do mesmo recibo já não encontra nada: não há pergunta em duplicado.
 assert.equal(await recoverFailedImages(db,falha,NUMERO),0);
 // Uma proposta já respondida não volta a ser perguntada.
 assert.equal(await recoverFailedImages(db,[{id:'wamid.VELHA',error:''}],NUMERO),0);
 // E um recibo de uma mensagem que não é nossa é ignorado.
 assert.equal(await recoverFailedImages(db,[{id:'wamid.OUTRA',error:''}],NUMERO),0);
 assert.equal(meta.sent.length,1);
});

await test('disconnecting forgets the number here',async()=>{
 const db=makeDb([{id:1,waba_id:'111',phone_number_id:'222',access_token:TOKEN}]);
 assert.deepEqual(await disconnectAccount(db),{ok:true});
 assert.equal(db._t.whatsapp_connection.length,0);
 assert.equal(await whatsAppNumber(db),null);
});

const {createMessageTemplates}=load('src/lib/whatsapp/templates-create.ts');
await test('creating the templates submits all six as Utility in pt_PT, and skips the ones that exist',async()=>{
 reset();meta.templates.length=0;meta.existing.clear();
 const numero={phoneNumberId:'222',accessToken:TOKEN,source:'backoffice'};
 const r=await createMessageTemplates(numero,'111');
 assert.equal(r.ok,true);
 assert.deepEqual(meta.templates.map(t=>t.name),['engineline_contacto','engineline_viatura','engineline_testemunho','engineline_aviso','engineline_alerta_stock','engineline_visita']);
 for(const t of meta.templates){
  assert.equal(t.waba,'111');assert.equal(t.category,'UTILITY');assert.equal(t.language,'pt_PT');
  const [body]=t.components;assert.equal(body.type,'BODY');
  const vars=(body.text.match(/\{\{\d+\}\}/g)??[]).length;
  assert.equal(body.example.body_text[0].length,vars,`${t.name}: um exemplo por variável`);
 }
 // Uma segunda vez, tudo já existe: nem falha, nem duplica.
 for(const t of meta.templates)meta.existing.add(t.name);
 meta.templates.length=0;
 const outra=await createMessageTemplates(numero,'111');
 assert.equal(outra.ok,true);assert.equal(meta.templates.length,0);
 assert.match(outra.lines[0],/já existia/);
 // Sem a conta ou sem o token, diz-se o que falta e não se pede nada à Meta.
 meta.calls.length=0;
 assert.equal((await createMessageTemplates(numero,null)).ok,false);
 assert.equal((await createMessageTemplates({...numero,accessToken:null},'111')).ok,false);
 assert.equal(meta.calls.length,0);
});

await test('a template Meta reports as already there (subcodes 2388024/2388026) is not a failure',async()=>{
 reset();meta.templates.length=0;meta.existing.clear();
 meta.dupSub=new Map([['engineline_contacto',2388024],['engineline_viatura',2388026]]);
 const numero={phoneNumberId:'222',accessToken:TOKEN,source:'backoffice'};
 const r=await createMessageTemplates(numero,'111');
 meta.dupSub=undefined;
 assert.equal(r.ok,true);
 assert.match(r.lines[0],/engineline_contacto: já existia/);assert.match(r.lines[1],/engineline_viatura: já existia/);
 assert.equal(meta.templates.length,4);
});

server.close();
