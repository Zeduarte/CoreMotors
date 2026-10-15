// Ordens por WhatsApp — as partes puras.
//
// Tudo o que decide o que fica gravado (matrícula, viatura, valor, frase) vive
// em funções puras de propósito, para ser testável sem base de dados, sem rede
// e sem gastar uma chamada ao modelo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createHmac } from 'node:crypto';
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
 const localRequire=(id)=>id.startsWith('@/')?load(resolveAlias(id)):id.startsWith('.')?load(resolveRelative(path,id)):require(id);
 new Function('module','exports','require',outputText)(mod,mod.exports,localRequire);
 cache.set(path,mod.exports);return mod.exports;}

const {plateKey,formatPlate,isPlausiblePlate}=load('src/lib/plate.ts');
await test('a plate compares by its canonical form, however it was typed',()=>{
 // Na base de dados há matrículas com hífenes (formulário) e sem (oficina): sem
 // esta forma canónica, a mesma viatura parecia duas.
 for(const p of ['33-AD-22','33ad22','33 AD 22',' 33-ad-22 '])
  assert.equal(plateKey(p),'33AD22',p);
 // A forma mostrada não muda — não-regressão do que o formulário já fazia.
 assert.equal(formatPlate('44vs23'),'44-VS-23');
 assert.equal(formatPlate('00TE00'),'00-TE-00');
 assert.equal(formatPlate('abcdefghij'),'AB-CD-EF','corta aos 6');
 assert.equal(formatPlate(''),'');
 assert.equal(isPlausiblePlate('33-AD-22'),true);
 assert.equal(isPlausiblePlate('AB'),false);
 assert.equal(isPlausiblePlate('320d'),false,'um modelo não é uma matrícula');
});

const {normalizeWhatsApp}=load('src/lib/phone.ts');
await test('a phone is the same person with or without the country code',()=>{
 for(const p of ['916193337','351916193337','+351 916 193 337','916 193 337'])
  assert.equal(normalizeWhatsApp(p),'351916193337',p);
 // Um número estrangeiro fica intacto: não se lhe cola o 351.
 assert.equal(normalizeWhatsApp('4915112345678'),'4915112345678');
});

const {verifySignature,verifyChallenge,MAX_BODY_BYTES}=load('src/lib/whatsapp/signature.ts');
const SEGREDO='segredo-de-teste';
const assina=(corpo)=>'sha256='+createHmac('sha256',SEGREDO).update(corpo,'utf8').digest('hex');
await test('only a request really signed by Meta is accepted',()=>{
 const corpo='{"object":"whatsapp_business_account","entry":[]}';
 assert.equal(verifySignature(corpo,assina(corpo),SEGREDO),true);
 // Um byte trocado no corpo invalida.
 assert.equal(verifySignature(corpo.replace('entry','entrY'),assina(corpo),SEGREDO),false);
 // Um corpo que só difere em espaços também: é por isso que a rota compara os
 // bytes em bruto e nunca o JSON reserializado.
 assert.equal(verifySignature(corpo.replace('","','", "'),assina(corpo),SEGREDO),false);
 assert.equal(verifySignature(corpo,null,SEGREDO),false,'sem cabeçalho');
 assert.equal(verifySignature(corpo,'sha256=abc',SEGREDO),false,'comprimento errado, sem estourar');
 assert.equal(verifySignature(corpo,assina(corpo),''),false,'sem segredo configurado');
 assert.equal(verifySignature(corpo,assina(corpo),'outro'),false,'segredo errado');
 // Corpo absurdo nem chega a ser processado.
 const enorme='x'.repeat(MAX_BODY_BYTES+1);
 assert.equal(verifySignature(enorme,assina(enorme),SEGREDO),false);
});
await test('the subscription handshake only answers to the agreed token',()=>{
 const p=(o)=>new URLSearchParams(o);
 assert.equal(verifyChallenge(p({'hub.mode':'subscribe','hub.verify_token':'tok','hub.challenge':'123'}),'tok'),'123');
 assert.equal(verifyChallenge(p({'hub.mode':'subscribe','hub.verify_token':'errado','hub.challenge':'123'}),'tok'),null);
 assert.equal(verifyChallenge(p({'hub.mode':'unsubscribe','hub.verify_token':'tok','hub.challenge':'123'}),'tok'),null);
 assert.equal(verifyChallenge(p({'hub.mode':'subscribe','hub.verify_token':'tok','hub.challenge':'123'}),''),null,'sem token configurado');
});

