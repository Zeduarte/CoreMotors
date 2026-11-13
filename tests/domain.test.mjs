import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url);
// Resolve o alias `@/` como o tsconfig, para os módulos poderem importar-se
// entre si (ex.: permissions.ts -> vehicle-categories.ts).
const cache=new Map();
function withExt(base){for(const ext of ['.ts','.tsx','/index.ts'])if(existsSync(base+ext))return base+ext;throw new Error(`não resolvido: ${base}`);}
function resolveAlias(id){return withExt(`src/${id.slice(2)}`);}
// Imports relativos entre módulos de src/ (ex.: schemas.ts -> ./brand-name).
function resolveRelative(from,id){return withExt(new URL(id,new URL(from,'file:///')).pathname.slice(1));}
function load(path){
 if(cache.has(path))return cache.get(path);
 const source=readFileSync(path,'utf8');
 const {outputText}=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});
 const mod={exports:{}};cache.set(path,mod.exports);
 const localRequire=(id)=>id.startsWith('@/')?load(resolveAlias(id)):id.startsWith('.')?load(resolveRelative(path,id)):require(id);
 new Function('module','exports','require',outputText)(mod,mod.exports,localRequire);
 cache.set(path,mod.exports);return mod.exports;}
const {margin,daysInStock,preparationLabel,csvCell}=load('src/lib/operations.ts');
const {canAccess,canManage}=load('src/lib/permissions.ts');
const {allRows}=load('src/lib/pagination.ts');
await test('missing financial data never becomes a false positive margin',()=>{
 assert.equal(margin(null,1000,20000),null);assert.equal(margin(15000,1000,null),null);assert.equal(margin(15000,1000,20000),4000);assert.equal(margin(20000,2000,19000),-3000);
});
await test('stock age stops at sale and uses calendar dates',()=>{assert.equal(daysInStock('2026-01-01','2026-02-01','2026-09-01'),31);assert.equal(daysInStock(null,null),null);});
await test('readiness requires defined, completed preparation and delivery checks',()=>{
 assert.equal(preparationLabel([]),'Preparação por definir');assert.equal(preparationLabel([{stage:'preparation',status:'waiting_parts'}]),'A aguardar peças');assert.equal(preparationLabel([{stage:'preparation',status:'done'}]),'Pronta para anunciar');assert.equal(preparationLabel([{stage:'preparation',status:'done'},{stage:'delivery',status:'done'}]),'Pronta para entrega');
});
await test('CSV exports neutralize spreadsheet formulas and quote delimiters',()=>{assert.equal(csvCell('=1+1'),'"\'=1+1"');assert.equal(csvCell(' A,"B"'),'" A,""B"""');assert.equal(csvCell('+351910000000'),'"\'+351910000000"');});
await test('financial and mechanical access matches business roles',()=>{
 assert.equal(canAccess('mecanico',['leads'],'leads'),false);assert.equal(canAccess('vendedor',null,'financeiro'),false);assert.equal(canAccess('chefe',null,'financeiro'),true);assert.equal(canAccess('admin',[],'financeiro'),true);assert.equal(canManage('chefe','mecanico'),false);
});
await test('everyone has the personal Hours section, including mechanics',()=>{
 for(const [role,allowed] of [['mecanico',null],['vendedor',null],['vendedor',['leads']],['chefe',null],['admin',[]]]) assert.equal(canAccess(role,allowed,'horas'),true,role);
 assert.equal(canAccess('mecanico',null,'leads'),false);
});
await test('motorcycle categories are one list (Moto 4 is just another category), picked like on OLX',()=>{
 const {applyFilters,emptyFilters}=load('src/lib/vehicles.ts');
 const VC=load('src/lib/vehicle-categories.ts');
 const base={make:'X',model:'Y',year:2020,mileage:0,price:5000,fuel:'Gasolina',transmission:'Manual',featured:false};
 const stock=[{...base,slug:'r6',vehicleType:'motorcycle',body:'Desportiva'},{...base,slug:'ltr',vehicleType:'motorcycle',body:'Moto 4'},{...base,slug:'clio',vehicleType:'car',body:'Utilitário'}];
 const pick=(p)=>applyFilters(stock,{...emptyFilters(),...p}).map(v=>v.slug);
 assert.deepEqual(pick({body:'Moto 4'}),['ltr']);
 assert.deepEqual(pick({vehicleType:'motorcycle'}),['r6','ltr']);
 assert.deepEqual(pick({}),['r6','ltr','clio']);
 assert.ok(VC.bodiesFor('motorcycle').includes('Moto 4'));
 assert.ok(VC.showsInWorkshop('workshop'),'na oficina fica na oficina');
 for(const st of ['draft','prepared','published','reserved','sold']) assert.ok(!VC.showsInWorkshop(st),`${st} só aparece em Viaturas`);
 assert.ok(!VC.bodiesFor('car').includes('Moto 4'));
 for(const b of [...VC.bodiesFor('motorcycle'),...VC.bodiesFor('car')]) assert.ok(VC.BODY_HINT[b],`falta a frase de ${b}`);
});
await test('company contacts come from the main point of sale, keeping what the point leaves blank',()=>{
 const {companyFromPoint,DEFAULT_COMPANY}=load('src/lib/branding.ts');
 const base={...DEFAULT_COMPANY,whatsapp:'351910000000',messenger:'https://m.me/x'};
 const point={address:'Av. Cruzeiro das Lampreias nº727',city:'Cabeça Santa',postalCode:'4575-134',phone:'916100742',email:'',hours:'',latitude:null,longitude:null};
 const c=companyFromPoint(base,point);
 assert.equal(c.phone,'916100742');assert.equal(c.phoneHref,'tel:916100742');
 assert.equal(c.address.street,'Av. Cruzeiro das Lampreias nº727');assert.equal(c.address.city,'Cabeça Santa');
 assert.equal(c.email,base.email,'email vazio no ponto não apaga');
 assert.deepEqual(c.geo,base.geo,'sem coordenadas no ponto mantém as anteriores');
 assert.equal(c.whatsapp,'351910000000');assert.equal(c.messenger,'https://m.me/x');
 assert.deepEqual(companyFromPoint(base,{...point,latitude:41.2,longitude:-8.3}).geo,{lat:41.2,lng:-8.3});
 assert.equal(companyFromPoint(base,undefined),base,'sem pontos de venda fica tudo como estava');
});
await test('only the account owner manages other admins',()=>{
 assert.equal(canManage('admin','admin'),false);assert.equal(canManage('admin','admin',false),false);assert.equal(canManage('admin','admin',true),true);
 assert.equal(canManage('chefe','admin',true),false);assert.equal(canManage('admin','chefe'),true);assert.equal(canManage('admin','mecanico'),true);assert.equal(canManage('chefe','vendedor'),true);
});
await test('pagination reads every row and propagates failures',async()=>{
 const rows=Array.from({length:1203},(_,i)=>i);assert.equal((await allRows(async(a,b)=>({data:rows.slice(a,b+1),error:null}))).length,1203);
 await assert.rejects(allRows(async()=>({data:null,error:{message:'offline'}})),/offline/);
});

