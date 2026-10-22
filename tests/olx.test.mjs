// Publicação no OLX — as partes puras: texto, atributos, ciclo de vida e OAuth.
// É aqui que se garante que um anúncio nunca é recusado por uma regra que se
// podia ter verificado antes de o enviar.
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

const F=load('src/lib/olx/fields.ts');
await test('OLX fields come from the API definitions and become form fields and filters',()=>{
 const attrs=[
  {code:'make',label:'Marca',validation:{required:true},values:[{code:'yamaha',label:'Yamaha'},{code:'bmw',label:'BMW'}]},
  {code:'color',label:'Cor',validation:{required:false},values:[{code:'preto',label:'Preto'},{code:'azul',label:'Azul'}]},
  {code:'condition',label:'Condição',validation:{required:true},values:[{code:'usado',label:'Usado'},{code:'novo',label:'Novo'}]},
  {code:'origin',label:'Origem',validation:{required:true},values:[{code:'nacional',label:'Nacional'},{code:'importado',label:'Importado'}]},
  {code:'extras',label:'Equipamento',validation:{allow_multiple_values:true},values:[{code:'abs',label:'ABS'},{code:'gps',label:'GPS'}]},
  {code:'weight',label:'Peso',unit:'kg',validation:{numeric:true}},
  {code:'vin',label:'Nº de quadro',validation:{}},
  {code:'price',label:'Preço',validation:{type:'price',required:true}},
  'lixo',
 ];
 const fields=F.toFields(attrs);
 assert.deepEqual(fields.map(f=>[f.code,f.kind]),[['make','select'],['color','select'],['condition','select'],['origin','select'],['extras','multi'],['weight','number'],['vin','text']],'preço fica de fora');
 const moto={make:'Yamaha',model:'R6',year:2019,mileage:10000,fuel:'Gasolina',transmission:'Manual',body:'Desportiva',power:120,displacement:600,color:'Preto',doors:0,seats:2,registrationMonth:null};
 // Automático: o que o site já sabe.
 assert.deepEqual(F.autoValues(fields,moto),{make:'yamaha',color:'preto',condition:'usado'});
 // A ficha manda: valida contra a lista do OLX e ignora o que não existe.
 const manual={color:'azul',origin:'importado',extras:['gps','xpto'],weight:'187,4',vin:'  JYA123  ',make:'ferrari',inventado:'x'};
 assert.deepEqual(F.cleanValues(fields,manual),{color:'azul',origin:'importado',extras:['gps'],weight:'187',vin:'JYA123'});
 const ad=F.advertAttributes(fields,moto,manual);
 assert.deepEqual(ad.missing,[]);
 assert.deepEqual(ad.attributes.find(a=>a.code==='extras'),{code:'extras',values:['gps']});
 assert.equal(ad.attributes.find(a=>a.code==='make').value,'yamaha','valor inválido na ficha não apaga o automático');
 // Obrigatório sem valor: não se inventa, diz onde preencher.
 assert.match(F.advertAttributes(fields,moto,{}).missing.join(),/Origem.*Campos do OLX/);
 // Filtros: sem duplicar os do site (marca), números com intervalo.
 assert.deepEqual(F.searchableFields(fields).map(f=>f.code),['color','condition','origin','extras','weight']);
 const vals=F.effectiveValues(fields,moto,manual);
 assert.equal(F.matchesOlxFilters(vals,{origin:'importado',weight:{min:150,max:200}}),true);
 assert.equal(F.matchesOlxFilters(vals,{origin:'nacional'}),false);
 assert.equal(F.matchesOlxFilters(vals,{extras:'gps'}),true);
 assert.equal(F.matchesOlxFilters(vals,{weight:{min:200,max:null}}),false);
 assert.equal(F.matchesOlxFilters(undefined,{color:''}),true,'filtro vazio não filtra');
 assert.deepEqual(F.valuesInStock(fields[1],[vals,{color:'preto'}]).map(v=>v.label),['Preto','Azul']);
 assert.equal(F.valueLabel(fields[4],['abs','gps']),'ABS, GPS');
 // Na ficha: um formulário só. O que o site tem não se repete; volta apenas
 // se o site tiver um valor que o OLX não reconhece.
 const place=F.formPlacement(fields,F.autoValues(fields,moto),()=>true);
 assert.deepEqual(place.characteristics.map(f=>f.code),['condition','origin','weight','vin'].filter(c=>!fields.find(f=>f.code===c)?.siteField));
 assert.deepEqual(place.equipment.map(f=>f.code),['extras']);
 assert.deepEqual(place.fixes,[]);
 const ferrari={...moto,make:'Ferrari'};
 assert.deepEqual(F.formPlacement(fields,F.autoValues(fields,ferrari),()=>true).fixes.map(f=>f.code),['make']);
 assert.deepEqual(F.formPlacement(fields,F.autoValues(fields,{...moto,make:''}),(s)=>s!=='make').fixes,[],'marca vazia preenche-se no campo do site');
 assert.deepEqual(F.missingRequired(fields,{},F.autoValues(fields,moto)).map(f=>f.code),['origin']);
});

