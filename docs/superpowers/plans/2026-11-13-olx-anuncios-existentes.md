# Anúncios do OLX geridos no backoffice — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Plataformas de anúncios → OLX mostra todos os anúncios da conta ligada, associados às viaturas, geríveis a 100% quando o OLX o permite e só de leitura quando vêm do Standvirtual.

**Architecture:** Uma tabela nova `olx_adverts` espelha a conta do OLX (lida por `importAdverts`). `channel_listings` continua a ser o motor da sincronização por viatura; `syncListing` passa a consultar `olx_adverts` para adotar anúncios associados, nunca tocar nos do Standvirtual e nunca duplicar. A lógica vive em `src/lib/olx/*` (testável com um OLX simulado); as Server Actions só verificam permissões e chamam-na.

**Tech Stack:** Next.js 15 (App Router, Server Actions), Supabase (Postgres + RLS + Storage), TypeScript, `node --test` com módulos TS transpilados, OLX Partner API v2.

**Spec:** `docs/superpowers/specs/2026-11-13-olx-anuncios-existentes-design.md`

## Global Constraints

- Textos da interface e erros em português de Portugal.
- Nunca enviar `PUT` nem comandos (`/commands`) a um anúncio com `origin = 'standvirtual'`.
- `olx_adverts`: RLS ativa, sem políticas, `revoke all` a `anon` e `authenticated` (como `olx_connection`). Só o cliente de serviço lê/escreve.
- Pedidos ao OLX só por `olxFetch` (`src/lib/olx/client.ts`): `Version: 2.0` e renovação do token.
- Sugestão forte = marca, modelo **e** preço iguais. Só a sugestão forte bloqueia a criação de um anúncio novo.
- Associar nunca marca OLX na viatura; desassociar desmarca OLX (anúncios `olx`).
- Fotos importadas só de `https://*.olxcdn.com`, cada uma ≤ 5 MB.
- Viatura criada a partir de um anúncio: `status: "draft"`, `channels: []`, pela `createCar` existente (permissões, tipo de site e validação dela).
- Aviso ao limpar anúncio de outra conta, exatamente: «O anúncio anterior não está na conta do OLX ligada (era de outra conta ou foi apagado). Grave a viatura para o publicar nesta conta.»
- Erro da sugestão forte, exatamente: «Já existe no OLX um anúncio que parece ser desta viatura («{título}»). Associe-o, ou desative-o, em Plataformas de anúncios.»
- Nota nos anúncios do Standvirtual: «Gerido no Standvirtual».

## Review Focus

1. Uma página do `GET /adverts` falha a meio da leitura → nada é apagado de `olx_adverts` nem limpo em `channel_listings` (Task 3).
2. Anúncio acabado de criar pelo site que ainda não aparece na lista do OLX → não é limpo, porque o `GET /adverts/{id}` dá 200 (Task 3).
3. Viatura publicada, com OLX marcado e um anúncio do Standvirtual associado, gravada várias vezes → zero pedidos `POST`/`PUT`/comandos ao OLX (Task 4).
4. Desassociar um anúncio `olx` e voltar a gravar a viatura → não cria anúncio novo nem desativa o antigo (Task 5).
5. Dois anúncios disputam a mesma viatura (C3 C-Series 12 450 € e C3 Feel 11 950 €) → só o de preço igual é sugerido (Task 2).

---

### Task 1: Tabela `olx_adverts`

**Files:**
- Create: `supabase/migrations/0051_olx_adverts.sql`
- Modify: `supabase/VERIFICAR_migracoes.sql` (cabeçalho «0001 → 0051» e linha `0051_olx_adverts`)
- Modify: `src/lib/supabase/database.types.ts` (tipo `OlxAdvertRow` junto a `OlxConnectionRow`; entrada `olx_adverts` em `Tables`)
- Test: `tests/database.test.mjs`