const {MarkerBuffer,safeEmitLength}=load('src/lib/chat/stream-marker.ts');
await test('chat streaming never leaks the action marker to the visitor',()=>{
 // Entregue aos pedaços, como vem da API: o marcador nunca pode ser mostrado.
 const buf=new MarkerBuffer();let shown='';
 for(const d of ['Tem gara','ntia de 18 meses.','\n\n[[','ACOES: inte','ressado, cont','actos]]']) shown+=buf.push(d);
 assert.equal(shown,'Tem garantia de 18 meses.');
 assert.ok(buf.raw.includes('[[ACOES:'));
 // Parênteses retos normais no texto continuam a passar.
 const plain=new MarkerBuffer();
 assert.equal(plain.push('Ver [aqui] o stock.')+plain.push(' Obrigado.'),'Ver [aqui] o stock. Obrigado.');
 // Um "[" final fica retido até se saber que não é um marcador.
 assert.equal(safeEmitLength('Preço [['),5);
 assert.equal(safeEmitLength('Preço 10.000 €'),14);
});

const {normalizeLocationIds,describeIssuePath}=load('src/lib/showroom.ts');
await test('point-of-sale identifiers are generated, never blocking the user',()=>{
 // Um id válido é estável: as viaturas ligam-se a ele.
 const estavel=normalizeLocationIds([{id:'penafiel',name:'Stand Penafiel'}]);
 assert.equal(estavel[0].id,'penafiel');

 // O que o utilizador escreveu ("Supermotas") não passa na regra → gera-se.
 const corrigido=normalizeLocationIds([{id:'Supermotas',name:'Supermotas'}]);
 assert.equal(corrigido[0].id,'supermotas');
 assert.equal(normalizeLocationIds([{id:'',name:'Cabeça Santa'}])[0].id,'cabeca-santa');
 assert.equal(normalizeLocationIds([{id:'!!',name:''}])[0].id,'ponto-1');

 // Dois pontos nunca ficam com o mesmo id.
 const repetidos=normalizeLocationIds([
  {id:'Supermotas',name:'Supermotas'},
  {id:'supermotas',name:'Supermotas'},
 ]);
 assert.deepEqual(repetidos.map(p=>p.id),['supermotas','supermotas-2']);
});
await test('validation errors name the section instead of the array index',()=>{
 assert.equal(describeIssuePath(['locations',0,'address']),'Ponto de venda 1 · morada');
 assert.equal(describeIssuePath(['faqs',2,'question']),'Pergunta 3 · pergunta');
 assert.equal(describeIssuePath(['services',1]),'Serviço 2');
});

