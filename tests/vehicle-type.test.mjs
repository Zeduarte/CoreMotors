import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);
const rows = [];
const leadRows = [];
let nextId = 1;
// O tipo de site (Definições → Tipo de site), lido de site_content.
let siteTypes=["car","motorcycle"];
// Perfil do utilizador autenticado do backoffice (acesso aos dois mundos).
let profile={id:"staff-test",role:"admin",allowed_vehicle_types:null};
const requestedSections = [];
function query(table) {
  const conditions = [];
  let operation = "read",
    payload,
    single = false;
  const api = {
    select() {
      return api;
    },
    range() { return api; },
    order() {
      return api;
    },
    limit() {
      return api;
    },
    in(k, values) {
      conditions.push((r) => values.includes(r[k]));
      return api;
    },
    eq(k, v) {
      conditions.push((r) => r[k] === v);
      return api;
    },
    neq(k, v) {
      conditions.push((r) => r[k] !== v);
      return api;
    },
    insert(v) {
      operation = "insert";
      payload = v;
      return api;
    },
    update(v) {
      operation = "update";
      payload = v;
      return api;
    },
    maybeSingle() {
      single = true;
      return api;
    },
    single() {
      single = true;
      return api;
    },
    then(onResult, onError) {
      let result =
        table === "cars"
          ? rows.filter((r) => conditions.every((c) => c(r)))
          : table === "profiles"
            ? (profile ? [profile] : [])
            : table === "site_content"
              ? [{ key: "site", content: { vehicle_types: siteTypes } }]
              : [];
      if (operation === "insert") {
        result = [
          {
            ...payload,
            id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`,
          },
        ];
        (table === "leads" ? leadRows : rows).push(...result);
      }
      if (operation === "update")
        result.forEach((r) => Object.assign(r, payload));
      return Promise.resolve({
        data: single ? (result[0] ?? null) : result,
        error: null,
      }).then(onResult, onError);
    },
  };
  return api;
}
const db = {
  from: query,
  auth: { getUser: async () => ({ data: { user: { id: "staff-test" } } }) },
};
const cache = new Map();
function load(file) {
  file = resolve(file);
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  const custom = (id) => {
    if (id === "server-only") return {};
    if (id === "next/headers") return {cookies:async()=>({get:()=>undefined})};
    if (id === "next/cache")
      return { revalidatePath() {}, revalidateTag() {}, unstable_cache: (f) => f };
    if (id === "@/lib/guard")
      return {
        requireSection: async (section) => requestedSections.push(section),
        requireVehicleType: async () => {},
        requireCarsAccess: async () => {},
      };
    if (id === "@/lib/public-submissions") return {publicSubmissionClient:async()=>db};
    if (id === "@/lib/supabase/server") return { createClient: async () => db };
    if (id === "@/lib/supabase/public") return { supabasePublic: db };
    if (id === "@/lib/storage")
      return { MEDIA_BUCKET: "media", publicMediaUrl: (p) => p };
    if (id.startsWith("@/") || id.startsWith(".")) {
      let path = id.startsWith("@/")
        ? resolve("src", id.slice(2))
        : resolve(dirname(file), id);
      if (!existsSync(path)) path += ".ts";
      return load(path);
    }
    return require(id);
  };
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  });
  new Function("module", "exports", "require", outputText)(
    mod,
    mod.exports,
    custom,
  );
  cache.set(file, mod.exports);
  return mod.exports;
}
const { createCar, updateCar } = load("src/lib/actions/cars.ts");
const { getVehicles, getRecentVehicles, getFeaturedVehicles, getSoldVehicles, getVehicleBySlug } = load("src/lib/queries.ts");
const { getAdminCars, getAdminCarById } = load("src/lib/admin-queries.ts");
const { inventoryVehicleType } = load("src/lib/vehicle-categories.ts");
await test("advert type is persisted on create/edit and scopes public database reads", async () => {
  const common = {
    year: 2023,
    mileage: 8000,
    fuel: "Gasolina",
    transmission: "Manual",
    price: 3500,
    status: "published",
  };
  const bike = {
    ...common,
    make: "Honda",
    model: "PCX",
    body: "Scooter",
    vehicle_type: "motorcycle",
    doors: 0,
    seats: 2,
  };
  const car = {
    ...common,
    make: "BMW",
    model: "320",
    body: "Berlina",
    vehicle_type: "car",
    doors: 4,
    seats: 5,
  };
  const b = await createCar(bike),
    c = await createCar(car);
  assert.equal(b.ok, true);
  assert.equal(c.ok, true);
  assert.equal(rows.find((r) => r.id === b.id).vehicle_type, "motorcycle");
  assert.equal(rows.find((r) => r.id === c.id).vehicle_type, "car");
  assert.equal((await updateCar(b.id, { ...bike, price: 4000 })).ok, true);
  assert.equal(rows.find((r) => r.id === b.id).vehicle_type, "motorcycle");
  assert.deepEqual(
    (await getVehicles("motorcycle")).map((v) => v.id),
    [b.id],
  );
  assert.deepEqual(
    (await getVehicles("car")).map((v) => v.id),
    [c.id],
  );
  // Um só site: carros e motas juntos.
  assert.deepEqual((await getVehicles()).map(v=>v.id).sort(),[b.id,c.id].sort());
  // Site só de motas: os carros deixam de aparecer (e vice-versa).
  siteTypes=["motorcycle"];
  assert.deepEqual((await getVehicles()).map(v=>v.id),[b.id]);
  assert.deepEqual((await getVehicles("car")).map(v=>v.id),[]);
  siteTypes=["car"];
  assert.deepEqual((await getVehicles()).map(v=>v.id),[c.id]);
  siteTypes=["car","motorcycle"];
  assert.deepEqual(requestedSections, ["carros", "carros", "carros"]);
});
test("inventory URL accepts only known vehicle sections", () => {
  assert.equal(inventoryVehicleType("carros"), "car");
  assert.equal(inventoryVehicleType("motas"), "motorcycle");
  for (const value of [undefined, "unknown", ["motas", "carros"]])
    assert.equal(inventoryVehicleType(value), null);
});

await test("one site: cars and motorcycles together in every public list and in the backoffice, as the site type says",async()=>{
 const bike=rows.find(r=>r.vehicle_type==="motorcycle"), car=rows.find(r=>r.vehicle_type==="car");
 bike.featured=car.featured=true;
 const ids=list=>list.map(v=>v.id).sort();
 assert.deepEqual(ids(await getRecentVehicles()),[bike.id,car.id].sort());
 assert.deepEqual(ids(await getFeaturedVehicles()),[bike.id,car.id].sort());
 assert.equal((await getVehicleBySlug(car.slug)).id,car.id);
 assert.equal((await getVehicleBySlug(bike.slug)).id,bike.id);
 assert.deepEqual(ids(await getAdminCars()),[bike.id,car.id].sort());
 assert.deepEqual((await getAdminCars("motas")).map(v=>v.id),[bike.id]);
 assert.equal((await getAdminCarById(bike.id)).id,bike.id);
 // Site só de carros: a ficha de uma mota não abre no site; no backoffice
 // continua (para acabar vendas e retirar anúncios), mas já não se criam motas.
 siteTypes=["car"];
 assert.equal(await getVehicleBySlug(bike.slug),undefined);
 assert.deepEqual(ids(await getAdminCars()),[bike.id,car.id].sort());
 assert.equal((await getAdminCarById(bike.id)).id,bike.id);
 const {getActiveVehicleTypes}=load("src/lib/vehicle-context.ts");
 assert.deepEqual(await getActiveVehicleTypes(),["car"]);
 bike.status=car.status="sold";
 assert.deepEqual((await getSoldVehicles()).map(v=>v.id),[car.id]);
 siteTypes=["car","motorcycle"];
 assert.deepEqual(ids(await getSoldVehicles()),[bike.id,car.id].sort());
});
// Para onde a rota do mundo manda: o `Location` (destinos com pesquisa) ou a
// página mínima que segue sozinha (destinos sem pesquisa — no Netlify, um
// `Location` sem pesquisa recebia a do pedido: /?type=…&area=…&target=…).
async function destinationOf(response){
 const location=response.headers.get("location");
 if(location)return location;
 const html=await response.clone().text();
 return /http-equiv="refresh" content="0;url=([^"]*)"/.exec(html)?.[1]?.replace(/&amp;/g,"&")??null;
}
await test("old carros/motas switch links land on the page (the stock filtered by type) without storing anything",async()=>{
 const {NextRequest}=require("next/server");
 const {GET}=load("src/app/api/vehicle-context/route.ts");
 const result=await GET(new NextRequest("https://example.test/api/vehicle-context?type=motorcycle&area=public&target=%2Finventario"));
 assert.equal(result.status,303);
 assert.equal(await destinationOf(result),"/inventario?tipo=motas");
 assert.equal(result.cookies.get("coremotors_public_type").value,"","o cookie antigo é apagado");
 assert.equal(result.cookies.get("coremotors_admin_type"),undefined);
 // Sem pesquisa no destino: página mínima que segue sozinha (Netlify).
 const about=await GET(new NextRequest("https://example.test/api/vehicle-context?type=motorcycle&target=%2Fsobre"));
 assert.equal(about.headers.get("location"),null,"sem Location: o Netlify juntava-lhe a pesquisa do pedido");
 assert.match(await about.clone().text(),/location\.replace\("\/sobre"\)/);
 const unsafe=await GET(new NextRequest("https://example.test/api/vehicle-context?type=car&area=admin&target=https://evil.test"));
 assert.equal(await destinationOf(unsafe),"/");
 assert.equal(unsafe.cookies.get("coremotors_admin_type"),undefined);
 const invalid=await GET(new NextRequest("https://example.test/api/vehicle-context?type=truck"));
 assert.equal(invalid.status,400);
 // As páginas por marca e o stock com uma pesquisa voltam para onde estavam.
 const go=async(target)=>destinationOf(await GET(new NextRequest(`https://example.test/api/vehicle-context?type=motorcycle&area=public&target=${encodeURIComponent(target)}`)));
 assert.equal(await go("/motas/yamaha"),"/motas/yamaha");
 const withQuery=await GET(new NextRequest(`https://example.test/api/vehicle-context?type=motorcycle&area=public&target=${encodeURIComponent("/inventario?marca=Yamaha&preco_max=8000")}`));
 assert.equal(withQuery.status,303);
 assert.equal(withQuery.headers.get("location"),"/inventario?marca=Yamaha&preco_max=8000&tipo=motas");
 // Só caminhos deste site: nada de outros domínios, esquemas, "..", nem a
 // própria API ou o backoffice.
 for(const bad of ["//evil.test","/\\evil.test","/%2F%2Fevil.test","https://evil.test","javascript:alert(1)","/motas/../admin","/motas/%2e%2e/admin","/inventario?x=<script>","/api/vehicle-context?type=car","/admin","/a b","/x\nLocation: //evil.test"]) assert.equal(await go(bad),"/",bad);
});

await test("a stock alert keeps what the person is looking for, with the type of the page it came from",async()=>{
 const {submitLead}=load("src/lib/actions/leads.ts");
 const f=new FormData();
 for(const[k,v]of Object.entries({privacy_acknowledged:"yes",kind:"alert",vehicle_type:"motorcycle",name:"Cliente Alerta",phone:"912345678",alert_make:"yamaha",alert_max_price:"8 000",whatsapp_opt_in:"yes"}))f.set(k,v);
 assert.equal((await submitLead({ok:false},f)).ok,true);
 const lead=leadRows.at(-1);
 assert.equal(lead.vehicle_type,"motorcycle","a página /motas diz o tipo, não o mundo guardado");
 assert.deepEqual({make:lead.car_details.criteria.make,max:lead.car_details.criteria.max_price},{make:"Yamaha",max:8000});
 assert.ok(lead.car_details.whatsapp_opt_in_at);
 assert.match(lead.message,/Yamaha · até 8/);
 f.set("alert_make","");f.set("alert_max_price","");
 const empty=await submitLead({ok:false},f);
 assert.equal(empty.ok,false);
 assert.match(empty.error,/marca, a categoria ou o preço/);
});

await test("public enquiries: the vehicle (or the form) says the type; a general contact on a mixed site has none",async()=>{
 const {submitLead}=load("src/lib/actions/leads.ts");
 const car=rows.find(r=>r.vehicle_type==="car"),bike=rows.find(r=>r.vehicle_type==="motorcycle");
 car.status=bike.status="published";
 function form(id){const f=new FormData();for(const[k,v]of Object.entries({privacy_acknowledged:"yes",kind:"contact",name:"Cliente Teste",email:"cliente@example.test",message:"Pretendo mais informações",...(id?{car_id:id}:{})}))f.set(k,v);return f;}
 // Site com carros e motas: um contacto geral fica sem tipo.
 assert.equal((await submitLead({ok:false},form())).ok,true);
 assert.equal(leadRows.at(-1).vehicle_type,null);
 // Site só de motas: o contacto geral é de motas.
 siteTypes=["motorcycle"];
 assert.equal((await submitLead({ok:false},form())).ok,true);
 assert.equal(leadRows.at(-1).vehicle_type,"motorcycle");
 siteTypes=["car","motorcycle"];
 // A encomenda diz o tipo no formulário.
 const order=form();order.set("vehicle_type","motorcycle");
 assert.equal((await submitLead({ok:false},order)).ok,true);
 assert.equal(leadRows.at(-1).vehicle_type,"motorcycle");
 // A viatura diz o tipo.
 assert.equal((await submitLead({ok:false},form(car.id))).ok,true);
 assert.equal(leadRows.at(-1).car_id,car.id);
 assert.equal(leadRows.at(-1).vehicle_type,"car");
 assert.equal((await submitLead({ok:false},form(bike.id))).ok,true);
 assert.equal(leadRows.at(-1).car_id,bike.id);
 assert.equal(leadRows.at(-1).vehicle_type,"motorcycle");
});

await test("per-user vehicle access limits what the single backoffice shows",async()=>{
 const {getAdminVehicleTypes}=load("src/lib/vehicle-context.ts");

 // Só carros: vê só carros, e `?tipo=motas` não abre as motas.
 profile={id:"staff-test",role:"vendedor",allowed_vehicle_types:["car"]};
 assert.deepEqual(await getAdminVehicleTypes(),["car"]);
 assert.deepEqual(await getAdminVehicleTypes("motas"),["car"]);

 // Só motas: o inverso.
 profile={id:"staff-test",role:"vendedor",allowed_vehicle_types:["motorcycle"]};
 assert.deepEqual(await getAdminVehicleTypes(),["motorcycle"]);
 assert.deepEqual(await getAdminVehicleTypes("carros"),["motorcycle"]);

 // O admin vê sempre os dois juntos, mesmo com uma restrição gravada; o
 // filtro restringe a um.
 profile={id:"staff-test",role:"admin",allowed_vehicle_types:["car"]};
 assert.deepEqual(await getAdminVehicleTypes(),["car","motorcycle"]);
 assert.deepEqual(await getAdminVehicleTypes("motas"),["motorcycle"]);
 assert.deepEqual(await getAdminVehicleTypes("outra-coisa"),["car","motorcycle"]);

 profile={id:"staff-test",role:"admin",allowed_vehicle_types:null};
});

await test("the backoffice has no carros/motas switch any more",()=>{
 assert.equal(existsSync(resolve("src/app/admin/vehicle-context/route.ts")),false);
 assert.equal(existsSync(resolve("src/components/admin/AdminWorldBanner.tsx")),false);
 const {filterByVehicleType}=load("src/lib/vehicle-context.ts");
 const calls=[];
 const q={or:f=>(calls.push(["or",f]),q),in:(c,v)=>(calls.push(["in",c,v]),q),is:(c,v)=>(calls.push(["is",c,v]),q)};
 // Todos os tipos + os sem tipo = sem filtro (não se cruza com a pesquisa).
 filterByVehicleType(q,["car","motorcycle"]);assert.deepEqual(calls,[]);
 filterByVehicleType(q,["car"]);assert.deepEqual(calls.pop(),["or","vehicle_type.in.(car),vehicle_type.is.null"]);
 filterByVehicleType(q,["motorcycle"],{includeNull:false});assert.deepEqual(calls.pop(),["in","vehicle_type",["motorcycle"]]);
 filterByVehicleType(q,["car","motorcycle"],{onlyNull:true});assert.deepEqual(calls.pop(),["is","vehicle_type",null]);
});

await test("old switch links keep the page the visitor arrived on",async()=>{
 // Links partilhados (OLX, Google, WhatsApp) apontam para uma viatura ou
 // página concreta. Escolher carros/motas na entrada não pode perder o destino.
 const {GET}=load("src/app/api/vehicle-context/route.ts");
 const {NextRequest}=require("next/server");
 const entrar=alvo=>GET(new NextRequest(
  `https://example.test/api/vehicle-context?type=car&area=public&target=${encodeURIComponent(alvo)}`));

 // …incluindo o link de cancelar o alerta (WhatsApp/email, num telemóvel
 // novo), um serviço e a ficha impressa — antes iam todos para a homepage.
 for(const alvo of ["/viaturas/bmw-116d","/contactos","/inventario","/vendidos","/servicos","/politica-de-privacidade",
  "/alertas/cancelar/0f8fad5b-d9cb-469f-a165-70867728950e.AbCdEfGhIjKlMnOpQrSt_-","/servicos/financiamento","/viaturas/bmw-116d/ficha","/carros/a/b"]){
  const r=await entrar(alvo);
  // O stock abre filtrado no tipo do link antigo.
  assert.equal(await destinationOf(r),alvo==="/inventario"?"/inventario?tipo=carros":alvo,alvo);
 }

 // Sem destino continua a ir para a homepage, e um destino externo é ignorado.
 const semAlvo=await GET(new NextRequest("https://example.test/api/vehicle-context?type=car&area=public"));
 assert.equal(await destinationOf(semAlvo),"/");
 const externo=await entrar("https://evil.test/phish");
 assert.equal(await destinationOf(externo),"/");
});