**Interfaces:**
- Produces: tabela `public.olx_adverts` com as colunas da spec mais `category_name text` (nome da categoria do OLX, usado nas sugestões e na importação); tipo `OlxAdvertRow` (`id: number; car_id: string | null; origin: "site" | "olx" | "standvirtual"; status: string; title: string; url: string | null; external_id: string | null; price: number | null; category_id: number | null; category_name: string | null; valid_to: string | null; olx_created_at: string | null; views: number | null; phone_views: number | null; observers: number | null; stats_at: string | null; seen_at: string; updated_at: string`).

- [ ] **Step 1: Write the failing test** — em `tests/database.test.mjs`, junto ao teste «OLX tokens and cache are unreachable…»:

```js
await test('olx_adverts: só o servidor, e uma viatura tem no máximo um anúncio',async()=>{
 await asUser(admin,async()=>assert.rejects(db.query('select * from public.olx_adverts'),/permission denied/));
 await asServer(async()=>{
  await db.query(`insert into olx_adverts(id,origin,status,title,car_id) values(1,'olx','active','A',$1)`,[car]);
  await assert.rejects(db.query(`insert into olx_adverts(id,origin,status,title,car_id) values(2,'olx','active','B',$1)`,[car]),/unique|duplicate/i);
  await assert.rejects(db.query(`insert into olx_adverts(id,origin,status,title) values(3,'outro','active','C')`),/check/i);
  await db.query(`delete from cars where id=$1`,[car]); // on delete set null
  assert.equal((await db.query('select car_id from olx_adverts where id=1')).rows[0].car_id,null);
 });
});
```
(Se o `car` do ficheiro for partilhado por testes seguintes, usar uma viatura criada só para este teste.)

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/database.test.mjs`
Expected: FAIL — `relation "public.olx_adverts" does not exist`; e o teste do `VERIFICAR_migracoes.sql` falha por faltar a linha da 0051.

- [ ] **Step 3: Write `0051_olx_adverts.sql`** — `create table if not exists`, `car_id uuid unique references public.cars(id) on delete set null`, `origin text not null check (origin in ('site','olx','standvirtual'))`, contadores `check (… >= 0)`, `seen_at`/`updated_at default now()`, trigger `set_updated_at`, `enable row level security` e `revoke all … from anon, authenticated`. Idempotente (pode correr duas vezes). Linha no `VERIFICAR_migracoes.sql`: `to_regclass('public.olx_adverts') is not null`. Tipos em `database.types.ts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/database.test.mjs`
Expected: PASS (todos)

- [ ] **Step 5: Commit**
```bash
git add supabase/migrations/0051_olx_adverts.sql supabase/VERIFICAR_migracoes.sql src/lib/supabase/database.types.ts tests/database.test.mjs
git commit -m "OLX: tabela olx_adverts, espelho dos anúncios da conta ligada"
```

---

### Task 2: Origem e sugestões (funções puras)

**Files:**
- Create: `src/lib/olx/adverts.ts`
- Test: `tests/olx-adverts.test.mjs` (novo; carrega TS com `createLoader` de `tests/support/load-ts.mjs`)

**Interfaces:**
- Consumes: `canonicalBrand` (`src/lib/brand-name.ts`), `normalize` (`src/lib/whatsapp/confirm.ts`).
- Produces:
  - `type AdvertOrigin = "site" | "olx" | "standvirtual"`
  - `advertOrigin(externalId: string | null | undefined, siteCarIds: ReadonlySet<string>): AdvertOrigin`
  - `isStandvirtualExport(error: string | null | undefined): boolean` — `/exportado do\s+standvirtual/i`
  - `interface MatchAdvert { id: number; title: string; price: number | null; categoryName: string | null }`
  - `interface MatchCar { id: string; make: string; model: string; price: number | null }`
  - `interface Suggestion { carId: string; strong: boolean }`
  - `suggestCar(advert: MatchAdvert, cars: MatchCar[]): Suggestion | null`
  - `suggestAll(adverts: MatchAdvert[], cars: MatchCar[]): Map<number, Suggestion>` — `cars` já sem as viaturas associadas.

- [ ] **Step 1: Write the failing tests** — fixture com os 11 anúncios e as 9 viaturas de 13/11/2026 (da spec):

```js
const ADS=[
 {id:675176856,title:'Mercedes-Benz A 180 d Progressive Aut.',price:21900,categoryName:'Mercedes-Benz'},
 {id:673875376,title:'Renault Mégane 1.5 dCi GT Line',price:11450,categoryName:'Renault'},
 {id:675176600,title:'Renault Captur 0.9 TCE',price:11500,categoryName:'Renault'},
 {id:675176520,title:'BMW 420 d Auto',price:22900,categoryName:'BMW'},
 {id:675176398,title:'Citroën C3 1.2 PureTech C-Series',price:12450,categoryName:'Citroën'},
 {id:672199203,title:'BMW 116 d Pack M',price:12900,categoryName:'BMW'},
 {id:673875380,title:'BMW 525 d Auto',price:14350,categoryName:'BMW'},
 {id:672202645,title:'Citroën C3 1.2 PureTech Feel',price:11950,categoryName:'Citroën'},
 {id:672202637,title:'Opel Combo 1.5 CDTi Edition',price:12950,categoryName:'Opel'},
 {id:670778144,title:'Mercedes-Benz CLA 180',price:15900,categoryName:'Mercedes-Benz'},
 {id:667023834,title:'Renault Grand Scenic',price:6000,categoryName:'Renault'},
];
const CARS=[['bmw525','BMW','525 d Auto',14350],['bmw420','BMW','420 d',22900],['bmw116','BMW','116d',12900],
 ['c3','Citroën','C3',12450],['punto','Fiat','Punto',4950],['a180','Mercedes-Benz','A 180 d',21900],
 ['p2008','Peugeot','2008',12950],['captur','Renault','Captur',11500],['megane','Renault','Mégane',11450]]
 .map(([id,make,model,price])=>({id,make,model,price}));

