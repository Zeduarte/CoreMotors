import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
const require = createRequire(import.meta.url);

process.env.ALERT_LINK_SECRET = "segredo-de-teste";

// ---- WhatsApp e base de dados falsos ---------------------------------------
const sent = [];
let sendResult = () => ({ ok: true, messageId: "wamid.1" });
const tables = { customer_settings: [], leads: [], cars: [], stock_alert_matches: [] };

function query(table) {
  const filters = [];
  let patch = null;
  let upsertRows = null;
  let single = false;
  let limit = Infinity;
  let order = null;
  const rows = () => tables[table];
  const api = {
    select() { return api; },
    eq(c, v) { filters.push((r) => r[c] === v); return api; },
    is(c, v) { filters.push((r) => (r[c] ?? null) === v); return api; },
    in(c, vs) { filters.push((r) => vs.includes(r[c])); return api; },
    gte(c, v) { filters.push((r) => r[c] != null && r[c] >= v); return api; },
    lte(c, v) { filters.push((r) => r[c] != null && r[c] <= v); return api; },
    order(c, o) { order = [c, o?.ascending !== false]; return api; },
    limit(n) { limit = n; return api; },
    maybeSingle() { single = true; return api; },
    update(p) { patch = p; return api; },
    upsert(list) { upsertRows = list; return api; },
    then(resolve) {
      if (upsertRows) {
        const inserted = [];
        for (const r of upsertRows) {
          if (rows().some((x) => x.lead_id === r.lead_id && x.car_id === r.car_id)) continue;
          const row = { id: `m${rows().length + 1}`, status: "pending", attempts: 0, error: null, sent_at: null, created_at: new Date(Date.now() + rows().length).toISOString(), ...r };
          rows().push(row);
          inserted.push(row);
        }
        return resolve({ data: inserted, error: null });
      }
      let hit = rows().filter((r) => filters.every((f) => f(r)));
      if (patch) {
        hit.forEach((r) => Object.assign(r, patch));
        return resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
      }
      if (order) hit = [...hit].sort((a, b) => (a[order[0]] < b[order[0]] ? -1 : 1) * (order[1] ? 1 : -1));
      hit = hit.slice(0, limit).map((r) => ({ ...r }));
      return resolve({ data: single ? hit[0] ?? null : hit, error: null });
    },
  };
  return api;
}
const db = { from: query };

const cache = new Map();
function load(file) {
  file = resolve(file);
  if (cache.has(file)) return cache.get(file);
  const mod = { exports: {} };
  cache.set(file, mod.exports);
  const custom = (id) => {
    if (id === "server-only") return {};
    if (id === "@/lib/whatsapp/account") return { whatsAppNumber: async () => ({ phoneNumberId: "1", accessToken: "token" }) };
    if (id === "@/lib/whatsapp/send-template")
      return {
        templateLanguage: () => "pt_PT",
        sendWhatsAppTemplate: async (to, template) => {
          sent.push({ to, template });
          return sendResult();
        },
      };
    if (id === "@/lib/notifications") return { backofficeBaseUrl: () => "https://stand.pt" };
    if (id === "@/lib/queries") return { getBranding: async () => ({ companyName: "Stand Teste" }) };
    if (id.startsWith("@/") || id.startsWith(".")) {
      let path = id.startsWith("@/") ? resolve("src", id.slice(2)) : resolve(dirname(file), id);
      if (!existsSync(path)) path += ".ts";
      return load(path);
    }
    return require(id);
  };
  const { outputText } = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  });
  new Function("module", "exports", "require", outputText)(mod, mod.exports, custom);
  cache.set(file, mod.exports);
  return mod.exports;
}

const A = { ...load("src/lib/stock-alerts.ts"), ...load("src/lib/stock-alert-schema.ts") };
const V = load("src/lib/visits.ts");
const S = load("src/lib/seo-pages.ts");
const F = load("src/lib/vehicles.ts");

const car = (over = {}) => ({
  id: "c1", slug: "yamaha-mt-07-2021", vehicle_type: "motorcycle", make: "Yamaha", model: "MT-07", variant: "ABS",
  body: "Naked", fuel: "Gasolina", price: 6900, price_on_request: false, year: 2021, mileage: 12000,
  published_at: "2026-10-10T10:00:00Z", status: "published", ...over,
});

