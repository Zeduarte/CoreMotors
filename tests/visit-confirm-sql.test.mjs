// Pedido de visita pelo site: aviso `lead_visit` e confirmação pelo WhatsApp
// (migração 0044), sobre a base de dados a sério (PGlite, todas as migrações).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

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
for (const file of (await readdir('supabase/migrations')).sort())
  await pg.exec((await readFile(`supabase/migrations/${file}`, 'utf8')).replace('create extension if not exists "pgcrypto";', ''));

const admin = '00000000-0000-4000-8000-000000000001';
const vendedor = '00000000-0000-4000-8000-000000000002';
const mecanico = '00000000-0000-4000-8000-000000000003';
const soMotas = '00000000-0000-4000-8000-000000000005';
for (const [id, role, phone] of [[admin, 'admin', '912000001'], [vendedor, 'vendedor', '912000002'], [mecanico, 'mecanico', '912000003'], [soMotas, 'vendedor', '912000005']]) {
  await pg.query('insert into auth.users(id,email) values($1,$2)', [id, `${role}${id.slice(-1)}@example.test`]);
  await pg.query('insert into public.profiles(id,role,phone) values($1,$2,$3)', [id, role, phone]);
}
await pg.query("update profiles set allowed_vehicle_types=array['motorcycle'] where id=$1", [soMotas]);
await pg.query('update notification_settings set whatsapp_enabled=true');

const hours = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const newVisit = async ({ status = 'requested', at = hours(48), vtype = 'car', kind = 'visit' } = {}) =>
  (await pg.query(
    `insert into leads(name,email,kind,vehicle_type,car_label,visit_at,visit_status) values('Maria Silva','c@example.test',$1,$2,'BMW 320d',$3,$4) returning id`,
    [kind, vtype, status === 'none' ? null : at, status === 'none' ? null : status])).rows[0].id;
const jobs = async (lead) => (await pg.query("select * from notification_jobs where channel='whatsapp' and lead_id=$1 order by recipient_id", [lead])).rows;
const asRole = (role, sql, params) => pg.transaction(async (tx) => { await tx.exec(`set local role ${role}`); return tx.query(sql, params); });
const setVisit = async (actor, lead, outcome, role = 'service_role') =>
  (await asRole(role, 'select public.wa_set_visit($1,$2,$3) r', [actor, lead, outcome])).rows[0].r;
const lead = async (id) => (await pg.query('select * from leads where id=$1', [id])).rows[0];
const activities = async (id) => (await pg.query("select * from lead_activities where lead_id=$1 order by created_at", [id])).rows;