test('sugere as 7 viaturas certas, todas fortes, e nenhuma errada',()=>{
 const s=A.suggestAll(ADS,CARS);
 assert.deepEqual(Object.fromEntries([...s].map(([k,v])=>[k,v.carId])),{
  675176856:'a180',673875376:'megane',675176600:'captur',675176520:'bmw420',675176398:'c3',672199203:'bmw116',673875380:'bmw525'});
 assert.ok([...s.values()].every(v=>v.strong));
});
test('dois anúncios para a mesma viatura: só o de preço igual',()=>{
 const s=A.suggestAll(ADS,CARS);
 assert.equal(s.get(675176398)?.carId,'c3');assert.equal(s.has(672202645),false);
});
test('marca e modelo sem o preço: sugestão fraca',()=>{
 assert.deepEqual(A.suggestCar({id:1,title:'BMW 116 d Pack M',price:11000,categoryName:'BMW'},CARS),{carId:'bmw116',strong:false});
});
test('a origem vem do external_id',()=>{
 const ids=new Set(['11111111-1111-4111-8111-111111111111']);
 assert.equal(A.advertOrigin(null,ids),'olx');assert.equal(A.advertOrigin('',ids),'olx');
 assert.equal(A.advertOrigin('11111111-1111-4111-8111-111111111111',ids),'site');
 assert.equal(A.advertOrigin('8097748498',ids),'standvirtual');
 assert.equal(A.isStandvirtualExport('user: Anúncio exportado do  Standvirtual. Para alterá-lo…'),true);
});
```

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/olx-adverts.test.mjs`
Expected: FAIL — `ENOENT … src/lib/olx/adverts.ts`