// ---- Alertas: critérios -------------------------------------------------------

test("alerta: precisa de marca, categoria ou preço, e guarda a marca na grafia certa", () => {
  assert.equal(A.parseCriteria({ vehicle_type: "motorcycle" }), null, "sem nada dispararia com todas");
  const c = A.parseCriteria({ vehicle_type: "motorcycle", make: " yamaha ", max_price: "8.000 €", min_year: "", max_km: null });
  assert.equal(c.make, "Yamaha");
  assert.equal(c.max_price, 8000);
  assert.equal(c.min_year, null);
  assert.ok(A.parseCriteria({ vehicle_type: "car", body: "SUV" }));
});

test("alerta: compara marca, modelo (parcial, sem acentos), preço, ano e km", () => {
  const c = A.parseCriteria({ vehicle_type: "motorcycle", make: "Yamaha", model: "mt 07", max_price: 7000, min_year: 2020, max_km: 20000 });
  assert.ok(A.carMatches(car(), c));
  assert.ok(!A.carMatches(car({ make: "Honda" }), c));
  assert.ok(!A.carMatches(car({ price: 7500 }), c), "acima do orçamento");
  assert.ok(!A.carMatches(car({ price_on_request: true }), c), "sob consulta não se sabe se cabe");
  assert.ok(!A.carMatches(car({ year: 2019 }), c));
  assert.ok(!A.carMatches(car({ mileage: 25000 }), c));
  assert.ok(!A.carMatches(car({ vehicle_type: "car" }), c), "outro tipo de viatura");
  const serie = A.parseCriteria({ vehicle_type: "car", make: "BMW", model: "Serie 3" });
  assert.ok(A.carMatches(car({ vehicle_type: "car", make: "BMW", model: "Série 3", variant: "320d Touring" }), serie));
  // O Intl usa espaços que não quebram nos números: compara-se sem eles.
  assert.equal(A.criteriaLabel(c).replace(/\s/g, " "), "Yamaha mt 07 · até 7000 € · desde 2020 · até 20 000 km");
});

test("alerta: só conta o que chegou depois de o alerta ser criado", () => {
  assert.ok(A.arrivedAfter(car({ published_at: "2026-10-10T10:00:00Z" }), "2026-10-01T00:00:00Z"));
  assert.ok(!A.arrivedAfter(car({ published_at: "2026-09-10T10:00:00Z" }), "2026-10-01T00:00:00Z"));
  assert.ok(!A.arrivedAfter(car({ published_at: null }), "2026-10-01T00:00:00Z"));
  assert.equal(A.customerPhone("912 345 678"), "351912345678");
  assert.equal(A.customerPhone("12"), null);
});

// ---- Alertas: envio -----------------------------------------------------------

