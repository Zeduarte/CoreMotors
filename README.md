# engineLine

Website de um stand de automóveis premium em Portugal, com **backoffice
completo** e inventário dinâmico. As animações ligadas ao scroll (estilo Apple)
do site público mantêm-se; os dados passaram de _hardcoded_ para uma base de
dados real (Supabase).

## Stack

| Camada            | Tecnologia                                       |
| ----------------- | ------------------------------------------------ |
| Framework         | Next.js 15 (App Router) + React 19 + TS estrito  |
| Estilos           | Tailwind CSS                                      |
| Animações         | GSAP + ScrollTrigger · Lenis · Framer Motion     |
| Backend / BD      | **Supabase** (Postgres + Auth + Storage)         |
| Auth / sessão     | `@supabase/ssr` (cookies) + middleware           |
| Validação         | Zod + React Hook Form                            |
| Gráficos          | Recharts                                          |
| Toasts            | Sonner                                            |
| Deploy            | **Vercel** (SSR + ISR)                            |

## Arquitetura e decisão de hosting

O site era estático (GitHub Pages). Um backoffice precisa de **autenticação,
Server Actions e dados dinâmicos**, que o Pages não suporta. Migrámos o deploy
para a **Vercel**, mantendo o GitHub como repositório:

- **Site público** — Server Components com **ISR** (`revalidate = 60`). Novas
  viaturas publicadas aparecem sem rebuild manual.
- **Backoffice** (`/admin`) — Server Actions + middleware de sessão. Rotas
  protegidas, renderização dinâmica.
- **Segurança** — imposta na base de dados por **Row Level Security (RLS)**:
  o público lê apenas viaturas `published`; a escrita exige um utilizador
  autenticado (staff). A chave anónima é segura no browser porque toda a
  autorização vive nas políticas.

### Fluxo de dados

```
Site público  ──► supabasePublic (anón, sem cookies) ──► RLS: só published
Backoffice    ──► supabase/server (cookies)         ──► RLS: staff → tudo
Server Actions──► validação Zod ──► Supabase ──► revalidatePath() do público
Uploads       ──► browser → Supabase Storage ──► registerMedia() grava metadados
```

## Setup local

### 1. Dependências

```bash
npm install
```

### 2. Criar o projeto Supabase