- [ ] **Step 3: Implement `src/lib/olx/adverts.ts`**
Comparação em texto normalizado (`normalize`, não alfanuméricos → espaço) e também compacto (sem espaços), para «116d» casar com «116 d». Marca: `normalize(canonicalBrand(car.make))` igual à categoria ou contida no título. Modelo: o modelo compacto contido no título compacto. Em `suggestAll`, se duas sugestões apontam para a mesma viatura, fica a forte; empate → nenhuma.

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/olx-adverts.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/lib/olx/adverts.ts tests/olx-adverts.test.mjs
git commit -m "OLX: origem dos anúncios e sugestão da viatura de cada um"
```

---

### Task 3: Ler anúncios do OLX (`importAdverts`)

**Files:**
- Create: `tests/support/olx-fake.mjs` — OLX simulado (servidor HTTP) e base de dados em memória, no molde de `tests/olx-flow.test.mjs`, generalizados: `startFakeOlx(): Promise<{ olx, url, close }>` (anúncios com `origin` simulada; `GET /adverts` paginado por `offset`/`limit`; `failPage` para simular uma página com erro; `PUT` a um anúncio `standvirtual` → 400 com `validation:[{field:'user',title:'Anúncio exportado do  Standvirtual. Para alterá-lo, necessita de aceder à sua conta.'}]`; `GET /categories/{id}` e `/attributes`) e `makeDb(tables)` (as operações do `olx-flow` mais `is(col,null)`, `order()` e `upsert` pela chave de cada tabela: `olx_adverts.id`, `olx_category_details.category_id`, `olx_category_cache.vehicle_type`).
- Create: `src/lib/olx/import.ts`
- Test: `tests/olx-adverts.test.mjs`

**Interfaces:**
- Consumes: `olxFetch`, `getConnection` (`client.ts`); `unwrap` (`categories.ts`); `parseStats` (`stats.ts`); `advertOrigin` (Task 2).
- Produces:
  - `interface ImportResult { ok: boolean; read: number; removed: number; cleared: number; stats: number; error?: string }`
  - `importAdverts(db: Db, opts: { stats: boolean }): Promise<ImportResult>`
  - `const PAGE = 100`
  - `const OTHER_ACCOUNT_NOTE` — o aviso exato da Global Constraints.

- [ ] **Step 1: Write the failing tests**
  - `lê todas as páginas e guarda origem, preço, categoria e associação do site` — 230 anúncios simulados → `read: 230`, 3 pedidos `GET /adverts?offset=…`; um com `external_id` = id de uma viatura fica `origin:'site'` e `car_id` dessa viatura; `price` numérico; `category_name` do `GET /categories/{id}` (um pedido por categoria distinta).
  - `não mexe numa associação já feita` — linha com `car_id` definido continua com o mesmo `car_id` depois de ler.
  - `um anúncio que desapareceu da conta sai da tabela` → `removed: 1`.
  - `página com erro: não apaga nem limpa nada` — `failPage=2` → `ok:false`, tabela e `channel_listings` iguais ao início.
  - `anúncio da conta antiga é limpo; um acabado de criar não` — `channel_listings` com `external_id` 999 (o `GET /adverts/999` dá 404) fica `external_id:null, external_url:null, remote_status:null, views:null, status:'pending', sync_state:'idle', last_error:OTHER_ACCOUNT_NOTE`; outro com `external_id` 777 fora da lista mas com `GET` 200 fica igual → `cleared: 1`.
  - `com stats, guarda as estatísticas de todos e copia-as para a viatura associada` — incluindo um `standvirtual`.

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/olx-adverts.test.mjs`
Expected: FAIL — `ENOENT … src/lib/olx/import.ts`