await test('a requested visit queues one lead_visit per person with the leads section', async () => {
  const id = await newVisit();
  const j = await jobs(id);
  assert.ok(j.length >= 2);
  assert.ok(j.every((x) => x.event === 'lead_visit'));
  const people = j.map((x) => x.recipient_id);
  assert.equal(new Set(people).size, people.length);
  assert.ok(people.includes(admin) && people.includes(vendedor));
  assert.ok(!people.includes(mecanico), 'mecânico não tem a secção leads');
  assert.ok(!people.includes(soMotas), 'sem acesso a carros');
  const p = j[0].payload;
  assert.equal(p.lead_id, id);
  assert.equal(p.visit_status, 'requested');
  assert.equal(Math.floor(new Date(p.visit_at).getTime() / 1000), Math.floor(new Date((await lead(id)).visit_at).getTime() / 1000));
  assert.match(p.visit_at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.equal((await pg.query("select count(*)::int n from notification_jobs where event='lead_contact' and lead_id=$1", [id])).rows[0].n, 0);
});

await test('a visit created already confirmed does not notify', async () => {
  const id = await newVisit({ status: 'confirmed' });
  assert.equal((await jobs(id)).length, 0);
});

await test('other kinds keep their notice', async () => {
  const id = await newVisit({ status: 'none', kind: 'contact' });
  const j = await jobs(id);
  assert.ok(j.length >= 1 && j.every((x) => x.event === 'lead_contact'));
});

await test('lead_visit is in the catalogue, on by default', async () => {
  assert.equal((await pg.query("select public.notification_event_section('lead_visit') s, public.notification_event_default('lead_visit') d")).rows[0].s, 'leads');
  assert.equal((await pg.query("select public.notification_event_default('lead_visit') d")).rows[0].d, true);
});

await test('confirm changes the visit, logs once, and repeating is a no-op', async () => {
  const id = await newVisit();
  const at = (await lead(id)).visit_at;
  assert.equal(await setVisit(vendedor, id, 'confirm'), 'confirmed');
  const l = await lead(id);
  assert.equal(l.visit_status, 'confirmed');
  assert.equal(l.next_action, 'Visita ao stand');
  assert.equal(new Date(l.next_action_at).getTime(), new Date(at).getTime());
  assert.equal(l.status, 'new');
  let acts = await activities(id);
  assert.equal(acts.length, 1);
  assert.equal(acts[0].kind, 'visit');
  assert.equal(acts[0].created_by, vendedor);
  assert.match(acts[0].body, /^Visita confirmada para \d\d\/\d\d\/\d{4} às \d\d:\d\d pelo WhatsApp\.$/);
  assert.equal(await setVisit(vendedor, id, 'confirm'), 'already_confirmed');
  assert.equal(await setVisit(admin, id, 'decline'), 'already_handled');
  assert.equal((await activities(id)).length, 1);
  assert.equal((await lead(id)).visit_status, 'confirmed');
});

await test('decline changes the visit, logs once, and repeating is a no-op', async () => {
  const id = await newVisit();
  assert.equal(await setVisit(vendedor, id, 'decline'), 'declined');
  const l = await lead(id);
  assert.equal(l.visit_status, 'cancelled');
  assert.equal(l.next_action, 'Propor outra hora ao cliente');
  assert.ok(l.next_action_at);
  const acts = await activities(id);
  assert.equal(acts.length, 1);
  assert.equal(acts[0].body, 'Visita recusada pelo WhatsApp: equipa propõe outra hora.');
  assert.equal(await setVisit(vendedor, id, 'decline'), 'already_declined');
  // Um colega que carrega «Confirmar» depois vê que já foi recusada.
  assert.equal(await setVisit(admin, id, 'confirm'), 'already_declined');
  assert.equal((await lead(id)).visit_status, 'cancelled');
  assert.equal((await activities(id)).length, 1);
});

await test('done and no_show visits are already handled', async () => {
  for (const st of ['done', 'no_show']) {
    const id = await newVisit({ status: st });
    assert.equal(await setVisit(vendedor, id, 'confirm'), 'already_handled');
    assert.equal(await setVisit(vendedor, id, 'decline'), 'already_handled');
    assert.equal((await lead(id)).visit_status, st);
  }
});

await test('a past visit is not changed', async () => {
  const id = await newVisit({ at: hours(-2) });
  assert.equal(await setVisit(vendedor, id, 'confirm'), 'past');
  assert.equal(await setVisit(vendedor, id, 'decline'), 'past');
  assert.equal((await lead(id)).visit_status, 'requested');
  assert.equal((await activities(id)).length, 0);
});

await test('unknown lead, lead without visit and bad outcome', async () => {
  assert.equal(await setVisit(vendedor, '11111111-1111-4111-8111-111111111111', 'confirm'), 'not_found');
  const semVisita = await newVisit({ status: 'none', kind: 'contact' });
  assert.equal(await setVisit(vendedor, semVisita, 'confirm'), 'not_found');
  const id = await newVisit();
  await assert.rejects(setVisit(vendedor, id, 'talvez'));
  await assert.rejects(setVisit(vendedor, id, null));
  assert.equal((await lead(id)).visit_status, 'requested');
});

await test('an actor without the leads section or the vehicle type is refused', async () => {
  const id = await newVisit();
  await assert.rejects(setVisit(mecanico, id, 'confirm'), /Sem permissão/);
  await assert.rejects(setVisit(soMotas, id, 'confirm'), /Sem acesso a este tipo de viatura/);
  await assert.rejects(setVisit(null, id, 'confirm'));
  assert.equal((await lead(id)).visit_status, 'requested');
  assert.equal((await activities(id)).length, 0);
});

await test('the lead_visit job is blocked once the visit is handled', async () => {
  const id = await newVisit();
  const j = (await jobs(id)).find((x) => x.recipient_id === vendedor);
  const block = async () => (await pg.query('select public.notification_job_block_reason($1,$2,$3) r', [vendedor, 'lead_visit', j.payload])).rows[0].r;
  assert.equal(await block(), null);
  await setVisit(admin, id, 'confirm');
  assert.equal(await block(), 'A visita já foi tratada');
  // E a recolha do envio cancela-o em vez de o entregar.
  await pg.query("update notification_jobs set next_attempt_at=now() where id=$1", [j.id]);
  const claimed = (await asRole('service_role', 'select * from public.claim_whatsapp_notifications(50)')).rows;
  assert.ok(!claimed.some((c) => c.job_id === j.id));
  const after = (await pg.query('select cancelled_at,last_error from notification_jobs where id=$1', [j.id])).rows[0];
  assert.ok(after.cancelled_at);
  assert.equal(after.last_error, 'A visita já foi tratada');
});

await test('the lead_visit job is blocked when the lead is gone', async () => {
  const id = await newVisit();
  const j = (await jobs(id)).find((x) => x.recipient_id === vendedor);
  const payload = { ...j.payload, lead_id: '22222222-2222-4222-8222-222222222222' };
  assert.equal((await pg.query('select public.notification_job_block_reason($1,$2,$3) r', [vendedor, 'lead_visit', payload])).rows[0].r, 'O contacto já não existe');
});

await test('authenticated and anon cannot run the RPCs', async () => {
  const id = await newVisit();
  for (const role of ['authenticated', 'anon'])
    await assert.rejects(setVisit(admin, id, 'confirm', role), /permission denied/i, role);
  for (const role of ['authenticated', 'anon'])
    await assert.rejects(asRole(role, "select public.notification_job_block_reason($1,'lead_visit','{}'::jsonb)", [admin]), /permission denied/i, role);
  assert.equal((await lead(id)).visit_status, 'requested');
});