1. Em [supabase.com](https://supabase.com) crie um novo projeto.
2. **SQL Editor → New query** → cole e corra `supabase/migrations/0001_init.sql`.
   Cria tabelas, enums, índices, triggers, políticas RLS **e** o bucket de
   Storage `car-media` com as respetivas políticas.
3. Corra também `supabase/migrations/0002_site_content.sql` — tabela do
   conteúdo editável da página inicial (backoffice → "Página inicial").
4. (Opcional) Corra `supabase/seed.sql` para importar o inventário de exemplo.

> Alternativa com a Supabase CLI: `supabase db push` (migrations) e
> `supabase db execute -f supabase/seed.sql`.

### 3. Variáveis de ambiente

```bash
cp .env.example .env.local
```

Preencha a partir de **Supabase → Project Settings**:

| Variável                        | Onde obter                              |
| ------------------------------- | --------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Settings → Data API → Project URL       |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Settings → API Keys → `anon public`     |
| `SUPABASE_SERVICE_ROLE_KEY`     | Settings → API Keys → `service_role` \* |
| `NEXT_PUBLIC_SITE_URL`          | O domínio público do site               |

\* Secreta — só para scripts de servidor. Nunca a exponha no browser.

### 4. Criar o primeiro utilizador admin

Não há registo público. Crie o vendedor manualmente:

1. **Supabase → Authentication → Users → Add user** → defina email + password
   e marque **Auto Confirm User**.
2. O trigger `handle_new_user` cria automaticamente o `profile` (role
   `vendedor` por defeito). Para o tornar `admin`, corra no SQL Editor:

   ```sql
   update public.profiles set role = 'admin' where email = 'voce@exemplo.pt';
   ```

### 5. Correr

```bash
npm run dev        # http://localhost:3000  (site público)
                   # http://localhost:3000/admin  (backoffice → login)
npm run build      # build de produção
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint
```

## Estrutura

```
supabase/
  migrations/0001_init.sql   Schema, RLS, triggers, bucket de Storage
  seed.sql                   Inventário de exemplo (opcional)
src/
  app/
    (public)/                Site público (Header/Footer/Lenis)
      page.tsx  inventario/  viaturas/[slug]/  sobre/  contactos/
    admin/
      login/                 Login (fora da shell)
      (dashboard)/           Shell autenticada
        page.tsx             Dashboard (KPIs + gráficos)
        carros/              Lista, criar, editar (+ media)
        leads/               Gestão de leads
    layout.tsx  sitemap.ts  robots.ts
  components/
    admin/                   Sidebar, CarForm, CarsTable, MediaManager, charts…
    forms/                   ContactForm (leads público)
    hero/ home/ inventory/ vehicle/ layout/ ui/ seo/ providers/
  lib/
    supabase/                client · server · public · middleware · types
    actions/                 Server Actions (cars · media · leads · auth)
    queries.ts               Leituras públicas (server-only)
    admin-queries.ts         Leituras do backoffice + stats
    mappers.ts schemas.ts slug.ts storage.ts format.ts site.ts
  types/vehicle.ts           Modelo de domínio público
middleware.ts                Refresh de sessão + guard de /admin
```

## Deploy (Vercel)

**Caminho recomendado — integração Git nativa:**

1. [vercel.com](https://vercel.com) → **Add New… → Project** → importe o repo do
   GitHub.
2. Framework detetado: **Next.js** (sem configuração especial).
3. **Settings → Environment Variables** → adicione as mesmas variáveis do
   `.env.local` (para Production e Preview).
4. Deploy. Cada push para `main` publica automaticamente; PRs geram Preview
   Deployments.

**Alternativa — GitHub Actions:** o workflow `.github/workflows/deploy.yml`
faz deploy via Vercel CLI. Requer os secrets `VERCEL_TOKEN`, `VERCEL_ORG_ID`,
`VERCEL_PROJECT_ID`.

O workflow `.github/workflows/ci.yml` corre lint + typecheck + build em cada
push/PR.

> **Supabase Auth:** em **Authentication → URL Configuration**, adicione o
> domínio da Vercel (produção e previews) aos _Redirect URLs_ / _Site URL_.

## Checklist de testes (validação funcional)

- [ ] **Login** — `/admin` sem sessão redireciona para `/admin/login`; login
      com credenciais válidas entra no dashboard; credenciais erradas mostram erro.
- [ ] **Dashboard** — KPIs e gráficos refletem o inventário; estado vazio
      desenhado quando não há viaturas.
- [ ] **Criar viatura** — `/admin/carros/novo`, guardar → redireciona para a
      edição; validação Zod bloqueia dados inválidos (ex.: sem preço e sem
      "sob consulta").
- [ ] **Upload de fotos** — arrastar imagens no editor; definir capa; reordenar
      por drag; apagar (com confirmação). Upload de vídeo mp4/webm.
- [ ] **Publicar** — mudar estado para `published` na lista (toggle rápido).
- [ ] **Site público** — a viatura publicada aparece em `/inventario` e tem
      página própria `/viaturas/<slug>` com galeria, specs e JSON-LD.
- [ ] **Destaque** — marcar "featured" faz aparecer na homepage.
- [ ] **Filtros/pesquisa** — na lista do backoffice e no inventário público.
- [ ] **Ações em lote** — selecionar várias → publicar/despublicar/apagar.
- [ ] **Lead / contacto** — submeter o formulário de test drive (ficha) e o de
      contacto (`/contactos`) → aparece em `/admin/leads`; mudar estado do lead.
- [ ] **Segurança** — sem sessão, tentar `/admin/carros` redireciona; a API só
      devolve viaturas publicadas ao público (RLS).
- [ ] **SEO** — `/sitemap.xml` lista as viaturas publicadas; cada ficha tem
      Open Graph e `schema.org/Vehicle`.

## Decisões técnicas (site público)

Mantidas do projeto original: loop único Lenis × GSAP, hero 360º em `<canvas>`,
SplitText manual (`AnimatedText`), respeito por `prefers-reduced-motion`, e
JSON-LD por viatura. Ver histórico para detalhes.

## Versão operacional — migração 0013

CRM com responsáveis e próximas ações, reservas transacionais, custos e margens,
preparação/entrega, auditoria e permissões na base de dados. Consulte
[Ativação e validação operacional](docs/OPERATIONS.md) **antes de publicar esta versão**.
A migração 0013 substitui o comportamento de criação automática de perfis e de
inserção anónima descrito no setup original: a chave de serviço passa a ser
necessária no servidor também para os formulários públicos.

```bash
npm test           # regressões SQL/RLS, domínio e renderização dos ecrãs
npm run typecheck
npm run lint
npm run build
```

## Separação de carros e motas — migração 0019

Aplicar `supabase/migrations/0019_vehicle_worlds.sql` depois da 0018 antes de publicar esta versão. Acrescenta a categoria aos contactos, classifica os contactos ligados a viaturas existentes e mantém os restantes na lista «Contactos antigos sem tipo». A migração acrescenta também indicadores e entradas de oficina por categoria, preservando as permissões existentes.

A escolha Carros/Motas fica guardada em cookies independentes para o site público e o backoffice. Stock, destaques, vendidos, pesquisa, favoritos, comparação e sugestões respeitam a escolha pública. No backoffice, os separadores abrangem stock, oficina, finanças e contactos. Marca, equipa, integrações e definições da empresa continuam partilhadas. Os pontos de venda mantêm-se na base de dados e na edição dos anúncios; apenas o respetivo filtro visual foi removido.

Verificação local: `npm test`, `npm run typecheck`, `npm run lint` e `npm run build`. A aplicação da migração numa base de dados remota e a publicação do site são passos separados.

## Ligar a conta OLX — Callback URL

O botão «Ligar conta OLX» (`/admin/anuncios`) devolve o utilizador ao site através do **Callback URL registado na aplicação, no portal OLX Partner**. O código não envia `redirect_uri` (a firewall do OLX recusa-o com 403). Por isso o Callback URL tem de ser `https://<domínio>/api/olx/callback`. Se estiver registado `http://localhost`, o OLX volta a `localhost` no fim da autorização e o Chrome mostra `ERR_CONNECTION_REFUSED`. Para testar em local, registe `http://localhost:3000/api/olx/callback` e use `npm run dev`. `OLX_REDIRECT_URI` fica vazio, salvo se a aplicação tiver vários callbacks registados.

## Ligar o número do WhatsApp no backoffice — migração 0035

Aplicar `supabase/migrations/0035_whatsapp_connection.sql`. Em **Integrações → Ordens por WhatsApp**, o botão «Ligar número do WhatsApp» abre a janela da Meta (Embedded Signup): entra-se com o Facebook da empresa, escolhe-se a conta do WhatsApp Business e o número, e o site faz o resto — troca a autorização por um token, confirma que o número pertence à conta, subscreve as mensagens e regista o número na Cloud API (o PIN de verificação em dois passos é mostrado uma vez). O token fica numa tabela só de servidor, como os do OLX.

### Vários clientes, uma app da Meta

O engineLine instala-se um site por cliente, e **todos usam a mesma app da Meta — a do fornecedor**. As quatro variáveis da app (`WHATSAPP_APP_ID`, `WHATSAPP_CONFIG_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`) são iguais em todos os sites; o que muda é o número, que cada cliente liga no seu backoffice. Como uma app só tem um endereço de webhook, ao ligar o número o site pede à Meta que as mensagens dessa conta sejam entregues no seu próprio `/api/whatsapp` (`override_callback_uri`). A Meta valida esse endereço na hora, por isso o site tem de estar publicado em HTTPS e com o `WHATSAPP_VERIFY_TOKEN` certo antes de se carregar no botão.

Configuração da app da Meta, uma vez para todos os clientes:

1. **Casos de utilização → Adicionar → WhatsApp** (conectar com clientes através do WhatsApp).
2. **Facebook Login for Business → Modelos → «WhatsApp Embedded Signup Configuration With 60 Expiration Token»** (a criação manual não oferece a variante do Embedded Signup), com o produto *WhatsApp Cloud API*. O ID dessa configuração vai para `WHATSAPP_CONFIG_ID`; o ID da app, para `WHATSAPP_APP_ID`. O acesso que este modelo dá expira ao fim de 60 dias: o site lê a validade à Meta ao ligar, e o painel avisa nas duas últimas semanas para se voltar a ligar o número (o mesmo botão).
3. **Facebook Login for Business → Definições**: ativar *Login with the JavaScript SDK* e acrescentar o domínio de **cada** site cliente a *Allowed domains for the JavaScript SDK*.
4. **WhatsApp → Configuração → Webhook**: um endereço geral (pode ser o de um dos sites), o `WHATSAPP_VERIFY_TOKEN` e o campo *messages* subscrito. É a subscrição do campo que conta; o endereço de cada cliente vem da ligação.

Para ligar números de **outras empresas** (e não só os da empresa dona da app), a Meta exige ainda: a verificação da empresa no Business Manager, o registo como *Tech Provider* e o acesso avançado às permissões `whatsapp_business_management` e `whatsapp_business_messaging` (revisão da app). Até lá, o botão só funciona com números da própria empresa dona da app — chega para testar.

`WHATSAPP_PHONE_NUMBER_ID` e `WHATSAPP_ACCESS_TOKEN` passam a ser opcionais: só são usados quando não há nenhum número ligado no backoffice, por isso um site que já funcionava com eles não pára no deploy.
