// Migração 0045 e o código que a acompanha: o que o público lê (colunas das
// viaturas e das definições, fotografias no Storage), as quotas dos formulários,
// a fila do webhook dos contactos e a pesquisa dos contactos. Base de dados a
// sério (PGlite, todas as migrações), como em database.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ts from 'typescript';
import { readFileSync, existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PGlite } from '@electric-sql/pglite';

const require = createRequire(import.meta.url);
const cache = new Map();
function withExt(base) { for (const ext of ['.ts', '.tsx', '/index.ts']) if (existsSync(base + ext)) return base + ext; throw new Error(`não resolvido: ${base}`); }
const stubs = {
  'server-only': {},
  'next/headers': { headers: async () => new Headers() },
};
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const { outputText } = ts.transpileModule(readFileSync(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  const mod = { exports: {} }; cache.set(path, mod.exports);
  const localRequire = (id) => id in stubs ? stubs[id] : id.startsWith('@/') ? load(withExt(`src/${id.slice(2)}`)) : require(id);
  new Function('module', 'exports', 'require', outputText)(mod, mod.exports, localRequire);
  cache.set(path, mod.exports); return mod.exports;
}
const { PUBLIC_CAR_COLUMNS, PUBLIC_CAR_SELECT, PUBLIC_SITE_SETTINGS_COLUMNS } = load('src/lib/public-columns.ts');
const { submissionKeys } = load('src/lib/public-submissions.ts');
const { webhookUrlProblem, webhookHosts } = load('src/lib/webhook-url.ts');
const { leadFilters, leadSearchOr } = load('src/lib/lead-filters.ts');

const pg = new PGlite();
await pg.exec(`
 create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create schema storage;
 create table auth.users(id uuid primary key, email text,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select coalesce(
   nullif(current_setting('request.jwt.claim.sub',true),''),
   nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
 create table storage.buckets(id text primary key,name text,public boolean);
 create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
 alter table storage.objects enable row level security;
 grant usage on schema public,auth,storage to anon,authenticated,service_role;
 alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
 alter default privileges in schema public grant usage,select on sequences to anon,authenticated,service_role;
 grant all on storage.objects to anon,authenticated,service_role;
`);
const migrations = (await readdir('supabase/migrations')).sort();
for (const file of migrations)
  await pg.exec((await readFile(`supabase/migrations/${file}`, 'utf8')).replace('create extension if not exists "pgcrypto";', ''));

const admin = '00000000-0000-4000-8000-000000000001';
await pg.query('insert into auth.users(id,email) values($1,$2)', [admin, 'admin@example.test']);
await pg.query("insert into public.profiles(id,role) values($1,'admin')", [admin]);
const newCar = async (slug, status) => (await pg.query(
  `insert into cars(slug,make,model,year,fuel,transmission,body,status,price,license_plate,created_by)
   values($1,'BMW','320',2020,'Diesel','Manual','Berlina',$2,25000,'AA-00-AA',$3) returning id`, [slug, status, admin])).rows[0].id;
const published = await newCar('publicada', 'published');
const draft = await newCar('rascunho', 'draft');

/** Corre como um papel (anon, authenticated, service_role), numa transacção. */
const as = (role, sql, params, sub = '') => pg.transaction(async (tx) => {
  await tx.exec(`set local role ${role}`);
  await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [sub]);
  return tx.query(sql, params);
});
/** As colunas de um `select(...)` do supabase-js, sem os recursos embutidos. */
const columnsOf = (select) => select.split(',').map((c) => c.trim()).filter((c) => c && !c.includes('('));

// ---------------------------------------------------------------------------
// 1 e 2. Colunas públicas
// ---------------------------------------------------------------------------

await test('anon cannot read the plate, the author or the OLX category of a published car', async () => {
  for (const col of ['license_plate', 'created_by', 'olx_category_id'])
    await assert.rejects(as('anon', `select ${col} from cars`), /permission denied/, col);
  await assert.rejects(as('anon', 'select * from cars'), /permission denied/, 'select * deixa de servir ao público');
  // Nem por um filtro: o WHERE também precisa do privilégio da coluna.
  await assert.rejects(as('anon', "select id from cars where license_plate='AA-00-AA'"), /permission denied/);
});