- [ ] **Step 3: Implement `importAdverts`** — ordem da spec (ler tudo → upsert → apagar não vistos → limpar `channel_listings` → estatísticas). Sem ligação → `{ ok:false, error:'A conta do OLX não está ligada.' }`. Nunca lança (como `syncListing`).

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/olx-adverts.test.mjs tests/olx-flow.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add tests/support/olx-fake.mjs src/lib/olx/import.ts tests/olx-adverts.test.mjs
git commit -m "OLX: ler todos os anúncios da conta e limpar os de outra conta"
```

---

### Task 4: Sincronização que adota, respeita o Standvirtual e não duplica

**Files:**
- Modify: `src/lib/olx/sync.ts` (`syncListing`)
- Test: `tests/olx-adverts.test.mjs`

**Interfaces:**
- Consumes: `suggestCar`, `isStandvirtualExport` (Task 2); tabela `olx_adverts`.
- Produces: `syncListing(db, carId)` com a mesma assinatura e as regras novas da spec. `channel_listings.notes = "Gerido no Standvirtual"` nos anúncios do Standvirtual.

- [ ] **Step 1: Write the failing tests** (OLX simulado da Task 3; viatura publicada com `channels:['olx']`):
  - `adota o anúncio OLX associado em vez de criar` — `olx_adverts {id:42, origin:'olx', car_id:CAR}` e `channel_listings` sem `external_id` → zero `POST /adverts`, um `PUT /adverts/42`, `external_id:'42'`.
  - `anúncio do Standvirtual associado: zero pedidos de escrita, sempre` — três `syncListing` seguidos → nenhum `POST`/`PUT`/`/commands` nas chamadas do simulado; `sync_state:'idle'`, `notes:'Gerido no Standvirtual'`, `last_error:null`.
  - `com external_id de um anúncio do Standvirtual também não envia nada`.
  - `sugestão forte por associar bloqueia a criação` — anúncio sem viatura com marca, modelo e preço da viatura → `sync_state:'error'`, `last_error` = o erro exato da Global Constraints com o título; zero `POST`.
  - `sugestão fraca não bloqueia` — preço diferente → cria normalmente.
  - `PUT recusado por ser do Standvirtual: passa a standvirtual, sem erro` — `olx_adverts.origin` passa a `'standvirtual'`; `channel_listings.sync_state:'idle'`, `notes:'Gerido no Standvirtual'`.

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/olx-adverts.test.mjs`
Expected: FAIL nos seis testes novos.

- [ ] **Step 3: Implement** — no início de `syncListing`, depois de ler `listing` e `car`: ler `olx_adverts` da viatura (`car_id`) e, se houver `external_id`, a linha desse id. Ramo Standvirtual → atualiza `channel_listings` e devolve `{ ok: true, action: "none" }`. Adoção → grava `external_id`/`external_url`/`remote_status` e segue com esse `external_id`. A verificação da sugestão forte é só quando a ação é `create`: anúncios com `car_id` nulo, `suggestCar(advert, [car])?.strong`. No `fail` do `PUT`, se `isStandvirtualExport(r.error)`, marca a origem e sai sem erro.

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/olx-adverts.test.mjs tests/olx-flow.test.mjs`
Expected: PASS (os do `olx-flow` continuam verdes: sem linhas em `olx_adverts` nada muda)

- [ ] **Step 5: Commit**
```bash
git add src/lib/olx/sync.ts tests/olx-adverts.test.mjs
git commit -m "OLX: a sincronização adota anúncios associados e nunca toca nos do Standvirtual"
```

---

### Task 5: Associar, desassociar, sugestões e ativar/desativar

**Files:**
- Create: `src/lib/olx/links.ts` (lógica, testada com o simulado)
- Create: `src/lib/actions/olx-adverts.ts` (`"use server"`; permissões + `revalidatePath("/admin/anuncios")`)
- Test: `tests/olx-adverts.test.mjs`

**Interfaces:**
- Consumes: `markPending`, `syncListing` (`sync.ts`); `importAdverts` (Task 3); `suggestAll` (Task 2); `requireSection`, `carTypesError`, `createClient`, `createAdminClient` (como em `src/lib/actions/olx.ts`).
- Produces (`links.ts`, todas devolvem `{ ok: boolean; error?: string; message?: string }`):
  - `linkAdvert(db: Db, advertId: number, carId: string)`
  - `unlinkAdvert(db: Db, advertId: number)`
  - `confirmSuggestions(db: Db)` — associa as sugestões fortes de `suggestAll`; `message` com quantas.
  - `setAdvertActive(db: Db, advertId: number, active: boolean)`
- Produces (`olx-adverts.ts`, Server Actions com `OlxActionResult`): `readOlxAdverts()`, `linkOlxAdvert(advertId: number, carId: string)`, `unlinkOlxAdvert(advertId: number)`, `confirmOlxSuggestions()`, `setOlxAdvertActive(advertId: number, active: boolean)`. Todas `requireSection("anuncios")`; as que recebem ou afetam uma viatura também `carTypesError(await createClient(), me, [carId])`.

- [ ] **Step 1: Write the failing tests**
  - `associar liga o anúncio à viatura sem marcar OLX` — viatura sem OLX: `car_id` definido, `cars.channels` igual, zero pedidos ao OLX.
  - `associar com OLX marcado sincroniza já (o anúncio passa a ter os dados da ficha)` — um `PUT` ao anúncio.
  - `associar recusa viatura ou anúncio já associados` — incluindo a viatura com `external_id` em `channel_listings` que existe em `olx_adverts`.
  - `desassociar um anúncio olx desmarca OLX; gravar a viatura depois não cria nem desativa` — `unlinkAdvert` → `channels` sem `'olx'`, `channel_listings.external_id:null`; `markPending` + `syncListing` → zero `POST` e zero `/commands`.
  - `não se desassocia um anúncio criado pelo site` → `ok:false`.
  - `confirmar sugestões associa só as fortes`.
  - `ativar/desativar: comando certo; recusado no Standvirtual e nos geridos pela ficha` — `setAdvertActive(id,false)` → `POST /adverts/{id}/commands {command:'deactivate', is_success:false}` e `status` relido; anúncio `standvirtual` ou com viatura com OLX marcado → `ok:false` sem pedido.
  - `as ações exigem o separador e o tipo da viatura` — com `createLoader` a substituir `@/lib/guard` (`requireSection` que lança para outro separador que não `anuncios`) e `@/lib/vehicle-access` (`carTypesError` que devolve «Sem acesso a este tipo de viatura.»): `linkOlxAdvert(42, CAR)` → `{ ok:false, error:'Sem acesso a este tipo de viatura.' }` e nenhuma escrita na base de dados.

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/olx-adverts.test.mjs`
Expected: FAIL — `ENOENT … src/lib/olx/links.ts`