const {extractMessages}=load('src/lib/whatsapp/payload.ts');
const envelope=(value)=>({object:'whatsapp_business_account',entry:[{id:'w',changes:[{field:'messages',value}]}]});
const texto=(id,body)=>({id,from:'351916193337',timestamp:'1',type:'text',text:{body}});
await test('reading Meta payloads never throws and ignores what is not a message',()=>{
 const meta={phone_number_id:'123'};
 // Os recibos de entrega são a maioria do tráfego e não são mensagens.
 assert.equal(extractMessages(envelope({metadata:meta,statuses:[{id:'x',status:'delivered'}]})).length,0);
 const uma=extractMessages(envelope({metadata:meta,messages:[texto('wamid.1','olá')]}));
 assert.equal(uma.length,1);
 assert.deepEqual(uma[0],{wamId:'wamid.1',from:'351916193337',type:'text',text:'olá',phoneNumberId:'123'});
 // Listas com mais de um elemento: percorrer, não indexar o primeiro.
 const duas={object:'x',entry:[
  {changes:[{value:{metadata:meta,messages:[texto('wamid.1','a')]}}]},
  {changes:[{value:{metadata:meta,messages:[texto('wamid.2','b'),texto('wamid.3','c')]}}]}]};
 assert.deepEqual(extractMessages(duas).map(m=>m.wamId),['wamid.1','wamid.2','wamid.3']);
 // Uma imagem aparece, para se poder responder "só entendo texto".
 const img=extractMessages(envelope({metadata:meta,messages:[{id:'wamid.9',from:'351',type:'image',image:{id:'i'}}]}));
 assert.deepEqual(img.map(m=>[m.type,m.text]),[['image','']]);
 // E nada disto estoura.
 for(const mau of [null,undefined,{},{entry:'x'},{entry:[{changes:null}]},{entry:[{changes:[{}]}]},'texto',42])
  assert.equal(extractMessages(mau).length,0,JSON.stringify(mau));
 // Uma mensagem sem id ou sem remetente é descartada.
 assert.equal(extractMessages(envelope({metadata:meta,messages:[{type:'text',text:{body:'x'}}]})).length,0);
});

const {readConfirmation,isUsable}=load('src/lib/whatsapp/confirm.ts');
await test('confirmation is read by equality, never by "contains"',()=>{
 for(const s of ['sim','SIM','Sim.','  sim  ','ok','confirmo','certo','exato','👍'])
  assert.equal(readConfirmation(s),'yes',s);
 for(const n of ['não','nao','NÃO','cancela','esquece','errado','❌'])
  assert.equal(readConfirmation(n),'no',n);
 // O caso que protege o valor: isto é um pedido novo, não uma confirmação.
 assert.equal(readConfirmation('sim, mas muda para 500'),'other');
 assert.equal(readConfirmation('sim sim mas no audi'),'other');
 assert.equal(readConfirmation('450'),'other');
 assert.equal(readConfirmation(''),'other');
});
await test('a proposal is only usable while pending and in time',()=>{
 const agora=new Date('2026-09-24T10:00:00Z');
 assert.equal(isUsable({status:'pending',expires_at:'2026-09-24T10:05:00Z'},agora),true);
 assert.equal(isUsable({status:'pending',expires_at:'2026-09-24T09:59:59Z'},agora),false,'expirou');
 assert.equal(isUsable({status:'pending',expires_at:'2026-09-24T10:00:00Z'},agora),false,'no limite');
 for(const s of ['confirmed','cancelled','expired','superseded'])
  assert.equal(isUsable({status:s,expires_at:'2026-09-24T10:05:00Z'},agora),false,s);
});