await test('the app public car column list is exactly what anon may read, and it is readable', async () => {
  const { rows } = await as('anon', `select ${PUBLIC_CAR_COLUMNS.join(',')} from cars`);
  // A RLS continua a esconder o rascunho.
  assert.deepEqual(rows.map((r) => r.id), [published]);
  assert.equal(rows[0].slug, 'publicada');
  const granted = (await pg.query(`select column_name from information_schema.column_privileges
    where grantee='anon' and table_schema='public' and table_name='cars' and privilege_type='SELECT'`)).rows.map((r) => r.column_name);
  assert.deepEqual([...PUBLIC_CAR_COLUMNS].sort(), granted.sort(), 'a lista do site e o grant da 0045 são a mesma');
  for (const c of ['license_plate', 'created_by', 'olx_category_id']) assert.ok(!PUBLIC_CAR_COLUMNS.includes(c), c);
  // O select do site inteiro (com as fotografias) é o que o PostgREST recebe.
  assert.deepEqual(columnsOf(PUBLIC_CAR_SELECT), [...PUBLIC_CAR_COLUMNS]);
  assert.match(PUBLIC_CAR_SELECT, /car_media\(\*\)$/);
});

await test('the photos of a published car are still public, and the staff still sees the whole car', async () => {
  await pg.query("insert into car_media(car_id,storage_path) values($1,$2),($3,$4)", [published, `${published}/a.jpg`, draft, `${draft}/b.jpg`]);
  assert.deepEqual((await as('anon', 'select storage_path from car_media')).rows.map((r) => r.storage_path), [`${published}/a.jpg`]);
  const row = (await as('authenticated', 'select * from cars where id=$1', [draft], admin)).rows[0];
  assert.equal(row.license_plate, 'AA-00-AA');
  assert.equal(row.created_by, admin);
});

await test('every public read of cars and site_settings in the app asks only for columns anon has', async () => {
  // As leituras que podem correr sem sessão: o cliente público (queries.ts,
  // showroom-queries.ts) e as ações do site com o cliente de cookies (leads.ts).
  const files = ['src/lib/queries.ts', 'src/lib/showroom-queries.ts', 'src/lib/actions/leads.ts'];
  const allowed = { cars: new Set(PUBLIC_CAR_COLUMNS), site_settings: new Set(PUBLIC_SITE_SETTINGS_COLUMNS) };
  let checked = 0;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/from\("(cars|site_settings)"\)\s*\.select\(\s*("[^"]*"|[A-Z_]+)/g)) {
      const [, table, arg] = m;
      assert.notEqual(arg, '"*"', `${file}: select("*") em ${table}`);
      const select = arg.startsWith('"') ? arg.slice(1, -1) : arg === 'CAR_SELECT' ? PUBLIC_CAR_SELECT : null;
      assert.ok(select, `${file}: select desconhecido ${arg}`);
      for (const c of columnsOf(select)) assert.ok(allowed[table].has(c), `${file}: ${table}.${c} não é pública`);
      await as('anon', `select ${columnsOf(select).join(',')} from ${table}`);
      checked++;
    }
  }
  assert.ok(checked >= 10, `só ${checked} leituras encontradas`);
});

await test('anon reads the public site settings but not the workshop hourly rate', async () => {
  await pg.query('update site_settings set workshop_hourly_rate=45 where id=1');
  await assert.rejects(as('anon', 'select workshop_hourly_rate from site_settings'), /permission denied/);
  await assert.rejects(as('anon', 'select * from site_settings'), /permission denied/);
  assert.equal((await as('anon', `select ${PUBLIC_SITE_SETTINGS_COLUMNS.join(',')} from site_settings`)).rows.length, 1);
  const granted = (await pg.query(`select column_name from information_schema.column_privileges
    where grantee='anon' and table_schema='public' and table_name='site_settings' and privilege_type='SELECT'`)).rows.map((r) => r.column_name);
  assert.deepEqual([...PUBLIC_SITE_SETTINGS_COLUMNS].sort(), granted.sort());
  assert.equal(Number((await as('authenticated', 'select workshop_hourly_rate from site_settings', [], admin)).rows[0].workshop_hourly_rate), 45);
});

await test('0045 can run twice without changing the result', async () => {
  await pg.exec((await readFile('supabase/migrations/0045_public_privacy.sql', 'utf8')));
  await assert.rejects(as('anon', 'select license_plate from cars'), /permission denied/);
  assert.equal((await as('anon', `select ${PUBLIC_CAR_COLUMNS.join(',')} from cars`)).rows.length, 1);
});

