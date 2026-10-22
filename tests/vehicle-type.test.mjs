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
let publicType="car",adminType="car";
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
    if (id === "next/headers") return {cookies:async()=>({get:key=>({value:key === "coremotors_admin_type" ? adminType : publicType})})};
    if (id === "next/cache")
      return { revalidatePath() {}, revalidateTag() {}, unstable_cache: (f) => f };
    if (id === "@/lib/guard")
      return {
        requireSection: async (section) => requestedSections.push(section),
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
  assert.deepEqual((await getVehicles()).map(v=>v.id),[c.id]);
  publicType="motorcycle";
  assert.deepEqual((await getVehicles()).map(v=>v.id),[b.id]);
  publicType="car";
  assert.deepEqual(requestedSections, ["carros", "carros", "carros"]);
});
test("inventory URL accepts only known vehicle sections", () => {
  assert.equal(inventoryVehicleType("carros"), "car");
  assert.equal(inventoryVehicleType("motas"), "motorcycle");
  for (const value of [undefined, "unknown", ["motas", "carros"]])
    assert.equal(inventoryVehicleType(value), null);
});

await test("public and admin categories stay independent across every vehicle list and detail",async()=>{
 const bike=rows.find(r=>r.vehicle_type==="motorcycle"), car=rows.find(r=>r.vehicle_type==="car");
 bike.featured=car.featured=true;
 publicType="motorcycle";adminType="car";
 assert.deepEqual((await getRecentVehicles()).map(v=>v.id),[bike.id]);
 assert.deepEqual((await getFeaturedVehicles()).map(v=>v.id),[bike.id]);
 // As listas seguem o mundo escolhido; a ficha abre por link direto em
 // qualquer um (o Google não guarda a escolha, e um link partilhado de uma
 // mota tem de abrir a quem está nos carros).
 assert.equal((await getVehicleBySlug(car.slug)).id,car.id);
 assert.equal((await getVehicleBySlug(bike.slug)).id,bike.id);
 assert.deepEqual((await getAdminCars()).map(v=>v.id),[car.id]);
 assert.equal(await getAdminCarById(bike.id),null);
 bike.status=car.status="sold";
 assert.deepEqual((await getSoldVehicles()).map(v=>v.id),[bike.id]);
 adminType="motorcycle";
 assert.deepEqual((await getAdminCars()).map(v=>v.id),[bike.id]);
 publicType="car";
 assert.deepEqual((await getSoldVehicles()).map(v=>v.id),[car.id]);
});
await test("selection endpoint stores only the requested area and rejects unsafe types and redirects",async()=>{
 const {NextRequest}=require("next/server");
 const {GET}=load("src/app/api/vehicle-context/route.ts");
 const result=await GET(new NextRequest("https://example.test/api/vehicle-context?type=motorcycle&area=public&target=%2Finventario"));
 assert.equal(result.status,303);
 assert.equal(result.headers.get("location"),"/inventario");
 assert.equal(result.cookies.get("coremotors_public_type").value,"motorcycle");
 assert.equal(result.cookies.get("coremotors_admin_type"),undefined);
 assert.match(result.headers.get("set-cookie"),/HttpOnly/);
 const unsafe=await GET(new NextRequest("https://example.test/api/vehicle-context?type=car&area=admin&target=https://evil.test"));
 assert.equal(unsafe.headers.get("location"),"/admin/carros");
 assert.equal(unsafe.cookies.get("coremotors_admin_type").value,"car");
 const invalid=await GET(new NextRequest("https://example.test/api/vehicle-context?type=truck"));
 assert.equal(invalid.status,400);
 // As páginas por marca e o stock com uma pesquisa voltam para onde estavam.
 const go=async(target)=>(await GET(new NextRequest(`https://example.test/api/vehicle-context?type=motorcycle&area=public&target=${encodeURIComponent(target)}`))).headers.get("location");
 assert.equal(await go("/motas/yamaha"),"/motas/yamaha");
 assert.equal(await go("/inventario?marca=Yamaha&preco_max=8000"),"/inventario?marca=Yamaha&preco_max=8000");
 for(const bad of ["//evil.test","/motas/../admin","/inventario?x=<script>","/carros/a/b"]) assert.equal(await go(bad),"/",bad);
});

