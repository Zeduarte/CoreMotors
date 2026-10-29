// Base de dados de teste: todas as migrações em PGlite, com os papéis e o
// `auth.uid()` da Supabase imitados como em tests/database.test.mjs.
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';

export async function bootDatabase() {
  const db = new PGlite();
  await db.exec(`
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
  for (const file of (await readdir('supabase/migrations')).sort()) {
    const sql = (await readFile(`supabase/migrations/${file}`, 'utf8')).replace('create extension if not exists "pgcrypto";', '');
    await db.exec(sql);
  }
  return db;
}

export async function addUser(db, id, role, name = role) {
  await db.query('insert into auth.users(id,email) values($1,$2)', [id, `${role}-${id}@example.test`]);
  await db.query('insert into public.profiles(id,role,full_name,email) values($1,$2,$3,$4)', [id, role, name, `${role}-${id}@example.test`]);
}

/** Corre `fn` como o utilizador `id` (papel `authenticated`), com RLS. */
export function asUserFactory(db) {
  return async function asUser(id, fn, role = 'authenticated') {
    await db.exec(`set role ${role}`);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id ?? '']);
    try { return await fn(); } finally { await db.exec('reset role'); await db.exec("select set_config('request.jwt.claim.sub','',false)"); }
  };
}