const {showroomSchema,DEFAULT_SHOWROOM}=load('src/lib/showroom.ts');
await test('the exact value that blocked saving now passes validation',()=>{
 const ponto={id:'Supermotas',name:'Supermotas',address:'Av. Cruzeiro das Lampreias n 727',
  city:'Cabeça Santa',postalCode:'4575-134',phone:'916100742',email:'',
  hours:'9h-13h e 14h-19h',latitude:null,longitude:null};
 const conteudo={...structuredClone(DEFAULT_SHOWROOM),locations:[ponto]};
 // Como estava: o formulário mandava o id tal e qual e a gravação falhava.
 assert.equal(showroomSchema.safeParse(conteudo).success,false);
 // Como fica: o id é corrigido antes de validar.
 const corrigido={...conteudo,locations:normalizeLocationIds(conteudo.locations)};
 const r=showroomSchema.safeParse(corrigido);
 assert.equal(r.success,true,JSON.stringify(r.error?.issues));
 assert.equal(r.data.locations[0].id,'supermotas');
});

const L=load('src/lib/leave.ts');
await test('portuguese holidays follow Easter and cover the fixed dates',()=>{
 // Datas de Páscoa conhecidas.
 assert.equal(L.isoDay(L.easterSunday(2026)),'2026-04-05');
 assert.equal(L.isoDay(L.easterSunday(2027)),'2027-03-28');
 assert.equal(L.isoDay(L.easterSunday(2024)),'2024-03-31');

 const f=L.nationalHolidays(2026);
 assert.equal(f.length,13);
 const dias=f.map(d=>d.day);
 for(const fixo of ['2026-01-01','2026-04-25','2026-05-01','2026-06-10','2026-08-15',
                    '2026-10-05','2026-11-01','2026-12-01','2026-12-08','2026-12-25'])
  assert.ok(dias.includes(fixo),fixo);
 assert.ok(dias.includes('2026-04-03'),'Sexta-feira Santa');
 assert.ok(dias.includes('2026-06-04'),'Corpo de Deus');
 assert.deepEqual(dias,[...dias].sort());
});
await test('only working days that are not holidays can be booked',()=>{
 const cal=L.companyCalendar(2026,[
  {day:'2026-06-29',kind:'holiday',label:'São Pedro'},
  {day:'2026-02-17',kind:'tolerance',label:'Carnaval'},
  {day:'2026-12-24',kind:'mandatory',label:'Véspera de Natal'},
 ]);
 assert.equal(L.isSelectable('2026-07-13',cal),true,'segunda-feira normal');
 assert.equal(L.isSelectable('2026-07-11',cal),false,'sábado');
 assert.equal(L.isSelectable('2026-01-01',cal),false,'feriado nacional');
 assert.equal(L.isSelectable('2026-06-29',cal),false,'feriado municipal');
 assert.equal(L.isSelectable('2026-02-17',cal),false,'tolerância');
 // Dia obrigatório é marcado pela empresa, mas continua a sair do saldo.
 assert.equal(L.isSelectable('2026-12-24',cal),true);
 // Os extras de outro ano não entram.
 assert.equal(L.companyCalendar(2026,[{day:'2025-06-29',kind:'holiday',label:'x'}]).has('2025-06-29'),false);
});
await test('leave balance adds carry-over and the birthday, and ignores rejected days',()=>{
 const saldo={baseDays:22,carriedDays:3,birthdayDay:1};
 const dias=[
  {day:'2026-07-13',half:false,status:'approved'},
  {day:'2026-07-14',half:false,status:'approved'},
  {day:'2026-07-15',half:true, status:'pending'},
  {day:'2026-08-03',half:false,status:'draft'},
  {day:'2026-09-01',half:false,status:'rejected'},
 ];
 const r=L.summarise(saldo,dias);
 assert.equal(r.total,26);
 assert.equal(r.approved,2);
 assert.equal(r.pending,0.5);
 assert.equal(r.marked,3.5,'recusado não conta');
 assert.equal(r.available,22.5);
 // Sem dias marcados o saldo é o total.
 assert.equal(L.summarise(L.DEFAULT_BALANCE,[]).available,23);
});
await test('consecutive days group into one request, across weekends',()=>{
 const dias=['2026-07-13','2026-07-14','2026-07-15','2026-07-16','2026-07-17']
  .map(day=>({day,half:false,status:'pending'}));
 const g=L.groupRanges(dias);
 assert.equal(g.length,1);
 assert.equal(L.describeRange(g[0].from,g[0].to),'13 a 17 de julho');

 // Sexta e a segunda seguinte são o mesmo período; um salto maior não é.
 const ponte=L.groupRanges([
  {day:'2026-07-17',half:false,status:'pending'},
  {day:'2026-07-20',half:false,status:'pending'},
 ]);
 assert.equal(ponte.length,1,'fim de semana pelo meio não quebra');
 const separados=L.groupRanges([
  {day:'2026-07-13',half:false,status:'pending'},
  {day:'2026-07-22',half:false,status:'pending'},
 ]);
 assert.equal(separados.length,2);
 // Estados diferentes nunca se juntam no mesmo pedido.
 assert.equal(L.groupRanges([
  {day:'2026-07-13',half:false,status:'approved'},
  {day:'2026-07-14',half:false,status:'pending'},
 ]).length,2);
 assert.equal(L.describeRange('2026-12-24','2026-12-24'),'24 de dezembro');
 assert.equal(L.describeRange('2026-07-30','2026-08-03'),'30 de julho a 3 de agosto');
});