await test("a stock alert keeps what the person is looking for, with the type of the page it came from",async()=>{
 const {submitLead}=load("src/lib/actions/leads.ts");
 publicType="car";
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

await test("public enquiries inherit the chosen world and cannot bind to the other category",async()=>{
 const {submitLead}=load("src/lib/actions/leads.ts");
 publicType="motorcycle";
 const car=rows.find(r=>r.vehicle_type==="car"),bike=rows.find(r=>r.vehicle_type==="motorcycle");
 car.status=bike.status="published";
 function form(id){const f=new FormData();for(const[k,v]of Object.entries({privacy_acknowledged:"yes",kind:"contact",name:"Cliente Teste",email:"cliente@example.test",message:"Pretendo mais informações",...(id?{car_id:id}:{})}))f.set(k,v);return f;}
 assert.equal((await submitLead({ok:false},form())).ok,true);
 assert.equal(leadRows.at(-1).vehicle_type,"motorcycle");
 const before=leadRows.length;
 assert.equal((await submitLead({ok:false},form(car.id))).ok,false);
 assert.equal(leadRows.length,before);
 assert.equal((await submitLead({ok:false},form(bike.id))).ok,true);
 assert.equal(leadRows.at(-1).car_id,bike.id);
 assert.equal(leadRows.at(-1).vehicle_type,"motorcycle");
});

await test("per-user vehicle access limits the backoffice world and the switch endpoint",async()=>{
 const {getAdminVehicleType}=load("src/lib/vehicle-context.ts");
 const {GET}=load("src/app/api/vehicle-context/route.ts");
 const {NextRequest}=require("next/server");
 const url=t=>new NextRequest(`https://example.test/api/vehicle-context?type=${t}&area=admin&target=%2Fadmin%2Fcarros`);

 // Só carros: o cookie a apontar para motas não dá acesso às motas.
 profile={id:"staff-test",role:"vendedor",allowed_vehicle_types:["car"]};
 adminType="motorcycle";
 assert.equal(await getAdminVehicleType(),"car");
 assert.equal((await GET(url("motorcycle"))).status,403);
 assert.equal((await GET(url("car"))).status,303);

 // Só motas: o inverso.
 profile={id:"staff-test",role:"vendedor",allowed_vehicle_types:["motorcycle"]};
 adminType="car";
 assert.equal(await getAdminVehicleType(),"motorcycle");
 assert.equal((await GET(url("car"))).status,403);

 // O admin acede sempre aos dois, mesmo com uma restrição gravada.
 profile={id:"staff-test",role:"admin",allowed_vehicle_types:["car"]};
 adminType="motorcycle";
 assert.equal(await getAdminVehicleType(),"motorcycle");
 assert.equal((await GET(url("motorcycle"))).status,303);

 profile={id:"staff-test",role:"admin",allowed_vehicle_types:null};
 adminType="car";
});

await test("first visit keeps the page the visitor arrived on",async()=>{
 // Links partilhados (OLX, Google, WhatsApp) apontam para uma viatura ou
 // página concreta. Escolher carros/motas na entrada não pode perder o destino.
 const {GET}=load("src/app/api/vehicle-context/route.ts");
 const {NextRequest}=require("next/server");
 const entrar=alvo=>GET(new NextRequest(
  `https://example.test/api/vehicle-context?type=car&area=public&target=${encodeURIComponent(alvo)}`));

 for(const alvo of ["/viaturas/bmw-116d","/contactos","/inventario","/vendidos","/servicos","/politica-de-privacidade"]){
  const r=await entrar(alvo);
  assert.equal(r.headers.get("location"),alvo,alvo);
 }

 // Sem destino continua a ir para a homepage, e um destino externo é ignorado.
 const semAlvo=await GET(new NextRequest("https://example.test/api/vehicle-context?type=car&area=public"));
 assert.equal(semAlvo.headers.get("location"),"/");
 const externo=await entrar("https://evil.test/phish");
 assert.equal(externo.headers.get("location"),"/");
});