test("alertas automáticos: regista cada correspondência uma vez e avisa quem pediu WhatsApp", async () => {
  const { processStockAlerts } = load("src/lib/stock-alert-run.ts");
  const { verifyAlertCancelToken } = load("src/lib/alert-token.ts");
  tables.customer_settings.push({ id: 1, customer_whatsapp: true });
  const criteria = { vehicle_type: "motorcycle", make: "Yamaha", max_price: 8000 };
  tables.leads.push(
    { id: "11111111-1111-4111-8111-111111111111", kind: "alert", status: "new", name: "Maria Silva", phone: "912345678", created_at: "2026-10-01T00:00:00Z", next_action: null, car_details: { criteria, whatsapp_opt_in_at: "2026-10-01T00:00:00Z" } },
    { id: "22222222-2222-4222-8222-222222222222", kind: "alert", status: "new", name: "João", phone: null, created_at: "2026-10-01T00:00:00Z", next_action: null, car_details: { criteria } },
    { id: "33333333-3333-4333-8333-333333333333", kind: "alert", status: "closed", name: "Fechado", phone: "913000000", created_at: "2026-10-01T00:00:00Z", next_action: null, car_details: { criteria, whatsapp_opt_in_at: "x" } },
  );
  tables.cars.push(car(), car({ id: "c2", slug: "honda-cb500f", make: "Honda" }), car({ id: "c3", slug: "yamaha-old", published_at: "2026-09-01T00:00:00Z" }));

  const now = new Date("2026-10-16T12:00:00Z");
  const opts = { baseUrl: "https://stand.pt", companyName: "Stand Teste", now };
  const first = await processStockAlerts(db, opts);
  assert.equal(first.matched, 2, "Maria e João, só a Yamaha nova; o alerta fechado não conta");
  assert.equal(first.sent, 1);
  assert.equal(first.manual, 1, "sem telefone fica para a equipa");

  const [msg] = sent;
  assert.equal(msg.to, "351912345678");
  assert.equal(msg.template.name, "engineline_alerta_stock");
  assert.equal(msg.template.params[0], "Maria");
  assert.equal(msg.template.params[3], "https://stand.pt/viaturas/yamaha-mt-07-2021");
  const token = msg.template.params[4].split("/").pop();
  assert.equal(verifyAlertCancelToken(token), "11111111-1111-4111-8111-111111111111");
  assert.equal(verifyAlertCancelToken(token.slice(0, -1) + "x"), null, "assinatura alterada");

  const joao = tables.leads.find((l) => l.name === "João");
  assert.match(joao.next_action, /Avisar o cliente: entrou Yamaha MT-07/);

  // Outra volta: nada de novo, nada se repete.
  const again = await processStockAlerts(db, opts);
  assert.deepEqual([again.matched, again.sent, again.manual], [0, 0, 0]);
  assert.equal(sent.length, 1);

  // Uma segunda viatura compatível no mesmo dia espera 20 horas.
  tables.cars.push(car({ id: "c4", slug: "yamaha-tracer", model: "Tracer 7", published_at: "2026-10-16T11:00:00Z" }));
  const third = await processStockAlerts(db, opts);
  assert.equal(third.matched, 2);
  assert.equal(third.sent, 0, "a Maria já recebeu um aviso hoje");
  const later = await processStockAlerts(db, { ...opts, now: new Date("2026-10-17T10:00:00Z") });
  assert.equal(later.sent, 1);
  assert.equal(sent.at(-1).template.params[3], "https://stand.pt/viaturas/yamaha-tracer");
});

test("alertas automáticos: viatura que saiu de venda cancela; recusa da Meta não se repete", async () => {
  const { processStockAlerts } = load("src/lib/stock-alert-run.ts");
  const lead = { id: "44444444-4444-4444-8444-444444444444", kind: "alert", status: "new", name: "Rui", phone: "914000000", created_at: "2026-10-02T00:00:00Z", next_action: null, car_details: { criteria: { vehicle_type: "car", body: "SUV" }, whatsapp_opt_in_at: "x" } };
  tables.leads.push(lead);
  tables.cars.push(car({ id: "c5", slug: "suv", vehicle_type: "car", make: "Kia", model: "Sportage", body: "SUV", published_at: "2026-10-05T00:00:00Z" }));
  sendResult = () => ({ ok: false, permanent: true, error: "(#131026) sem WhatsApp" });
  const run = await processStockAlerts(db, { baseUrl: "https://stand.pt", companyName: "S", now: new Date("2026-10-18T12:00:00Z") });
  assert.equal(run.failed, 1);
  const match = tables.stock_alert_matches.find((m) => m.lead_id === lead.id);
  assert.equal(match.status, "failed");
  assert.match(match.error, /131026/);
  sendResult = () => ({ ok: true });

  tables.cars.find((c) => c.id === "c5").status = "sold";
  match.status = "pending";
  await processStockAlerts(db, { baseUrl: "https://stand.pt", companyName: "S", now: new Date("2026-10-19T12:00:00Z") });
  assert.equal(match.status, "cancelled");
});

// ---- Visitas ------------------------------------------------------------------

test("visitas: horas de Lisboa com a hora de verão e de inverno", () => {
  assert.equal(V.zonedToUtc("2026-07-15", "10:30").toISOString(), "2026-07-15T09:30:00.000Z");
  assert.equal(V.zonedToUtc("2026-12-15", "10:30").toISOString(), "2026-12-15T10:30:00.000Z");
  // Dia da mudança (25/10/2026): de manhã já é inverno.
  assert.equal(V.zonedToUtc("2026-10-25", "10:00").toISOString(), "2026-10-25T10:00:00.000Z");
  assert.match(V.visitWhenLabel("2026-07-15T09:30:00Z"), /quarta-feira, 15 de julho, às 10:30/);
});