const {rankVehicles}=load('src/lib/whatsapp/match.ts');
const frota=[
 {id:'a',make:'BMW',model:'320',color:'Preto',license_plate:'33-AD-22',status:'published'},
 {id:'b',make:'Bmw',model:'320',color:'Cinzento',license_plate:'44-VS-23',status:'published'},
 {id:'c',make:'Audi',model:'A1',color:'Branco',license_plate:'12-AB-34',status:'published'},
];
await test('finding a vehicle: the plate decides, and ambiguity is never guessed',()=>{
 // A matrícula ganha mesmo quando a marca escrita está errada.
 assert.deepEqual(rankVehicles({matricula:'33ad22',marca:'Audi'},frota).map(v=>v.id),['a']);
 assert.deepEqual(rankVehicles({matricula:'33-AD-22'},frota).map(v=>v.id),['a']);
 // Dois BMW 320 e nenhuma cor: pergunta-se.
 assert.equal(rankVehicles({texto:'bmw 320'},frota).length,2,'ambíguo');
 // Com a cor há um vencedor claro. Nota: "Bmw" e "BMW" contam como a mesma marca.
 assert.deepEqual(rankVehicles({texto:'bmw 320 preto'},frota).map(v=>v.id),['a']);
 assert.deepEqual(rankVehicles({texto:'bmw 320 cinzento'},frota).map(v=>v.id),['b']);
 // Nada que encaixe.
 assert.equal(rankVehicles({texto:'mercedes classe a'},frota).length,0);
 assert.equal(rankVehicles({},frota).length,0,'sem pistas não se devolve o stock');
 // O que a pessoa não pode ver nunca entra na lista — quem filtra é o SQL.
 assert.equal(rankVehicles({texto:'audi a1'},frota.filter(v=>v.id!=='c')).length,0);
});

const {formatMoney,formatDay,vehicleLabel,describeAction,confirmationMessage,receiptMessage}=load('src/lib/whatsapp/describe.ts');
await test('money in a receipt keeps its cents',()=>{
 // O formatPrice do site arredonda (é para preços de anúncio); num recibo de
 // despesa 450,50 € não pode virar "451 €".
 assert.match(formatMoney(450.5),/450,50/);
 assert.match(formatMoney(450),/450/);
 assert.equal(/,/.test(formatMoney(450)),false,'um valor redondo não leva cêntimos');
 assert.match(formatMoney(1250.75),/1\s?250,75/);
 assert.equal(formatDay('2026-09-24'),'24/09/2026');
 assert.equal(vehicleLabel({make:'BMW',model:'320',license_plate:'33AD22'}),'BMW 320, matrícula 33-AD-22');
 assert.equal(vehicleLabel({make:'BMW',model:'320'}),'BMW 320');
 // Uma viatura antiga gravada como "Bmw" sai com a grafia certa no recibo.
 assert.equal(vehicleLabel({make:'Bmw',model:'320d'}),'BMW 320d');
});
await test('the sentence the person reads is the record that gets written',()=>{
 const despesa={kind:'add_cost',carId:'a',veiculo:'BMW 320, matrícula 33-AD-22',
  categoria:'parts',descricao:'troca da embraiagem e revisão geral',valor:450,data:'2026-09-24'};
 const pergunta=confirmationMessage(despesa);
 const recibo=receiptMessage(despesa);
 // Tudo o que é gravado tem de estar nas duas frases.
 for(const parte of ['BMW 320','33-AD-22','450','embraiagem','24/09/2026']){
  assert.ok(pergunta.includes(parte),`pergunta sem "${parte}": ${pergunta}`);
  assert.ok(recibo.includes(parte),`recibo sem "${parte}": ${recibo}`);
 }
 assert.match(pergunta,/Vai ser adicionada/);
 assert.match(pergunta,/Confirmar\? Responda sim ou não\./);
 assert.match(recibo,/Foi adicionada/);
 assert.equal(/Confirmar\?/.test(recibo),false,'o recibo não volta a perguntar');
 // As outras duas acções.
 assert.match(describeAction({kind:'register_vehicle',nome:'Audi A1',matricula:'00TE00',tipo:'car'},'passado'),
  /Audi A1.*00-TE-00/);
 assert.match(describeAction({kind:'log_hours',carId:'a',veiculo:'BMW 320',data:'2026-09-24',
  inicio:'09:00',fim:'17:30',horas:8.5,descricao:'Travões'},'futuro'),/09:00.*17:30.*8,5 h.*Travões/);
});