const {canDecideLeaveFor,leaveSelfApproves}=load('src/lib/permissions.ts');
await test('leave approval follows the hierarchy, and only admins self-approve',()=>{
 // O administrador está no topo.
 assert.equal(canDecideLeaveFor('admin','chefe'),true);
 assert.equal(canDecideLeaveFor('admin','admin'),true);
 // O chefe decide quem está abaixo, nunca um par nem um superior.
 assert.equal(canDecideLeaveFor('chefe','vendedor'),true);
 assert.equal(canDecideLeaveFor('chefe','mecanico'),true);
 assert.equal(canDecideLeaveFor('chefe','chefe'),false,'um par não decide');
 assert.equal(canDecideLeaveFor('chefe','admin'),false,'nunca um superior');
 // Quem não gere ninguém não decide nada.
 assert.equal(canDecideLeaveFor('vendedor','vendedor'),false);
 assert.equal(canDecideLeaveFor('mecanico','vendedor'),false);
 // Só o administrador aprova o próprio plano ao submetê-lo.
 assert.equal(leaveSelfApproves('admin'),true);
 for(const r of ['chefe','vendedor','mecanico']) assert.equal(leaveSelfApproves(r),false,r);
});

// ---------------------------------------------------------------------------
// Correções vindas da ronda de testes funcionais de 2026-09-23.
// ---------------------------------------------------------------------------