const C=load('src/lib/olx/categories.ts');
await test('new segments reach OLX: Utilitário and Moto 4 are not confused with Citadino',()=>{
 const A=load('src/lib/olx/attributes.ts');
 const body=[{code:'u',label:'Utilitário'},{code:'c',label:'Citadino'},{code:'q',label:'Moto 4 / Quad'}];
 assert.equal(A.pickValue('Utilitário',body),'u');
 assert.equal(A.pickValue('Citadino',body),'c');
 assert.equal(A.pickValue('Moto 4',body),'q');
});
await test('OLX categories are recognised by name, never parts or the parent branch',()=>{
 const tree=[
  {id:1,name:'Carros, motos e barcos',is_leaf:false},
  {id:377,name:'Carros',is_leaf:false},
  {id:378,name:'Motociclos - Scooters',is_leaf:true},
  {id:379,name:'Peças e Acessórios para Carros',is_leaf:true},
  {id:380,name:'Barcos',is_leaf:true},
 ];
 assert.deepEqual(C.categoryCandidates(tree,'car').map(c=>c.id),[377],'aceita "Carros" mesmo com subcategorias');
 assert.deepEqual(C.categoryCandidates(tree,'motorcycle').map(c=>c.id),[378]);
 // Havendo uma final, prefere-a à que tem subcategorias.
 assert.deepEqual(C.categoryCandidates([...tree,{id:400,name:'Carros usados',is_leaf:true}],'car').map(c=>c.id),[400]);
 // Para escolher à mão: veículos sim, peças não.
 assert.deepEqual(tree.filter(C.isVehicleCategory).map(c=>c.id),[1,377,378]);
 assert.deepEqual(C.categoryCandidates([{id:9,name:'Auto Peças',is_leaf:true}],'car'),[]);
});

const S=load('src/lib/olx/stats.ts');
await test('OLX statistics parse direct or wrapped responses; junk becomes unknown, not zero',()=>{
 assert.deepEqual(S.parseStats({advert_views:123,phone_views:100,users_observing:10}),{views:123,phoneViews:100,observers:10});
 assert.deepEqual(S.parseStats({data:{advert_views:'45',phone_views:0,users_observing:null}}),{views:45,phoneViews:0,observers:null});
 assert.deepEqual(S.parseStats({advert_views:-1,phone_views:1.5,users_observing:'x'}),{views:null,phoneViews:null,observers:null});
 assert.deepEqual(S.parseStats(null),{views:null,phoneViews:null,observers:null});
 assert.equal(S.wantsStats({external_id:'1',status:'published'}),true);
 assert.equal(S.wantsStats({external_id:'1',status:'removed'}),false);
 assert.equal(S.wantsStats({external_id:null,status:'published'}),false);
});

const T=load('src/lib/olx/text.ts');
await test('title and description always pass OLX text rules',()=>{
 // "BMW 320d 2018": curto demais e 75% maiúsculas.
 const t=T.buildTitle('BMW 320d 2018',['Diesel','120 000 km','Manual']);
 assert.ok(t.length>=16&&t.length<=150,t);
 assert.ok(T.capsRatio(t)<=0.5,t);
 assert.match(t,/^BMW 320d 2018/);
 // Texto gritado, com contactos e pontuação repetida.
 const d=T.buildDescription('GRANDE OPORTUNIDADE!!!! Ligue 912 345 678 ou joao@stand.pt www.stand.pt',['Ano: 2018']);
 assert.deepEqual(T.textProblems(t,d),[],d);
 assert.equal(/912|@|www/.test(d),false,'contactos removidos');
 assert.equal(/!!!/.test(d),false);
 // Sem descrição nenhuma, a ficha e o complemento garantem os 80 caracteres.
 assert.ok(T.buildDescription('',[]).length>=80);
 // "120 000 km" não é um telefone.
 assert.match(T.stripContacts('120 000 km'),/120 000 km/);
 assert.ok(T.textProblems('curto','x').length>=2);
});

const A=load('src/lib/olx/attributes.ts');
const facts={make:'BMW',model:'320d',year:2018,mileage:120000,fuel:'Diesel',transmission:'Automática',
 body:'Berlina',power:190,displacement:1995,color:'Preto',doors:4,seats:5,registrationMonth:null};