test("visitas: só dias abertos, com antecedência mínima e vagas cheias bloqueadas", () => {
  const s = V.parseVisitSchedule({ ...V.DEFAULT_VISIT_SCHEDULE, slot: 60, notice_hours: 2, max_days: 7 });
  // Sexta, 16/10/2026, 15:10 em Lisboa (14:10 UTC).
  const now = new Date("2026-10-16T14:10:00Z");
  const days = V.visitDays(s, now);
  assert.equal(days[0].date, "2026-10-16");
  assert.deepEqual(days[0].slots.map((x) => x.time), ["18:00"], "antes das 17:10 não dá");
  assert.ok(!days.some((d) => d.weekday === 0), "domingo fechado");
  const sat10 = V.zonedToUtc("2026-10-17", "10:00").toISOString();
  const taken = { [sat10]: 1 };
  const sat = V.visitDays(s, now, taken).find((d) => d.date === "2026-10-17");
  assert.equal(sat.slots.find((x) => x.time === "10:00").available, false);
  assert.ok(!V.isBookable(s, now, sat10, taken), "cheia");
  assert.ok(V.isBookable(s, now, V.zonedToUtc("2026-10-17", "11:00").toISOString(), taken));
  assert.ok(!V.isBookable(s, now, V.zonedToUtc("2026-10-17", "11:30").toISOString()), "fora das vagas");
  assert.ok(!V.isBookable(s, now, V.zonedToUtc("2026-10-18", "11:00").toISOString()), "domingo");
});

test("visitas: horário guardado inválido cai no padrão, campo a campo", () => {
  const s = V.parseVisitSchedule({ days: { 1: [["19:00", "09:00"]], 2: [["09:00", "13:00"], ["14:00", "18:00"]] }, slot: 7, capacity: 99 });
  assert.deepEqual(s.days["1"], [], "intervalo ao contrário fica fechado");
  assert.equal(s.days["2"].length, 2);
  assert.equal(s.slot, 30);
  assert.equal(s.capacity, 20);
  const ics = V.visitIcs({ at: "2026-10-17T09:00:00Z", minutes: 30, title: "Visita, stand", location: "Rua A; 1", description: "x", uid: "u" });
  assert.match(ics, /DTSTART:20261017T090000Z/);
  assert.match(ics, /DTEND:20261017T093000Z/);
  assert.match(ics, /SUMMARY:Visita\\, stand/);
});

// ---- Páginas para o Google ----------------------------------------------------

const stock = [
  { slug: "a", vehicleType: "motorcycle", make: "Yamaha", model: "MT-07", body: "Naked", fuel: "Gasolina", price: 6900, year: 2021, mileage: 1 },
  { slug: "b", vehicleType: "motorcycle", make: "Suzuki", model: "LT-R 450", body: "Moto 4", fuel: "Gasolina", price: 4500, year: 2009, mileage: 1 },
  { slug: "c", vehicleType: "motorcycle", make: "Harley-Davidson", model: "Street Bob", body: "Chopper/Cruiser", fuel: "Gasolina", price: 0, priceOnRequest: true, year: 2020, mileage: 1 },
];