const {buildRegister,buildCost,buildHours,canUseCategory}=load('src/lib/whatsapp/actions.ts');
const viatura={carId:'a',veiculo:'BMW 320, matrícula 33-AD-22'};
const HOJE='2026-09-24';
await test('cost categories follow the same rule as the backoffice',()=>{
 // Material basta a Oficina; dinheiro de gestão exige Custos e margens.
 assert.equal(canUseCategory('parts',['oficina']),true);
 assert.equal(canUseCategory('other',['oficina']),true);
 assert.equal(canUseCategory('labour',['oficina']),false);
 assert.equal(canUseCategory('transport',['oficina']),false);
 for(const c of ['parts','labour','transport','preparation','other'])
  assert.equal(canUseCategory(c,['financeiro']),true,c);
 assert.equal(canUseCategory('parts',['leads']),false);
});
await test('a proposal that cannot be executed is never shown to the person',()=>{
 const base={viatura:'V1',categoria:'parts',valor:450,descricao:'Embraiagem'};
 assert.equal(buildCost(base,viatura,['oficina'],HOJE).ok,true);
 // O mecânico a escolher mão de obra recebe uma frase útil, não "sem permissão".
 const mo=buildCost({...base,categoria:'labour'},viatura,['oficina'],HOJE);
 assert.equal(mo.ok,false);
 assert.match(mo.error,/horas/);
 // Quem não tem nenhuma das duas secções é recusado de outra maneira.
 assert.match(buildCost(base,viatura,['leads'],HOJE).error,/Custos e margens/);
 // Datas no futuro não passam.
 assert.equal(buildCost({...base,data:'2026-09-25'},viatura,['financeiro'],HOJE).ok,false);
 assert.equal(buildCost({...base,data:'2026-09-24'},viatura,['financeiro'],HOJE).ok,true);
 // Os cêntimos sobrevivem, sem lixo de vírgula flutuante.
 assert.equal(buildCost({...base,valor:450.555},viatura,['financeiro'],HOJE).action.valor,450.56);
});
await test('registering a vehicle needs the workshop and a plausible plate',()=>{
 const bom=buildRegister({nome:'Audi A1',matricula:'00-TE-00',tipo:'car'},['oficina']);
 assert.equal(bom.ok,true);
 assert.equal(bom.action.matricula,'00TE00');
 assert.match(buildRegister({nome:'Audi A1',matricula:'00-TE-00',tipo:'car'},['financeiro']).error,/Oficina/);
 assert.match(buildRegister({nome:'Audi A1',matricula:'AB',tipo:'car'},['oficina']).error,/matrícula/);
});
await test('hours reuse the backoffice rule: no zero, no silent night shift',()=>{
 const base={viatura:'V1',data:HOJE,inicio:'09:00',fim:'17:30',noite:false};
 const ok=buildHours(base,viatura,['oficina'],HOJE);
 assert.equal(ok.ok,true);
 assert.equal(ok.action.horas,8.5);
 assert.match(buildHours({...base,fim:'09:00'},viatura,['oficina'],HOJE).error,/igual ao início/);
 assert.match(buildHours({...base,inicio:'11:00',fim:'10:00'},viatura,['oficina'],HOJE).error,/dia seguinte/);
 // Declarado como nocturno, aceita-se.
 const noite=buildHours({...base,inicio:'22:00',fim:'02:00',noite:true},viatura,['oficina'],HOJE);
 assert.equal(noite.action.horas,4);
 assert.match(buildHours(base,viatura,['financeiro'],HOJE).error,/Oficina/);
 assert.equal(buildHours({...base,data:'2026-09-25'},viatura,['oficina'],HOJE).ok,false);
});

// ---------------------------------------------------------------------------
// Fase 2: a imagem de confirmação e as ordens novas (viaturas, leads,
// testemunhos). Partes puras: link assinado, frases, formulário e regras.
// ---------------------------------------------------------------------------

