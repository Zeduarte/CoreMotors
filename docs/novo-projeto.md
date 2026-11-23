# Um site novo para outro stand

O código é o mesmo para todos os stands. Cada stand tem as suas três coisas:

| | O quê | Onde se configura |
| --- | --- | --- |
| **Base de dados** | viaturas, contactos, utilizadores, textos | um projeto **Supabase** próprio |
| **Fotos** | fotos e vídeos das viaturas, logótipo | um bucket **Cloudflare R2** próprio |
| **Site** | o domínio e as variáveis que ligam tudo | um site **Netlify** próprio |

O que liga um site ao seu Supabase e ao seu R2 são só as **variáveis do Netlify**
desse site. Nada disto está no código. O build no Netlify **pára** se faltar uma
variável obrigatória, com a lista do que falta, por isso um site mal configurado
nunca fica publicado partido nem com os dados de outro stand.

Tempo: cerca de 1 hora. Exemplo: o stand «Auto Exemplo», domínio `autoexemplo.pt`.

---

## 1. Supabase (a base de dados)

1. [supabase.com](https://supabase.com) → **New project**.
   - Nome: `autoexemplo`. Região: **Europe (Frankfurt ou Ireland)**.
   - Guarde a palavra-passe da base de dados num sítio seguro.
2. **SQL Editor** → **New query** → cole o ficheiro inteiro
   [`supabase/INSTALAR_projeto_novo.sql`](../supabase/INSTALAR_projeto_novo.sql) → **Run**.
   Cria tudo de uma vez: tabelas, regras de segurança e o espaço das fotos.
3. **Authentication** → **Sign In / Providers** → **Email**: desligue
   **«Allow new users to sign up»**. As contas criam-se no backoffice, em
   Utilizadores. Assim ninguém de fora cria uma conta.
4. **Authentication** → **Users** → **Add user** → **Create new user**:
   - o email e uma palavra-passe do dono;
   - marque **Auto Confirm User**.
5. **SQL Editor** → **New query**:
   ```sql
   select public.setup_owner('email-do-dono@autoexemplo.pt');
   ```
   Essa conta passa a ser o **acesso core**: administrador, dono da conta, e
   entra com o nome de utilizador **Core**.
6. Guarde, de **Project Settings**:
   - **Data API → Project URL**: `https://<projeto>.supabase.co`
   - **API Keys → Publishable key** (`sb_publishable_…`)
   - **API Keys → Secret key** (`sb_secret_…`). É secreta: só vai para o Netlify.

## 2. Domínio e Cloudflare R2 (as fotos)

O endereço das fotos (`fotos.autoexemplo.pt`) só se liga ao bucket se o domínio
estiver na **mesma conta Cloudflare** que o bucket.

1. Cloudflare → **Add a domain** → `autoexemplo.pt` → plano **Free**.
   - Confirme os registos que a Cloudflare importou.
   - Os do site ficam com a nuvem **cinzenta** (DNS only).
   - No registador do domínio (Hostinger, PTisp…), troque os **nameservers**
     pelos 2 que a Cloudflare indicar. Espere até o domínio aparecer como **Active**.
2. **R2** → **Create bucket** → `autoexemplo-fotos`, localização automática.
3. No bucket → **Settings**:
   - **Custom Domains** → **Connect Domain** → `fotos.autoexemplo.pt`.
   - **CORS Policy** → cole (com o domínio do stand):
     ```json
     [
       {
         "AllowedOrigins": ["https://autoexemplo.pt", "https://www.autoexemplo.pt"],
         "AllowedMethods": ["GET", "HEAD", "PUT"],
         "AllowedHeaders": ["*"],
         "MaxAgeSeconds": 3600
       }
     ]
     ```
4. **R2** → **Manage API Tokens** → **Create API Token**:
   - permissão **Object Read & Write**;
   - só o bucket `autoexemplo-fotos`.

   Guarde o **Access Key ID**, o **Secret Access Key** (só aparece uma vez) e o
   **Account ID** (na página do R2).

## 3. Netlify (o site)

1. Netlify → **Add new site** → **Import an existing project** → GitHub →
   repositório `CoreMotors`.
   - **Branch**: a mesma de produção dos outros stands (hoje `core/supermotas`).
     Todos os stands correm o mesmo código: uma melhoria chega a todos.
   - Build command e publish directory já vêm do `netlify.toml`, não mude.
2. **Antes do primeiro deploy**: **Site configuration** → **Environment
   variables** → acrescente:

   | Variável | Valor |
   | --- | --- |
   | `NEXT_PUBLIC_SUPABASE_URL` | Project URL do passo 1.6 |
   | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Publishable key |
   | `SUPABASE_SERVICE_ROLE_KEY` | Secret key (marcar «Contains secret values») |
   | `NEXT_PUBLIC_SITE_URL` | `https://autoexemplo.pt` |
   | `MAINTENANCE_SECRET` | um texto aleatório longo (secret) |
   | `TRUSTED_CLIENT_IP_HEADER` | `x-nf-client-connection-ip` |
   | `R2_ACCOUNT_ID` | Account ID |
   | `R2_ACCESS_KEY_ID` | Access Key ID (secret) |
   | `R2_SECRET_ACCESS_KEY` | Secret Access Key (secret) |
   | `R2_BUCKET` | `autoexemplo-fotos` |
   | `NEXT_PUBLIC_MEDIA_URL` | `https://fotos.autoexemplo.pt` (sem `/` no fim) |

   Opcionais: assistente (`ANTHROPIC_API_KEY`), WhatsApp, OLX, Google. A lista
   completa, e onde se encontra cada uma, está em
   [`src/config/env-vars.json`](../src/config/env-vars.json) e em `.env.example`.
3. **Deploys** → **Trigger deploy**. Se faltar alguma variável, o log do build
   diz qual («check-env: o build parou…»).
4. **Domain management** → **Add a domain** → `autoexemplo.pt`. Na Cloudflare,
   crie os registos que o Netlify indicar, com a nuvem **cinzenta**:
   - `A` `@` → `75.2.60.5`
   - `CNAME` `www` → `<site>.netlify.app`

## 4. Primeiro login e dados do stand

1. Abra `https://autoexemplo.pt/admin` → nome de utilizador **Core** + a
   palavra-passe do passo 1.4. Pode mudá-la em **Perfil → Palavra-passe**.
2. **Gestão → Configuração deste site**: confirme que mostra o projeto Supabase
   e o endereço das fotos **deste** stand, e que não falta nada.
3. **Gestão → Fotos → Testar ligação**: tudo com ✓.
4. **Definições**:
   - tipo de site (carros, motas ou os dois);
   - nome e logótipo, cores;
   - WhatsApp;
   - **Identificação legal**: nome legal, NIF e, se o stand for intermediário
     de crédito, o PDF da ficha do Banco de Portugal.
5. **Página inicial → Pontos de venda**: morada, telefone, email, horário.
6. **Gestão → Versão do site**: Core (genérica). A Core2 tem fotos da Supermotas.
7. **Utilizadores**: crie as contas da equipa. Cada pessoa recebe um link para
   definir a palavra-passe.

---

## O que NUNCA fazer

- **Pôr endereços ou chaves no `netlify.toml`.** Esse ficheiro é igual em todos
  os sites e passa à frente das variáveis do painel: todos os stands ficavam
  ligados à mesma base de dados.
- **Partilhar um projeto Supabase ou um bucket entre stands.** Os dados e as
  fotos misturavam-se.
- **Correr o `INSTALAR_projeto_novo.sql` numa base de dados com dados.** Use-o só
  em projetos acabados de criar. Numa base existente aplique só as migrações em
  falta, que o `VERIFICAR_migracoes.sql` indica.

## Para quem mexe no código

- Migração nova: crie `supabase/migrations/00NN_nome.sql`, acrescente a linha
  dela ao `VERIFICAR_migracoes.sql`, e corra `npm run sql:instalar` para
  atualizar o ficheiro de instalação. Os testes falham se esquecer algum destes.
  Depois aplique a migração na base de dados de **cada** stand.
- Variável nova: acrescente-a a `src/config/env-vars.json` e ao `.env.example`.
- Dados de um stand (nome, contactos, textos legais) vão para a base de dados,
  nas Definições, nunca para o código.