const {marginHint}=load('src/lib/operations.ts');
await test('margin hint names the field that is actually missing',()=>{
 // O relatório: aquisição gravada, preço sob consulta, e a página insistia em
 // "Aquisição por preencher".
 assert.equal(marginHint(10000,null),'Preço por preencher');
 assert.equal(marginHint(null,20000),'Aquisição por preencher');
 assert.equal(marginHint(null,null),'Aquisição e preço por preencher');
});

const {canonicalBrand,brandOptions,sameBrand}=load('src/lib/brand-name.ts');
await test('brand spelling does not split the same make in two',()=>{
 // Do relatório: a pesquisa achava três BMW, o filtro mostrava uma.
 assert.equal(canonicalBrand('Bmw'),'BMW');
 assert.equal(canonicalBrand('bmw'),'BMW');
 assert.equal(canonicalBrand('  BMW '),'BMW');
 assert.deepEqual(brandOptions(['BMW','Bmw','bmw']),['BMW']);
 assert.equal(sameBrand('Bmw','BMW'),true);
 // Marcas fora do catálogo ficam como foram escritas, mas agrupam-se.
 assert.equal(canonicalBrand('Marca Rara'),'Marca Rara');
 assert.deepEqual(brandOptions(['Marca rara','Marca Rara']).length,1);
 assert.equal(canonicalBrand(''),'');
});

const {carFormSchema,companySchema}=load('src/lib/schemas.ts');
const carroBase={vehicle_type:'car',make:'bmw',model:'116d',year:2020,mileage:50000,
 fuel:'Diesel',transmission:'Manual',body:'Berlina',price:20000,doors:5,seats:5};
await test('blank optional numbers stay unknown instead of becoming zero',()=>{
 // Do relatório: criar sem donos nem potência publicava "Nº de donos 0" e "0 cv".
 const r=carFormSchema.safeParse({...carroBase,owners:'',warranty_months:'',previous_price:''});
 assert.equal(r.success,true,JSON.stringify(r.error?.issues));
 assert.equal(r.data.owners,null,'donos em branco não é zero');
 assert.equal(r.data.warranty_months,null);
 assert.equal(r.data.previous_price,null);
 // Um zero já gravado também se lê como desconhecido.
 assert.equal(carFormSchema.safeParse({...carroBase,owners:0}).data.owners,null);
 // Um valor indicado passa intacto.
 assert.equal(carFormSchema.safeParse({...carroBase,owners:'2'}).data.owners,2);
});
await test('brand is stored in the catalogue spelling',()=>{
 assert.equal(carFormSchema.safeParse(carroBase).data.make,'BMW');
});
await test('a motorcycle cannot be saved with car seating',()=>{
 // Do relatório: o formulário de motas oferecia 4 a 9 lugares.
 const mota={...carroBase,vehicle_type:'motorcycle',body:'Naked',doors:0,seats:5};
 const r=carFormSchema.safeParse(mota);
 assert.equal(r.success,false);
 assert.equal(r.error.issues.some(i=>i.path[0]==='seats'),true);
 assert.equal(carFormSchema.safeParse({...mota,seats:2}).success,true);
});
await test('whatsapp is rejected or completed when the country code is missing',()=>{
 // Do relatório: a ficha gerava wa.me/916193337, que o WhatsApp não reconhece.
 assert.equal(companySchema.safeParse({whatsapp:'916193337'}).data.whatsapp,'351916193337');
 assert.equal(companySchema.safeParse({whatsapp:'351916193337'}).data.whatsapp,'351916193337');
 assert.equal(companySchema.safeParse({whatsapp:'12345'}).success,false,'curto demais é recusado');
 assert.equal(companySchema.safeParse({whatsapp:''}).success,true);
});