const {previewUrl,verifyPreview,signPreview,PREVIEW_TTL_S}=load('src/lib/whatsapp/preview-link.ts');
const PROPOSTA='3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e6f';
const SEGREDO_IMG='segredo-do-servidor';
const AGORA_IMG=new Date('2026-10-15T10:00:00Z');
const partes=(url)=>{const u=new URL(url,'https://x');return {id:u.pathname.split('/').pop(),exp:u.searchParams.get('exp'),sig:u.searchParams.get('sig')};};
await test('the image link is signed, expires, and refuses anything forged',()=>{
 const url=previewUrl('https://stand.example.pt',PROPOSTA,AGORA_IMG,SEGREDO_IMG);
 assert.match(url,new RegExp(`^https://stand\\.example\\.pt/api/whatsapp/preview/${PROPOSTA}\\?exp=\\d+&sig=[0-9a-f]{64}$`));
 const {id,exp,sig}=partes(url);
 assert.equal(Number(exp),Math.floor(AGORA_IMG.getTime()/1000)+PREVIEW_TTL_S,'vale ~15 minutos');
 assert.equal(verifyPreview(id,exp,sig,AGORA_IMG,SEGREDO_IMG),true);
 // Assinatura de outra proposta, prazo mexido, segredo errado: tudo recusado.
 assert.equal(verifyPreview('3f2b8c1e-5d4a-4b6c-9e7f-1a2b3c4d5e70',exp,sig,AGORA_IMG,SEGREDO_IMG),false,'outro id');
 assert.equal(verifyPreview(id,String(Number(exp)+60),sig,AGORA_IMG,SEGREDO_IMG),false,'prazo alargado à mão');
 assert.equal(verifyPreview(id,exp,sig,AGORA_IMG,'outro-segredo'),false,'segredo errado');
 assert.equal(verifyPreview(id,exp,sig.replace(/^./,c=>c==='a'?'b':'a'),AGORA_IMG,SEGREDO_IMG),false,'um carácter trocado');
 assert.equal(verifyPreview(id,exp,'abc',AGORA_IMG,SEGREDO_IMG),false,'comprimento errado, sem estourar');
 assert.equal(verifyPreview(id,exp,null,AGORA_IMG,SEGREDO_IMG),false,'sem assinatura');
 assert.equal(verifyPreview(id,null,sig,AGORA_IMG,SEGREDO_IMG),false,'sem prazo');
 assert.equal(verifyPreview('../../etc',exp,sig,AGORA_IMG,SEGREDO_IMG),false,'id que não é uuid');
 // Expirado: um segundo depois do fim já não vale.
 const depois=new Date((Number(exp)+1)*1000);
 assert.equal(verifyPreview(id,exp,sig,depois,SEGREDO_IMG),false,'expirado');
 // Um prazo muito para lá do normal é recusado mesmo bem assinado (segredo vazado).
 const longe=String(Math.floor(AGORA_IMG.getTime()/1000)+86400);
 assert.equal(verifyPreview(id,longe,signPreview(id,Number(longe),SEGREDO_IMG),AGORA_IMG,SEGREDO_IMG),false);
 // A chave é derivada: o HMAC directo com o segredo NÃO é a assinatura (o
 // App Secret também assina os webhooks da Meta e os dois usos não se cruzam).
 assert.notEqual(sig,createHmac('sha256',SEGREDO_IMG).update(`${id}.${exp}`).digest('hex'));
 // Sem segredo configurado não há link (e a proposta segue só em texto).
 assert.equal(previewUrl('https://stand.example.pt',PROPOSTA,AGORA_IMG,''),null);
 assert.equal(verifyPreview(id,exp,sig,AGORA_IMG,''),false);
 // No simulador a origem é vazia: caminho relativo.
 assert.match(previewUrl('',PROPOSTA,AGORA_IMG,SEGREDO_IMG),/^\/api\/whatsapp\/preview\//);
});

const {previewCard,CAR_STATUS_LABEL}=load('src/lib/whatsapp/describe.ts');
const UUID=/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
const CARRO_ID='11111111-1111-4111-8111-111111111111';
const LEAD_ID='44444444-4444-4444-8444-444444444444';
const NOVAS=[
 {kind:'create_draft_car',tipo:'car',marca:'BMW',modelo:'320d',versao:'M Sport',ano:2019,km:120000,combustivel:'Diesel',caixa:'Automática',segmento:'Berlina',preco:23500,matricula:'33AD22',cor:'Preto',portas:4,lugares:5},
 {kind:'update_car',carId:CARRO_ID,veiculo:'BMW 320, matrícula 33-AD-22',novo:{preco:23500,km:121000},antes:{preco:25000,km:120000,tagline:'',descricao:''}},
 {kind:'set_car_status',carId:CARRO_ID,veiculo:'BMW 320, matrícula 33-AD-22',de:'draft',para:'published'},
 {kind:'set_lead_status',leadId:LEAD_ID,contacto:'João Silva (BMW 320)',de:'new',para:'lost',motivo:'Comprou noutro stand'},
 {kind:'assign_lead',leadId:LEAD_ID,contacto:'João Silva (BMW 320)',responsavelId:CARRO_ID,responsavel:'Ana Costa',antes:'Por atribuir'},
 {kind:'add_lead_note',leadId:LEAD_ID,contacto:'João Silva (BMW 320)',tipo:'call',texto:'Ligou a pedir o IUC'},
 {kind:'set_testimonial',testimonialId:LEAD_ID,autor:'Maria',classificacao:5,excerto:'Excelente serviço',publicar:true},
];
await test('every new order reads the same in the question, the receipt and the image',()=>{
 const chaves={create_draft_car:['BMW 320d M Sport','2019','120 000 km','Diesel','Automática','Berlina','23 500','33-AD-22'],
  update_car:['23 500','25 000','121 000','120 000'],set_car_status:['Rascunho','Publicado'],
  set_lead_status:['João Silva','Novo','Perdido','Comprou noutro stand'],assign_lead:['João Silva','Ana Costa'],
  add_lead_note:['João Silva','chamada','Ligou a pedir o IUC'],set_testimonial:['Maria','5/5','Excelente serviço']};
 const sem=(s)=>s.replace(/\s/g,' ');
 for(const a of NOVAS){
  const pergunta=sem(confirmationMessage(a)),recibo=sem(receiptMessage(a));
  for(const parte of chaves[a.kind]){
   assert.ok(pergunta.includes(parte),`${a.kind}: pergunta sem "${parte}": ${pergunta}`);
   assert.ok(recibo.includes(parte),`${a.kind}: recibo sem "${parte}": ${recibo}`);
  }
  assert.match(pergunta,/Confirmar\? Responda sim ou não\.$/);
  assert.equal(/Confirmar\?/.test(recibo),false);
  // A imagem: nenhum identificador interno, e os mesmos valores.
  const card=previewCard(a);
  const tudo=sem(JSON.stringify(card));
  assert.equal(UUID.test(tudo),false,`${a.kind}: a imagem não mostra ids internos`);
  assert.ok(card.title&&card.subject&&card.fields.length,a.kind);
  for(const f of card.fields)if(f.before!==undefined)assert.notEqual(f.before,f.value,`${a.kind}: um «antes» igual ao «depois» não é alteração`);
 }
 // Uma alteração mostra o antes e o depois, campo a campo.
 const edicao=previewCard(NOVAS[1]);
 assert.deepEqual(edicao.fields.map(f=>[f.label,sem(f.before),sem(f.value)]),[['Preço','25 000 €','23 500 €'],['Quilómetros','120 000 km','121 000 km']]);
 assert.equal(CAR_STATUS_LABEL.published,'Publicado');
});

const {buildCreateCar,buildUpdateCar,buildCarStatus,buildLeadStatus,buildAssignLead,buildLeadNote,buildTestimonial,
 CreateCarInput,LeadStatusInput,UpdateCarInput,PendingActionSchema}=load('src/lib/whatsapp/actions.ts');
const fichaCompleta={status:'draft',price:25000,price_on_request:false,mileage:120000,tagline:null,description:null,
 year:2019,fuel:'Diesel',transmission:'Manual',body:'Berlina',model:'320',reservaAtiva:false};
const carroV={carId:CARRO_ID,veiculo:'BMW 320, matrícula 33-AD-22'};
await test('a new stock vehicle follows the backoffice form rules and is always a draft',()=>{
 const base={tipo:'car',marca:'bmw',modelo:'320d',ano:2019,km:120000,combustivel:'Diesel',caixa:'Manual',segmento:'Berlina',preco:23500};
 const ok=buildCreateCar(CreateCarInput.parse(base),['carros'],['car','motorcycle']);
 assert.equal(ok.ok,true,ok.error);
 assert.equal(ok.action.marca,'BMW','grafia do catálogo, como no formulário');
 assert.deepEqual([ok.action.portas,ok.action.lugares],[5,5]);
 assert.equal(PendingActionSchema.safeParse(ok.action).success,true);
 // Mota: 0 portas e 2 lugares por defeito; um segmento de carro é recusado
 // pela MESMA regra do carFormSchema.
 const mota=buildCreateCar(CreateCarInput.parse({...base,tipo:'motorcycle',segmento:'Naked',marca:'Honda',modelo:'CB500F'}),['carros'],['car','motorcycle']);
 assert.deepEqual([mota.action.portas,mota.action.lugares],[0,2]);
 assert.match(buildCreateCar(CreateCarInput.parse({...base,tipo:'motorcycle'}),['carros'],['car','motorcycle']).error,/segmento adequado/);
 assert.match(buildCreateCar(CreateCarInput.parse({...base,ano:1900}),['carros'],['car','motorcycle']).error,/Ano inválido/);
 // Sem preço nem «sob consulta» o modelo tem de perguntar (erro recuperável).
 const {preco:_p,...semPreco}=base;void _p;
 assert.equal(CreateCarInput.safeParse(semPreco).success,false);
 assert.equal(buildCreateCar(CreateCarInput.parse({...semPreco,sob_consulta:true}),['carros'],['car']).action.preco,null);
 // Secção e tipo de viatura.
 assert.match(buildCreateCar(CreateCarInput.parse(base),['oficina'],['car']).error,/Não tem acesso a Viaturas/);
 assert.match(buildCreateCar(CreateCarInput.parse(base),['carros'],['motorcycle']).error,/carros/);
 assert.match(buildCreateCar(CreateCarInput.parse({...base,matricula:'AB'}),['carros'],['car']).error,/matrícula/);
});
await test('editing a vehicle only proposes what really changes',()=>{
 const r=buildUpdateCar(UpdateCarInput.parse({viatura:'V1',preco:23500,km:120000}),carroV,fichaCompleta,['carros']);
 assert.deepEqual(r.action.novo,{preco:23500},'os km já eram 120 000');
 assert.deepEqual(r.action.antes,{preco:25000,km:120000,tagline:'',descricao:''});
 assert.match(buildUpdateCar(UpdateCarInput.parse({viatura:'V1',preco:25000}),carroV,fichaCompleta,['carros']).error,/já está assim/);
 assert.equal(buildUpdateCar(UpdateCarInput.parse({viatura:'V1',sob_consulta:true}),carroV,fichaCompleta,['carros']).action.novo.preco,null);
 assert.match(buildUpdateCar(UpdateCarInput.parse({viatura:'V1',preco:1}),carroV,fichaCompleta,['oficina']).error,/Viaturas/);
 // Nada para alterar, preço com cêntimos, preço e «sob consulta» juntos: o modelo corrige.
 assert.equal(UpdateCarInput.safeParse({viatura:'V1'}).success,false);
 assert.equal(UpdateCarInput.safeParse({viatura:'V1',preco:23500.5}).success,false);
 assert.equal(UpdateCarInput.safeParse({viatura:'V1',preco:23500,sob_consulta:true}).success,false);
 // Texto vazio não apaga.
 assert.equal(UpdateCarInput.safeParse({viatura:'V1',descricao:'  '}).success,false);
});
await test('vehicle status: publish or draft here; reservations and sales have their own flow',()=>{
 const st=(estado,ficha=fichaCompleta,sec=['carros'])=>buildCarStatus({viatura:'V1',estado},carroV,ficha,sec);
 assert.equal(st('published').ok,true);
 assert.equal(st('published').action.de,'draft');
 assert.match(st('reserved').error,/contacto do cliente.*prazo e sinal/);
 assert.match(st('sold').error,/Concluir venda/);
 assert.match(st('draft').error,/já está como «Rascunho»/);
 assert.match(st('published',{...fichaCompleta,status:'workshop'}).error,/oficina/);
 assert.match(st('draft',{...fichaCompleta,status:'sold'}).error,/vendida/);
 assert.match(st('draft',{...fichaCompleta,status:'published',reservaAtiva:true}).error,/reserva ativa/);
 assert.match(st('published',{...fichaCompleta,fuel:null}).error,/ficha/);
 assert.match(st('published',{...fichaCompleta,model:'—'}).error,/ficha/);
 assert.match(st('published',{...fichaCompleta,price:null}).error,/preço/);
 assert.equal(st('published',{...fichaCompleta,price:null,price_on_request:true}).ok,true,'sob consulta publica');
 assert.match(st('published',fichaCompleta,['oficina']).error,/Viaturas/);
});
const lead={id:LEAD_ID,label:'João Silva (BMW 320)',status:'new',assigned_to:null,assigned_name:null,active_reservation:false};
await test('leads follow the backoffice rules: lost needs a reason, won needs the sale',()=>{
 assert.equal(LeadStatusInput.safeParse({contacto:'C1',estado:'lost'}).success,false,'o motivo pergunta-se');
 const perdido=buildLeadStatus(LeadStatusInput.parse({contacto:'C1',estado:'lost',motivo:'Comprou noutro stand'}),lead,['leads']);
 assert.equal(perdido.action.motivo,'Comprou noutro stand');
 assert.equal(buildLeadStatus({contacto:'C1',estado:'contacted',motivo:'x'},lead,['leads']).action.motivo,'','só um perdido leva motivo');
 assert.match(buildLeadStatus({contacto:'C1',estado:'won'},lead,['leads']).error,/Concluir venda/);
 assert.match(buildLeadStatus({contacto:'C1',estado:'new'},lead,['leads']).error,/já está como «Novo»/);
 assert.match(buildLeadStatus({contacto:'C1',estado:'closed'},{...lead,status:'won'},['leads']).error,/já está concluída/);
 assert.match(buildLeadStatus({contacto:'C1',estado:'closed'},{...lead,active_reservation:true},['leads']).error,/reserva ativa/);
 assert.match(buildLeadStatus({contacto:'C1',estado:'closed'},lead,['carros']).error,/Não tem acesso a Leads/);
 const ana={id:CARRO_ID,nome:'Ana Costa'};
 assert.equal(buildAssignLead(lead,ana,['leads']).action.antes,'Por atribuir');
 assert.match(buildAssignLead({...lead,assigned_to:ana.id},ana,['leads']).error,/já é o responsável/);
 assert.match(buildLeadNote({contacto:'C1',texto:'x',tipo:'note'},lead,['oficina']).error,/Leads/);
});
await test('testimonials: approve publishes, reject only takes it off the site',()=>{
 const t={id:LEAD_ID,name:'Maria',rating:5,body:'Excelente serviço, recomendo a toda a gente.',published:false};
 const aprovar=buildTestimonial({testemunho:'T1',acao:'aprovar'},t,['testemunhos']);
 assert.equal(aprovar.action.publicar,true);
 assert.match(buildTestimonial({testemunho:'T1',acao:'rejeitar'},t,['testemunhos']).error,/não está publicado.*backoffice/);
 assert.equal(buildTestimonial({testemunho:'T1',acao:'rejeitar'},{...t,published:true},['testemunhos']).action.publicar,false);
 assert.match(buildTestimonial({testemunho:'T1',acao:'aprovar'},{...t,published:true},['testemunhos']).error,/já está publicado/);
 assert.match(buildTestimonial({testemunho:'T1',acao:'aprovar'},t,['leads']).error,/Testemunhos/);
});
await test('a stored proposal that was tampered with is not executable',()=>{
 for(const a of NOVAS)assert.equal(PendingActionSchema.safeParse(a).success,true,a.kind);
 // Campos que a RPC não aceita, estados de fluxo próprio, ids que não são uuid.
 assert.equal(PendingActionSchema.safeParse({...NOVAS[1],novo:{status:'sold'}}).success,false);
 assert.equal(PendingActionSchema.safeParse({...NOVAS[2],para:'sold'}).success,false);
 assert.equal(PendingActionSchema.safeParse({...NOVAS[3],para:'won'}).success,false);
 assert.equal(PendingActionSchema.safeParse({...NOVAS[3],leadId:'C1'}).success,false);
 assert.equal(PendingActionSchema.safeParse({kind:'delete_car',carId:CARRO_ID}).success,false,'não existe acção de apagar');
});

const {extractFailedStatuses}=load('src/lib/whatsapp/payload.ts');
await test('a failed delivery receipt is picked up, everything else is ignored',()=>{
 const recibos=envelope({metadata:{phone_number_id:'123'},statuses:[
  {id:'wamid.IMG',status:'failed',errors:[{code:131053,title:'Media upload error'}]},
  {id:'wamid.OK',status:'delivered'},{status:'failed'},
 ]});
 assert.deepEqual(extractFailedStatuses(recibos),[{id:'wamid.IMG',error:'(#131053) Media upload error'}]);
 for(const mau of [null,{},{entry:[{changes:[{value:{statuses:'x'}}]}]},'texto'])
  assert.deepEqual(extractFailedStatuses(mau),[],JSON.stringify(mau));
});

const {layoutPreview,imageText}=load('src/lib/whatsapp/preview.ts');
await test('the image is tall enough for its fields and only uses what the font can draw',()=>{
 const curto=layoutPreview(previewCard(NOVAS[2]));
 const longo=layoutPreview(previewCard(NOVAS[0]));
 assert.ok(longo.height>curto.height,'mais campos, imagem mais alta');
 assert.ok(curto.height>=500&&longo.height<=2800,`${curto.height} / ${longo.height}`);
 // Campos curtos vão aos pares, como no formulário; uma alteração tem a sua linha.
 assert.ok(longo.rows.some(r=>r.kind==='pair'&&r.fields.length===2));
 assert.equal(curto.rows[0].kind,'change');
 assert.equal(imageText('Ótimo 👍 serviço\n\nспасибо obrigado',100),'Ótimo serviço obrigado');
 assert.equal(imageText('a'.repeat(300),10).length,10);
});