// ---------------------------------------------------------------------------
// 3. Storage
// ---------------------------------------------------------------------------

await test('anon lists only the photos of cars on the site; the staff lists everything', async () => {
  await pg.query(`insert into storage.objects(bucket_id,name) values
    ('car-media',$1),('car-media',$2),('car-media','branding/logo.png'),('car-media','_originais/x/y.jpg'),('wa-media','z.jpg')`,
  [`${published}/capa.jpg`, `${draft}/rascunho.jpg`]);
  const names = async (role, sub) => (await as(role, "select name from storage.objects where bucket_id='car-media' order by name", [], sub)).rows.map((r) => r.name);
  assert.deepEqual(await names('anon'), [`${published}/capa.jpg`]);
  // Sessão sem perfil (não é da equipa): o mesmo que o público.
  assert.deepEqual(await names('authenticated', '00000000-0000-4000-8000-0000000000ee'), [`${published}/capa.jpg`]);
  assert.equal((await names('authenticated', admin)).length, 4);
  // A política antiga, que deixava listar tudo, já não existe.
  assert.equal((await pg.query("select count(*)::int n from pg_policies where schemaname='storage' and policyname='car-media: public read'")).rows[0].n, 0);
  // Vendida continua visível (é prova social no site).
  await pg.query("update cars set status='sold' where id=$1", [published]);
  assert.deepEqual(await names('anon'), [`${published}/capa.jpg`]);
  await pg.query("update cars set status='published' where id=$1", [published]);
});