const defs=[
 {code:'make',label:'Marca',validation:{required:true},values:[{code:'audi',label:'Audi'},{code:'bmw',label:'BMW'}]},
 {code:'fuel_type',label:'Combustível',validation:{required:true},values:[{code:'petrol',label:'Gasolina'},{code:'diesel',label:'Diesel'}]},
 {code:'gearbox',label:'Caixa de velocidades',validation:{required:true},values:[{code:'manual',label:'Manual'},{code:'automatic',label:'Automática'}]},
 {code:'milage',label:'Quilómetros',unit:'km',validation:{required:true,numeric:true}},
 {code:'price',label:'Preço',validation:{type:'price',required:true}},
];
await test('car fields map to OLX attributes by label, never by guess',()=>{
 const r=A.mapAttributes(defs,facts);
 assert.deepEqual(r.missing,[]);
 const by=Object.fromEntries(r.attributes.map(a=>[a.code,a.value]));
 assert.deepEqual(by,{make:'bmw',fuel_type:'diesel',gearbox:'automatic',milage:'120000'});
 assert.equal(r.attributes.some(a=>a.code==='price'),false,'o preço vai no campo próprio');
 // Um valor que o OLX não aceita, num obrigatório: não escolhe outro qualquer.
 const gpl=A.mapAttributes(defs,{...facts,fuel:'GPL'});
 assert.match(gpl.missing.join(),/Combustível.*GPL/);
 // Um obrigatório que o site não tem.
 const vin=A.mapAttributes([{code:'vin',label:'Número de chassis',validation:{required:true}}],facts);
 assert.equal(vin.missing.length,1);
 // Opcional sem correspondência: simplesmente não vai.
 assert.deepEqual(A.mapAttributes([{code:'vin',label:'Número de chassis',validation:{required:false}}],facts).missing,[]);
 // Duas correspondências parciais = dúvida = não escolhe.
 assert.equal(A.pickValue('hibrido',[{code:'a',label:'Híbrido gasolina'},{code:'b',label:'Híbrido diesel'}]),null);
});

const Ad=load('src/lib/olx/advert.ts');
const car={...facts,id:'11111111-1111-4111-8111-111111111111',variant:null,price:18500,priceOnRequest:false,
 description:'Muito estimado, revisões na marca.',tagline:null,extras:['GPS','Bluetooth']};
const ctx={categoryId:181,attributeDefs:defs,cityId:1,contactName:'CoreMotors',contactPhone:'916193337',
 images:['https://x/1.jpg','https://x/2.jpg','https://x/3.jpg'],photosLimit:2};
await test('an advert is built only when OLX would accept it',()=>{
 const r=Ad.buildAdvert(car,ctx);
 assert.equal(r.ok,true,JSON.stringify(r.problems));
 assert.equal(r.advert.external_id,car.id,'o id do site identifica o anúncio');
 assert.equal('external_url' in r.advert,false,'o OLX recusa links externos de parceiros');
 assert.equal(r.advert.images.length,2,'respeita o limite de fotos da categoria');
 assert.deepEqual(r.advert.price,{value:18500,currency:'EUR',negotiable:false,trade:false});
 const sob=Ad.buildAdvert({...car,priceOnRequest:true,price:null},ctx);
 assert.equal(sob.ok,false);assert.match(sob.problems.join(),/preço/);
 assert.match(Ad.buildAdvert(car,{...ctx,images:[]}).problems.join(),/fotografia/);
});

const L=load('src/lib/olx/lifecycle.ts');
await test('what happens to the OLX advert follows the car',()=>{
 const d=(status,extra={})=>L.desiredAction({status,channels:['olx'],externalId:null,remoteStatus:null,...extra});
 assert.equal(d('published'),'create');
 assert.equal(d('published',{externalId:'9',remoteStatus:'active'}),'update');
 assert.equal(d('published',{externalId:'9',remoteStatus:'outdated'}),'update_and_activate');
 assert.equal(d('reserved'),'none','não se cria anúncio para uma reservada');
 assert.equal(d('reserved',{externalId:'9',remoteStatus:'active'}),'update');
 assert.equal(d('sold',{externalId:'9',remoteStatus:'active'}),'deactivate_sold');
 assert.equal(d('sold'),'none');
 assert.equal(d('draft',{externalId:'9',remoteStatus:'active'}),'deactivate');
 assert.equal(L.desiredAction({status:'published',channels:[],externalId:'9',remoteStatus:'active'}),'deactivate','OLX desmarcado');
 assert.equal(L.desiredAction({status:'published',channels:[],externalId:'9',remoteStatus:'removed_by_user'}),'none');
});

const O=load('src/lib/olx/oauth.ts');
await test('the OAuth state binds the return to the browser that started it',()=>{
 const s=O.createState('segredo',1000);
 assert.equal(O.verifyState(s,s,'segredo',2000),true);
 assert.equal(O.verifyState(s,null,'segredo',2000),false,'sem cookie');
 assert.equal(O.verifyState(s,O.createState('segredo',1000),'segredo',2000),false,'outro navegador');
 assert.equal(O.verifyState(s,s,'outro',2000),false,'assinatura');
 assert.equal(O.verifyState(s,s,'segredo',1000+11*60*1000),false,'expirado');
 // Só letras e algarismos: passa na firewall do OLX (o formato antigo não).
 assert.match(s,/^[a-z0-9]+$/);
 const [n,,sig]=s.split('z');
 const forjado=`${n}z${(9e15).toString(36)}z${sig}`;
 assert.equal(O.verifyState(forjado,forjado,'segredo',2000),false,'prazo adulterado');
 const antigo='abc.123.def';
 assert.equal(O.verifyState(antigo,antigo,'segredo',2000),false,'formato antigo recusado');
});