- [ ] **Step 3: Implement `links.ts` e as Server Actions** (estas ficam finas: permissões → `links.ts` → `revalidatePath`).

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/olx-adverts.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/lib/olx/links.ts src/lib/actions/olx-adverts.ts tests/olx-adverts.test.mjs
git commit -m "OLX: associar anúncios às viaturas, confirmar sugestões, ativar e desativar"
```

---

### Task 6: Criar a viatura a partir de um anúncio

**Files:**
- Create: `src/lib/olx/import-car.ts`
- Modify: `src/lib/actions/olx-adverts.ts` (`createCarFromOlxAdvert`)
- Test: `tests/olx-adverts.test.mjs`

**Interfaces:**
- Consumes: `fieldFor`, `pickValue`, `OlxAttributeDef` (`attributes.ts`); `FUEL_TYPES`, `TRANSMISSIONS`, `BODY_TYPES` (`schemas.ts`); `createCar` (`src/lib/actions/cars.ts`); `MEDIA_BUCKET`, `MEDIA_CACHE_CONTROL` (`storage.ts`); `linkAdvert` (Task 5).
- Produces:
  - `advertToCarInput(advert: OlxAdvertFull, defs: OlxAttributeDef[], ctx: { make: string; vehicleType: "car" | "motorcycle" }): { ok: true; input: Record<string, unknown> } | { ok: false; missing: string[] }` — `missing` com os nomes em português («combustível», «caixa», «carroçaria», «ano»).
  - `OlxAdvertFull` (em `import-car.ts`): a forma do `GET /adverts/{id}` (`title, description, category_id, price{value}, attributes[{code,value,values}], images[{url}]`).
  - `isOlxImageUrl(url: string): boolean` — `https:` e host terminado em `.olxcdn.com`.
  - `copyAdvertPhotos(db: Db, carId: string, urls: string[]): Promise<{ copied: number; failed: number }>` — até 30 fotos; `redirect: "error"`, `content-type` `image/*`, ≤ 5 MB; caminho `${carId}/olx-${n}.jpg`; `car_media` com `kind:'image'`, `position` por ordem e `is_cover` na primeira.
  - `createCarFromOlxAdvert(advertId: number): Promise<OlxActionResult & { carId?: string }>` — `requireSection("anuncios")`; `createCar` faz o resto das permissões. Tipo: `motorcycle` se a categoria descende de 379 (sobe `parent_id` com `GET /categories/{id}`, no máximo 4 níveis), senão `car`. Fotos falhadas não desfazem a viatura: `message` diz quantas.

- [ ] **Step 1: Write the failing tests**
  - `o Grand Scenic vira um rascunho com os campos certos` — anúncio e definições de atributos simulados (`combustivel diesel→Diesel`, `gearbox manual→Manual`, `body_type combi→Monovolume`, `year 2008`, `first_registration_month 04`, `quilometros 242000`, `engine_power 106`, `engine_capacity 1500`, `nr_seats 7`, `portas 4-5`) → `input` com `make:'Renault', model:'Grand Scenic', year:2008, registration_month:4, mileage:242000, fuel:'Diesel', transmission:'Manual', body:'Monovolume', power:106, displacement:1500, seats:7, doors:5, price:6000, status:'draft', channels:[]`, `vehicle_type:'car'` e `olx_attributes` com os códigos do anúncio.
  - `sem combustível que se reconheça, diz o que falta` → `{ ok:false, missing:['combustível'] }`.
  - `só copia fotos do CDN do OLX` — `isOlxImageUrl('https://ireland.apollo.olxcdn.com:443/v1/files/x/image')` true; `http://…olxcdn.com`, `https://evil.com/olxcdn.com/x`, `https://olxcdn.com.evil.com/x` false.

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/olx-adverts.test.mjs`
Expected: FAIL — `ENOENT … src/lib/olx/import-car.ts`

- [ ] **Step 3: Implement** — modelo: etiqueta do atributo cujo `fieldFor` é `model` (pela definição), senão o título sem a marca. Portas em intervalo («4-5») → o maior. Os enums (`fuel`, `transmission`, `body`) por `pickValue(label, LISTA.map(v=>({code:v,label:v})))`.

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/olx-adverts.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/lib/olx/import-car.ts src/lib/actions/olx-adverts.ts tests/olx-adverts.test.mjs
git commit -m "OLX: criar a viatura em rascunho a partir de um anúncio, com as fotos"
```

---

### Task 7: Ligação à conta e manutenção diária

**Files:**
- Modify: `src/app/api/olx/callback/route.ts`
- Modify: `src/app/api/maintenance/route.ts`
- Test: `tests/olx-adverts.test.mjs`

**Interfaces:**
- Consumes: `importAdverts` (Task 3).
- Produces: `resetForAccount(db: Db, previousUserId: string | null, newUserId: string | null): Promise<boolean>` em `src/lib/olx/import.ts` — esvazia `olx_adverts` quando as contas diferem (e a anterior não era nula); devolve se esvaziou.

- [ ] **Step 1: Write the failing test** — `ligar outra conta esvazia o espelho; a mesma conta não`: `resetForAccount(db,'111','222')` → `true` e `olx_adverts` vazia; `('222','222')` e `(null,'222')` → `false`, tabela intacta.

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/olx-adverts.test.mjs`
Expected: FAIL — `resetForAccount is not a function`

- [ ] **Step 3: Implement** — no retorno do OAuth: ler `olx_user_id` antes do `upsert`; depois de ler `/users/me`, `resetForAccount` e `importAdverts(db, { stats: false })` dentro do `try` (uma falha aqui não impede `done("ligado")`). Na manutenção: `importAdverts(db, { stats: true })` no lugar de `refreshStats(db)`.

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/olx-adverts.test.mjs tests/olx.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/lib/olx/import.ts src/app/api/olx/callback/route.ts src/app/api/maintenance/route.ts tests/olx-adverts.test.mjs
git commit -m "OLX: ler os anúncios ao ligar a conta e todos os dias"
```

---

### Task 8: Painel «Anúncios no OLX» e ficha da viatura

**Files:**
- Create: `src/components/admin/OlxAdvertsTable.tsx` (`"use client"`)
- Modify: `src/components/admin/OlxPanel.tsx` (a tabela «Estatísticas dos anúncios» passa a `OlxAdvertsTable`; lê `olx_adverts` e as viaturas, calcula `suggestAll`)
- Modify: `src/components/admin/OlxActions.tsx` («Atualizar estatísticas» → «Ler anúncios do OLX», `readOlxAdverts`)
- Modify: `src/components/admin/ChannelListings.tsx` e `src/app/admin/(dashboard)/carros/[id]/page.tsx` (prop `olxAdvert`)
- Test: `tests/olx-adverts.test.mjs` (render com `renderToStaticMarkup`, como em `tests/backoffice-ui.test.mjs`)

**Interfaces:**
- Consumes: Server Actions da Task 5 e 6; `REMOTE_STATUS_LABEL` (`lifecycle.ts`).
- Produces:
  - `interface AdvertRowView { id: number; title: string; url: string | null; origin: AdvertOrigin; status: string; views: number | null; phone_views: number | null; observers: number | null; car: { id: string; label: string; managed: boolean } | null; suggestion: { carId: string; label: string; strong: boolean } | null }` — `managed` = viatura com OLX marcado e origem ≠ `standvirtual`.
  - `OlxAdvertsTable({ adverts, cars, readAt }: { adverts: AdvertRowView[]; cars: { id: string; label: string }[]; readAt: string | null })`
  - `ChannelListings` ganha `olxAdvert?: { title: string; url: string | null; origin: AdvertOrigin; status: string; views: number | null; phone_views: number | null; observers: number | null } | null`.

- [ ] **Step 1: Write the failing tests**
  - `a lista mostra origem, estado e as ações certas por linha` — três linhas (Standvirtual com sugestão; Standvirtual associado; OLX sem viatura) → o HTML tem «Gerido no Standvirtual», «Associar», «Desassociar», «Criar viatura», «Ativar»; a linha Standvirtual não tem «Ativar» nem «Desativar»; uma linha OLX com `car.managed:true` tem «Gere-se na ficha» e não tem «Desativar».
  - `«Confirmar N sugestões» conta só as fortes`.
  - `a ficha mostra o anúncio do Standvirtual mesmo sem OLX marcado` — `ChannelListings` com `channels:[]` e `olxAdvert` Standvirtual → «Este anúncio vem do Standvirtual: altera-se lá» e as visualizações; com `olxAdvert` OLX e sem OLX marcado → «Marque OLX para o backoffice passar a gerir este anúncio.»

- [ ] **Step 2: Run test to verify it fails**
Run: `node --test tests/olx-adverts.test.mjs`
Expected: FAIL — `ENOENT … OlxAdvertsTable.tsx`

- [ ] **Step 3: Implement** — ordenação: por associar primeiro, depois visualizações. Confirmações com `confirm()` (como «Desligar») antes de associar um anúncio que passa a ser gerido pela ficha («A partir de agora o anúncio passa a ter o texto, as fotos e o preço da ficha.»), de ativar («O OLX pode cobrar a ativação.») e de desativar. Totais no topo a partir de `olx_adverts`.

- [ ] **Step 4: Run test to verify it passes**
Run: `node --test tests/olx-adverts.test.mjs tests/backoffice-ui.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add src/components/admin/OlxAdvertsTable.tsx src/components/admin/OlxPanel.tsx src/components/admin/OlxActions.tsx src/components/admin/ChannelListings.tsx "src/app/admin/(dashboard)/carros/[id]/page.tsx" tests/olx-adverts.test.mjs
git commit -m "OLX: painel com todos os anúncios da conta e a origem de cada um"
```

---

### Task 9: Verificação final

- [ ] **Step 1:** `npm test` → `ℹ fail 0`
- [ ] **Step 2:** `npm run -s typecheck` → sem saída, código 0
- [ ] **Step 3:** `npx next lint` → «No ESLint warnings or errors»
- [ ] **Step 4:** `npm run build` → termina sem erros
- [ ] **Step 5:** Pedir ao utilizador para aplicar `0051_olx_adverts.sql` no Supabase (SQL Editor) e correr `VERIFICAR_migracoes.sql` (deve dizer «tudo aplicado»). Só depois do push e do deploy: em `https://supermotas.com/admin/anuncios`, carregar em «Ler anúncios do OLX» → 11 anúncios, 7 sugestões fortes, os do Standvirtual com «Gerido no Standvirtual», e os 3 anúncios da conta antiga já sem erro.
