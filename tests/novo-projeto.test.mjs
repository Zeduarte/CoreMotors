// Um stand novo no seu próprio projeto: a base de dados instala-se de uma vez
// (INSTALAR_projeto_novo.sql), o dono cria-se com setup_owner, e nada no
// código ou na configuração partilhada aponta para os dados de outro stand.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { PGlite } from "@electric-sql/pglite";
import { buildInstallSql } from "../scripts/sql-instalar.mjs";

const INSTALL = "supabase/INSTALAR_projeto_novo.sql";

test("INSTALAR_projeto_novo.sql está atualizado (node scripts/sql-instalar.mjs) e tem todas as migrações", () => {
  const sql = readFileSync(INSTALL, "utf8");
  assert.equal(sql, buildInstallSql(), "corra: node scripts/sql-instalar.mjs");
  for (const f of readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"))) assert.ok(sql.includes(`-- ${f}\n`), f);
});

async function freshSupabase() {
  // O mínimo do Supabase que as migrações usam (como em tests/database.test.mjs).
  const db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb default '{}');
    create function auth.uid() returns uuid language sql stable as $$ select coalesce(
      nullif(current_setting('request.jwt.claim.sub',true),''),
      nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid $$;
    create table storage.buckets(id text primary key, name text, public boolean);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);
    alter table storage.objects enable row level security;
    grant usage on schema public, auth, storage to anon, authenticated, service_role;
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant usage, select on sequences to anon, authenticated, service_role;
    grant all on storage.objects to anon, authenticated, service_role;
  `);
  return db;
}

test("uma base de dados vazia instala-se com o ficheiro inteiro de uma só vez, e o dono cria-se com setup_owner", async () => {
  const db = await freshSupabase();
  // Tal como no SQL Editor: o ficheiro inteiro num só envio (o pgcrypto já vem no Supabase).
  await db.exec(readFileSync(INSTALL, "utf8").replace('create extension if not exists "pgcrypto";', ""));

  // Nasce sem dados de nenhum stand: nome por omissão, sem nome legal nem NIF.
  const s = (await db.query("select company_name, legal_name, nif, credit_intermediary_url from site_settings where id=1")).rows[0];
  assert.deepEqual(s, { company_name: "CoreMotors", legal_name: null, nif: null, credit_intermediary_url: null });
  assert.equal((await db.query("select count(*)::int n from cars")).rows[0].n, 0);
  assert.equal((await db.query("select count(*)::int n from profiles")).rows[0].n, 0);

  // O dono: a conta criada em Authentication → Users passa a acesso core.
  const owner = "00000000-0000-4000-8000-0000000000aa";
  const other = "00000000-0000-4000-8000-0000000000bb";
  await db.query("insert into auth.users(id,email) values($1,'Dono@Stand.pt'),($2,'outro@stand.pt')", [owner, other]);
  await assert.rejects(db.query("select public.setup_owner('ninguem@stand.pt')"), /Não existe nenhuma conta/);
  const msg = (await db.query("select public.setup_owner('dono@stand.pt') as m")).rows[0].m;
  assert.match(msg, /«Core»/);
  const p = (await db.query("select role, is_owner, username, allowed_sections from profiles where id=$1", [owner])).rows[0];
  assert.deepEqual(p, { role: "admin", is_owner: true, username: "Core", allowed_sections: null });
  // Pode correr-se outra vez para a mesma conta; outra conta não passa a dona.
  await db.query("select public.setup_owner('dono@stand.pt')");
  await assert.rejects(db.query("select public.setup_owner('outro@stand.pt', 'Outro')"), /já tem um dono/);
  // O login por nome de utilizador encontra o dono.
  assert.equal((await db.query("select public.login_email('core') as e")).rows[0].e.toLowerCase(), "dono@stand.pt");

  // Ninguém pela API (anon ou equipa) se faz dono com esta função.
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`set role ${role}`);
    try {
      await assert.rejects(db.query("select public.setup_owner('outro@stand.pt', 'X')"), /permission denied/, role);
    } finally {
      await db.exec("reset role");
    }
  }
  await db.close();
});

test("a 0057 passa a identificação legal antiga para a base de dados da Supermotas — e só para ela", async () => {
  for (const [company, expected] of [
    ["Supermotas", { legal_name: "Carlos Moreira – Supermotas, Unipessoal Lda", nif: "518429261" }],
    ["Outro Stand", { legal_name: null, nif: null }],
  ]) {
    const db = await freshSupabase();
    const files = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql")).sort();
    for (const f of files) {
      if (f.startsWith("0057")) await db.query("update site_settings set company_name=$1 where id=1", [company]);
      await db.exec(readFileSync(`supabase/migrations/${f}`, "utf8").replace('create extension if not exists "pgcrypto";', ""));
    }
    const s = (await db.query("select legal_name, nif from site_settings where id=1")).rows[0];
    assert.deepEqual(s, expected, company);
    // O site público (anon) lê-os.
    await db.exec("set role anon");
    await db.query("select legal_name, nif, credit_intermediary_url from site_settings");
    await db.exec("reset role");
    await db.close();
  }
});

test("nada partilhado aponta para o projeto de um stand: netlify.toml sem Supabase, fotos sem endereço por omissão", () => {
  const toml = readFileSync("netlify.toml", "utf8");
  assert.doesNotMatch(toml, /supabase\.co|sb_publishable_|NEXT_PUBLIC_SUPABASE_(URL|ANON_KEY)\s*=/);
  assert.doesNotMatch(readFileSync("src/lib/storage.ts", "utf8"), /=\s*"https:\/\/fotos\./);
  // Os dados antigos só ficam em LEGACY_LEGAL (base de dados sem a 0057).
  const legal = readFileSync("src/lib/legal.ts", "utf8");
  assert.equal(legal.match(/518429261/g)?.length, 1);
  assert.match(legal, /LEGACY_LEGAL: LegalInfo = \{\s*legalName: "Carlos Moreira – Supermotas/);
  for (const f of ["src/lib/site.ts", "src/app/admin/(dashboard)/layout.tsx", "src/components/admin/MobileNav.tsx", "src/lib/admin-queries.ts"]) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /"Supermotas"|supermotas\.(pt|netlify)/, f);
  }
});

test("o build no Netlify pára sem as variáveis do site, e diz quais faltam", () => {
  const run = (env) => {
    try {
      return { code: 0, out: execFileSync("node", ["scripts/check-env.mjs"], { env: { PATH: process.env.PATH, ...env }, encoding: "utf8", stdio: "pipe" }) };
    } catch (e) {
      return { code: e.status, out: `${e.stdout}${e.stderr}` };
    }
  };
  const full = {
    NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "sb_publishable_x",
    SUPABASE_SERVICE_ROLE_KEY: "sb_secret_x",
    NEXT_PUBLIC_MEDIA_URL: "https://fotos.stand.pt",
    R2_ACCOUNT_ID: "a",
    R2_ACCESS_KEY_ID: "b",
    R2_SECRET_ACCESS_KEY: "c",
    R2_BUCKET: "stand-fotos",
  };
  const ok = run({ ...full, NETLIFY: "true" });
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /Supabase abcdefghijklmnopqrst, fotos em https:\/\/fotos\.stand\.pt/);

  const { R2_BUCKET, NEXT_PUBLIC_SUPABASE_URL, ...missing } = full;
  const bad = run({ ...missing, NETLIFY: "true" });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /falta NEXT_PUBLIC_SUPABASE_URL/);
  assert.match(bad.out, /falta R2_BUCKET/);
  // Fora do Netlify (computador, CI) só avisa.
  assert.equal(run(missing).code, 0);
  // Endereços mal colados.
  assert.match(run({ ...full, NETLIFY: "true", NEXT_PUBLIC_SUPABASE_URL: "https://site.pt" }).out, /não parece um projeto Supabase/);
  assert.match(run({ ...full, NETLIFY: "true", NEXT_PUBLIC_MEDIA_URL: "https://fotos.stand.pt/" }).out, /não pode acabar em «\/»/);
  // Com as fotos no Supabase (de propósito), o R2 não é preciso.
  const supa = { ...full, NEXT_PUBLIC_MEDIA_STORAGE: "supabase", NETLIFY: "true" };
  for (const k of ["NEXT_PUBLIC_MEDIA_URL", "R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET"]) delete supa[k];
  assert.equal(run(supa).code, 0);
  // A lista do build e a do .env.example são as mesmas variáveis.
  const example = readFileSync(".env.example", "utf8");
  for (const v of JSON.parse(readFileSync("src/config/env-vars.json", "utf8")).vars) assert.match(example, new RegExp(`^${v.name}=`, "m"), v.name);
});
