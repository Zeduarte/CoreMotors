// Verifica os endereços das duas bases antes da cópia (ação «Copiar base de
// dados»), para que um engano ao colar o segredo dê uma mensagem clara em vez
// de um erro do PostgreSQL. Nunca mostra a palavra-passe.
//
//   ORIGEM_DB_URL=… DESTINO_DB_URL=… node scripts/verificar-enderecos-supabase.mjs
import { existsSync, readFileSync } from "node:fs";

/** Analisa um endereço de base Supabase: projeto, servidor e enganos comuns. */
export function checkDbUrl(raw) {
  const problems = [];
  const value = String(raw ?? "");
  if (!value) return { problems: ["está vazio"] };
  const text = value.trim();
  if (text !== value) problems.push("tem espaços ou uma mudança de linha no início ou no fim (apague-os)");
  if (!/^postgres(ql)?:\/\//.test(text)) {
    problems.push("não começa por postgresql:// (copie o endereço inteiro do Session pooler)");
    return { problems };
  }
  let url;
  try {
    url = new URL(text);
  } catch {
    problems.push("não é um endereço válido (copie-o outra vez do Session pooler)");
    return { problems };
  }
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  const host = url.hostname;
  const port = url.port || "5432";

  if (/YOUR-PASSWORD/i.test(password) || /YOUR-PASSWORD/i.test(text)) problems.push("ainda tem [YOUR-PASSWORD]: troque-o pela palavra-passe da base");
  else if (!password) problems.push("não tem palavra-passe (entre os dois pontos e o @)");
  else if (/[[\]]/.test(password)) problems.push("a palavra-passe tem parênteses retos [ ] à volta: tire-os");
  else if (!/^[A-Za-z0-9]+$/.test(password)) problems.push("a palavra-passe tem símbolos ou espaços: crie uma só com letras e números (Reset database password)");

  const direct = host.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  const ref = user.match(/^postgres\.([a-z0-9]+)$/)?.[1] ?? direct?.[1] ?? null;
  if (direct) problems.push("é o endereço da «Direct connection»: use o do «Session pooler» (acaba em pooler.supabase.com)");
  else if (!host.endsWith(".pooler.supabase.com")) problems.push(`o servidor (${host}) não é do Supabase: use o endereço do «Session pooler»`);
  else if (port === "6543") problems.push("é o «Transaction pooler» (porta 6543): use o «Session pooler» (porta 5432)");
  if (!direct && !ref) problems.push(`o utilizador devia ser postgres.<projeto>, e é «${user}»`);

  return { ref, host, port, problems };
}

/** O projeto que o site usa (NEXT_PUBLIC_SUPABASE_URL do netlify.toml), se houver. */
export function siteProjectRef(toml) {
  return toml.match(/NEXT_PUBLIC_SUPABASE_URL\s*=\s*"https:\/\/([a-z0-9]+)\.supabase\.co/)?.[1] ?? null;
}

function main() {
  const site = existsSync("netlify.toml") ? siteProjectRef(readFileSync("netlify.toml", "utf8")) : null;
  const sides = { ORIGEM: "projeto atual", DESTINO: "projeto novo" };
  const found = {};
  let ok = true;
  for (const [side, label] of Object.entries(sides)) {
    const r = checkDbUrl(process.env[`${side}_DB_URL`]);
    found[side] = r;
    const where = r.ref ? `projeto ${r.ref}, servidor ${r.host}:${r.port}` : "—";
    console.log(`${side} (${label}): ${where}`);
    for (const p of r.problems) {
      console.log(`::error::SUPABASE_${side}_DB_URL ${p}.`);
      ok = false;
    }
  }
  if (found.ORIGEM.ref && found.ORIGEM.ref === found.DESTINO.ref) {
    console.log("::error::Os dois endereços são do mesmo projeto Supabase.");
    ok = false;
  }
  if (site && found.DESTINO.ref === site) {
    console.log(`::error::SUPABASE_DESTINO_DB_URL é o projeto que o site usa (${site}). Os segredos ORIGEM e DESTINO estão trocados?`);
    ok = false;
  } else if (site && found.ORIGEM.ref && found.ORIGEM.ref !== site) {
    console.log(`::error::SUPABASE_ORIGEM_DB_URL é o projeto ${found.ORIGEM.ref}, mas o site usa o ${site}. A origem tem de ser o projeto do site.`);
    ok = false;
  }
  if (!ok) process.exit(1);
  console.log("Endereços com bom aspeto ✔");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
