// Gera supabase/INSTALAR_projeto_novo.sql: todas as migrações, por ordem, num
// só ficheiro, para instalar a base de dados de um stand novo de uma vez
// (Supabase → SQL Editor → colar → Run). Ver docs/novo-projeto.md.
//
// Uso: node scripts/sql-instalar.mjs   (depois de criar uma migração nova)
// tests/novo-projeto.test.mjs falha se o ficheiro estiver desatualizado.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const DIR = new URL("../supabase/migrations/", import.meta.url);
export const OUT = new URL("../supabase/INSTALAR_projeto_novo.sql", import.meta.url);

export function migrationFiles() {
  return readdirSync(DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
}

export function buildInstallSql() {
  const files = migrationFiles();
  const last = files.at(-1).slice(0, 4);
  const head = `-- ===========================================================================
-- INSTALAR_projeto_novo.sql — base de dados de um stand NOVO (0001 → ${last})
--
-- GERADO por scripts/sql-instalar.mjs a partir de supabase/migrations/.
-- Não editar à mão: crie uma migração nova e corra o script.
--
-- Só para um projeto Supabase acabado de criar (vazio). Numa base de dados
-- que já está a funcionar, aplique só as migrações em falta
-- (VERIFICAR_migracoes.sql diz quais).
--
-- Como usar:
--   1. Supabase → SQL Editor → New query → colar este ficheiro inteiro → Run.
--   2. Authentication → Users → Add user → Create new user (o email e a
--      palavra-passe do dono; marcar «Auto Confirm User»).
--   3. SQL Editor → New query:
--        select public.setup_owner('email-do-dono@exemplo.pt');
--      Essa conta passa a ser o acesso core: entra no backoffice com o nome
--      de utilizador «Core» e a palavra-passe do passo 2.
--   Passo a passo completo: docs/novo-projeto.md
-- ===========================================================================
`;
  const body = files
    .map((f) => {
      const sql = readFileSync(new URL(f, DIR), "utf8").trimEnd();
      // `commit;` no fim de cada uma: o SQL Editor corre o ficheiro todo como uma
      // só transação, e um valor novo de um tipo (ALTER TYPE … ADD VALUE) só se
      // pode usar depois de gravado — as migrações seguintes usam-nos.
      return `\n-- ---------------------------------------------------------------------------\n-- ${f}\n-- ---------------------------------------------------------------------------\n${sql}\ncommit;\n`;
    })
    .join("");
  return `${head}${body}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  writeFileSync(OUT, buildInstallSql());
  console.log(`supabase/INSTALAR_projeto_novo.sql: ${migrationFiles().length} migrações.`);
}