const {normalizeWhatsApp}=load('src/lib/phone.ts');
await test('whatsapp links always carry a country code',()=>{
 assert.equal(normalizeWhatsApp('916193337'),'351916193337');
 assert.equal(normalizeWhatsApp('916 193 337'),'351916193337');
 assert.equal(normalizeWhatsApp('+351 916 193 337'),'351916193337');
 assert.equal(normalizeWhatsApp('4915112345678'),'4915112345678','estrangeiro fica igual');
});

const {defaultAssignableRole}=load('src/lib/permissions.ts');
await test('creating a user does not default to administrator',()=>{
 // Do relatório: o papel pré-selecionado era Administrador.
 assert.equal(defaultAssignableRole('admin'),'vendedor');
 assert.equal(defaultAssignableRole('chefe'),'vendedor');
 assert.equal(defaultAssignableRole('vendedor'),null,'não atribui papéis a ninguém');
});

const {extrasCatalog,groupExtras}=load('src/lib/extras.ts');
await test('motorcycles are offered motorcycle equipment only',()=>{
 // Do relatório: vidros elétricos, volante e climatização bi-zona nas motas.
 const mota=extrasCatalog('motorcycle').flatMap(g=>g.items);
 for(const proibido of ['Vidros elétricos dianteiros','Volante em pele',
  'Climatização bi-zona','Tecto de abrir/correr elétrico'])
  assert.equal(mota.includes(proibido),false,proibido);
 assert.equal(mota.includes('Quickshifter'),true);
 assert.equal(mota.includes('Punhos aquecidos'),true);
 // Os extras de mota continuam a agrupar-se na ficha pública.
 const grupos=groupExtras(['Quickshifter','Punhos aquecidos']);
 assert.equal(grupos.some(g=>g.title==='Outros equipamentos'),false,
  'equipamento de mota não cai em "Outros"');
 // E o carro mantém o catálogo de sempre.
 assert.equal(extrasCatalog('car').flatMap(g=>g.items).includes('Volante em pele'),true);
});

const {worklogHours}=load('src/lib/operations.ts');
await test('workshop hours reject zero duration and never guess a night shift',()=>{
 // Do relatório: 10:53–10:53 foi aceite como 0 h; 11:00–10:00 virou 23 h.
 assert.ok('error' in worklogHours('10:53','10:53',false),'0 h é recusado');
 assert.ok('error' in worklogHours('11:00','10:00',false),'intervalo invertido é recusado');
 // Trabalho nocturno só quando é declarado.
 assert.equal(worklogHours('22:00','02:00',true).hours,4);
 // Turno normal e turno em aberto.
 assert.equal(worklogHours('09:00','17:30',false).hours,8.5);
 assert.equal(worklogHours('09:00','',false).hours,0,'sem fim fica em aberto');
});

await test('viatura sem origem indicada é nacional (só se marca quando é importada)',()=>{
 assert.equal(carFormSchema.safeParse(carroBase).data.national,true);
 assert.equal(carFormSchema.safeParse({...carroBase,national:false}).data.national,false);
});
