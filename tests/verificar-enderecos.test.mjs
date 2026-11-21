// Verificação dos endereços das bases antes da cópia (scripts/verificar-enderecos-supabase.mjs).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { checkDbUrl, siteProjectRef } from "../scripts/verificar-enderecos-supabase.mjs";

const POOLER = "aws-1-eu-west-1.pooler.supabase.com";
const ok = `postgresql://postgres.abcdefghijklmnopqrst:Abc123xyz@${POOLER}:5432/postgres`;

test("um endereço do Session pooler bem colado passa e diz o projeto e o servidor", () => {
  assert.deepEqual(checkDbUrl(ok), { ref: "abcdefghijklmnopqrst", host: POOLER, port: "5432", problems: [] });
});

test("apanha os enganos comuns ao colar o segredo", () => {
  const cases = [
    [ok.replace("Abc123xyz", "[YOUR-PASSWORD]"), /YOUR-PASSWORD/],
    [ok.replace("Abc123xyz", "[Abc123xyz]"), /parênteses retos/],
    [ok.replace(":Abc123xyz", ""), /não tem palavra-passe/],
    [ok.replace("Abc123xyz", "Abc%23123"), /símbolos/],
    [`${ok}\n`, /espaços ou uma mudança de linha/],
    [` ${ok}`, /espaços ou uma mudança de linha/],
    ["postgresql://postgres:Abc123@db.abcdefghijklmnopqrst.supabase.co:5432/postgres", /Direct connection/],
    [ok.replace(":5432", ":6543"), /Transaction pooler/],
    [ok.replace("postgres.abcdefghijklmnopqrst", "postgres"), /postgres\.<projeto>/],
    ["Abc123xyz", /não começa por postgresql/],
    ["", /vazio/],
  ];
  for (const [url, problem] of cases) {
    const { problems } = checkDbUrl(url);
    assert.ok(problems.some((p) => problem.test(p)), `${JSON.stringify(url)} → ${JSON.stringify(problems)}`);
  }
});

test("nunca devolve a palavra-passe", () => {
  const r = checkDbUrl(ok.replace("Abc123xyz", "Segredo!99"));
  assert.ok(!JSON.stringify(r).includes("Segredo"));
});

test("lê o projeto do site no netlify.toml", () => {
  assert.equal(siteProjectRef('NEXT_PUBLIC_SUPABASE_URL = "https://hmmuhxfggwhvvvtzbdps.supabase.co"'), "hmmuhxfggwhvvvtzbdps");
  assert.match(siteProjectRef(readFileSync("netlify.toml", "utf8")) ?? "", /^[a-z0-9]{20}$/);
  assert.equal(siteProjectRef("sem nada"), null);
});