await test('the app never lists the photo bucket with the public client', () => {
  for (const file of ['src/lib/queries.ts', 'src/lib/showroom-queries.ts', 'src/lib/supabase/public.ts'])
    assert.doesNotMatch(readFileSync(file, 'utf8'), /\.list\(/, file);
});

// ---------------------------------------------------------------------------
// 4. Quotas dos formulários
// ---------------------------------------------------------------------------

const consume = async (key, max) => (await as('service_role', 'select consume_submission($1,$2,600) ok', [key, max])).rows[0].ok;
const hits = async (key) => (await pg.query('select hits from submission_limits where key=$1', [key])).rows[0]?.hits ?? 0;

await test('a refused submission does not keep counting', async () => {
  assert.deepEqual([await consume('t', 2), await consume('t', 2), await consume('t', 2), await consume('t', 2)], [true, true, false, false]);
  assert.equal(await hits('t'), 3, 'para em max+1');
  // A janela passa: volta a aceitar.
  await pg.query("update submission_limits set window_start=now()-interval '11 minutes' where key='t'");
  assert.equal(await consume('t', 2), true);
  await assert.rejects(as('anon', "select consume_submission('x',1,600)"), /permission denied/);
});

await test('one client stopped by its own limit cannot use up the global quota', async () => {
  // A ordem do servidor: IP, identidade e, no fim, a global.
  const keys = submissionKeys('lead', 'ip-hash', 'id-hash');
  assert.deepEqual(keys.map((k) => k.value), ['lead:ip:ip-hash', 'lead:identity:id-hash', 'lead:global']);
  assert.deepEqual(submissionKeys('lead', null, null).map((k) => k.value), ['lead:global']);
  // O ciclo de publicSubmissionClient: para na primeira recusa.
  const attempt = async () => { for (const k of keys) if (!(await consume(k.value, k.max))) return false; return true; };
  const results = [];
  for (let i = 0; i < 40; i++) results.push(await attempt());
  assert.equal(results.filter(Boolean).length, 5, 'o limite por identidade (5) manda');
  assert.equal(await hits('lead:global'), 5, 'a quota global só conta os 5 aceites');
});

// ---------------------------------------------------------------------------
// 7. Webhook dos contactos
// ---------------------------------------------------------------------------

const webhookJobs = async (lead) => (await pg.query("select count(*)::int n from notification_jobs where channel='webhook' and lead_id=$1", [lead])).rows[0].n;
const newLead = async () => (await pg.query("insert into leads(name,email) values('Cliente','c@example.test') returning id")).rows[0].id;
const setWebhook = (url) => pg.query("update integration_secrets set data=jsonb_set(data,'{lead_webhook}',to_jsonb($1::text)) where id=1", [url]);

await test('without a webhook configured, a lead does not enter the webhook queue', async () => {
  await setWebhook('');
  assert.equal(await webhookJobs(await newLead()), 0);
  await setWebhook('https://hooks.slack.com/services/x');
  assert.equal(await webhookJobs(await newLead()), 1);
});

await test('jobs left more than 24 hours in the queue are not sent by themselves, but can be retried', async () => {
  await pg.query("delete from notification_jobs where channel='webhook'");
  const old = await newLead(); const fresh = await newLead();
  await pg.query("update notification_jobs set created_at=now()-interval '3 days',next_attempt_at=now()-interval '3 days' where lead_id=$1", [old]);
  const claimed = (await as('service_role', 'select lead_id from claim_notification_jobs()')).rows.map((r) => r.lead_id);
  assert.deepEqual(claimed, [fresh]);
  const stale = (await pg.query('select attempts,last_error from notification_jobs where lead_id=$1', [old])).rows[0];
  assert.equal(stale.attempts, 8);
  assert.match(stale.last_error, /24 horas/);
  // «Voltar a tentar» no painel (requeueNotification): volta à fila.
  await pg.query('update notification_jobs set attempts=0,next_attempt_at=now(),last_error=null where lead_id=$1', [old]);
  assert.deepEqual((await as('service_role', 'select lead_id from claim_notification_jobs()')).rows.map((r) => r.lead_id), [old]);
});

await test('the cleanup removes webhook jobs older than 30 days and keeps the recent ones', async () => {
  const old = await newLead(); const recent = await newLead();
  await pg.query("update notification_jobs set created_at=now()-interval '31 days' where lead_id=$1", [old]);
  await as('service_role', 'select prune_notification_jobs()');
  assert.equal(await webhookJobs(old), 0);
  assert.equal(await webhookJobs(recent), 1);
  await assert.rejects(as('authenticated', 'select prune_notification_jobs()', [], admin), /permission denied/);
});

await test('the webhook URL is checked against the same host list when saving and sending', () => {
  const hosts = webhookHosts(undefined);
  assert.ok(hosts.includes('hooks.slack.com'));
  assert.equal(webhookUrlProblem('https://hooks.slack.com/services/T/B/x', hosts), null);
  assert.match(webhookUrlProblem('http://hooks.slack.com/services/x', hosts), /HTTPS/);
  assert.match(webhookUrlProblem('https://evil.example/x', hosts), /não autorizado/);
  assert.match(webhookUrlProblem('https://user:pw@hooks.slack.com/x', hosts), /credenciais/);
  assert.match(webhookUrlProblem('não é url', hosts), /inválido/);
  // A lista do servidor substitui a predefinida.
  assert.equal(webhookUrlProblem('https://n8n.stand.pt/hook', webhookHosts('n8n.stand.pt, outro.pt')), null);
  assert.match(webhookUrlProblem('https://hooks.slack.com/x', webhookHosts('n8n.stand.pt')), /não autorizado/);
  // O envio e a gravação usam a mesma função.
  assert.match(readFileSync('src/lib/notifications.ts', 'utf8'), /webhookUrlProblem\(webhook\)/);
  assert.match(readFileSync('src/lib/actions/settings.ts', 'utf8'), /webhookUrlProblem\(parsed\.data\.lead_webhook\)/);
});

// ---------------------------------------------------------------------------
// 6. Pesquisa dos contactos (lista e exportação)
// ---------------------------------------------------------------------------

await test('the lead search cannot add conditions or wildcards to the PostgREST filter', () => {
  for (const evil of ['a%,status.eq.won', 'x),or(id.not.is.null', '*', '"a,b"', 'a_b\\c']) {
    const { q } = leadFilters({ q: evil });
    assert.doesNotMatch(q, /[,()%*"_\\]/, evil);
    const or = leadSearchOr(q);
    // Exatamente as quatro condições, sem mais nenhuma.
    assert.equal(or.split(',').length, 4, or);
    assert.ok(or.split(',').every((c) => /^(name|email|phone|car_label)\.ilike\.%[^%]*%$/.test(c)), or);
  }
  // O que se procura de verdade passa: emails, telefones, nomes com acentos.
  assert.equal(leadFilters({ q: '  joão.silva@mail.pt ' }).q, 'joão.silva@mail.pt');
  assert.equal(leadSearchOr('912 345 678').split(',')[2], 'phone.ilike.%912 345 678%');
  assert.match(readFileSync('src/app/api/admin/leads/export/route.ts', 'utf8'), /\.or\(leadSearchOr\(f\.q\)\)/);
});
