// Antes do build: este site tem as variáveis de que precisa?
//
// Cada stand é um site do Netlify com o seu Supabase e o seu R2 (ver
// docs/novo-projeto.md); só as variáveis mudam. Um site sem elas — ou com as de
// outro stand — ficaria publicado partido, ou a mostrar os dados de outro. Por
// isso, no Netlify, o build PÁRA aqui com a lista do que falta. Fora do Netlify
// (o seu computador, o CI) só avisa.
//
// Uso: node scripts/check-env.mjs   (corre sozinho em `npm run build`)
import { readFileSync } from "node:fs";

const { vars } = JSON.parse(readFileSync(new URL("../src/config/env-vars.json", import.meta.url), "utf8"));
const env = process.env;
const val = (k) => (env[k] ?? "").trim();
const onNetlify = env.NETLIFY === "true";
const usesR2 = val("NEXT_PUBLIC_MEDIA_STORAGE") !== "supabase";

const problems = [];
for (const v of vars) {
  // R2_ENDPOINT (só em testes) substitui o endereço da conta.
  const required = (v.required === true || (v.required === "r2" && usesR2)) && !(v.name === "R2_ACCOUNT_ID" && val("R2_ENDPOINT"));
  if (required && !val(v.name)) problems.push(`falta ${v.name} — ${v.help}`);
}
const supa = val("NEXT_PUBLIC_SUPABASE_URL");
if (supa && !/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/.test(supa) && !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(supa)) {
  problems.push(`NEXT_PUBLIC_SUPABASE_URL não parece um projeto Supabase (${supa}). Esperado: https://<projeto>.supabase.co`);
}
const media = val("NEXT_PUBLIC_MEDIA_URL");
if (usesR2 && media && !/^https?:\/\/[^/]+/.test(media)) problems.push(`NEXT_PUBLIC_MEDIA_URL tem de começar por https:// (${media})`);
if (media.endsWith("/")) problems.push("NEXT_PUBLIC_MEDIA_URL não pode acabar em «/».");

if (!problems.length) {
  const ref = /^https:\/\/([a-z0-9-]+)\./.exec(supa)?.[1] ?? "?";
  console.log(`check-env: OK — Supabase ${ref}${usesR2 ? `, fotos em ${media}` : ", fotos no Supabase"}.`);
} else {
  const head = onNetlify ? "check-env: o build parou — faltam variáveis neste site do Netlify" : "check-env: aviso — faltam variáveis";
  console[onNetlify ? "error" : "warn"](
    `${head}:\n  - ${problems.join("\n  - ")}\n` +
      "Netlify → Site configuration → Environment variables. Guia: docs/novo-projeto.md",
  );
  if (onNetlify) process.exit(1);
}