test("páginas por marca, categoria e preço: endereços e o que mostram", () => {
  assert.equal(S.resolveSeoPage("motorcycle", "yamaha", stock).title, "Motas Yamaha usadas");
  assert.equal(S.resolveSeoPage("motorcycle", "harley-davidson", stock).filters.make, "Harley-Davidson");
  const quads = S.resolveSeoPage("motorcycle", "quads", stock);
  assert.equal(quads.title, "Moto 4 e quads usados");
  assert.deepEqual(stock.filter(quads.matches).map((v) => v.slug), ["b"]);
  assert.equal(S.resolveSeoPage("motorcycle", "moto-4", stock).slug, "quads");
  const price = S.resolveSeoPage("motorcycle", "ate-5000-euros", stock);
  assert.deepEqual(stock.filter(price.matches).map((v) => v.slug), ["b"], "sob consulta não entra");
  assert.equal(S.resolveSeoPage("motorcycle", "ate-4321-euros", stock), null, "só as faixas definidas");
  assert.equal(S.resolveSeoPage("motorcycle", "eletricos", stock), null, "combustível só nos carros");
  assert.equal(S.resolveSeoPage("car", "eletricos", []).title, "Carros elétricos usados");
  assert.equal(S.resolveSeoPage("motorcycle", "ducati", stock).title, "Motas Ducati usadas", "marca do catálogo sem stock tem página");
  assert.equal(S.resolveSeoPage("motorcycle", "nao-existe", stock), null);
  const pages = S.seoPagesFor("motorcycle", stock).map((p) => `${p.page.slug}:${p.count}`);
  assert.ok(pages.includes("yamaha:1") && pages.includes("quads:1") && pages.includes("custom:1"));
  assert.ok(pages.includes("ate-5000-euros:1") && !pages.includes("ate-3000-euros:0"));
  assert.match(S.seoIntro(quads, "motorcycle", 1, 4500, "Supermotas").replace(/\s/g, " "), /^1 mota disponível na Supermotas — moto 4 e quads usados, desde 4500 €\./);
  assert.match(S.seoIntro(quads, "motorcycle", 0, null, "Supermotas"), /não temos moto 4 e quads usados em stock/);
});

// ---- Pesquisa com os filtros do OLX -------------------------------------------

test("pesquisa: os filtros vão para o endereço e voltam iguais", () => {
  const f = {
    ...F.emptyFilters(),
    make: "Yamaha", maxPrice: 8000, minDisplacement: 500, nationalOnly: true,
    olx: { color_type: "metalizada", power_kw: { min: 30, max: null } },
  };
  const qs = F.filtersToQuery(f, "price-asc");
  assert.match(qs, /marca=Yamaha/);
  assert.match(qs, /preco_max=8000/);
  assert.match(qs, /olx_power_kw_min=30/);
  const back = F.filtersFromQuery(Object.fromEntries(new URLSearchParams(qs)));
  assert.deepEqual({ ...F.emptyFilters(), ...back }, f);
  assert.equal(F.sortFromQuery({ ordem: "price-asc" }), "price-asc");
  assert.equal(F.sortFromQuery({ ordem: "x" }), "relevance");
  assert.equal(F.filtersFromQuery({ make: "BMW" }).make, "BMW", "os links antigos continuam a funcionar");
  assert.equal(F.activeFilterCount(f), 5, "preço, cilindrada, nacional e os dois campos do OLX (a marca tem campo próprio)");
});

test("pesquisa: potência, cilindrada, historial e campos do OLX filtram o stock", () => {
  const base = { make: "X", model: "Y", year: 2020, mileage: 1000, price: 5000, fuel: "Gasolina", transmission: "Manual", body: "Naked", featured: false, color: "Azul", doors: 0, seats: 2, power: 70, displacement: 690 };
  const list = [
    { ...base, slug: "a2", national: true, serviceBook: true, olx: { cor: "azul" } },
    { ...base, slug: "a", displacement: 1000, power: 150, firstOwner: true, warrantyMonths: 12, olx: { cor: "preto" } },
    { ...base, slug: "sem", displacement: 0, power: 0 },
  ];
  const pick = (p) => F.applyFilters(list, { ...F.emptyFilters(), ...p }).map((v) => v.slug);
  assert.deepEqual(pick({ maxDisplacement: 700 }), ["a2"], "a desconhecida não passa no filtro");
  assert.deepEqual(pick({ minPower: 100 }), ["a"]);
  assert.deepEqual(pick({ nationalOnly: true, serviceBookOnly: true }), ["a2"]);
  assert.deepEqual(pick({ firstOwnerOnly: true, warrantyOnly: true }), ["a"]);
  assert.deepEqual(pick({ olx: { cor: "preto" } }), ["a"]);
  assert.deepEqual(pick({ color: "azul" }), ["a2", "a", "sem"], "cor sem olhar a maiúsculas");
  assert.deepEqual(pick({}), ["a2", "a", "sem"]);
});
