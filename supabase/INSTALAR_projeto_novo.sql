-- ===========================================================================
-- INSTALAR_projeto_novo.sql — base de dados de um stand NOVO (0001 → 0057)
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

-- ---------------------------------------------------------------------------
-- 0001_init.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- CoreMotors — Schema inicial (Supabase / Postgres)
-- Tabelas: profiles, cars, car_media, leads
-- Inclui: enums, índices, RLS, triggers de updated_at, trigger de novo utilizador
-- Correr no SQL Editor do Supabase (ou via `supabase db push`).
-- ============================================================================

-- Extensões -----------------------------------------------------------------
create extension if not exists "pgcrypto"; -- gen_random_uuid()

-- ============================================================================
-- ENUMS
-- ============================================================================
do $$ begin
  create type public.user_role   as enum ('admin', 'vendedor');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.fuel_type   as enum ('Gasolina', 'Diesel', 'Híbrido', 'Híbrido Plug-in', 'Elétrico', 'GPL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.transmission as enum ('Manual', 'Automática');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.body_type   as enum ('Berlina', 'SUV', 'Coupé', 'Carrinha', 'Citadino', 'Descapotável', 'Monovolume');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.car_status  as enum ('draft', 'published', 'reserved', 'sold');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.media_kind  as enum ('image', 'video');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_kind   as enum ('contact', 'test_drive', 'finance');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_status as enum ('new', 'contacted', 'closed');
exception when duplicate_object then null; end $$;

-- ============================================================================
-- FUNÇÃO: updated_at automático
-- ============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================================
-- TABELA: profiles  (1:1 com auth.users, guarda o role)
-- ============================================================================
create table if not exists public.profiles (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  full_name  text,
  role       public.user_role not null default 'vendedor',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cria automaticamente um profile quando nasce um utilizador no auth.users.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce((new.raw_user_meta_data->>'role')::public.user_role, 'vendedor')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Helper: o utilizador autenticado é membro do staff (existe profile)?
create or replace function public.is_staff()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid());
$$;

-- ============================================================================
-- TABELA: cars
-- ============================================================================
create table if not exists public.cars (
  id                uuid primary key default gen_random_uuid(),
  slug              text not null unique,

  -- Identificação
  make              text not null,
  model             text not null,
  variant           text,
  year              int  not null check (year between 1950 and 2100),
  license_plate     text,                         -- privado (não exposto ao público)

  -- Mecânica
  mileage           int  not null default 0 check (mileage >= 0),
  fuel              public.fuel_type    not null,
  transmission      public.transmission not null,
  body              public.body_type    not null,
  power             int  not null default 0 check (power >= 0),   -- cv
  displacement      int  not null default 0 check (displacement >= 0), -- cm³
  color             text,
  doors             int  not null default 5 check (doors between 1 and 9),
  seats             int  not null default 5 check (seats between 1 and 9),

  -- Comercial
  price             int  check (price is null or price >= 0),     -- euros; null = sob consulta
  price_on_request  boolean not null default false,
  status            public.car_status not null default 'draft',
  featured          boolean not null default false,

  -- Conteúdo
  tagline           text,
  description        text,
  extras            text[] not null default '{}',                 -- equipamento / extras
  location          text,                                         -- stand / localização
  highlights        jsonb  not null default '[]'::jsonb,          -- [{label,value}] opcional

  -- Auditoria
  created_by        uuid references public.profiles(id) on delete set null,
  published_at      timestamptz,
  sold_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists idx_cars_status      on public.cars (status);
create index if not exists idx_cars_featured     on public.cars (featured) where featured;
create index if not exists idx_cars_make         on public.cars (make);
create index if not exists idx_cars_fuel         on public.cars (fuel);
create index if not exists idx_cars_price        on public.cars (price);
create index if not exists idx_cars_created_at   on public.cars (created_at desc);
create index if not exists idx_cars_status_pub   on public.cars (status, published_at desc);

drop trigger if exists trg_cars_updated_at on public.cars;
create trigger trg_cars_updated_at
  before update on public.cars
  for each row execute function public.set_updated_at();

-- Marca de tempo de publicação/venda ao mudar de estado.
create or replace function public.cars_status_timestamps()
returns trigger
language plpgsql
as $$
begin
  if new.status = 'published' and (old.status is distinct from 'published') and new.published_at is null then
    new.published_at := now();
  end if;
  if new.status = 'sold' and (old.status is distinct from 'sold') then
    new.sold_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_cars_status_ts on public.cars;
create trigger trg_cars_status_ts
  before insert or update on public.cars
  for each row execute function public.cars_status_timestamps();

-- ============================================================================
-- TABELA: car_media  (fotos e vídeos, ordenáveis, com capa)
-- ============================================================================
create table if not exists public.car_media (
  id           uuid primary key default gen_random_uuid(),
  car_id       uuid not null references public.cars(id) on delete cascade,
  kind         public.media_kind not null default 'image',
  storage_path text not null,                         -- caminho no bucket 'car-media'
  alt          text not null default '',
  position     int  not null default 0,               -- ordem na galeria
  is_cover     boolean not null default false,
  width        int,
  height       int,
  created_at   timestamptz not null default now()
);

create index if not exists idx_car_media_car on public.car_media (car_id, position);
-- No máximo uma capa por carro.
create unique index if not exists uniq_car_media_cover
  on public.car_media (car_id) where is_cover;

-- ============================================================================
-- TABELA: leads  (pedidos de contacto / test drive por anúncio)
-- ============================================================================
create table if not exists public.leads (
  id             uuid primary key default gen_random_uuid(),
  car_id         uuid references public.cars(id) on delete set null,
  car_label      text,                                 -- snapshot do carro (caso seja apagado)
  kind           public.lead_kind   not null default 'contact',
  status         public.lead_status not null default 'new',
  name           text not null,
  email          text not null,
  phone          text,
  message        text,
  preferred_date date,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_leads_status     on public.leads (status);
create index if not exists idx_leads_created_at  on public.leads (created_at desc);
create index if not exists idx_leads_car         on public.leads (car_id);

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
alter table public.profiles  enable row level security;
alter table public.cars      enable row level security;
alter table public.car_media enable row level security;
alter table public.leads     enable row level security;

-- ---- profiles --------------------------------------------------------------
drop policy if exists "profiles: self read"    on public.profiles;
create policy "profiles: self read"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: self update"  on public.profiles;
create policy "profiles: self update"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- ---- cars ------------------------------------------------------------------
-- Leitura pública apenas de publicados; staff lê tudo.
drop policy if exists "cars: public read published" on public.cars;
create policy "cars: public read published"
  on public.cars for select
  using (status = 'published' or public.is_staff());

-- Escrita apenas por staff autenticado.
drop policy if exists "cars: staff insert" on public.cars;
create policy "cars: staff insert"
  on public.cars for insert to authenticated
  with check (public.is_staff());

drop policy if exists "cars: staff update" on public.cars;
create policy "cars: staff update"
  on public.cars for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "cars: staff delete" on public.cars;
create policy "cars: staff delete"
  on public.cars for delete to authenticated
  using (public.is_staff());

-- ---- car_media -------------------------------------------------------------
drop policy if exists "car_media: public read published" on public.car_media;
create policy "car_media: public read published"
  on public.car_media for select
  using (
    public.is_staff()
    or exists (select 1 from public.cars c where c.id = car_id and c.status = 'published')
  );

drop policy if exists "car_media: staff write" on public.car_media;
create policy "car_media: staff write"
  on public.car_media for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- ---- leads -----------------------------------------------------------------
-- Qualquer visitante pode criar um lead (formulário público).
drop policy if exists "leads: public insert" on public.leads;
create policy "leads: public insert"
  on public.leads for insert to anon, authenticated
  with check (true);

-- Só o staff lê / gere leads.
drop policy if exists "leads: staff read"   on public.leads;
create policy "leads: staff read"
  on public.leads for select to authenticated
  using (public.is_staff());

drop policy if exists "leads: staff update" on public.leads;
create policy "leads: staff update"
  on public.leads for update to authenticated
  using (public.is_staff()) with check (public.is_staff());

drop policy if exists "leads: staff delete" on public.leads;
create policy "leads: staff delete"
  on public.leads for delete to authenticated
  using (public.is_staff());

-- ============================================================================
-- STORAGE: bucket 'car-media' (público para leitura, escrita só staff)
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('car-media', 'car-media', true)
on conflict (id) do nothing;

drop policy if exists "car-media: public read" on storage.objects;
create policy "car-media: public read"
  on storage.objects for select
  using (bucket_id = 'car-media');

drop policy if exists "car-media: staff insert" on storage.objects;
create policy "car-media: staff insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'car-media' and public.is_staff());

drop policy if exists "car-media: staff update" on storage.objects;
create policy "car-media: staff update"
  on storage.objects for update to authenticated
  using (bucket_id = 'car-media' and public.is_staff());

drop policy if exists "car-media: staff delete" on storage.objects;
create policy "car-media: staff delete"
  on storage.objects for delete to authenticated
  using (bucket_id = 'car-media' and public.is_staff());
commit;

-- ---------------------------------------------------------------------------
-- 0002_site_content.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- CoreMotors — Conteúdo editável de páginas (ex.: página inicial)
-- Tabela key→jsonb, leitura pública, escrita só staff. Correr no SQL Editor.
-- ============================================================================

create table if not exists public.site_content (
  key        text primary key,
  content    jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_site_content_updated_at on public.site_content;
create trigger trg_site_content_updated_at
  before update on public.site_content
  for each row execute function public.set_updated_at();

alter table public.site_content enable row level security;

-- Leitura pública (o site precisa de ler os textos).
drop policy if exists "site_content: public read" on public.site_content;
create policy "site_content: public read"
  on public.site_content for select
  using (true);

-- Escrita apenas por staff autenticado.
drop policy if exists "site_content: staff write" on public.site_content;
create policy "site_content: staff write"
  on public.site_content for all to authenticated
  using (public.is_staff()) with check (public.is_staff());

-- Linha inicial vazia para a página inicial (os defaults do código preenchem
-- tudo o que não estiver definido aqui — a homepage fica idêntica ao original).
insert into public.site_content (key, content)
values ('home', '{}'::jsonb)
on conflict (key) do nothing;
commit;

-- ---------------------------------------------------------------------------
-- 0003_roles_branding.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- CoreMotors — Permissões (admin vs vendedor) + Branding do site
-- Correr no SQL Editor DEPOIS de 0001 e 0002.
-- ============================================================================

-- Helper: o utilizador autenticado é admin?
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

-- ---- profiles: admins gerem todos os perfis ------------------------------
drop policy if exists "profiles: admin read all" on public.profiles;
create policy "profiles: admin read all"
  on public.profiles for select to authenticated
  using (public.is_admin());

drop policy if exists "profiles: admin update all" on public.profiles;
create policy "profiles: admin update all"
  on public.profiles for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "profiles: admin delete" on public.profiles;
create policy "profiles: admin delete"
  on public.profiles for delete to authenticated
  using (public.is_admin());

-- ============================================================================
-- TABELA: site_settings (marca do site — linha única)
-- ============================================================================
create table if not exists public.site_settings (
  id           smallint primary key default 1,
  company_name text not null default 'CoreMotors',
  logo_url     text,
  tagline      text,
  accent       text not null default '#E8B15A',
  accent_soft  text not null default '#C8934A',
  updated_at   timestamptz not null default now(),
  constraint site_settings_single_row check (id = 1)
);

-- Se a tabela já existia sem as colunas de cor, acrescenta-as.
alter table public.site_settings add column if not exists accent text not null default '#E8B15A';
alter table public.site_settings add column if not exists accent_soft text not null default '#C8934A';

insert into public.site_settings (id, company_name)
values (1, 'CoreMotors')
on conflict (id) do nothing;

drop trigger if exists trg_site_settings_updated_at on public.site_settings;
create trigger trg_site_settings_updated_at
  before update on public.site_settings
  for each row execute function public.set_updated_at();

alter table public.site_settings enable row level security;

-- Leitura pública (o site mostra o nome/logo a todos).
drop policy if exists "site_settings: public read" on public.site_settings;
create policy "site_settings: public read"
  on public.site_settings for select
  using (true);

-- Escrita APENAS por admin (nome/logo é gerido só pelo admin).
drop policy if exists "site_settings: admin write" on public.site_settings;
create policy "site_settings: admin write"
  on public.site_settings for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
commit;

-- ---------------------------------------------------------------------------
-- 0004_leads_crm.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- CoreMotors — CRM de leads (Fase 1)
-- Novos tipos de lead (retoma, encomenda), estados de pipeline, notas e
-- detalhes do carro do cliente. Correr no SQL Editor DEPOIS de 0001–0003.
--
-- Nota: `ALTER TYPE ... ADD VALUE` não pode ser usado na MESMA transação em que
-- o valor é utilizado. Este script apenas adiciona valores e colunas — seguro.
-- ============================================================================

-- Novos tipos de lead
alter type public.lead_kind add value if not exists 'trade_in';
alter type public.lead_kind add value if not exists 'order';

-- Novos estados do pipeline (mantém 'new','contacted','closed' já existentes)
alter type public.lead_status add value if not exists 'proposal';
alter type public.lead_status add value if not exists 'won';
alter type public.lead_status add value if not exists 'lost';

-- Notas internas + detalhes estruturados (ex.: carro de retoma / encomenda)
alter table public.leads add column if not exists notes text;
alter table public.leads
  add column if not exists car_details jsonb not null default '{}'::jsonb;
commit;

-- ---------------------------------------------------------------------------
-- 0005_trust.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- CoreMotors — Confiança & transparência (Fase 2)
-- Campos de transparência nas viaturas, visibilidade de reservados/vendidos,
-- e tabela de testemunhos. Correr no SQL Editor DEPOIS de 0001–0004.
-- ============================================================================

-- ---- Campos de transparência / badges nas viaturas ------------------------
alter table public.cars add column if not exists previous_price int;   -- p/ "Baixa de preço"
alter table public.cars add column if not exists national boolean not null default false;
alter table public.cars add column if not exists owners int;           -- nº de donos
alter table public.cars add column if not exists first_owner boolean not null default false;
alter table public.cars add column if not exists service_book boolean not null default false; -- livro de revisões
alter table public.cars add column if not exists warranty_months int;  -- garantia (meses)
alter table public.cars add column if not exists last_inspection date; -- última inspeção

-- ---- Tornar reservados/vendidos visíveis no site (para os badges) ----------
drop policy if exists "cars: public read published" on public.cars;
create policy "cars: public read published"
  on public.cars for select
  using (status in ('published','reserved','sold') or public.is_staff());

drop policy if exists "car_media: public read published" on public.car_media;
create policy "car_media: public read published"
  on public.car_media for select
  using (
    public.is_staff()
    or exists (
      select 1 from public.cars c
      where c.id = car_id and c.status in ('published','reserved','sold')
    )
  );

-- ============================================================================
-- TABELA: testimonials (avaliações de clientes)
-- ============================================================================
create table if not exists public.testimonials (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  rating     smallint not null default 5 check (rating between 1 and 5),
  body       text not null,
  role       text,                       -- ex.: "Comprou um BMW M4"
  published  boolean not null default true,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_testimonials_pub
  on public.testimonials (published, position);

drop trigger if exists trg_testimonials_updated_at on public.testimonials;
create trigger trg_testimonials_updated_at
  before update on public.testimonials
  for each row execute function public.set_updated_at();

alter table public.testimonials enable row level security;

drop policy if exists "testimonials: public read" on public.testimonials;
create policy "testimonials: public read"
  on public.testimonials for select
  using (published or public.is_staff());

drop policy if exists "testimonials: staff write" on public.testimonials;
create policy "testimonials: staff write"
  on public.testimonials for all to authenticated
  using (public.is_staff()) with check (public.is_staff());
commit;

-- ---------------------------------------------------------------------------
-- 0006_growth.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- CoreMotors — Crescimento (Fases 3 & 4)
--   • Estatísticas de visitas às viaturas (car_views) — dashboard analítica
--   • Reservas com sinal (novo tipo de lead + definições de sinal)
--   • Exportação multi-canal (canais por viatura + credenciais das plataformas)
--   • Marketing/consentimento (GA4, Meta Pixel) e reservas nas definições
--
-- Correr no SQL Editor DEPOIS de 0001–0005. Todas as instruções são
-- idempotentes (podem correr mais do que uma vez sem erro).
-- ============================================================================

-- ---- Novo tipo de lead: reserva --------------------------------------------
-- (ADD VALUE é seguro isolado; o valor só é usado fora desta transação.)
alter type public.lead_kind add value if not exists 'reservation';

-- ---- Canais de publicação por viatura --------------------------------------
-- Ex.: {'standvirtual','olx','custojusto'} — usado nos feeds de exportação.
alter table public.cars
  add column if not exists channels text[] not null default '{}'::text[];

-- ---- Definições de marketing / reservas ------------------------------------
alter table public.site_settings add column if not exists ga4_id text;
alter table public.site_settings add column if not exists pixel_id text;
alter table public.site_settings
  add column if not exists reservation_enabled boolean not null default false;
alter table public.site_settings
  add column if not exists deposit_amount int not null default 500;

-- ============================================================================
-- TABELA: car_views (uma linha por visita à ficha de uma viatura)
-- ============================================================================
create table if not exists public.car_views (
  id         bigint generated always as identity primary key,
  car_id     uuid references public.cars(id) on delete cascade,
  slug       text,
  session    text,                          -- hash anónimo (sem dados pessoais)
  created_at timestamptz not null default now()
);

create index if not exists idx_car_views_car on public.car_views (car_id);
create index if not exists idx_car_views_created on public.car_views (created_at);

alter table public.car_views enable row level security;

-- Qualquer visitante pode registar uma visita (insert), mas nunca ler.
drop policy if exists "car_views: public insert" on public.car_views;
create policy "car_views: public insert"
  on public.car_views for insert
  with check (true);

-- Apenas o staff consulta as estatísticas.
drop policy if exists "car_views: staff read" on public.car_views;
create policy "car_views: staff read"
  on public.car_views for select
  using (public.is_staff());

-- ============================================================================
-- TABELA: integration_secrets (credenciais das plataformas + pagamentos)
-- Linha única (id = 1). Dados sensíveis — só administradores leem/escrevem.
-- Guarda um JSON: { standvirtual: {user, token}, stripe: {secret}, ... }
-- ============================================================================
create table if not exists public.integration_secrets (
  id         smallint primary key default 1 check (id = 1),
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

insert into public.integration_secrets (id, data)
  values (1, '{}'::jsonb)
  on conflict (id) do nothing;

drop trigger if exists trg_integration_secrets_updated_at on public.integration_secrets;
create trigger trg_integration_secrets_updated_at
  before update on public.integration_secrets
  for each row execute function public.set_updated_at();

alter table public.integration_secrets enable row level security;

drop policy if exists "integration_secrets: admin read" on public.integration_secrets;
create policy "integration_secrets: admin read"
  on public.integration_secrets for select
  using (public.is_admin());

drop policy if exists "integration_secrets: admin write" on public.integration_secrets;
create policy "integration_secrets: admin write"
  on public.integration_secrets for all to authenticated
  using (public.is_admin()) with check (public.is_admin());
commit;

-- ---------------------------------------------------------------------------
-- 0007_company.sql
-- ---------------------------------------------------------------------------
-- ===========================================================================
-- 0007_company.sql
-- Dados de contacto/empresa editáveis no backoffice (linha única id=1 da
-- tabela site_settings). Todos opcionais: se ficarem a NULL, o site usa os
-- valores por defeito de `src/lib/site.ts`.
-- ===========================================================================

alter table public.site_settings add column if not exists phone text;
alter table public.site_settings add column if not exists email text;
alter table public.site_settings add column if not exists whatsapp text;
alter table public.site_settings add column if not exists address_street text;
alter table public.site_settings add column if not exists address_city text;
alter table public.site_settings add column if not exists address_postal text;
alter table public.site_settings add column if not exists address_country text;
alter table public.site_settings add column if not exists hours text;
alter table public.site_settings add column if not exists geo_lat double precision;
alter table public.site_settings add column if not exists geo_lng double precision;
commit;

-- ---------------------------------------------------------------------------
-- 0008_public_submissions.sql
-- ---------------------------------------------------------------------------
-- ===========================================================================
-- 0008_public_submissions.sql
-- (1) Novo tipo de lead: "offer" (proposta de preço numa viatura).
-- (2) Submissão PÚBLICA de testemunhos: qualquer visitante pode inserir um
--     testemunho, mas SEMPRE por publicar (published = false). Só o staff o
--     pode aprovar (tornar published = true) — a política de escrita do staff
--     já existe (0005). Assim, nada aparece no site sem aprovação.
-- ===========================================================================

-- (1) ----------------------------------------------------------------------
alter type public.lead_kind add value if not exists 'offer';

-- (2) ----------------------------------------------------------------------
-- Inserção anónima permitida apenas quando published = false (fica pendente).
drop policy if exists "testimonials: public submit" on public.testimonials;
create policy "testimonials: public submit"
  on public.testimonials for insert
  to anon
  with check (published = false);
commit;

-- ---------------------------------------------------------------------------
-- 0009_roles_permissions.sql
-- ---------------------------------------------------------------------------
-- ===========================================================================
-- 0009_roles_permissions.sql
-- Hierarquia de papéis (admin > chefe > vendedor) e permissões por separador.
--  - Adiciona o papel "chefe".
--  - `allowed_sections`: lista de separadores do backoffice a que o utilizador
--    tem acesso. NULL = usar os defaults do papel (ver src/lib/permissions.ts).
--    O admin vê sempre tudo (este campo é ignorado para admin).
-- ===========================================================================

alter type public.user_role add value if not exists 'chefe';

alter table public.profiles
  add column if not exists allowed_sections text[];
commit;

-- ---------------------------------------------------------------------------
-- 0010_messenger.sql
-- ---------------------------------------------------------------------------
-- ===========================================================================
-- 0010_messenger.sql
-- Link do Facebook Messenger da empresa (ex.: https://m.me/aminhapagina).
-- Usado no botão flutuante de contacto (WhatsApp + Messenger).
-- ===========================================================================

alter table public.site_settings add column if not exists messenger text;
commit;

-- ---------------------------------------------------------------------------
-- 0011_lead_alert.sql
-- ---------------------------------------------------------------------------
-- 0011_lead_alert.sql
-- Novo tipo de lead: "alert" — pedidos de "avise-me quando entrar" feitos por
-- visitantes que procuram uma viatura que ainda não está em stock.
alter type public.lead_kind add value if not exists 'alert';
commit;

-- ---------------------------------------------------------------------------
-- 0012_mechanic.sql
-- ---------------------------------------------------------------------------
-- ===========================================================================
-- 0012_mechanic.sql
-- Papel "mecanico" + registo de HORAS de oficina por viatura.
--
--  - O mecânico vê todas as viaturas (via is_staff) mas só o separador
--    "Oficina".
--  - Cada registo tem data + hora de início + hora de fim; as horas são
--    calculadas. Liga-se à viatura por car_id (a viatura guarda a matrícula
--    única em license_plate).
-- ===========================================================================

-- ALTER TYPE ... ADD VALUE tem de ser instrução isolada no editor SQL.
alter type public.user_role add value if not exists 'mecanico';

create table if not exists public.vehicle_tasks (
  id          uuid primary key default gen_random_uuid(),
  car_id      uuid not null references public.cars(id) on delete cascade,
  work_date   date not null default current_date,
  start_time  time not null,
  end_time    time,
  description text,
  hours       numeric(6,2) not null default 0 check (hours >= 0),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- Compatibilidade: se uma versão anterior (com title/done/notes) já existir,
-- ajusta as colunas para o novo formato de registo de horas.
alter table public.vehicle_tasks add column if not exists work_date  date not null default current_date;
alter table public.vehicle_tasks add column if not exists start_time time;
alter table public.vehicle_tasks add column if not exists end_time   time;
alter table public.vehicle_tasks add column if not exists description text;
alter table public.vehicle_tasks drop column if exists title;
alter table public.vehicle_tasks drop column if exists done;
alter table public.vehicle_tasks drop column if exists notes;

create index if not exists vehicle_tasks_car_id_idx
  on public.vehicle_tasks(car_id);

alter table public.vehicle_tasks enable row level security;

drop policy if exists "vehicle_tasks: staff all" on public.vehicle_tasks;
create policy "vehicle_tasks: staff all"
  on public.vehicle_tasks for all
  to authenticated
  using (public.is_staff())
  with check (public.is_staff());
commit;

-- ---------------------------------------------------------------------------
-- 0013_operations.sql
-- ---------------------------------------------------------------------------
-- Apply after 0012. All schema/security changes are transactional.
begin;

create or replace function public.has_section(section text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select case
    when role::text = 'admin' then true
    when role::text = 'mecanico' then section = 'oficina'
    when section = 'dashboard' then true
    when cardinality(allowed_sections) > 0 then section = any(allowed_sections)
    when role::text = 'chefe' then section = any(array['carros','pagina-inicial','leads','testemunhos','financeiro'])
    when role::text = 'vendedor' then section = any(array['carros','leads'])
    else false end from public.profiles where id = auth.uid()), false);
$$;
revoke all on function public.has_section(text) from public;
grant execute on function public.has_section(text) to anon, authenticated, service_role;

-- Auth registration must never manufacture staff or trust user-controlled metadata.
-- Staff creation now explicitly inserts the profile through the server admin API.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin return new; end;
$$;
revoke update on public.profiles from anon, authenticated;
grant update(full_name) on public.profiles to authenticated;
drop policy if exists "profiles: admin update all" on public.profiles;
drop policy if exists "profiles: admin delete" on public.profiles;
drop policy if exists "profiles: admin read all" on public.profiles;
create policy "profiles: managers read" on public.profiles for select to authenticated
using (public.has_section('utilizadores'));
revoke insert, delete on public.profiles from anon, authenticated;

-- Replace permissive legacy policies (policies otherwise combine with OR).
drop policy if exists "cars: public read published" on public.cars;
create policy "cars: read" on public.cars for select using
(status in ('published','reserved','sold') or public.has_section('carros') or public.has_section('oficina') or public.has_section('financeiro'));
drop policy if exists "cars: staff insert" on public.cars;
drop policy if exists "cars: staff update" on public.cars;
drop policy if exists "cars: staff delete" on public.cars;
create policy "cars: write" on public.cars for all to authenticated
using (public.has_section('carros')) with check (public.has_section('carros'));
drop policy if exists "car_media: staff write" on public.car_media;
drop policy if exists "car_media: public read published" on public.car_media;
create policy "media: read" on public.car_media for select using (
 public.has_section('carros') or public.has_section('oficina') or exists
 (select 1 from public.cars c where c.id = car_id and c.status in ('published','reserved','sold')));
create policy "media: write" on public.car_media for all to authenticated
using (public.has_section('carros')) with check (public.has_section('carros'));
drop policy if exists "car-media: staff insert" on storage.objects;
drop policy if exists "car-media: staff update" on storage.objects;
drop policy if exists "car-media: staff delete" on storage.objects;
create policy "car-media: editor insert" on storage.objects for insert to authenticated
with check (bucket_id = 'car-media' and (public.has_section('carros') or public.is_admin()));
create policy "car-media: editor update" on storage.objects for update to authenticated
using (bucket_id = 'car-media' and (public.has_section('carros') or public.is_admin()))
with check (bucket_id = 'car-media' and (public.has_section('carros') or public.is_admin()));
create policy "car-media: editor delete" on storage.objects for delete to authenticated
using (bucket_id = 'car-media' and (public.has_section('carros') or public.is_admin()));

drop policy if exists "leads: public insert" on public.leads;
drop policy if exists "leads: staff read" on public.leads;
drop policy if exists "leads: staff update" on public.leads;
drop policy if exists "leads: staff delete" on public.leads;
create policy "leads: commercial" on public.leads for all to authenticated
using (public.has_section('leads')) with check (public.has_section('leads'));
drop policy if exists "car_views: public insert" on public.car_views;
drop policy if exists "car_views: staff read" on public.car_views;
create policy "views: analytics" on public.car_views for select to authenticated using (public.has_section('carros'));
drop policy if exists "testimonials: public submit" on public.testimonials;
drop policy if exists "testimonials: public read" on public.testimonials;
drop policy if exists "testimonials: staff write" on public.testimonials;
create policy "testimonials: read" on public.testimonials for select using (published or public.has_section('testemunhos'));
create policy "testimonials: write" on public.testimonials for all to authenticated
using (public.has_section('testemunhos')) with check (public.has_section('testemunhos'));
drop policy if exists "vehicle_tasks: staff all" on public.vehicle_tasks;
create policy "tasks: workshop" on public.vehicle_tasks for all to authenticated
using (public.has_section('oficina')) with check (public.has_section('oficina'));
-- Drop all old content write policies irrespective of their original name.
do $$ declare p record; begin
 for p in select policyname from pg_policies where schemaname='public' and tablename='site_content' and cmd <> 'SELECT' loop
 execute format('drop policy %I on public.site_content',p.policyname); end loop;
end $$;
create policy "content: editor" on public.site_content for all to authenticated
using (public.has_section('pagina-inicial')) with check (public.has_section('pagina-inicial'));

-- Draft intake can have unknown specifications. A published car cannot.
alter table public.cars alter column year drop not null;
alter table public.cars alter column fuel drop not null;
alter table public.cars alter column transmission drop not null;
alter table public.cars alter column body drop not null;
alter table public.cars add constraint complete_public_car check
(status = 'draft' or (year is not null and fuel is not null and transmission is not null and body is not null and model <> '—')) not valid;

alter table public.leads add column assigned_to uuid references public.profiles(id) on delete set null;
alter table public.leads add column next_action text;
alter table public.leads add column next_action_at timestamptz;
alter table public.leads add column loss_reason text;
alter table public.leads add column first_contacted_at timestamptz;
create index leads_followup_idx on public.leads(next_action_at) where status in ('new','contacted','proposal');
create index leads_assignee_idx on public.leads(assigned_to);
create table public.lead_activities (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null references public.leads(id) on delete cascade,
 kind text not null check(kind in ('call','message','proposal','visit','note')),
 body text not null check(length(body) between 1 and 4000), created_by uuid references public.profiles(id) on delete set null,
 created_at timestamptz not null default now()
);
alter table public.lead_activities enable row level security;
create policy "activities: read" on public.lead_activities for select to authenticated using (public.has_section('leads'));
create policy "activities: append" on public.lead_activities for insert to authenticated
with check (public.has_section('leads') and created_by = auth.uid());
create index on public.lead_activities(lead_id,created_at desc);

-- Private financial data must never live on the publicly readable cars row.
create table public.vehicle_financials (
 car_id uuid primary key references public.cars(id) on delete cascade,
 acquired_on date, purchase_price numeric(12,2) check(purchase_price >= 0),
 sale_lead_id uuid unique references public.leads(id),
 sale_price numeric(12,2) check(sale_price >= 0), sold_on date,
 updated_at timestamptz not null default now()
);
create table public.vehicle_costs (
 id uuid primary key default gen_random_uuid(), car_id uuid not null references public.cars(id) on delete cascade,
 category text not null check(category in ('transport','parts','labour','preparation','other')),
 description text not null check(length(description) between 1 and 500),
 amount numeric(12,2) not null check(amount > 0), incurred_on date not null default current_date,
 created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now()
);
create index on public.vehicle_costs(car_id);
alter table public.vehicle_financials enable row level security;
alter table public.vehicle_costs enable row level security;
create policy "financials: finance" on public.vehicle_financials for all to authenticated
using(public.has_section('financeiro')) with check(public.has_section('financeiro'));
create policy "costs: finance" on public.vehicle_costs for all to authenticated
using(public.has_section('financeiro')) with check(public.has_section('financeiro'));

create table public.preparation_tasks (
 id uuid primary key default gen_random_uuid(), car_id uuid not null references public.cars(id) on delete cascade,
 title text not null check(length(title) between 1 and 200),
 stage text not null default 'preparation' check(stage in ('preparation','delivery')),
 status text not null default 'pending' check(status in ('pending','in_progress','waiting_parts','done')),
 assigned_to uuid references public.profiles(id) on delete set null,
 parts text, due_on date, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index on public.preparation_tasks(car_id);
alter table public.preparation_tasks enable row level security;
create policy "preparation: operations" on public.preparation_tasks for all to authenticated
using(public.has_section('oficina') or public.has_section('carros'))
with check(public.has_section('oficina') or public.has_section('carros'));

create table public.reservations (
 id uuid primary key default gen_random_uuid(), car_id uuid not null references public.cars(id),
 lead_id uuid not null references public.leads(id), expires_at timestamptz not null,
 status text not null default 'active' check(status in ('active','cancelled','expired','completed')),
 deposit_amount numeric(12,2) not null default 0 check(deposit_amount >= 0),
 deposit_received boolean not null default false,
 created_by uuid references public.profiles(id) on delete set null, created_at timestamptz not null default now()
);
create unique index one_active_reservation on public.reservations(car_id) where status = 'active';
alter table public.reservations enable row level security;
create policy "reservations: read" on public.reservations for select to authenticated using(public.has_section('leads'));
-- Writes exclusively through transactional RPCs below.

create table public.audit_log (
 id bigint generated always as identity primary key, entity text not null, record_id text not null,
 action text not null, actor_id uuid, changed_fields jsonb not null, created_at timestamptz not null default now()
);
create index on public.audit_log(entity,record_id,created_at desc);
alter table public.audit_log enable row level security;
create policy "audit: read" on public.audit_log for select to authenticated using (
 public.is_admin() or (entity in ('cars','preparation_tasks') and public.has_section('carros')) or
 (entity in ('leads','reservations') and public.has_section('leads')) or
 (entity in ('vehicle_financials','vehicle_costs') and public.has_section('financeiro')) or
 (entity in ('vehicle_tasks','preparation_tasks') and public.has_section('oficina')));
create function public.audit_change() returns trigger language plpgsql security definer set search_path=public as $$
declare before_row jsonb := '{}'::jsonb; after_row jsonb := '{}'::jsonb; diff jsonb;
begin
 if tg_op <> 'INSERT' then before_row := to_jsonb(old); end if;
 if tg_op <> 'DELETE' then after_row := to_jsonb(new); end if;
 select coalesce(jsonb_object_agg(k,jsonb_build_object('before',before_row->k,'after',after_row->k)),'{}') into diff
 from (select jsonb_object_keys(before_row || after_row) k) keys
 where k <> 'updated_at' and before_row->k is distinct from after_row->k;
 if diff <> '{}'::jsonb then
 insert into public.audit_log(entity,record_id,action,actor_id,changed_fields)
 values(tg_table_name,case when tg_table_name in ('vehicle_financials','vehicle_costs','preparation_tasks','vehicle_tasks') then coalesce(after_row->>'car_id',before_row->>'car_id') else coalesce(after_row->>'id',before_row->>'id') end,tg_op,auth.uid(),diff);
 end if;
 return coalesce(new,old);
end $$;
do $$ declare t text; begin
 foreach t in array array['cars','leads','reservations','vehicle_financials','vehicle_costs','vehicle_tasks','preparation_tasks','profiles'] loop
 execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function public.audit_change()',t);
 end loop;
end $$;

-- Server-only counters: callers cannot reset their quota or bypass it via PostgREST.
create table public.submission_limits (key text primary key, window_start timestamptz not null, hits int not null);
alter table public.submission_limits enable row level security;
create function public.consume_submission(key_value text, max_hits int, window_seconds int) returns boolean
language plpgsql security definer set search_path=public as $$
declare n int;
begin
 insert into submission_limits as l(key,window_start,hits) values(key_value,now(),1)
 on conflict(key) do update set
 hits=case when l.window_start < now()-make_interval(secs=>window_seconds) then 1 else l.hits+1 end,
 window_start=case when l.window_start < now()-make_interval(secs=>window_seconds) then now() else l.window_start end returning hits into n;
 return n <= max_hits;
end $$;
revoke all on function public.consume_submission(text,int,int) from public,anon,authenticated;
grant execute on function public.consume_submission(text,int,int) to service_role;

create table public.notification_jobs (
 id uuid primary key default gen_random_uuid(), lead_id uuid not null unique references public.leads(id) on delete cascade,
 attempts int not null default 0, next_attempt_at timestamptz not null default now(),
 delivered_at timestamptz, last_error text, created_at timestamptz not null default now()
);
alter table public.notification_jobs enable row level security;
create policy "notifications: admin read" on public.notification_jobs for select to authenticated using(public.is_admin());
create function public.queue_lead_notification() returns trigger language plpgsql security definer set search_path=public as $$
begin insert into public.notification_jobs(lead_id) values(new.id); return new; end $$;
create trigger queue_notification after insert on public.leads for each row execute function public.queue_lead_notification();

-- Recalculate hours at the database boundary; direct API writes cannot forge totals.
create function public.calculate_work_hours() returns trigger language plpgsql as $$
begin
 new.hours := case when new.end_time is null then 0 else round((mod(extract(epoch from (new.end_time-new.start_time))::numeric+86400,86400)/3600),2) end;
 new.updated_at := now(); return new;
end $$;
create trigger calculate_hours before insert or update on public.vehicle_tasks for each row execute function public.calculate_work_hours();

create function public.create_workshop_intake(vehicle_name text, plate text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid := gen_random_uuid();
begin
 if not public.has_section('oficina') then raise exception 'Sem permissão'; end if;
 if length(trim(vehicle_name)) not between 1 and 120 or length(trim(plate)) not between 2 and 20 then raise exception 'Dados inválidos'; end if;
 insert into public.cars(id,slug,make,model,year,license_plate,fuel,transmission,body,status,price_on_request,created_by)
 values(result,'oficina-'||result,trim(vehicle_name),'—',null,upper(trim(plate)),null,null,null,'draft',true,auth.uid());
 return result;
end $$;

create function public.reserve_vehicle(lead uuid, expiry timestamptz, deposit numeric) returns uuid
language plpgsql security definer set search_path=public as $$
declare vehicle uuid; current_status public.car_status; result uuid;
begin
 if not public.has_section('leads') or not public.has_section('carros') then raise exception 'É necessário acesso a contactos e viaturas'; end if;
 if expiry <= now() or expiry > now()+interval '30 days' or deposit < 0 then raise exception 'Prazo ou sinal inválido'; end if;
 select car_id into vehicle from public.leads where id=lead and status in ('new','contacted','proposal') for update;
 if vehicle is null then raise exception 'Associe uma viatura ao contacto'; end if;
 select status into current_status from public.cars where id=vehicle for update;
 if current_status <> 'published' then raise exception 'A viatura não está disponível'; end if;
 insert into public.reservations(car_id,lead_id,expires_at,deposit_amount,created_by) values(vehicle,lead,expiry,deposit,auth.uid()) returning id into result;
 update public.cars set status='reserved' where id=vehicle;
 return result;
end $$;

create function public.release_reservation(reservation_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare vehicle uuid;
begin
 if not public.has_section('leads') or not public.has_section('carros') then raise exception 'Sem permissão'; end if;
 select car_id into vehicle from public.reservations where id=reservation_id;
 perform 1 from public.cars where id=vehicle for update;
 update public.reservations set status='cancelled' where id=reservation_id and status='active';
 if not found then raise exception 'Reserva já terminada'; end if;
 update public.cars set status='published' where id=vehicle and status='reserved';
end $$;
create function public.confirm_reservation_deposit(reservation_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_section('leads') then raise exception 'Sem permissão'; end if;
 update public.reservations set deposit_received=true where id=reservation_id and status='active' and expires_at>now();
 if not found then raise exception 'Reserva não está ativa'; end if;
end $$;
create function public.expire_reservations() returns int
language plpgsql security definer set search_path=public as $$
declare expired_car record; n int:=0;
begin
 for expired_car in select c.id from public.cars c where exists(select 1 from public.reservations r where r.car_id=c.id and r.status='active' and r.expires_at<=now()) for update skip locked loop
 update public.reservations set status='expired' where car_id=expired_car.id and status='active' and expires_at<=now();
 if found then update public.cars set status='published' where id=expired_car.id and status='reserved'; n:=n+1; end if;
 end loop; return n;
end $$;
revoke all on function public.expire_reservations() from public,anon,authenticated;
grant execute on function public.expire_reservations() to service_role;

create function public.close_vehicle_sale(lead uuid, amount numeric, sale_date date) returns void
language plpgsql security definer set search_path=public as $$
declare vehicle uuid; current_status public.car_status;
begin
 if not public.has_section('leads') or not public.has_section('carros') or not public.has_section('financeiro') then raise exception 'É necessário acesso a contactos, viaturas e financeiro'; end if;
 if amount <= 0 or sale_date > current_date then raise exception 'Valor ou data inválida'; end if;
 select car_id into vehicle from public.leads where id=lead and status in ('new','contacted','proposal') for update;
 if vehicle is null then raise exception 'Associe uma viatura'; end if;
 select status into current_status from public.cars where id=vehicle for update;
 if current_status not in ('published','reserved') then raise exception 'Viatura indisponível'; end if;
 if exists(select 1 from public.reservations where car_id=vehicle and status='active' and lead_id<>lead) then raise exception 'Viatura reservada para outro contacto'; end if;
 update public.reservations set status='completed' where car_id=vehicle and status='active';
 update public.cars set status='sold',sold_at=sale_date::timestamptz where id=vehicle;
 insert into public.vehicle_financials(car_id,sale_price,sold_on,sale_lead_id) values(vehicle,amount,sale_date,lead)
 on conflict(car_id) do update set sale_price=excluded.sale_price,sold_on=excluded.sold_on,sale_lead_id=excluded.sale_lead_id,updated_at=now();
 update public.leads set status='won',next_action=null,next_action_at=null where id=lead;
end $$;

-- Prevent ordinary edits from bypassing an active reservation.
create function public.protect_reserved_car() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.status is distinct from old.status and exists(select 1 from public.reservations where car_id=old.id and status='active') and new.status <> 'reserved' then
 raise exception 'Termine a reserva antes de alterar a disponibilidade'; end if;
 return new;
end $$;
create trigger protect_reservation before update on public.cars for each row execute function public.protect_reserved_car();

create function public.staff_directory() returns table(id uuid, full_name text, role text)
language sql stable security definer set search_path=public as $$
 select p.id,coalesce(p.full_name,p.email,'Utilizador'),p.role::text from public.profiles p
 where public.has_section('leads') or public.has_section('oficina') or public.has_section('carros');
$$;
-- Safe counts, aggregated before API row limits. Respect the caller's table RLS.
create function public.analytics_summary() returns jsonb language sql stable security invoker set search_path=public as $$
 select jsonb_build_object(
 'views', (select count(*) from public.car_views),
 'month_views',(select count(*) from public.car_views where created_at>=date_trunc('month',now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon'),
 'leads',(select count(*) from public.leads),
 'new_leads',(select count(*) from public.leads where status='new'),
 'by_car',coalesce((select jsonb_agg(x) from (select c.id,
 (select count(*) from public.car_views v where v.car_id=c.id) as views,
 (select count(*) from public.leads l where l.car_id=c.id) as leads from public.cars c) x),'[]'::jsonb));
$$;
-- Every client RPC is explicit; trigger functions need no public execution.
do $$ declare signature text; begin
 foreach signature in array array['create_workshop_intake(text,text)','reserve_vehicle(uuid,timestamptz,numeric)','release_reservation(uuid)','confirm_reservation_deposit(uuid)','close_vehicle_sale(uuid,numeric,date)','staff_directory()','analytics_summary()'] loop
 execute 'revoke all on function public.'||signature||' from public,anon';
 execute 'grant execute on function public.'||signature||' to authenticated';
 end loop;
end $$;
grant select,insert,update,delete on public.lead_activities,public.vehicle_financials,public.vehicle_costs,public.preparation_tasks,public.reservations,public.audit_log,public.notification_jobs,public.submission_limits to authenticated,service_role;
grant usage,select on all sequences in schema public to authenticated,service_role;

create function public.validate_lead_followup() returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' then
   if new.car_id is distinct from old.car_id and (old.status='won' or exists(select 1 from public.reservations where lead_id=old.id and status='active')) then raise exception 'Não pode trocar a viatura de uma reserva ativa ou venda concluída'; end if;
   if old.status='won' and new.status<>'won' then raise exception 'A venda já está concluída'; end if;
 end if;
 if new.status='won' and new.car_id is not null and not exists(select 1 from public.vehicle_financials f join public.cars c on c.id=f.car_id where f.car_id=new.car_id and f.sale_lead_id=new.id and f.sale_price is not null and c.status='sold') then raise exception 'Conclua a venda com o preço efetivo'; end if;
 if new.status='lost' and nullif(trim(new.loss_reason),'') is null then raise exception 'Indique o motivo de perda'; end if;
 if new.status in ('contacted','proposal','won') and new.first_contacted_at is null then new.first_contacted_at:=now(); end if;
 if new.status in ('won','lost','closed') then new.next_action:=null; new.next_action_at:=null; end if;
 if (new.next_action_at is null) <> (nullif(trim(new.next_action),'') is null) then raise exception 'Preencha ação e data'; end if;
 return new;
end $$;
create trigger validate_followup before insert or update on public.leads for each row execute function public.validate_lead_followup();
create or replace function public.cars_status_timestamps() returns trigger language plpgsql as $$
begin
 if new.status='published' and old.status is distinct from 'published' and new.published_at is null then new.published_at:=now(); end if;
 if new.status='sold' and old.status is distinct from 'sold' and new.sold_at is not distinct from old.sold_at then new.sold_at:=now(); end if;
 return new;
end $$;

create function public.claim_notification_jobs() returns setof public.notification_jobs language sql security definer set search_path=public as $$
 update public.notification_jobs set attempts=attempts+1,next_attempt_at=now()+interval '2 minutes'
 where id in (select id from public.notification_jobs where delivered_at is null and attempts<8 and next_attempt_at<=now() order by created_at limit 3 for update skip locked)
 returning *;
$$;
create function public.prune_submission_limits() returns void language sql security definer set search_path=public as $$
 delete from public.submission_limits where window_start<now()-interval '1 day';
$$;
revoke all on function public.claim_notification_jobs(),public.prune_submission_limits() from public,anon,authenticated;
grant execute on function public.claim_notification_jobs(),public.prune_submission_limits() to service_role;
commit;
commit;

-- ---------------------------------------------------------------------------
-- 0014_channel_listings.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- 0013 — Estado de publicação por canal (OLX, StandVirtual, CustoJusto, …)
--
-- Regista, por viatura e por canal, se o anúncio está publicado, o link do
-- anúncio no portal e as datas. Como a publicação é feita por FEED (o portal
-- importa o inventário), esta tabela é a "verdade" do estado em cada portal —
-- gerida no backoffice, na ficha da viatura.
--
-- Nota: `status` é TEXT com CHECK (evita ALTER TYPE, que não corre dentro de
-- transação e complica a aplicação das migrações).
-- ============================================================================

create table if not exists public.channel_listings (
  id           uuid primary key default gen_random_uuid(),
  car_id       uuid not null references public.cars (id) on delete cascade,
  channel      text not null,
  status       text not null default 'pending'
               check (status in ('pending', 'published', 'removed', 'error')),
  external_url text,
  external_id  text,
  published_at timestamptz,
  notes        text,
  created_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (car_id, channel)
);

create index if not exists idx_channel_listings_car     on public.channel_listings (car_id);
create index if not exists idx_channel_listings_channel on public.channel_listings (channel, status);

-- updated_at automático (reutiliza a função criada em 0001).
drop trigger if exists trg_channel_listings_updated_at on public.channel_listings;
create trigger trg_channel_listings_updated_at
  before update on public.channel_listings
  for each row execute function public.set_updated_at();

-- RLS: apenas staff lê/escreve (nada público).
alter table public.channel_listings enable row level security;

drop policy if exists "channel_listings: staff all" on public.channel_listings;
create policy "channel_listings: staff all"
  on public.channel_listings
  for all
  using (public.is_staff())
  with check (public.is_staff());
commit;

-- ---------------------------------------------------------------------------
-- 0015_fix_work_hours.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- 0015 — corrige o cálculo de horas na oficina
--
-- O trigger calculate_work_hours (criado em 0013) fazia `end_time - start_time`.
-- Se o start_time for NULL (registos antigos/incompletos), o resultado é NULL e
-- a coluna `hours` (not-null) rebentava ao "Terminar" um registo:
--   "null value in column 'hours' of relation 'vehicle_tasks'..."
--
-- Agora, se faltar o início OU o fim, as horas ficam a 0 (em vez de NULL).
-- ============================================================================

create or replace function public.calculate_work_hours()
returns trigger language plpgsql as $$
begin
  new.hours := case
    when new.end_time is null or new.start_time is null then 0
    else round(
      (mod(extract(epoch from (new.end_time - new.start_time))::numeric + 86400, 86400) / 3600),
      2
    )
  end;
  return new;
end;
$$;

-- O trigger já existe (0013) e passa a usar esta função corrigida.
commit;

-- ---------------------------------------------------------------------------
-- 0016_workshop_rate.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- 0016 — valor/hora da mão de obra da oficina
--
-- Guarda o custo por hora (€) usado para converter as horas registadas na
-- Oficina em custo de mão de obra na página "Custos e margens". Só o admin
-- define (backoffice → Definições).
-- ============================================================================

alter table public.site_settings
  add column if not exists workshop_hourly_rate numeric(8,2) not null default 0;
commit;

-- ---------------------------------------------------------------------------
-- 0017_workshop_costs_and_rate.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- 0017 — valor/hora por viatura + a oficina pode registar custos (peças)
--
-- 1) hourly_rate_override: valor/hora só para esta viatura. NULL = usa o
--    valor por defeito definido em Custos e margens.
-- 2) A oficina passa a poder registar custos (o mecânico vai buscar material
--    e lança ali o valor das peças). Sem isto a RLS ("costs: finance")
--    bloqueava o mecânico. As políticas são permissivas (somam-se à existente).
-- ============================================================================

-- 1) Valor/hora específico da viatura ----------------------------------------
alter table public.vehicle_financials
  add column if not exists hourly_rate_override numeric(8,2)
  check (hourly_rate_override is null or hourly_rate_override >= 0);

-- 2) Oficina nos custos -------------------------------------------------------
-- Ler: o mecânico vê os custos da viatura em que está a trabalhar.
drop policy if exists "costs: workshop read" on public.vehicle_costs;
create policy "costs: workshop read" on public.vehicle_costs
  for select to authenticated
  using (public.has_section('oficina'));

-- Inserir: pode lançar peças/material.
drop policy if exists "costs: workshop insert" on public.vehicle_costs;
create policy "costs: workshop insert" on public.vehicle_costs
  for insert to authenticated
  with check (public.has_section('oficina') and created_by = auth.uid());

-- Apagar: só o que ele próprio lançou (corrigir enganos), nunca custos de outros.
drop policy if exists "costs: workshop delete" on public.vehicle_costs;
create policy "costs: workshop delete" on public.vehicle_costs
  for delete to authenticated
  using (public.has_section('oficina') and created_by = auth.uid());
commit;

-- ---------------------------------------------------------------------------
-- 0018_showroom.sql
-- ---------------------------------------------------------------------------
-- Novos campos opcionais: os anúncios existentes mantêm os dados atuais.
alter type public.body_type add value if not exists 'Scooter';
alter type public.body_type add value if not exists 'Naked';
alter type public.body_type add value if not exists 'Desportiva';
alter type public.body_type add value if not exists 'Trail';
alter type public.body_type add value if not exists 'Touring';
alter type public.body_type add value if not exists 'Chopper/Cruiser';
alter type public.body_type add value if not exists 'Enduro';
alter table public.cars add column if not exists registration_month integer check (registration_month between 1 and 12);
alter table public.cars add column if not exists vehicle_type text not null default 'car' check (vehicle_type in ('car','motorcycle'));
alter table public.cars add column if not exists point_of_sale_id text;
alter table public.cars drop constraint if exists cars_doors_check;
alter table public.cars add constraint cars_doors_check check (doors between 0 and 9 and (vehicle_type = 'motorcycle' or doors >= 1));
-- Comparação textual evita usar os novos valores enum antes do COMMIT.
alter table public.cars add constraint cars_vehicle_category_check check (
 body is null or ((vehicle_type = 'motorcycle') = (body::text in ('Scooter','Naked','Desportiva','Trail','Touring','Chopper/Cruiser','Enduro')))
);
alter table public.cars add constraint cars_motorcycle_doors_check check (vehicle_type <> 'motorcycle' or doors = 0);
insert into public.site_content(key,content) values ('showroom','{}'::jsonb) on conflict(key) do nothing;

-- Serializa alterações de locais e associações, incluindo viaturas ocultas por RLS.
create function public.validate_showroom_location() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb;
begin
  if tg_table_name = 'cars' then
    if new.point_of_sale_id is null then return new; end if;
    select content into cfg from public.site_content where key = 'showroom' for update;
    if not exists (select 1 from jsonb_array_elements(coalesce(cfg->'locations','[]'::jsonb)) p where p->>'id' = new.point_of_sale_id) then
      raise exception 'Ponto de venda inexistente';
    end if;
    return new;
  end if;
  if old.key <> 'showroom' then return new; end if;
  if tg_op = 'DELETE' then cfg := '{}'::jsonb;
  elsif new.key <> 'showroom' then cfg := '{}'::jsonb; else cfg := new.content; end if;
  if exists (select 1 from public.cars c where c.point_of_sale_id is not null and not exists
    (select 1 from jsonb_array_elements(coalesce(cfg->'locations','[]'::jsonb)) p where p->>'id' = c.point_of_sale_id)) then
    raise exception 'Reatribua as viaturas antes de remover o ponto de venda';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.validate_showroom_location() from public;
create trigger validate_car_location before insert or update of point_of_sale_id on public.cars
for each row execute function public.validate_showroom_location();
create trigger protect_showroom_locations before update or delete on public.site_content
for each row execute function public.validate_showroom_location();
commit;

-- ---------------------------------------------------------------------------
-- 0019_vehicle_worlds.sql
-- ---------------------------------------------------------------------------
-- Keep the vehicle category across sales enquiries, workshop and reporting.
-- Older enquiries without a linked vehicle stay explicitly unclassified.
alter table public.leads add column vehicle_type text check (vehicle_type in ('car','motorcycle'));
update public.leads l set vehicle_type=c.vehicle_type from public.cars c where c.id=l.car_id;
create index cars_vehicle_type_status_idx on public.cars(vehicle_type,status);
create index leads_vehicle_type_created_idx on public.leads(vehicle_type,created_at desc);

create function public.sync_lead_vehicle_type() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  if new.car_id is not null then
    select vehicle_type into new.vehicle_type from public.cars where id=new.car_id;
  end if;
  return new;
end $$;
revoke all on function public.sync_lead_vehicle_type() from public;
create trigger leads_vehicle_type before insert or update of car_id,vehicle_type on public.leads
for each row execute function public.sync_lead_vehicle_type();

create function public.sync_car_lead_types() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  update public.leads set vehicle_type=new.vehicle_type where car_id=new.id;
  return new;
end $$;
revoke all on function public.sync_car_lead_types() from public;
create trigger cars_lead_types after update of vehicle_type on public.cars
for each row when (old.vehicle_type is distinct from new.vehicle_type) execute function public.sync_car_lead_types();

create function public.create_workshop_intake_for_type(vehicle_name text,plate text,selected_type text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid := gen_random_uuid();
begin
  if not public.has_section('oficina') then raise exception 'Sem permissão'; end if;
  if selected_type is null or selected_type not in ('car','motorcycle') then raise exception 'Tipo inválido'; end if;
  if vehicle_name is null or plate is null or length(trim(vehicle_name)) not between 1 and 120 or length(trim(plate)) not between 2 and 20 then raise exception 'Dados inválidos'; end if;
  insert into public.cars(id,slug,make,model,year,license_plate,fuel,transmission,body,status,price_on_request,created_by,vehicle_type,doors,seats)
  values(result,'oficina-'||result,trim(vehicle_name),'—',null,upper(trim(plate)),null,null,null,'draft',true,auth.uid(),selected_type,case when selected_type='motorcycle' then 0 else null end,case when selected_type='motorcycle' then 2 else null end);
  return result;
end $$;
revoke all on function public.create_workshop_intake_for_type(text,text,text) from public;
grant execute on function public.create_workshop_intake_for_type(text,text,text) to authenticated;

create function public.analytics_summary_by_type(selected_type text) returns jsonb
language sql stable security invoker set search_path=public as $$
 select jsonb_build_object(
  'views',(select count(*) from public.car_views v join public.cars c on c.id=v.car_id where c.vehicle_type=selected_type),
  'month_views',(select count(*) from public.car_views v join public.cars c on c.id=v.car_id where c.vehicle_type=selected_type and v.created_at>=date_trunc('month',now() at time zone 'Europe/Lisbon') at time zone 'Europe/Lisbon'),
  'leads',(select count(*) from public.leads where vehicle_type=selected_type),
  'new_leads',(select count(*) from public.leads where vehicle_type=selected_type and status='new'),
  'by_car',coalesce((select jsonb_agg(x) from (select c.id,
    (select count(*) from public.car_views v where v.car_id=c.id) as views,
    (select count(*) from public.leads l where l.car_id=c.id) as leads
    from public.cars c where c.vehicle_type=selected_type) x),'[]'::jsonb)
 );
$$;
revoke all on function public.analytics_summary_by_type(text) from public;
grant execute on function public.analytics_summary_by_type(text) to authenticated;
commit;

-- ---------------------------------------------------------------------------
-- 0020_profile_vehicle_types.sql
-- ---------------------------------------------------------------------------
-- Acesso por tipo de viatura: o admin decide se cada utilizador trabalha com
-- carros e motas, só carros ou só motas.
--
-- NULL = sem restrição (os dois mundos). É o que fica para todos os perfis
-- existentes, para nada mudar em contas já criadas.
alter table public.profiles
  add column allowed_vehicle_types text[]
  check (
    allowed_vehicle_types is null
    or (
      cardinality(allowed_vehicle_types) between 1 and 2
      and allowed_vehicle_types <@ array['car','motorcycle']::text[]
    )
  );

comment on column public.profiles.allowed_vehicle_types is
  'Tipos de viatura a que o utilizador acede no backoffice. NULL = ambos.';
commit;

-- ---------------------------------------------------------------------------
-- 0021_profile_and_leave.sql
-- ---------------------------------------------------------------------------
-- Perfil pessoal e gestão de férias.
--
-- Cada colaborador passa a ter dados próprios (contacto, data de nascimento,
-- função) e um plano de férias por ano. Os colegas veem quem está fora, mas
-- não veem saldos nem dados pessoais uns dos outros.
begin;

-- ---------------------------------------------------------------------------
-- Perfil: dados que o próprio mantém
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists phone text,
  add column if not exists birth_date date,
  add column if not exists job_title text;

comment on column public.profiles.birth_date is
  'Usada para o dia de aniversário nas férias; o dia e mês bastam.';

-- Quem é chefe ou administrador aprova pedidos de férias.
create or replace function public.can_approve_leave() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role::text in ('admin', 'chefe') from public.profiles where id = auth.uid()),
    false);
$$;
revoke all on function public.can_approve_leave() from public;
grant execute on function public.can_approve_leave() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Dias especiais da empresa (além dos feriados nacionais, que são calculados)
-- ---------------------------------------------------------------------------
create table if not exists public.company_days (
  id    uuid primary key default gen_random_uuid(),
  day   date not null,
  -- holiday: feriado municipal ou outro; tolerance: tolerância de ponto;
  -- mandatory: dia de fecho obrigatório, descontado no saldo.
  kind  text not null check (kind in ('holiday', 'tolerance', 'mandatory')),
  label text not null default '',
  unique (day, kind)
);
alter table public.company_days enable row level security;

drop policy if exists "company_days: staff read" on public.company_days;
create policy "company_days: staff read"
  on public.company_days for select to authenticated
  using (public.is_staff());

drop policy if exists "company_days: settings write" on public.company_days;
create policy "company_days: settings write"
  on public.company_days for all to authenticated
  using (public.has_section('definicoes'))
  with check (public.has_section('definicoes'));

-- ---------------------------------------------------------------------------
-- Saldo anual. Sem linha, aplicam-se os valores por defeito (22 + 0 + 1).
-- ---------------------------------------------------------------------------
create table if not exists public.leave_balances (
  profile_id   uuid not null references public.profiles(id) on delete cascade,
  year         int  not null check (year between 2000 and 2100),
  base_days    numeric(4,1) not null default 22 check (base_days between 0 and 60),
  carried_days numeric(4,1) not null default 0  check (carried_days between 0 and 60),
  birthday_day numeric(2,1) not null default 1  check (birthday_day in (0, 1)),
  updated_at   timestamptz not null default now(),
  primary key (profile_id, year)
);
alter table public.leave_balances enable row level security;

-- O saldo é pessoal: cada um vê o seu; quem aprova vê todos.
drop policy if exists "leave_balances: read own or approver" on public.leave_balances;
create policy "leave_balances: read own or approver"
  on public.leave_balances for select to authenticated
  using (profile_id = auth.uid() or public.can_approve_leave());

drop policy if exists "leave_balances: approver writes" on public.leave_balances;
create policy "leave_balances: approver writes"
  on public.leave_balances for all to authenticated
  using (public.can_approve_leave())
  with check (public.can_approve_leave());

-- ---------------------------------------------------------------------------
-- Dias marcados
-- ---------------------------------------------------------------------------
create table if not exists public.leave_days (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles(id) on delete cascade,
  day         date not null,
  -- Meio dia conta 0,5 no saldo.
  half        boolean not null default false,
  -- draft: ainda por submeter; pending: à espera de decisão.
  status      text not null default 'draft'
              check (status in ('draft', 'pending', 'approved', 'rejected')),
  note        text not null default '',
  decided_by  uuid references public.profiles(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (profile_id, day)
);
create index if not exists leave_days_day_idx on public.leave_days(day);
create index if not exists leave_days_profile_year_idx
  on public.leave_days(profile_id, day);

drop trigger if exists trg_leave_days_updated_at on public.leave_days;
create trigger trg_leave_days_updated_at
  before update on public.leave_days
  for each row execute function public.set_updated_at();

alter table public.leave_days enable row level security;

-- Os colegas veem os dias uns dos outros — é para isso que serve o mapa de
-- equipa. O que não é partilhado (saldos, notas de decisão) vive noutras
-- colunas e tabelas, e a aplicação não as mostra a quem não é o próprio.
drop policy if exists "leave_days: staff read" on public.leave_days;
create policy "leave_days: staff read"
  on public.leave_days for select to authenticated
  using (public.is_staff());

-- Cada um marca e apaga os seus dias, enquanto não estiverem decididos.
drop policy if exists "leave_days: own insert" on public.leave_days;
create policy "leave_days: own insert"
  on public.leave_days for insert to authenticated
  with check (profile_id = auth.uid() and status in ('draft', 'pending'));

drop policy if exists "leave_days: own update" on public.leave_days;
create policy "leave_days: own update"
  on public.leave_days for update to authenticated
  using (
    (profile_id = auth.uid() and status in ('draft', 'pending'))
    or public.can_approve_leave()
  )
  with check (profile_id = auth.uid() or public.can_approve_leave());

drop policy if exists "leave_days: own delete" on public.leave_days;
create policy "leave_days: own delete"
  on public.leave_days for delete to authenticated
  using (
    (profile_id = auth.uid() and status in ('draft', 'pending'))
    or public.can_approve_leave()
  );

-- Lista de colegas para o mapa de equipa: nome e id, nada mais.
create or replace function public.leave_directory()
returns table (id uuid, full_name text)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.full_name, ''), p.email, 'Utilizador')
  from public.profiles p
  where public.is_staff()
  order by 2;
$$;
revoke all on function public.leave_directory() from public;
grant execute on function public.leave_directory() to authenticated, service_role;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0022_leave_hierarchy.sql
-- ---------------------------------------------------------------------------
-- Aprovação de férias segue a hierarquia: só decide quem está acima.
--
-- Antes, qualquer chefe podia decidir o plano de outro chefe — ou do próprio
-- administrador. Agora vale a mesma regra do resto do backoffice: o gestor
-- tem de ter rank estritamente superior ao do colaborador.
begin;

create or replace function public.can_decide_leave_for(target uuid)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    -- O administrador está no topo: decide tudo, incluindo o seu próprio plano.
    when (select role::text from public.profiles where id = auth.uid()) = 'admin'
      then true
    -- O chefe decide quem está abaixo dele, nunca um par nem um superior.
    when (select role::text from public.profiles where id = auth.uid()) = 'chefe'
      then (select role::text from public.profiles where id = target)
           in ('vendedor', 'mecanico')
    else false
  end;
$$;
revoke all on function public.can_decide_leave_for(uuid) from public;
grant execute on function public.can_decide_leave_for(uuid) to authenticated, service_role;

-- As políticas passam a usar a regra da hierarquia em vez do "é chefe ou admin".
drop policy if exists "leave_days: own update" on public.leave_days;
create policy "leave_days: own update"
  on public.leave_days for update to authenticated
  using (
    (profile_id = auth.uid() and status in ('draft', 'pending'))
    or public.can_decide_leave_for(profile_id)
  )
  with check (profile_id = auth.uid() or public.can_decide_leave_for(profile_id));

drop policy if exists "leave_days: own delete" on public.leave_days;
create policy "leave_days: own delete"
  on public.leave_days for delete to authenticated
  using (
    (profile_id = auth.uid() and status in ('draft', 'pending'))
    or public.can_decide_leave_for(profile_id)
  );

-- O administrador aprova o próprio plano ao submetê-lo, por isso tem de poder
-- inserir já como aprovado. Os restantes continuam limitados a draft/pending.
drop policy if exists "leave_days: own insert" on public.leave_days;
create policy "leave_days: own insert"
  on public.leave_days for insert to authenticated
  with check (
    profile_id = auth.uid()
    and (
      status in ('draft', 'pending')
      or (status = 'approved' and public.can_decide_leave_for(auth.uid()))
    )
  );

-- Saldos: mesma regra. Cada um vê o seu; quem gere vê e altera os de baixo.
drop policy if exists "leave_balances: read own or approver" on public.leave_balances;
create policy "leave_balances: read own or approver"
  on public.leave_balances for select to authenticated
  using (profile_id = auth.uid() or public.can_decide_leave_for(profile_id));

drop policy if exists "leave_balances: approver writes" on public.leave_balances;
create policy "leave_balances: approver writes"
  on public.leave_balances for all to authenticated
  using (public.can_decide_leave_for(profile_id))
  with check (public.can_decide_leave_for(profile_id));

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0023_profile_write_grants.sql
-- ---------------------------------------------------------------------------
-- Deixar o colaborador gravar os próprios dados de perfil.
--
-- A migração 0013 fez `revoke update on public.profiles` e devolveu apenas
-- `grant update(full_name)`, para que ninguém pudesse promover-se a si mesmo
-- mexendo no papel ou nas secções. Quando a 0021 acrescentou telefone, data de
-- nascimento e função, esse grant não foi alargado — a política RLS "profiles:
-- self update" autorizava a linha, mas o Postgres recusava as colunas, e a
-- gravação do perfil falhava com um erro genérico.
--
-- Aqui alarga-se o grant às três colunas novas. O papel (`role`) e as secções
-- continuam de fora, de propósito: essas mudam-se em Utilizadores, por quem
-- gere pessoas, nunca no próprio perfil.
begin;

grant update(phone, birth_date, job_title) on public.profiles to authenticated;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0024_whatsapp_orders.sql
-- ---------------------------------------------------------------------------
-- Ordens do backoffice vindas do WhatsApp.
--
-- O colaborador manda uma mensagem ("coloca uma despesa de 450 de embraiagem ao
-- bmw 320") e o sistema registra-a na oficina ou nos custos. O que se resolve
-- aqui é o problema de fundo desse canal: QUEM escreve na base de dados.
--
-- Um webhook não tem sessão Supabase, logo `auth.uid()` é nulo. E tudo o que
-- protege estas tabelas depende dele: `has_section()` decide por `auth.uid()`, a
-- RLS de vehicle_costs/vehicle_tasks/cars está construída sobre `has_section()`,
-- e o gatilho `audit_change()` grava `actor_id := auth.uid()`. Escrever com a
-- chave de serviço resolveria o acesso ao preço de saltar a RLS e de gravar
-- auditoria sem autor — as duas coisas que não se podem perder num canal que
-- mexe em dinheiro.
--
-- A solução tem duas metades que NÃO se devem confundir:
--
--   Autorização  → sempre com o id explícito do colaborador
--                  (`has_section_for(actor, …)`), nunca com `auth.uid()`.
--   Atribuição   → assume-se a identidade da pessoa dentro da transacção, para
--                  que o histórico da viatura mostre quem deu a ordem.
--
-- Separá-las é o ponto: se a autorização dependesse da impersonação, uma falha
-- da impersonação abriria a porta em vez de a fechar.
--
-- Saída de emergência, se algum dia a impersonação deixar de ser possível:
-- assinar aqui um JWT curto com o segredo do projecto e usar um cliente
-- autenticado normal. Faz a RLS aplicar-se inteira, mas dá ao webhook um
-- cliente de uso geral — tudo o que a pessoa pode fazer, um erro de código
-- passaria a poder fazer. Três verbos batem essa elegância.
begin;

-- ---------------------------------------------------------------------------
-- Permissões com o id explícito
-- ---------------------------------------------------------------------------

-- O MESMO `case` que a 0013 já tinha, agora parametrizado pelo utilizador. A
-- regra continua a existir numa só cópia em SQL.
create or replace function public.has_section_for(uid uuid, section text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case
    when role::text = 'admin' then true
    when role::text = 'mecanico' then section = 'oficina'
    when section = 'dashboard' then true
    when cardinality(allowed_sections) > 0 then section = any(allowed_sections)
    when role::text = 'chefe' then section = any(array['carros','pagina-inicial','leads','testemunhos','financeiro'])
    when role::text = 'vendedor' then section = any(array['carros','leads'])
    else false end from public.profiles where id = uid), false);
$$;
revoke all on function public.has_section_for(uuid, text) from public, anon;
grant execute on function public.has_section_for(uuid, text) to authenticated, service_role;

-- `has_section` passa a invólucro: mesma assinatura, mesmas políticas RLS, zero
-- duplicação da regra.
create or replace function public.has_section(section text)
returns boolean language sql stable security definer set search_path = public as $$
  select public.has_section_for(auth.uid(), section);
$$;

-- A permissão de tipo de viatura só existia em TypeScript (`effectiveVehicleTypes`),
-- por isso não protegia nada que escrevesse com a chave de serviço. Nulo ou vazio
-- = sem restrição, como no TypeScript.
create or replace function public.has_vehicle_type_for(uid uuid, vtype text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role::text = 'admin'
    or allowed_vehicle_types is null
    or cardinality(allowed_vehicle_types) = 0
    or vtype = any(allowed_vehicle_types)
    from public.profiles where id = uid), false);
$$;
revoke all on function public.has_vehicle_type_for(uuid, text) from public, anon;
grant execute on function public.has_vehicle_type_for(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- A porta única das escritas vindas do WhatsApp
-- ---------------------------------------------------------------------------

create or replace function public.wa_begin_as(actor uuid, sections text[])
returns void language plpgsql security definer set search_path = public as $$
begin
  if actor is null then raise exception 'Ator em falta'; end if;
  if not exists (select 1 from public.profiles where id = actor) then
    raise exception 'Colaborador desconhecido';
  end if;
  -- Autoriza com o id explícito: basta uma das secções pedidas.
  if not exists (select 1 from unnest(sections) s where public.has_section_for(actor, s)) then
    raise exception 'Sem permissão';
  end if;

  -- Só agora se assume a identidade, e só nesta transacção (is_local = true).
  -- Definem-se os dois nomes porque não se sabe qual deles o `auth.uid()` da
  -- Supabase lê nesta versão — a função vive no esquema `auth`, que não é nosso.
  perform set_config('request.jwt.claim.sub', actor::text, true);
  perform set_config('request.jwt.claims',
    json_build_object('sub', actor::text, 'role', 'authenticated')::text, true);

  -- E verifica-se. Sem isto, o modo de falha mais provável de todo este desenho
  -- — o `auth.uid()` ler um nome que não definimos — seria silencioso e
  -- produziria exactamente a auditoria sem autor que isto existe para evitar.
  if auth.uid() is distinct from actor then
    raise exception 'Falha ao assumir a identidade do colaborador';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Escritas: três verbos, nada mais
-- ---------------------------------------------------------------------------

create or replace function public.wa_create_workshop_vehicle(
  actor uuid, vehicle_name text, plate text, selected_type text) returns uuid
language plpgsql security definer set search_path = public as $$
begin
  perform public.wa_begin_as(actor, array['oficina']);
  if not public.has_vehicle_type_for(actor, selected_type) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;
  -- Delega na RPC de 0019, que já usa auth.uid() e has_section por dentro — e a
  -- partir do wa_begin_as os dois dizem o que queremos. Nada é duplicado.
  return public.create_workshop_intake_for_type(vehicle_name, plate, selected_type);
end $$;

create or replace function public.wa_add_cost(
  actor uuid, car uuid, kind text, note text, value numeric, incurred date)
returns uuid language plpgsql security definer set search_path = public as $$
declare novo uuid; vtype text;
begin
  -- Material basta a Oficina; mão de obra, transporte e preparação são dinheiro
  -- de gestão e exigem Financeiro. Espelha a regra que `addWorkshopCost` já
  -- aplica no backoffice.
  if kind in ('parts', 'other') then
    perform public.wa_begin_as(actor, array['oficina', 'financeiro']);
  else
    perform public.wa_begin_as(actor, array['financeiro']);
  end if;

  if kind not in ('transport','parts','labour','preparation','other') then
    raise exception 'Categoria inválida';
  end if;
  if value is null or value <= 0 or value > 9999999 then
    raise exception 'Valor inválido';
  end if;
  if length(trim(coalesce(note, ''))) not between 1 and 500 then
    raise exception 'Descrição inválida';
  end if;
  if incurred is null or incurred > current_date
     or incurred < current_date - interval '1 year' then
    raise exception 'Data inválida';
  end if;

  select vehicle_type into vtype from public.cars where id = car;
  if vtype is null then raise exception 'Viatura inexistente'; end if;
  if not public.has_vehicle_type_for(actor, vtype) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;

  insert into public.vehicle_costs(car_id, category, description, amount, incurred_on, created_by)
  values (car, kind, trim(note), value, incurred, actor)
  returning id into novo;
  return novo;
end $$;

create or replace function public.wa_log_hours(
  actor uuid, car uuid, work_day date, starts time, ends time, note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare novo uuid; vtype text;
begin
  perform public.wa_begin_as(actor, array['oficina']);
  if starts is null then raise exception 'Hora de início em falta'; end if;
  if ends is not null and ends = starts then raise exception 'Fim igual ao início'; end if;
  if work_day is null or work_day > current_date then raise exception 'Data inválida'; end if;

  select vehicle_type into vtype from public.cars where id = car;
  if vtype is null then raise exception 'Viatura inexistente'; end if;
  if not public.has_vehicle_type_for(actor, vtype) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;

  -- `hours` não é passado de propósito: o gatilho `calculate_work_hours` (0013)
  -- recalcula-o sempre a partir do início e do fim.
  insert into public.vehicle_tasks(car_id, work_date, start_time, end_time, description, created_by)
  values (car, work_day, starts, ends, nullif(trim(coalesce(note, '')), ''), actor)
  returning id into novo;
  return novo;
end $$;

-- ---------------------------------------------------------------------------
-- Leituras, já filtradas pelas permissões
-- ---------------------------------------------------------------------------

-- Um número nacional de 9 dígitos gravado sem indicativo é completado com o 351,
-- como faz o `normalizeWhatsApp` do TypeScript. `immutable` para poder indexar.
create or replace function public.normalize_phone(raw text)
returns text language sql immutable strict as $$
  select case
    when regexp_replace(raw, '\D', '', 'g') ~ '^[29]\d{8}$'
      then '351' || regexp_replace(raw, '\D', '', 'g')
    else regexp_replace(raw, '\D', '', 'g') end;
$$;

create or replace function public.wa_actor_for_phone(raw_phone text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare alvo uuid; quantos int;
begin
  if raw_phone is null or public.normalize_phone(raw_phone) = '' then return null; end if;
  select count(*) into quantos from public.profiles p
   where p.phone is not null
     and public.normalize_phone(p.phone) = public.normalize_phone(raw_phone);
  -- Dois perfis com o mesmo telefone: falha fechada. Mais vale não responder do
  -- que atribuir uma ordem à pessoa errada.
  if quantos <> 1 then return null; end if;
  select p.id into alvo from public.profiles p
   where p.phone is not null
     and public.normalize_phone(p.phone) = public.normalize_phone(raw_phone);
  return alvo;
end $$;

create or replace function public.wa_vehicles_for_actor(actor uuid)
returns table(id uuid, make text, model text, variant text, color text,
              license_plate text, status text, vehicle_type text)
language sql stable security definer set search_path = public as $$
  select c.id, c.make, c.model, c.variant, c.color, c.license_plate,
         c.status::text, c.vehicle_type
    from public.cars c
   where (public.has_section_for(actor, 'oficina')
       or public.has_section_for(actor, 'carros')
       or public.has_section_for(actor, 'financeiro'))
     and public.has_vehicle_type_for(actor, c.vehicle_type)
   order by c.updated_at desc;
$$;

create or replace function public.wa_vehicle_summary(actor uuid, car uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when not exists (
      select 1 from public.wa_vehicles_for_actor(actor) v where v.id = car
    ) then null else jsonb_build_object(
    'costs', coalesce((select sum(amount) from public.vehicle_costs where car_id = car), 0),
    'cost_count', (select count(*) from public.vehicle_costs where car_id = car),
    'hours', coalesce((select sum(hours) from public.vehicle_tasks where car_id = car), 0),
    'status', (select status::text from public.cars where id = car)
  ) end;
$$;

-- ---------------------------------------------------------------------------
-- Estado do canal: idempotência e propostas à espera de confirmação
-- ---------------------------------------------------------------------------

-- A Meta reentrega a mesma mensagem quando não recebe 200 a tempo. Sem esta
-- tabela, uma reentrega lançava o custo duas vezes.
create table if not exists public.wa_messages (
  wam_id        text primary key,
  from_phone    text not null,
  actor_id      uuid references public.profiles(id) on delete set null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  reply_sent_at timestamptz,
  last_error    text
);
create index if not exists wa_messages_received_idx on public.wa_messages(received_at);

-- A acção já interpretada e validada, à espera do "sim". Guarda-se o que vai ser
-- escrito, não o texto original: a confirmação nunca reinterpreta nada, por isso
-- o que é gravado é forçosamente o que a pessoa leu.
create table if not exists public.wa_pending_actions (
  id         uuid primary key default gen_random_uuid(),
  actor_id   uuid not null references public.profiles(id) on delete cascade,
  from_phone text not null,
  kind       text not null check (kind in ('register_vehicle','add_cost','log_hours')),
  payload    jsonb not null,
  summary    text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '10 minutes',
  status     text not null default 'pending'
             check (status in ('pending','confirmed','cancelled','expired','superseded')),
  settled_at timestamptz,
  result_id  uuid
);
-- Um número só pode ter uma proposta em aberto: a nova substitui a anterior.
create unique index if not exists wa_pending_one_open
  on public.wa_pending_actions(from_phone) where status = 'pending';

-- Canalização de servidor, como `submission_limits`: RLS activa e nenhuma
-- política, logo só o service_role (que a ignora) lhes toca.
alter table public.wa_messages enable row level security;
alter table public.wa_pending_actions enable row level security;
revoke all on public.wa_messages from anon, authenticated;
revoke all on public.wa_pending_actions from anon, authenticated;

-- As matrículas na base de dados são inconsistentes: a RPC da oficina grava
-- `upper(trim(plate))` sem tirar hífenes e o formulário grava-os. Comparar
-- sempre pela forma canónica — e indexá-la, para a procura não varrer a tabela.
create index if not exists cars_plate_key_idx on public.cars
  ((upper(regexp_replace(coalesce(license_plate, ''), '[^A-Za-z0-9]', '', 'g'))));
create index if not exists profiles_phone_key_idx on public.profiles
  (public.normalize_phone(phone)) where phone is not null;

create or replace function public.prune_whatsapp() returns void
language sql security definer set search_path = public as $$
  delete from public.wa_messages where received_at < now() - interval '7 days';
  delete from public.wa_pending_actions
   where status <> 'pending' and created_at < now() - interval '1 day';
$$;

-- Só o servidor. O bloco faz o revoke e o grant juntos, para não se poder
-- acrescentar uma função e esquecer o revoke.
do $$ declare sig text; begin
  foreach sig in array array[
    'wa_begin_as(uuid,text[])',
    'wa_create_workshop_vehicle(uuid,text,text,text)',
    'wa_add_cost(uuid,uuid,text,text,numeric,date)',
    'wa_log_hours(uuid,uuid,date,time,time,text)',
    'wa_actor_for_phone(text)',
    'wa_vehicles_for_actor(uuid)',
    'wa_vehicle_summary(uuid,uuid)',
    'prune_whatsapp()'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0025_olx.sql
-- ---------------------------------------------------------------------------
-- Publicação automática no OLX (Partner API).
--
-- Até aqui o estado em cada portal era registado à mão em `channel_listings`.
-- Para o OLX passa a ser o próprio sistema a criar, atualizar e retirar o
-- anúncio, por isso a tabela ganha o estado da sincronização e o último erro.
--
-- Os tokens OAuth da conta do stand ficam numa tabela só de servidor: dão
-- acesso total à conta do OLX (o OLX avisa que um token é "como uma
-- password"), e por isso nenhuma sessão do backoffice os pode ler — nem um
-- administrador. As credenciais da aplicação (client_id/secret) nem sequer
-- vivem na base de dados: estão nas variáveis de ambiente do Netlify.
begin;

-- Ligação à conta do stand no OLX. Uma linha só (id = 1).
create table if not exists public.olx_connection (
  id             int primary key default 1 check (id = 1),
  access_token   text not null,
  refresh_token  text not null,
  expires_at     timestamptz not null,
  olx_user_id    text,
  olx_user_name  text,
  -- Localização do stand no OLX (a cidade é obrigatória em cada anúncio),
  -- resolvida a partir das coordenadas das Definições.
  city_id        bigint,
  district_id    bigint,
  connected_by   uuid references public.profiles(id) on delete set null,
  connected_at   timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Categoria do OLX para carros e para motas, com a definição dos atributos.
-- Os IDs variam por país e não vêm na documentação: são lidos da API pelo
-- botão "Carregar categorias" em Integrações.
create table if not exists public.olx_category_cache (
  vehicle_type text primary key check (vehicle_type in ('car', 'motorcycle')),
  category_id  bigint not null,
  category_name text not null default '',
  photos_limit int not null default 0,
  attributes   jsonb not null default '[]'::jsonb,
  fetched_at   timestamptz not null default now()
);

-- Canalização de servidor: RLS ativa e nenhuma política, como `wa_messages`.
-- O painel de Integrações lê o estado através do cliente de serviço, e só
-- mostra o que é seguro mostrar (nunca os tokens).
alter table public.olx_connection enable row level security;
alter table public.olx_category_cache enable row level security;
revoke all on public.olx_connection from anon, authenticated;
revoke all on public.olx_category_cache from anon, authenticated;

-- Estado da sincronização automática, por viatura e canal.
alter table public.channel_listings
  add column if not exists sync_state text not null default 'idle'
    check (sync_state in ('idle', 'pending', 'syncing', 'error')),
  add column if not exists last_error text,
  add column if not exists last_synced_at timestamptz,
  add column if not exists remote_status text,
  add column if not exists attempts int not null default 0;

create index if not exists idx_channel_listings_sync
  on public.channel_listings (channel, sync_state)
  where sync_state in ('pending', 'error');

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0026_profile_owner.sql
-- ---------------------------------------------------------------------------
-- Dono da conta: o único administrador que pode gerir os outros administradores.
--
-- Entre administradores ninguém mexe em ninguém (mesmo nível). Sem um dono,
-- um admin que se fosse embora não podia ser despromovido nem apagado a partir
-- do backoffice. O dono resolve isso sem dar esse poder a todos os admins.
--
-- A coluna só é escrita pelo servidor (service_role): o `authenticated` só tem
-- `update` em full_name, phone, birth_date e job_title (0013/0023), por isso
-- ninguém se promove a dono pelo browser.

alter table public.profiles
  add column if not exists is_owner boolean not null default false;

-- No máximo um dono.
create unique index if not exists profiles_single_owner_idx
  on public.profiles ((true)) where is_owner;

-- O primeiro administrador criado fica dono, se ainda não houver nenhum.
update public.profiles
set is_owner = true
where id = (
  select id from public.profiles
  where role = 'admin'
  order by created_at
  limit 1
)
and not exists (select 1 from public.profiles where is_owner);
commit;

-- ---------------------------------------------------------------------------
-- 0027_workshop_statuses.sql
-- ---------------------------------------------------------------------------
-- Dois estados novos para as viaturas que entram pela oficina:
--   workshop  → "Na oficina": só aparece na Oficina, não em Viaturas;
--   prepared  → "Preparado": a oficina acabou; aparece em Viaturas para o
--               vendedor completar a ficha e publicar.
--
-- Fica numa migração à parte porque o Postgres não deixa usar um valor novo de
-- um enum na mesma transação em que foi criado. A 0028 é que os usa.

alter type public.car_status add value if not exists 'workshop' before 'draft';
alter type public.car_status add value if not exists 'prepared' after 'draft';
commit;

-- ---------------------------------------------------------------------------
-- 0028_workshop_flow.sql
-- ---------------------------------------------------------------------------
-- Fluxo oficina → viaturas (usa os estados criados na 0027).
--
--  1. O que se regista na oficina entra "Na oficina" (antes entrava em
--     rascunho e aparecia logo em Viaturas).
--  2. Quem tem a Oficina dá-a como preparada → "Preparado", e passa a aparecer
--     em Viaturas.
--  3. Uma viatura preparada (ou em rascunho) pode voltar para a oficina.
--
-- As mudanças 2 e 3 passam por funções, porque o mecânico não tem permissão de
-- escrita na tabela `cars` (só quem tem o separador Viaturas a tem).

-- Enquanto está na oficina ou preparada, a ficha pode estar incompleta — como
-- no rascunho. Publicar continua a exigir os dados todos.
alter table public.cars drop constraint if exists complete_public_car;
alter table public.cars add constraint complete_public_car check
(status in ('workshop', 'draft', 'prepared') or (year is not null and fuel is not null and transmission is not null and body is not null and model <> '—')) not valid;

create or replace function public.create_workshop_intake(vehicle_name text, plate text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid := gen_random_uuid();
begin
 if not public.has_section('oficina') then raise exception 'Sem permissão'; end if;
 if length(trim(vehicle_name)) not between 1 and 120 or length(trim(plate)) not between 2 and 20 then raise exception 'Dados inválidos'; end if;
 insert into public.cars(id,slug,make,model,year,license_plate,fuel,transmission,body,status,price_on_request,created_by)
 values(result,'oficina-'||result,trim(vehicle_name),'—',null,upper(trim(plate)),null,null,null,'workshop',true,auth.uid());
 return result;
end $$;

create or replace function public.create_workshop_intake_for_type(vehicle_name text,plate text,selected_type text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid := gen_random_uuid();
begin
  if not public.has_section('oficina') then raise exception 'Sem permissão'; end if;
  if selected_type is null or selected_type not in ('car','motorcycle') then raise exception 'Tipo inválido'; end if;
  if vehicle_name is null or plate is null or length(trim(vehicle_name)) not between 1 and 120 or length(trim(plate)) not between 2 and 20 then raise exception 'Dados inválidos'; end if;
  insert into public.cars(id,slug,make,model,year,license_plate,fuel,transmission,body,status,price_on_request,created_by,vehicle_type,doors,seats)
  values(result,'oficina-'||result,trim(vehicle_name),'—',null,upper(trim(plate)),null,null,null,'workshop',true,auth.uid(),selected_type,case when selected_type='motorcycle' then 0 else null end,case when selected_type='motorcycle' then 2 else null end);
  return result;
end $$;

-- Oficina → Preparado.
create or replace function public.mark_vehicle_prepared(vehicle uuid) returns void
language plpgsql security definer set search_path=public as $$
declare current_status public.car_status; vtype text;
begin
  if not public.has_section('oficina') then raise exception 'Sem permissão'; end if;
  select status, vehicle_type into current_status, vtype from public.cars where id = vehicle for update;
  if not found then raise exception 'Viatura não encontrada'; end if;
  if not public.has_vehicle_type_for(auth.uid(), vtype) then raise exception 'Sem permissão'; end if;
  if current_status <> 'workshop' then raise exception 'A viatura não está na oficina'; end if;
  update public.cars set status = 'prepared' where id = vehicle;
end $$;
revoke all on function public.mark_vehicle_prepared(uuid) from public, anon;
grant execute on function public.mark_vehicle_prepared(uuid) to authenticated;

-- Preparado (ou rascunho) → volta para a oficina.
create or replace function public.return_vehicle_to_workshop(vehicle uuid) returns void
language plpgsql security definer set search_path=public as $$
declare current_status public.car_status; vtype text;
begin
  if not (public.has_section('oficina') or public.has_section('carros')) then raise exception 'Sem permissão'; end if;
  select status, vehicle_type into current_status, vtype from public.cars where id = vehicle for update;
  if not found then raise exception 'Viatura não encontrada'; end if;
  if not public.has_vehicle_type_for(auth.uid(), vtype) then raise exception 'Sem permissão'; end if;
  if current_status not in ('prepared', 'draft') then
    raise exception 'Só uma viatura preparada ou em rascunho pode voltar para a oficina';
  end if;
  update public.cars set status = 'workshop' where id = vehicle;
end $$;
revoke all on function public.return_vehicle_to_workshop(uuid) from public, anon;
grant execute on function public.return_vehicle_to_workshop(uuid) to authenticated;

-- As viaturas registadas na oficina que ninguém completou (modelo ainda "—")
-- continuam na oficina: saem de Viaturas até serem dadas como preparadas.
update public.cars set status = 'workshop'
where status = 'draft' and slug like 'oficina-%' and model = '—';
commit;

-- ---------------------------------------------------------------------------
-- 0029_time_entries.sql
-- ---------------------------------------------------------------------------
-- Separador "Horas": cada utilizador regista as suas horas e tarefas.
--
-- As horas feitas numa viatura já vivem em `vehicle_tasks` (com `created_by`)
-- e aparecem sozinhas nas Horas de quem as registou. Esta tabela guarda o
-- resto: trabalho que não é numa viatura (limpeza, atendimento, recados…).
--
-- Cada um só vê e mexe nas suas; o administrador vê e corrige as de todos.

create table if not exists public.time_entries (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  work_date   date not null default current_date,
  start_time  time not null,
  end_time    time,
  hours       numeric(6,2) not null default 0 check (hours >= 0),
  description text not null check (length(trim(description)) between 1 and 500),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists time_entries_profile_date_idx on public.time_entries(profile_id, work_date);

-- As horas calculam-se na BD, como nas viaturas: um pedido direto à API não
-- consegue gravar um total inventado.
drop trigger if exists calculate_hours on public.time_entries;
create trigger calculate_hours before insert or update on public.time_entries
for each row execute function public.calculate_work_hours();

alter table public.time_entries enable row level security;
revoke all on public.time_entries from anon;
grant select, insert, update, delete on public.time_entries to authenticated;

drop policy if exists "time: read" on public.time_entries;
create policy "time: read" on public.time_entries for select to authenticated
using (profile_id = auth.uid() or public.is_admin());

-- Só se regista em nome próprio.
drop policy if exists "time: insert" on public.time_entries;
create policy "time: insert" on public.time_entries for insert to authenticated
with check (profile_id = auth.uid());

drop policy if exists "time: update" on public.time_entries;
create policy "time: update" on public.time_entries for update to authenticated
using (profile_id = auth.uid() or public.is_admin())
with check (profile_id = auth.uid() or public.is_admin());

drop policy if exists "time: delete" on public.time_entries;
create policy "time: delete" on public.time_entries for delete to authenticated
using (profile_id = auth.uid() or public.is_admin());
commit;

-- ---------------------------------------------------------------------------
-- 0030_olx_stats.sql
-- ---------------------------------------------------------------------------
-- Estatísticas dos anúncios do OLX (GET /adverts/{id}/statistics), guardadas
-- junto ao anúncio para o backoffice as mostrar sem ir ao OLX a cada página.
-- Atualizam-se uma vez por dia (/api/maintenance) e com um botão.

alter table public.channel_listings
  add column if not exists views integer check (views >= 0),
  add column if not exists phone_views integer check (phone_views >= 0),
  add column if not exists observers integer check (observers >= 0),
  add column if not exists stats_at timestamptz;
commit;

-- ---------------------------------------------------------------------------
-- 0031_olx_category_per_car.sql
-- ---------------------------------------------------------------------------
-- Categoria do OLX por viatura.
--
-- Cada tipo continua a ter a sua categoria padrão (`olx_category_cache`), mas
-- uma viatura pode ir para outra — por exemplo uma moto 4, que no OLX não é
-- "Motociclos". Os atributos de cada categoria escolhida (padrão ou exceção)
-- guardam-se aqui, porque são eles que dizem que campos o anúncio leva.

create table if not exists public.olx_category_details (
  category_id  bigint primary key,
  -- Caminho legível: "Carros, motos e barcos › Motociclos - Scooters › …".
  category_name text not null default '',
  photos_limit int not null default 0,
  attributes   jsonb not null default '[]'::jsonb,
  fetched_at   timestamptz not null default now()
);

-- Canalização de servidor, como as outras tabelas do OLX: só o cliente de
-- serviço lê e escreve.
alter table public.olx_category_details enable row level security;
revoke all on public.olx_category_details from anon, authenticated;

-- Nulo = usa a categoria padrão do tipo.
alter table public.cars add column if not exists olx_category_id bigint;
commit;

-- ---------------------------------------------------------------------------
-- 0032_olx_fields.sql
-- ---------------------------------------------------------------------------
-- Campos do OLX na ficha e na pesquisa do site.
--
-- Cada categoria do OLX tem a sua lista de campos (marca, modelo, segmento,
-- cor, condição, …), que o site já guarda ao escolher a categoria. Agora:
--  - os valores que o stand escolhe para cada campo ficam na viatura;
--  - o site público pode ler a lista de campos, para mostrar os mesmos filtros.

-- { "codigo_do_campo": "valor" | ["valor", …] } — os códigos são os do OLX.
alter table public.cars add column if not exists olx_attributes jsonb not null default '{}'::jsonb;

-- Os campos das categorias padrão, sem nada da ligação (tokens) nem das
-- categorias de exceção. As tabelas do OLX continuam fechadas; isto só expõe
-- a lista de campos, que é pública no próprio OLX.
create or replace function public.olx_category_fields()
returns table (vehicle_type text, category_id bigint, category_name text, attributes jsonb)
language sql stable security definer set search_path = public as $$
  select vehicle_type, category_id, category_name, attributes from public.olx_category_cache;
$$;
revoke all on function public.olx_category_fields() from public;
grant execute on function public.olx_category_fields() to anon, authenticated;
commit;

-- ---------------------------------------------------------------------------
-- 0033_body_types.sql
-- ---------------------------------------------------------------------------
-- Segmentos que faltavam: "Utilitário" nos carros (ex.: Renault Mégane) e
-- "Moto 4" nas motas (quads/ATV, ex.: Suzuki LTR 450).
alter type public.body_type add value if not exists 'Utilitário' after 'Citadino';
alter type public.body_type add value if not exists 'Moto 4';

-- A regra que liga o segmento ao tipo tinha a lista das motas fechada: sem
-- "Moto 4" lá, uma moto 4 era recusada. Comparação textual (como na 0018)
-- para não usar os valores novos do enum antes do COMMIT.
alter table public.cars drop constraint if exists cars_vehicle_category_check;
alter table public.cars add constraint cars_vehicle_category_check check (
  body is null or ((vehicle_type = 'motorcycle') = (body::text in ('Scooter','Naked','Desportiva','Trail','Touring','Chopper/Cruiser','Enduro','Moto 4')))
);
commit;

-- ---------------------------------------------------------------------------
-- 0034_vehicle_badges.sql
-- ---------------------------------------------------------------------------
-- Etiquetas do stand marcadas em cada viatura (ex.: "IVA dedutível").
-- Guarda os ids das etiquetas criadas em Definições → Etiquetas; o texto e a
-- cor vivem lá (site_content, chave 'badges'), para se mudarem num só sítio.
alter table public.cars add column if not exists badges text[] not null default '{}';
commit;

-- ---------------------------------------------------------------------------
-- 0035_whatsapp_connection.sql
-- ---------------------------------------------------------------------------
-- Ligação ao número de WhatsApp da empresa, feita no backoffice.
--
-- Até aqui o número e o token viviam só nas variáveis do Netlify
-- (WHATSAPP_PHONE_NUMBER_ID e WHATSAPP_ACCESS_TOKEN), e trocar de número
-- obrigava a ir ao painel da Meta copiar valores e fazer um novo deploy. Agora
-- o administrador carrega em «Ligar número do WhatsApp» em Integrações, escolhe
-- o número na janela da própria Meta (Embedded Signup), e o site guarda aqui o
-- resultado. As variáveis continuam a funcionar quando esta tabela está vazia.
--
-- Como `olx_connection`: o token dá acesso para enviar mensagens em nome da
-- empresa, por isso a tabela é só de servidor e nenhuma sessão a lê — nem um
-- administrador. O App Secret e o ID da app não vivem aqui: são da app da Meta,
-- não do número, e ficam nas variáveis de ambiente.
begin;

-- Uma linha só (id = 1): o site responde por um número de cada vez.
create table if not exists public.whatsapp_connection (
  id                   int primary key default 1 check (id = 1),
  -- Os dois IDs entram em caminhos do Graph API: só algarismos, sempre.
  waba_id              text not null check (waba_id ~ '^[0-9]+$'),
  phone_number_id      text not null check (phone_number_id ~ '^[0-9]+$'),
  access_token         text not null,
  -- A configuração de Embedded Signup da Meta dá tokens de 60 dias. Guarda-se
  -- a validade (lida da Meta ao ligar) para o painel avisar a tempo de se
  -- voltar a ligar o número. Nulo = a Meta não disse, ou não expira.
  token_expires_at     timestamptz,
  display_phone_number text,
  verified_name        text,
  -- PIN da verificação em dois passos, definido ao registar o número na Cloud
  -- API. É preciso para voltar a registar o número (por exemplo, noutra app);
  -- se se perder, a Meta deixa redefini-lo no WhatsApp Manager.
  registration_pin     text,
  -- O registo pode falhar sem impedir a ligação (o número já estava registado
  -- com outro PIN, por exemplo). Fica escrito para o painel o mostrar.
  register_warning     text,
  connected_by         uuid references public.profiles(id) on delete set null,
  connected_at         timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Canalização de servidor: RLS ativa e nenhuma política, como `olx_connection`.
alter table public.whatsapp_connection enable row level security;
revoke all on public.whatsapp_connection from anon, authenticated;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0036_whatsapp_notifications.sql
-- ---------------------------------------------------------------------------
-- Avisos por WhatsApp aos colaboradores do backoffice.
--
-- Até aqui, o que entrava no backoffice (um contacto do site, uma proposta de
-- preço, um testemunho por aprovar, uma viatura nova na oficina) só se via
-- abrindo o backoffice — ou, para os contactos, num webhook genérico (Slack,
-- Make…). A partir daqui, cada colaborador com telefone no perfil recebe uma
-- mensagem no WhatsApp sobre o que é da sua área.
--
-- Decisões que não se devem desfazer sem pensar:
--
--  * A fila é a que já existia (`notification_jobs`, 0013), com um canal novo.
--    Um aviso por WhatsApp é uma linha por PESSOA, e um índice único (aviso,
--    registo, pessoa) garante que o mesmo acontecimento nunca chega duas vezes
--    à mesma pessoa — mesmo que o gatilho volte a correr ou que dois processos
--    agendem ao mesmo tempo.
--  * Os avisos são agendados por gatilhos na base de dados, e não no código das
--    páginas: assim apanham também o que não passa pelos formulários do
--    backoffice — as viaturas criadas pelo assistente do WhatsApp, por exemplo.
--    E nunca bloqueiam: um erro a agendar é engolido (fica um WARNING no log da
--    base de dados) e o contacto do cliente grava-se na mesma.
--  * Quem recebe decide-se com as MESMAS regras do backoffice
--    (`has_section_for` e `has_vehicle_type_for`, da 0024): ninguém fica a saber
--    pelo WhatsApp de um contacto que não poderia abrir no backoffice. E volta a
--    verificar-se antes de enviar — quem perdeu o acesso entretanto não recebe.
--  * Quem fez a ação não é avisado dela própria.
--  * O canal começa DESLIGADO. A Meta só deixa a empresa iniciar conversas com
--    modelos aprovados (docs/WHATSAPP_TEMPLATES.md); até lá, cada envio falhava.
--    O administrador liga-o em Integrações depois de os modelos estarem
--    aprovados — e, desligado, nada se acumula na fila.
--  * Entrega «no máximo uma vez»: um envio cujo resultado não se sabe (a Meta
--    não respondeu a tempo) não é repetido automaticamente — pode ter chegado.
--    Fica no painel de Integrações para o administrador decidir.
--
-- O número 0037 já existia (memória das conversas do assistente) quando esta
-- foi escrita; as duas não se tocam.
begin;

-- ---------------------------------------------------------------------------
-- Catálogo dos avisos: a que separador pertence cada um
-- ---------------------------------------------------------------------------

-- Uma só cópia da regra em SQL. O TypeScript (src/lib/notification-events.ts)
-- tem os textos; um teste garante que os dois catálogos têm os mesmos avisos.
-- Fica executável por todos de propósito: é usada na verificação da tabela de
-- preferências, que corre com as permissões de quem grava.
create or replace function public.notification_event_section(ev text)
returns text language sql immutable set search_path = public as $$
  select case ev
    -- Contactos do site, um aviso por tipo de pedido.
    when 'lead_contact'        then 'leads'
    when 'lead_test_drive'     then 'leads'
    when 'lead_offer'          then 'leads'
    when 'lead_reservation'    then 'leads'
    when 'lead_trade_in'       then 'leads'
    when 'lead_order'          then 'leads'
    when 'lead_alert'          then 'leads'
    -- Uma reserva feita por um colega: quem vende tem de deixar de a oferecer.
    when 'vehicle_reserved'    then 'leads'
    when 'testimonial_pending' then 'testemunhos'
    when 'vehicle_workshop'    then 'oficina'
    when 'vehicle_created'     then 'carros'
    when 'vehicle_prepared'    then 'carros'
    when 'vehicle_published'   then 'carros'
    -- O acesso dado pela Meta dura 60 dias; sem ele, o WhatsApp todo pára.
    when 'whatsapp_expiring'   then 'integracoes'
    else null end;
$$;

-- ---------------------------------------------------------------------------
-- Interruptor geral (uma linha só)
-- ---------------------------------------------------------------------------

create table if not exists public.notification_settings (
  id               int primary key default 1 check (id = 1),
  whatsapp_enabled boolean not null default false,
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now()
);
insert into public.notification_settings (id) values (1) on conflict (id) do nothing;

alter table public.notification_settings enable row level security;
-- Qualquer colaborador vê se o canal está ligado (o perfil diz-lhe se vai
-- receber avisos); só o administrador o muda.
drop policy if exists "notification_settings: staff read" on public.notification_settings;
create policy "notification_settings: staff read" on public.notification_settings
  for select to authenticated using (public.is_staff());
drop policy if exists "notification_settings: admin write" on public.notification_settings;
create policy "notification_settings: admin write" on public.notification_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.notification_settings from anon, authenticated;
grant select on public.notification_settings to authenticated;
grant update (whatsapp_enabled, updated_by, updated_at) on public.notification_settings to authenticated;
grant all on public.notification_settings to service_role;

-- ---------------------------------------------------------------------------
-- Preferências de cada pessoa
-- ---------------------------------------------------------------------------

-- Sem linha = ligado. Assim, quem nunca abriu o perfil recebe tudo, e um aviso
-- novo acrescentado mais tarde chega ligado a toda a gente, como os outros.
create table if not exists public.notification_preferences (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event      text not null check (public.notification_event_section(event) is not null),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (profile_id, event)
);

alter table public.notification_preferences enable row level security;
-- São pessoais: cada um vê e muda as suas, e mais ninguém (nem o administrador
-- desliga os avisos de outra pessoa).
drop policy if exists "notification_preferences: own" on public.notification_preferences;
create policy "notification_preferences: own" on public.notification_preferences
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
revoke all on public.notification_preferences from anon, authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;

-- ---------------------------------------------------------------------------
-- A fila de 0013 ganha o canal WhatsApp
-- ---------------------------------------------------------------------------

alter table public.notification_jobs
  add column if not exists channel       text not null default 'webhook',
  -- Só no WhatsApp: que aviso, sobre que registo, para quem.
  add column if not exists event         text,
  add column if not exists subject_id    uuid,
  add column if not exists recipient_id  uuid references public.profiles(id) on delete cascade,
  -- O que a mensagem diz, guardado no momento: o texto não muda se o registo
  -- for editado entretanto, e o envio não precisa de ler mais nada.
  add column if not exists payload       jsonb not null default '{}'::jsonb,
  -- Reclamado para envio. Fica preenchido enquanto não se sabe o resultado —
  -- é isso que impede o envio automático de repetir uma mensagem que pode ter
  -- chegado.
  add column if not exists claimed_at    timestamptz,
  -- Não enviado de propósito (a pessoa perdeu o acesso, já não é novidade…).
  -- O motivo fica em `last_error`.
  add column if not exists cancelled_at  timestamptz,
  -- O id da mensagem na Meta, para cruzar com o WhatsApp Manager.
  add column if not exists wa_message_id text;

-- Um aviso por WhatsApp sobre uma viatura não tem contacto associado.
alter table public.notification_jobs alter column lead_id drop not null;
-- O webhook continua a ter um envio por contacto; o WhatsApp tem um por pessoa.
alter table public.notification_jobs drop constraint if exists notification_jobs_lead_id_key;
create unique index if not exists notification_jobs_webhook_lead
  on public.notification_jobs (lead_id) where channel = 'webhook';
-- A garantia de «nunca duas vezes à mesma pessoa».
create unique index if not exists notification_jobs_whatsapp_once
  on public.notification_jobs (event, subject_id, recipient_id) where channel = 'whatsapp';
create index if not exists notification_jobs_whatsapp_recent
  on public.notification_jobs (created_at desc) where channel = 'whatsapp';

alter table public.notification_jobs drop constraint if exists notification_jobs_channel_check;
alter table public.notification_jobs add constraint notification_jobs_channel_check
  check (channel in ('webhook', 'whatsapp'));
alter table public.notification_jobs drop constraint if exists notification_jobs_shape;
alter table public.notification_jobs add constraint notification_jobs_shape check (
  (channel = 'webhook' and lead_id is not null) or
  (channel = 'whatsapp' and event is not null and subject_id is not null and recipient_id is not null));

-- O processamento do webhook (0013) passa a reclamar só os seus. Mesma
-- assinatura: os privilégios da 0013 mantêm-se.
create or replace function public.claim_notification_jobs() returns setof public.notification_jobs
language sql security definer set search_path = public as $$
 update public.notification_jobs set attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
 where id in (select id from public.notification_jobs
               where channel = 'webhook' and delivered_at is null and attempts < 8 and next_attempt_at <= now()
               order by created_at limit 3 for update skip locked)
 returning *;
$$;

-- ---------------------------------------------------------------------------
-- Quem recebe
-- ---------------------------------------------------------------------------

-- Porque é que esta pessoa NÃO pode receber este aviso (nulo = pode). Serve ao
-- agendar e outra vez antes de enviar, e o texto vai para o painel.
create or replace function public.notification_block_reason(uid uuid, ev text, vtype text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.notification_event_section(ev) is null then 'Aviso desconhecido'
    when p.id is null then 'O colaborador já não existe'
    -- O WhatsApp quer o número com indicativo: entre 9 e 15 algarismos.
    when length(coalesce(public.normalize_phone(p.phone), '')) not between 9 and 15
      then 'Sem telefone válido no perfil'
    when not public.has_section_for(p.id, public.notification_event_section(ev))
      then 'Sem acesso a este separador'
    when vtype is not null and not public.has_vehicle_type_for(p.id, vtype)
      then 'Sem acesso a este tipo de viatura'
    when exists (select 1 from public.notification_preferences np
                  where np.profile_id = p.id and np.event = ev and not np.enabled)
      then 'Aviso desligado no perfil'
    else null end
  from (select uid as id) alvo
  left join public.profiles p on p.id = alvo.id;
$$;

-- Toda a gente que pode receber, menos quem fez a ação. Dois perfis com o mesmo
-- telefone são o mesmo WhatsApp: recebe uma vez.
create or replace function public.notification_recipients(ev text, vtype text, actor uuid)
returns table (profile_id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select distinct on (public.normalize_phone(p.phone)) p.id, public.normalize_phone(p.phone)
    from public.profiles p
   where p.id is distinct from actor
     and public.notification_block_reason(p.id, ev, vtype) is null
   order by public.normalize_phone(p.phone), p.created_at, p.id;
$$;

-- Agenda um aviso para todos os que o devem receber. `auth.uid()` é quem fez a
-- ação: o colaborador no backoffice, o do WhatsApp (assumido pelo wa_begin_as
-- da 0024), ou ninguém num formulário público.
create or replace function public.queue_whatsapp_event(
  ev text, subject uuid, vtype text, details jsonb, lead uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not coalesce((select whatsapp_enabled from public.notification_settings where id = 1), false) then
    return 0;
  end if;
  if public.notification_event_section(ev) is null then
    raise exception 'Aviso desconhecido: %', ev;
  end if;
  insert into public.notification_jobs (channel, event, subject_id, recipient_id, lead_id, payload)
  select 'whatsapp', ev, subject, r.profile_id, lead,
         coalesce(details, '{}'::jsonb) || jsonb_build_object('vehicle_type', vtype)
    from public.notification_recipients(ev, vtype, auth.uid()) r
  on conflict (event, subject_id, recipient_id) where channel = 'whatsapp' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Os gatilhos. Todos engolem os próprios erros: avisar é acessório, gravar não.
-- ---------------------------------------------------------------------------

-- Contactos do site, de qualquer tipo. O tipo de viatura já foi preenchido pelo
-- gatilho `leads_vehicle_type` (0019), que corre antes.
create or replace function public.notify_lead_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.queue_whatsapp_event(
    case new.kind::text
      when 'test_drive'  then 'lead_test_drive'
      when 'offer'       then 'lead_offer'
      when 'reservation' then 'lead_reservation'
      when 'trade_in'    then 'lead_trade_in'
      when 'order'       then 'lead_order'
      when 'alert'       then 'lead_alert'
      else 'lead_contact' end,
    new.id, new.vehicle_type,
    -- Só o que a mensagem mostra. Email e telefone do cliente não vão para o
    -- WhatsApp: estão no backoffice, a um toque do link.
    jsonb_build_object(
      'kind', new.kind,
      'name', new.name,
      'car_label', new.car_label,
      'offer_amount', new.car_details -> 'offer_amount',
      'deposit', new.car_details -> 'deposit'),
    new.id);
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (contacto %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp on public.leads;
create trigger notify_whatsapp after insert on public.leads
  for each row execute function public.notify_lead_whatsapp();

-- Testemunho enviado pelo site: entra por aprovar. Os criados no backoffice já
-- vêm aprovados e não precisam de aviso.
create or replace function public.notify_testimonial_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.queue_whatsapp_event('testimonial_pending', new.id, null,
    jsonb_build_object('name', new.name, 'rating', new.rating));
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (testemunho %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp on public.testimonials;
create trigger notify_whatsapp after insert on public.testimonials
  for each row when (not new.published) execute function public.notify_testimonial_whatsapp();

-- Viaturas: entrada na oficina (incluindo as do assistente do WhatsApp),
-- criação em Viaturas, preparada pela oficina, e a PRIMEIRA publicação.
-- `published_at` só é preenchido uma vez (0001), por isso uma viatura que sai de
-- reservada e volta a publicada não avisa outra vez.
create or replace function public.notify_car_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text;
begin
  if tg_op = 'INSERT' then
    ev := case
      -- Criada já publicada: um aviso só, o que interessa.
      when new.published_at is not null then 'vehicle_published'
      when new.status = 'workshop' then 'vehicle_workshop'
      else 'vehicle_created' end;
  elsif new.published_at is not null and old.published_at is null then
    ev := 'vehicle_published';
  elsif new.status = 'prepared' and old.status = 'workshop' then
    ev := 'vehicle_prepared';
  else
    return null;
  end if;
  perform public.queue_whatsapp_event(ev, new.id, new.vehicle_type,
    jsonb_build_object(
      'make', new.make, 'model', new.model, 'variant', new.variant,
      'plate', new.license_plate, 'year', new.year));
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (viatura %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp on public.cars;
create trigger notify_whatsapp after insert or update of status, published_at on public.cars
  for each row execute function public.notify_car_whatsapp();

-- Reserva confirmada no backoffice. O registo é a reserva (e não a viatura):
-- a mesma viatura pode voltar a ser reservada mais tarde, e isso é novidade.
create or replace function public.notify_reservation_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select make, model, variant, license_plate, vehicle_type into c
    from public.cars where id = new.car_id;
  perform public.queue_whatsapp_event('vehicle_reserved', new.id, c.vehicle_type,
    jsonb_build_object(
      'make', c.make, 'model', c.model, 'variant', c.variant, 'plate', c.license_plate,
      'car_id', new.car_id, 'lead_id', new.lead_id,
      'expires_at', new.expires_at, 'deposit', new.deposit_amount));
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (reserva %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp on public.reservations;
create trigger notify_whatsapp after insert on public.reservations
  for each row execute function public.notify_reservation_whatsapp();

-- O acesso do número à Meta expira (60 dias, 0035). Avisa-se uma vez na última
-- semana; o registo é a própria data de expiração, por isso voltar a ligar o
-- número (data nova) volta a poder avisar daqui a 60 dias.
create or replace function public.queue_whatsapp_expiry_warning() returns int
language plpgsql security definer set search_path = public as $$
declare expira timestamptz;
begin
  select token_expires_at into expira from public.whatsapp_connection where id = 1;
  if expira is null or expira <= now() or expira > now() + interval '7 days' then
    return 0;
  end if;
  return public.queue_whatsapp_event('whatsapp_expiring',
    md5('whatsapp_expiring:' || expira::text)::uuid, null,
    jsonb_build_object('expires_at', expira));
end $$;

-- ---------------------------------------------------------------------------
-- Envio: reclamar e registar o resultado
-- ---------------------------------------------------------------------------

create or replace function public.claim_whatsapp_notifications(batch int default 10)
returns table (job_id uuid, event_kind text, subject uuid, details jsonb, attempt int, to_phone text)
language plpgsql security definer set search_path = public as $$
begin
  -- 1. Já não é novidade: um aviso que esperou mais de um dia sem ser tentado
  --    (o número não estava ligado, a manutenção parou…) não se envia — senão,
  --    ao ligar o número, chegava de uma vez tudo o que se acumulou.
  update public.notification_jobs j
     set cancelled_at = now(), last_error = 'Expirou sem ser enviado (mais de 24 horas à espera)'
   where j.channel = 'whatsapp' and j.delivered_at is null and j.cancelled_at is null
     and j.claimed_at is null and j.next_attempt_at < now() - interval '24 hours';

  -- 2. Quem deixou de poder receber desde que o aviso foi agendado: perdeu o
  --    acesso, tirou o telefone, desligou o aviso.
  update public.notification_jobs j
     set cancelled_at = now(),
         last_error = public.notification_block_reason(j.recipient_id, j.event, j.payload ->> 'vehicle_type')
   where j.channel = 'whatsapp' and j.delivered_at is null and j.cancelled_at is null
     and j.claimed_at is null and j.attempts < 8
     and public.notification_block_reason(j.recipient_id, j.event, j.payload ->> 'vehicle_type') is not null;

  -- 3. Os próximos, por ordem. Os do mesmo instante ficam juntos por pessoa e
  --    aviso, para o envio poder juntar «12 viaturas publicadas» numa mensagem.
  return query
  with escolhidos as (
    select q.id from public.notification_jobs q
     where q.channel = 'whatsapp' and q.delivered_at is null and q.cancelled_at is null
       and q.claimed_at is null and q.attempts < 8 and q.next_attempt_at <= now()
     order by q.created_at, q.recipient_id, q.event
     limit greatest(1, least(coalesce(batch, 10), 50))
     for update skip locked
  ), reclamados as (
    update public.notification_jobs j
       set attempts = j.attempts + 1, claimed_at = now()
      from escolhidos e
     where j.id = e.id
    returning j.id, j.event, j.subject_id, j.payload, j.attempts, j.recipient_id, j.created_at
  )
  select r.id, r.event, r.subject_id, r.payload, r.attempts,
         (select public.normalize_phone(p.phone) from public.profiles p where p.id = r.recipient_id)
    from reclamados r
   order by r.created_at, r.recipient_id, r.event;
end $$;

-- O resultado de um envio:
--   sent       → entregue à Meta.
--   failed     → a Meta recusou; volta a tentar mais tarde (até 8 vezes).
--   permanent  → repetir não adianta (modelo inexistente, número sem WhatsApp…):
--                fica à espera do administrador.
--   uncertain  → não se sabe se chegou. Fica reclamado, com o motivo, e o envio
--                automático não lhe volta a tocar.
--   skipped    → não se enviou de propósito.
create or replace function public.finish_whatsapp_notification(
  job uuid, outcome text, detail text default null, message_id text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if outcome = 'sent' then
    update public.notification_jobs
       set delivered_at = now(), claimed_at = null, last_error = null, wa_message_id = left(message_id, 200)
     where id = job and channel = 'whatsapp';
  elsif outcome = 'failed' then
    update public.notification_jobs
       set claimed_at = null, last_error = left(coalesce(detail, 'Falha no envio'), 300),
           next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, attempts)))
     where id = job and channel = 'whatsapp' and delivered_at is null;
  elsif outcome = 'permanent' then
    update public.notification_jobs
       set claimed_at = null, attempts = greatest(attempts, 8),
           last_error = left(coalesce(detail, 'Falha no envio'), 300)
     where id = job and channel = 'whatsapp' and delivered_at is null;
  elsif outcome = 'uncertain' then
    update public.notification_jobs
       set last_error = left(coalesce(detail, 'Sem resposta da Meta'), 300)
     where id = job and channel = 'whatsapp' and delivered_at is null;
  elsif outcome = 'skipped' then
    update public.notification_jobs
       set claimed_at = null, cancelled_at = now(), last_error = left(coalesce(detail, 'Não enviado'), 300)
     where id = job and channel = 'whatsapp' and delivered_at is null;
  else
    raise exception 'Resultado inválido: %', outcome;
  end if;
end $$;

-- O histórico do painel chega para um mês; o resto é ruído.
create or replace function public.prune_notification_jobs() returns void
language sql security definer set search_path = public as $$
  delete from public.notification_jobs
   where channel = 'whatsapp' and created_at < now() - interval '30 days';
$$;

-- Só o servidor. O bloco faz o revoke e o grant juntos, para não se poder
-- acrescentar uma função e esquecer o revoke. As funções de gatilho não
-- precisam de ser executáveis por ninguém: o Postgres não o verifica ao
-- disparar.
do $$ declare sig text; begin
  foreach sig in array array[
    'notification_block_reason(uuid,text,text)',
    'notification_recipients(text,text,uuid)',
    'queue_whatsapp_event(text,uuid,text,jsonb,uuid)',
    'queue_whatsapp_expiry_warning()',
    'claim_whatsapp_notifications(int)',
    'finish_whatsapp_notification(uuid,text,text,text)',
    'prune_notification_jobs()',
    'notify_lead_whatsapp()',
    'notify_testimonial_whatsapp()',
    'notify_car_whatsapp()',
    'notify_reservation_whatsapp()'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0037_wa_conversation.sql
-- ---------------------------------------------------------------------------
-- Memória curta das conversas do assistente interno por WhatsApp.
--
-- Até aqui cada mensagem era interpretada sozinha: se o assistente perguntava
-- «qual BMW?» e a pessoa respondia «o preto», a resposta chegava sem a pergunta
-- e não se percebia. Guardam-se agora as últimas mensagens de cada número (o
-- que a pessoa escreveu e o que o assistente respondeu, em texto), e só essas
-- voltam ao modelo.
--
-- Só texto: nunca se guardam blocos de pensamento nem resultados de
-- ferramentas, por isso o que volta ao modelo é exactamente o que a pessoa leu
-- no WhatsApp. E é memória CURTA de propósito — dois dias chegam para uma
-- conversa, e não se acumula um histórico de mensagens de colaboradores.
--
-- O número 0036 está reservado para as notificações por WhatsApp.
begin;

create table if not exists public.wa_conversation (
  id         bigserial primary key,
  -- O número, ou a chave do simulador do backoffice («sim:<id>»).
  from_phone text not null,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null check (length(content) between 1 and 4000),
  created_at timestamptz not null default now()
);
create index if not exists wa_conversation_phone_idx
  on public.wa_conversation (from_phone, created_at desc);

-- Canalização de servidor, como wa_messages: RLS activa e nenhuma política.
alter table public.wa_conversation enable row level security;
revoke all on public.wa_conversation from anon, authenticated;
revoke all on sequence public.wa_conversation_id_seq from anon, authenticated;

-- A limpeza que já corre na manutenção passa a apagar também a memória antiga.
-- `create or replace` mantém os privilégios definidos na 0024 (só service_role).
create or replace function public.prune_whatsapp() returns void
language sql security definer set search_path = public as $$
  delete from public.wa_messages where received_at < now() - interval '7 days';
  delete from public.wa_pending_actions
   where status <> 'pending' and created_at < now() - interval '1 day';
  delete from public.wa_conversation where created_at < now() - interval '2 days';
$$;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0038_wa_more_actions.sql
-- ---------------------------------------------------------------------------
-- Assistente interno por WhatsApp, segunda fase: mais ordens de escrita.
--
-- Até aqui o canal só escrevia na oficina e nos custos (0024). Passa a poder
-- também, sempre por proposta + imagem + «sim» lido por igualdade:
--
--   Viaturas     → criar uma viatura em RASCUNHO; mudar preço, quilómetros,
--                  frase de destaque e descrição; publicar / passar a rascunho.
--   Leads        → mudar o estado, atribuir o responsável, registar uma nota.
--   Testemunhos  → aprovar (publicar) ou rejeitar (retirar do site).
--
-- O desenho é o da 0024 e não muda: a autorização é feita SEMPRE com o id
-- explícito do colaborador (`has_section_for`, `has_vehicle_type_for`) e só
-- depois `wa_begin_as` assume a identidade, para a auditoria atribuir a ordem a
-- quem a deu. Cada função valida os valores outra vez, aqui — o TypeScript já
-- os validou, mas a chave de serviço ignora a RLS, e estas funções são a única
-- barreira que sobra se um dia alguém as chamar por outro caminho.
--
-- Nada se apaga por este canal: nenhuma função desta migração tem `delete`.
-- Reservar e vender têm fluxo próprio no backoffice (prazo e sinal; preço e
-- data da venda, a partir do contacto) e por isso ficam de fora — o estado
-- de uma viatura só passa a «publicada» ou a «rascunho» por aqui.
--
-- A 0036 é das notificações por WhatsApp (outro trabalho); esta não lhe toca.
begin;

-- ---------------------------------------------------------------------------
-- As novas propostas cabem na tabela de propostas
-- ---------------------------------------------------------------------------

alter table public.wa_pending_actions drop constraint if exists wa_pending_actions_kind_check;
alter table public.wa_pending_actions add constraint wa_pending_actions_kind_check check (kind in (
  'register_vehicle', 'add_cost', 'log_hours',
  'create_draft_car', 'update_car', 'set_car_status',
  'set_lead_status', 'assign_lead', 'add_lead_note',
  'set_testimonial'
));

-- A proposta passa a ir como imagem. A Meta aceita o envio e só DEPOIS vai
-- buscar a imagem; se falhar, avisa por um recibo «failed» com o id da
-- mensagem. Guarda-se esse id para, nesse caso, mandar a proposta em texto —
-- senão a pessoa ficava sem a pergunta e sem saber porquê.
alter table public.wa_pending_actions add column if not exists image_wamid text;
create index if not exists wa_pending_image_idx
  on public.wa_pending_actions (image_wamid) where image_wamid is not null;

-- ---------------------------------------------------------------------------
-- Procuras, já filtradas pelas permissões (como wa_vehicles_for_actor)
-- ---------------------------------------------------------------------------

-- Minúsculas e sem acentos, sem depender da extensão `unaccent` (que nem todas
-- as instalações têm): «João» e «joao» têm de ser o mesmo contacto.
create or replace function public.wa_fold(t text) returns text
language sql immutable set search_path = public as $$
  select translate(lower(coalesce(t, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
$$;

-- O texto procurado → palavras. Tudo o que não é letra, algarismo, @ ou ponto
-- vira espaço: assim nem um «%» nem um «_» chegam ao `like` como curinga.
create or replace function public.wa_words(search text) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_remove(regexp_split_to_array(
    trim(regexp_replace(public.wa_fold(search), '[^a-z0-9@.]+', ' ', 'g')), ' '), ''), '{}');
$$;

-- Contactos (leads) que o colaborador pode alterar: precisa de Leads e do tipo
-- de viatura do contacto (um contacto antigo sem tipo vê-se nos dois mundos,
-- como no backoffice). Sem nenhuma pista não se devolve a lista toda.
create or replace function public.wa_leads_for_actor(actor uuid, search text, only_status text)
returns table(id uuid, name text, phone text, email text, status text, car_label text,
              vehicle_type text, assigned_to uuid, assigned_name text,
              active_reservation boolean, created_at timestamptz, total bigint)
language sql stable security definer set search_path = public as $$
  with pedido as (
    select public.wa_words(search) as palavras,
           regexp_replace(coalesce(search, ''), '\D', '', 'g') as digitos
  )
  select l.id, l.name, l.phone, nullif(l.email, ''), l.status::text, l.car_label,
         l.vehicle_type, l.assigned_to, coalesce(nullif(trim(p.full_name), ''), p.email),
         exists (select 1 from public.reservations r where r.lead_id = l.id and r.status = 'active'),
         l.created_at, count(*) over ()
    from public.leads l
    left join public.profiles p on p.id = l.assigned_to
    cross join pedido
   where public.has_section_for(actor, 'leads')
     and (l.vehicle_type is null or public.has_vehicle_type_for(actor, l.vehicle_type))
     and (only_status is null or l.status::text = only_status)
     and (cardinality(pedido.palavras) > 0 or only_status is not null)
     and (cardinality(pedido.palavras) = 0
       or (length(pedido.digitos) >= 6
           and regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') like '%' || pedido.digitos || '%')
       or not exists (
         select 1 from unnest(pedido.palavras) w
          where public.wa_fold(l.name || ' ' || coalesce(l.email, '') || ' ' ||
                coalesce(l.car_label, '') || ' ' || coalesce(l.phone, '')) not like '%' || w || '%'))
   order by l.created_at desc
   limit 5;
$$;

-- Testemunhos: precisa de Testemunhos. Os por aprovar vêm primeiro.
create or replace function public.wa_testimonials_for_actor(actor uuid, search text, only_pending boolean)
returns table(id uuid, name text, rating int, role text, body text, published boolean,
              created_at timestamptz, total bigint)
language sql stable security definer set search_path = public as $$
  with pedido as (select public.wa_words(search) as palavras)
  select t.id, t.name, t.rating::int, t.role, t.body, t.published, t.created_at, count(*) over ()
    from public.testimonials t
    cross join pedido
   where public.has_section_for(actor, 'testemunhos')
     and (not coalesce(only_pending, false) or not t.published)
     and (cardinality(pedido.palavras) > 0 or coalesce(only_pending, false))
     and not exists (
       select 1 from unnest(pedido.palavras) w
        where public.wa_fold(t.name || ' ' || coalesce(t.role, '') || ' ' || t.body)
              not like '%' || w || '%')
   order by t.published, t.created_at desc
   limit 5;
$$;

-- Quem pode ser responsável de um contacto: a mesma regra do backoffice
-- (`saveLeadFollowup`): qualquer colaborador menos o mecânico.
create or replace function public.wa_staff_for_actor(actor uuid, search text)
returns table(id uuid, full_name text, total bigint)
language sql stable security definer set search_path = public as $$
  with pedido as (select public.wa_words(search) as palavras)
  select p.id, coalesce(nullif(trim(p.full_name), ''), p.email, 'Colaborador'), count(*) over ()
    from public.profiles p
    cross join pedido
   where public.has_section_for(actor, 'leads')
     and p.role::text <> 'mecanico'
     and cardinality(pedido.palavras) > 0
     and not exists (
       select 1 from unnest(pedido.palavras) w
        where public.wa_fold(coalesce(p.full_name, '') || ' ' || coalesce(p.email, ''))
              not like '%' || w || '%')
   order by p.full_name
   limit 5;
$$;

-- ---------------------------------------------------------------------------
-- Viaturas (separador Viaturas = 'carros')
-- ---------------------------------------------------------------------------

-- Viatura nova, SEMPRE em rascunho: não aparece no site até alguém a publicar,
-- e para isso tem de ter os dados que o formulário do backoffice exige. Os
-- campos mínimos são os do `carFormSchema` (marca, modelo, ano, km,
-- combustível, caixa, segmento, preço ou «sob consulta»).
create or replace function public.wa_create_draft_car(
  actor uuid, selected_type text, vehicle_make text, vehicle_model text, vehicle_variant text,
  vehicle_year int, km int, fuel_kind text, gearbox text, body_kind text,
  asking_price int, on_request boolean, plate text, paint text,
  door_count int, seat_count int, slug_base text)
returns uuid language plpgsql security definer set search_path = public as $$
declare novo uuid := gen_random_uuid(); candidato text; n int := 1;
begin
  perform public.wa_begin_as(actor, array['carros']);
  if selected_type is null or selected_type not in ('car', 'motorcycle') then
    raise exception 'Tipo inválido';
  end if;
  if not public.has_vehicle_type_for(actor, selected_type) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;
  if length(trim(coalesce(vehicle_make, ''))) not between 1 and 60
     or length(trim(coalesce(vehicle_model, ''))) not between 1 and 80
     or trim(vehicle_model) = '—' then
    raise exception 'Marca ou modelo inválido';
  end if;
  if length(coalesce(vehicle_variant, '')) > 80 or length(coalesce(paint, '')) > 60 then
    raise exception 'Dados inválidos';
  end if;
  if vehicle_year is null or vehicle_year < 1950
     or vehicle_year > extract(year from current_date)::int + 1 then
    raise exception 'Ano inválido';
  end if;
  if km is null or km < 0 or km > 2000000 then raise exception 'Quilómetros inválidos'; end if;
  -- A regra do formulário: um preço positivo, ou «sob consulta» (e então sem preço).
  if coalesce(on_request, false) then
    asking_price := null;
  elsif asking_price is null or asking_price <= 0 or asking_price > 99999999 then
    raise exception 'Preço inválido';
  end if;
  if plate is not null and plate !~ '^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$' then
    raise exception 'Matrícula inválida';
  end if;
  -- Portas e lugares: as restrições da tabela já recusam uma mota com portas;
  -- os lugares de uma mota só o formulário verificava.
  if door_count is null or seat_count is null or door_count not between 0 and 9
     or seat_count not between 1 and 9
     or (selected_type = 'motorcycle' and (door_count <> 0 or seat_count > 2))
     or (selected_type = 'car' and door_count < 1) then
    raise exception 'Portas ou lugares inválidos';
  end if;
  -- O slug base vem do `vehicleSlug` do TypeScript (a mesma regra do
  -- formulário); aqui só se garante que é um slug e que é único.
  if slug_base is null or length(slug_base) > 120 or slug_base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Slug inválido';
  end if;
  candidato := slug_base;
  while exists (select 1 from public.cars where slug = candidato) loop
    n := n + 1;
    candidato := slug_base || '-' || n;
  end loop;

  -- Os enums (combustível, caixa, segmento) validam-se no próprio cast, e a
  -- restrição cars_vehicle_category_check recusa um segmento do outro tipo.
  insert into public.cars(id, slug, make, model, variant, year, vehicle_type, license_plate,
    mileage, fuel, transmission, body, color, doors, seats, price, price_on_request,
    status, created_by)
  values (novo, candidato, trim(vehicle_make), trim(vehicle_model),
    nullif(trim(coalesce(vehicle_variant, '')), ''), vehicle_year, selected_type, plate,
    km, fuel_kind::public.fuel_type, gearbox::public.transmission, body_kind::public.body_type,
    nullif(trim(coalesce(paint, '')), ''), door_count, seat_count, asking_price,
    coalesce(on_request, false), 'draft', actor);
  return novo;
end $$;

-- Preço, quilómetros, frase de destaque e descrição. Só as chaves enviadas
-- mudam, numa ÚNICA actualização: o histórico da viatura mostra uma alteração
-- com tudo o que a pessoa confirmou, e não várias soltas.
create or replace function public.wa_update_car(actor uuid, car uuid, changes jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.cars%rowtype; k text; v jsonb;
begin
  perform public.wa_begin_as(actor, array['carros']);
  if changes is null or jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  for k in select jsonb_object_keys(changes) loop
    if k not in ('price', 'mileage', 'tagline', 'description') then
      raise exception 'Campo não permitido';
    end if;
  end loop;

  select * into c from public.cars where id = car for update;
  if not found then raise exception 'Viatura inexistente'; end if;
  if not public.has_vehicle_type_for(actor, c.vehicle_type) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;

  if changes ? 'price' then
    v := changes -> 'price';
    -- null = «sob consulta», como no formulário.
    if jsonb_typeof(v) = 'null' then
      c.price := null; c.price_on_request := true;
    elsif jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
          and (v #>> '{}')::numeric between 1 and 99999999 then
      c.price := (v #>> '{}')::int; c.price_on_request := false;
    else
      raise exception 'Preço inválido';
    end if;
  end if;
  if changes ? 'mileage' then
    v := changes -> 'mileage';
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
       or (v #>> '{}')::numeric not between 0 and 2000000 then
      raise exception 'Quilómetros inválidos';
    end if;
    c.mileage := (v #>> '{}')::int;
  end if;
  -- Texto vazio não apaga nada: por aqui só se substitui.
  if changes ? 'tagline' then
    v := changes -> 'tagline';
    if jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 160 then
      raise exception 'Frase de destaque inválida';
    end if;
    c.tagline := trim(v #>> '{}');
  end if;
  if changes ? 'description' then
    v := changes -> 'description';
    if jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 5000 then
      raise exception 'Descrição inválida';
    end if;
    c.description := trim(v #>> '{}');
  end if;

  update public.cars
     set price = c.price, price_on_request = c.price_on_request, mileage = c.mileage,
         tagline = c.tagline, description = c.description
   where id = car;
  return car;
end $$;

-- Publicar ou passar a rascunho. Reservada e vendida ficam de fora (fluxo
-- próprio no contacto); a oficina tem os seus botões; uma venda não se desfaz
-- por mensagem. Uma reserva activa bloqueia, como no gatilho protect_reservation.
create or replace function public.wa_set_car_status(actor uuid, car uuid, new_status text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.cars%rowtype;
begin
  perform public.wa_begin_as(actor, array['carros']);
  if new_status is null or new_status not in ('draft', 'published') then
    raise exception 'Estado não permitido por aqui';
  end if;
  select * into c from public.cars where id = car for update;
  if not found then raise exception 'Viatura inexistente'; end if;
  if not public.has_vehicle_type_for(actor, c.vehicle_type) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;
  if c.status::text = new_status then raise exception 'Já está nesse estado'; end if;
  if c.status in ('workshop', 'sold') then
    raise exception 'Estado atual não se altera por aqui';
  end if;
  if exists (select 1 from public.reservations where car_id = car and status = 'active') then
    raise exception 'Termine a reserva antes de alterar a disponibilidade';
  end if;
  -- A mesma exigência que a restrição complete_public_car e o formulário.
  if new_status = 'published' and (c.year is null or c.fuel is null or c.transmission is null
     or c.body is null or c.model = '—') then
    raise exception 'Ficha incompleta';
  end if;
  if new_status = 'published' and not c.price_on_request and coalesce(c.price, 0) <= 0 then
    raise exception 'Preço em falta';
  end if;
  update public.cars set status = new_status::public.car_status where id = car;
  return car;
end $$;

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create or replace function public.wa_lead_for_update(actor uuid, lead uuid)
returns public.leads language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  select * into l from public.leads where id = lead for update;
  if not found then raise exception 'Contacto inexistente'; end if;
  if l.vehicle_type is not null and not public.has_vehicle_type_for(actor, l.vehicle_type) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;
  return l;
end $$;

-- Os estados da lista do backoffice. «Ganho» só pela «Concluir venda» (preço
-- e data); um perdido leva sempre o motivo. O gatilho validate_followup
-- continua a aplicar-se por cima (venda concluída não volta atrás, etc.).
create or replace function public.wa_set_lead_status(actor uuid, lead uuid, new_status text, reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  perform public.wa_begin_as(actor, array['leads']);
  if new_status is null or new_status not in ('new', 'contacted', 'proposal', 'lost', 'closed') then
    raise exception 'Estado não permitido por aqui';
  end if;
  l := public.wa_lead_for_update(actor, lead);
  if l.status = 'won' then raise exception 'A venda já está concluída'; end if;
  if l.status::text = new_status then raise exception 'Já está nesse estado'; end if;
  if new_status = 'lost' and length(trim(coalesce(reason, ''))) not between 1 and 1000 then
    raise exception 'Indique o motivo de perda';
  end if;
  -- Perder ou fechar um contacto com a viatura reservada deixava a viatura
  -- presa a uma reserva de ninguém. A reserva cancela-se primeiro, no backoffice.
  if new_status in ('lost', 'closed') and exists (
       select 1 from public.reservations where lead_id = lead and status = 'active') then
    raise exception 'Termine a reserva antes de alterar a disponibilidade';
  end if;
  update public.leads
     set status = new_status::public.lead_status,
         loss_reason = case when new_status = 'lost' then trim(reason) else null end
   where id = lead;
  return lead;
end $$;

create or replace function public.wa_assign_lead(actor uuid, lead uuid, assignee uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  perform public.wa_begin_as(actor, array['leads']);
  l := public.wa_lead_for_update(actor, lead);
  if assignee is null or not exists (
       select 1 from public.profiles where id = assignee and role::text <> 'mecanico') then
    raise exception 'Responsável inválido';
  end if;
  if l.assigned_to is not distinct from assignee then raise exception 'Já está nesse estado'; end if;
  update public.leads set assigned_to = assignee where id = lead;
  return lead;
end $$;

create or replace function public.wa_add_lead_note(actor uuid, lead uuid, note_kind text, note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype; novo uuid;
begin
  perform public.wa_begin_as(actor, array['leads']);
  if note_kind is null or note_kind not in ('call', 'message', 'proposal', 'visit', 'note') then
    raise exception 'Tipo inválido';
  end if;
  if length(trim(coalesce(note, ''))) not between 1 and 4000 then raise exception 'Texto inválido'; end if;
  l := public.wa_lead_for_update(actor, lead);
  insert into public.lead_activities(lead_id, kind, body, created_by)
  values (l.id, note_kind, trim(note), actor)
  returning id into novo;
  return novo;
end $$;

-- ---------------------------------------------------------------------------
-- Testemunhos
-- ---------------------------------------------------------------------------

-- Aprovar = publicar no site; rejeitar = retirar do site. Apagar fica no
-- backoffice, como tudo o que se apaga.
create or replace function public.wa_set_testimonial(actor uuid, testimonial uuid, publish boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare atual boolean;
begin
  perform public.wa_begin_as(actor, array['testemunhos']);
  if publish is null then raise exception 'Dados inválidos'; end if;
  select published into atual from public.testimonials where id = testimonial for update;
  if not found then raise exception 'Testemunho inexistente'; end if;
  if atual = publish then raise exception 'Já está nesse estado'; end if;
  update public.testimonials set published = publish where id = testimonial;
  return testimonial;
end $$;

-- Só o servidor, como na 0024: revoke e grant juntos, para não se poder
-- acrescentar uma função e esquecer o revoke.
do $$ declare sig text; begin
  foreach sig in array array[
    'wa_fold(text)',
    'wa_words(text)',
    'wa_leads_for_actor(uuid,text,text)',
    'wa_testimonials_for_actor(uuid,text,boolean)',
    'wa_staff_for_actor(uuid,text)',
    'wa_create_draft_car(uuid,text,text,text,text,integer,integer,text,text,text,integer,boolean,text,text,integer,integer,text)',
    'wa_update_car(uuid,uuid,jsonb)',
    'wa_set_car_status(uuid,uuid,text)',
    'wa_lead_for_update(uuid,uuid)',
    'wa_set_lead_status(uuid,uuid,text,text)',
    'wa_assign_lead(uuid,uuid,uuid)',
    'wa_add_lead_note(uuid,uuid,text,text)',
    'wa_set_testimonial(uuid,uuid,boolean)'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0039_wa_media.sql
-- ---------------------------------------------------------------------------
-- Assistente interno por WhatsApp: fotografias das viaturas.
--
-- O colaborador manda fotografias ao número da empresa («fotos do bmw 320
-- preto») e elas ficam na galeria da viatura — as mesmas linhas de `car_media`,
-- o mesmo bucket `car-media` e o mesmo caminho `<id da viatura>/<uuid>.jpg` que
-- o backoffice usa. Como tudo neste canal, nada é gravado sem o «sim»:
--
--   1. cada fotografia que chega é descarregada da Meta, reduzida como no
--      backoffice e guardada À PARTE, num bucket PRIVADO (`wa-media`), com uma
--      linha nesta tabela (`wa_media`, estado «staged»);
--   2. as fotografias seguidas do mesmo número juntam-se numa só proposta
--      («juntar 4 fotografias à viatura X»), mostrada em imagem com as
--      miniaturas;
--   3. no «sim», o servidor copia-as para o caminho da viatura e chama
--      `wa_add_car_media`, que autoriza (Viaturas + tipo de viatura), cria as
--      linhas de `car_media` com a regra de ordem e capa do backoffice e marca
--      as fotografias como juntas. No «não», ficam descartadas.
--
-- O bucket é privado de propósito: uma fotografia por confirmar não é pública,
-- e a imagem da proposta mostra-a através do servidor, nunca por um link
-- directo. O que fica por juntar é apagado ao fim de dois dias, com os
-- ficheiros (a limpeza do Storage é feita em TypeScript, na manutenção).
--
-- Nada se apaga por este canal: `wa_add_car_media` não tem `delete`. A limpeza
-- é `prune_wa_media`, que só a manutenção chama.
--
-- A 0040 e a 0041 são de outros trabalhos; esta não lhes toca.
begin;

-- ---------------------------------------------------------------------------
-- A nova proposta cabe na tabela de propostas
-- ---------------------------------------------------------------------------

alter table public.wa_pending_actions drop constraint if exists wa_pending_actions_kind_check;
alter table public.wa_pending_actions add constraint wa_pending_actions_kind_check check (kind in (
  'register_vehicle', 'add_cost', 'log_hours',
  'create_draft_car', 'update_car', 'set_car_status',
  'set_lead_status', 'assign_lead', 'add_lead_note',
  'set_testimonial',
  'add_car_media'
));

-- ---------------------------------------------------------------------------
-- O bucket das fotografias por confirmar: PRIVADO, sem políticas
-- ---------------------------------------------------------------------------

-- Sem nenhuma política em storage.objects para este bucket, só a chave de
-- serviço lhe chega. O `on conflict` garante que, se alguém o tiver criado à
-- mão como público, volta a ser privado.
insert into storage.buckets (id, name, public)
values ('wa-media', 'wa-media', false)
on conflict (id) do update set public = false;

-- ---------------------------------------------------------------------------
-- As fotografias recebidas
-- ---------------------------------------------------------------------------

create table if not exists public.wa_media (
  id           uuid primary key default gen_random_uuid(),
  -- A ordem de chegada, sem empates: decide qual é a última de uma rajada (é
  -- essa que responde) e a ordem na galeria.
  seq          bigserial not null unique,
  from_phone   text not null,
  -- Quem a mandou. `set null` e não `cascade`: sem a linha, a limpeza não
  -- saberia que ficheiro apagar.
  actor_id     uuid references public.profiles(id) on delete set null,
  -- O id do ficheiro na Meta: uma reentrega não guarda a mesma fotografia duas vezes.
  media_id     text not null unique,
  -- No bucket `wa-media`: `<id do colaborador>/<uuid>.jpg`.
  storage_path text not null unique
               check (storage_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.jpg$'),
  width        int check (width between 1 and 20000),
  height       int check (height between 1 and 20000),
  bytes        int check (bytes >= 0),
  -- A legenda é texto de quem escreveu: dado, nunca instrução.
  caption      text not null default '' check (length(caption) <= 1024),
  status       text not null default 'staged'
               check (status in ('staged', 'attached', 'discarded')),
  car_media_id uuid references public.car_media(id) on delete set null,
  created_at   timestamptz not null default now(),
  settled_at   timestamptz
);
create index if not exists wa_media_phone_idx on public.wa_media (from_phone, seq desc)
  where status = 'staged';
create index if not exists wa_media_created_idx on public.wa_media (created_at);

-- Canalização de servidor, como wa_messages: RLS activa e nenhuma política.
alter table public.wa_media enable row level security;
revoke all on public.wa_media from anon, authenticated;
revoke all on sequence public.wa_media_seq_seq from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Juntar as fotografias confirmadas à viatura
-- ---------------------------------------------------------------------------

-- `items`: [{ "media": <id em wa_media>, "path": <caminho em car-media>,
-- "width": …, "height": … }], pela ordem da galeria. Os ficheiros já foram
-- copiados pelo servidor para `path`; aqui autoriza-se e regista-se.
--
-- A ordem e a capa são as de `registerMedia` (src/lib/actions/media.ts):
-- acrescenta no fim, e a primeira imagem de uma viatura sem capa e sem
-- imagens passa a ser a capa. A viatura fica bloqueada (`for update`) para
-- duas confirmações ao mesmo tempo não darem a mesma posição.
create or replace function public.wa_add_car_media(actor uuid, car uuid, items jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c public.cars%rowtype;
  m public.wa_media%rowtype;
  item jsonb;
  pos int;
  capa boolean;
  n int := 0;
  caminho text;
  w int;
  h int;
  novo uuid;
begin
  perform public.wa_begin_as(actor, array['carros']);
  select * into c from public.cars where id = car for update;
  if not found then raise exception 'Viatura inexistente'; end if;
  if not public.has_vehicle_type_for(actor, c.vehicle_type) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;
  if items is null or jsonb_typeof(items) <> 'array'
     or jsonb_array_length(items) not between 1 and 30 then
    raise exception 'Fotografias inválidas';
  end if;

  select coalesce(max(position), -1) + 1 into pos from public.car_media where car_id = car;
  capa := not exists (select 1 from public.car_media
                       where car_id = car and (is_cover or kind = 'image'));

  for item in select value from jsonb_array_elements(items) loop
    if jsonb_typeof(item) <> 'object'
       or coalesce(item ->> 'media', '') !~ '^[0-9a-f-]{36}$' then
      raise exception 'Fotografias inválidas';
    end if;
    select * into m from public.wa_media where id = (item ->> 'media')::uuid for update;
    -- Só a própria pessoa junta as fotografias que mandou, e só uma vez.
    if not found or m.status <> 'staged' or m.actor_id is distinct from actor then
      raise exception 'Fotografia indisponível';
    end if;
    -- O caminho é o do backoffice, dentro da pasta DESTA viatura.
    caminho := item ->> 'path';
    if caminho is null or caminho !~ ('^' || car::text || '/[0-9a-f-]{36}\.jpg$') then
      raise exception 'Caminho inválido';
    end if;
    w := case when jsonb_typeof(item -> 'width') = 'number' then (item ->> 'width')::int end;
    h := case when jsonb_typeof(item -> 'height') = 'number' then (item ->> 'height')::int end;
    if (w is not null and w not between 1 and 20000) or (h is not null and h not between 1 and 20000) then
      raise exception 'Dimensões inválidas';
    end if;

    insert into public.car_media(car_id, kind, storage_path, alt, width, height, position, is_cover)
    values (car, 'image', caminho, '', w, h, pos, capa and n = 0)
    returning id into novo;
    update public.wa_media
       set status = 'attached', car_media_id = novo, settled_at = now()
     where id = m.id;
    pos := pos + 1;
    n := n + 1;
  end loop;
  return car;
end $$;

-- ---------------------------------------------------------------------------
-- Limpeza (só a manutenção a chama, depois de apagar os ficheiros)
-- ---------------------------------------------------------------------------

-- Recebe os ids cujos ficheiros a manutenção já apagou do bucket e apaga as
-- linhas — só as que têm mais de dois dias, aconteça o que acontecer à lista.
-- Não começa por `wa_`: não é uma escrita do assistente, e nenhuma dessas apaga.
create or replace function public.prune_wa_media(ids uuid[]) returns int
language sql security definer set search_path = public as $$
  with apagadas as (
    delete from public.wa_media
     where id = any(coalesce(ids, '{}'))
       and created_at < now() - interval '2 days'
    returning 1
  )
  select count(*)::int from apagadas;
$$;

-- Só o servidor, como na 0024 e na 0038.
do $$ declare sig text; begin
  foreach sig in array array[
    'wa_add_car_media(uuid,uuid,jsonb)',
    'prune_wa_media(uuid[])'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0040_wa_site_settings.sql
-- ---------------------------------------------------------------------------
-- Assistente interno por WhatsApp: a Página inicial e as Definições.
--
-- O canal passa a poder mudar, sempre por proposta + imagem + «sim», o que se
-- muda hoje nesses dois separadores do backoffice — textos, números, opções e
-- sim/não, nada mais:
--
--   Página inicial → textos do topo, marcas, confiança e chamada final
--                    (site_content 'home'); pontos de venda, serviços,
--                    perguntas frequentes e Google (site_content 'showroom').
--                    Precisa do separador Página inicial, como o
--                    `requireSection("pagina-inicial")` das acções.
--   Definições     → nome, slogan e cores da marca; WhatsApp e Messenger do
--                    site; valor/hora da oficina (site_settings); etiquetas
--                    dos cards (site_content 'badges'). Só administradores,
--                    como o `requireAdmin` de cada acção: o separador não basta.
--
-- O desenho é o da 0024/0038: a autorização é feita com o id explícito
-- (`wa_begin_as` → `has_section_for`, e o papel lido aqui), só depois se
-- assume a identidade. O TypeScript já validou tudo com os MESMOS esquemas zod
-- do backoffice; aqui repete-se a parte que importa para a segurança: uma
-- lista branca de chaves (nem uma a mais, nem uma a menos) e os limites de
-- cada valor. Uma chave de integração, um token ou o logótipo nunca passam.
--
-- Fica de fora de propósito: imagens, integrações e segredos
-- (integration_secrets, OLX, ligação do WhatsApp, Analytics, Pixel, reservas
-- online), utilizadores e permissões. E nada se retira: os pontos de venda e
-- as perguntas mantêm-se os mesmos, e nenhuma função desta migração apaga.
--
-- A 0039 (fotos) e a 0041 (avisos) são de outros trabalhos; esta não lhes toca.
begin;

-- ---------------------------------------------------------------------------
-- As novas propostas cabem na tabela de propostas
-- ---------------------------------------------------------------------------

-- Acrescenta, sem reescrever a lista: lê os tipos que a restrição já aceita
-- (os da 0038 e os de qualquer migração entretanto) e junta os novos. Assim a
-- ordem em que as migrações dos vários trabalhos chegam não faz perder nenhum.
do $$
declare
  atuais text[];
  novos text[] := array['update_homepage', 'update_showroom', 'update_site_settings', 'update_badges'];
begin
  select coalesce(array_agg(distinct m[1]), '{}') into atuais
    from pg_constraint c
    cross join lateral regexp_matches(pg_get_constraintdef(c.oid), '''([a-z_]+)''::text', 'g') m
   where c.conrelid = 'public.wa_pending_actions'::regclass
     and c.conname = 'wa_pending_actions_kind_check';
  alter table public.wa_pending_actions drop constraint if exists wa_pending_actions_kind_check;
  execute format(
    'alter table public.wa_pending_actions add constraint wa_pending_actions_kind_check check (kind = any (%L::text[]))',
    (select array_agg(distinct k order by k) from unnest(atuais || novos) k));
end $$;

-- ---------------------------------------------------------------------------
-- A lista branca: um valor tem exactamente a forma prevista
-- ---------------------------------------------------------------------------

-- `shape` descreve o valor:
--   {"t":"text","max":N,"min":N,"re":"…"}  texto (min conta sem espaços nas pontas)
--   {"t":"enum","of":[…]}                   um dos textos da lista
--   {"t":"bool"}                            verdadeiro/falso
--   {"t":"num","min":N,"max":N,"null":true} número (nulo só se permitido)
--   {"t":"list","max":N,"item":{…}}         lista de valores com a forma item
--   {"t":"obj","keys":{…}}                  objecto com EXACTAMENTE estas chaves
create or replace function public.wa_json_fits(v jsonb, shape jsonb)
returns boolean language plpgsql immutable set search_path = public as $$
declare t text := shape->>'t'; k text; item jsonb;
begin
  if v is null or shape is null then return false; end if;
  if t = 'text' then
    return jsonb_typeof(v) = 'string'
       and length(v #>> '{}') <= (shape->>'max')::int
       and length(trim(v #>> '{}')) >= coalesce((shape->>'min')::int, 0)
       and (shape->>'re' is null or (v #>> '{}') ~ (shape->>'re'));
  elsif t = 'enum' then
    return jsonb_typeof(v) = 'string' and (shape->'of') ? (v #>> '{}');
  elsif t = 'bool' then
    return jsonb_typeof(v) = 'boolean';
  elsif t = 'num' then
    if jsonb_typeof(v) = 'null' then return coalesce((shape->>'null')::boolean, false); end if;
    return jsonb_typeof(v) = 'number'
       and (v #>> '{}')::numeric between (shape->>'min')::numeric and (shape->>'max')::numeric;
  elsif t = 'list' then
    if jsonb_typeof(v) <> 'array' or jsonb_array_length(v) > (shape->>'max')::int then return false; end if;
    for item in select value from jsonb_array_elements(v) loop
      if not public.wa_json_fits(item, shape->'item') then return false; end if;
    end loop;
    return true;
  elsif t = 'obj' then
    if jsonb_typeof(v) <> 'object' then return false; end if;
    -- A lista branca propriamente dita: uma chave a mais (um token, um
    -- logótipo) recusa o conteúdo inteiro.
    if (select coalesce(array_agg(x order by x), '{}') from jsonb_object_keys(v) x)
       is distinct from
       (select coalesce(array_agg(x order by x), '{}') from jsonb_object_keys(shape->'keys') x) then
      return false;
    end if;
    for k in select jsonb_object_keys(shape->'keys') loop
      if not public.wa_json_fits(v->k, shape->'keys'->k) then return false; end if;
    end loop;
    return true;
  end if;
  return false;
end $$;

-- As Definições são só de administradores, como o `requireAdmin` das acções.
create or replace function public.wa_require_admin(actor uuid)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.profiles where id = actor and role::text = 'admin') then
    raise exception 'Apenas administradores';
  end if;
end $$;

-- Os ids de uma lista de objectos, pela ordem (nulo/ausente → lista vazia).
create or replace function public.wa_ids(list jsonb)
returns text[] language sql immutable set search_path = public as $$
  select coalesce(array_agg(e.value->>'id' order by e.n), '{}')
    from jsonb_array_elements(case when jsonb_typeof(list) = 'array' then list else '[]'::jsonb end)
         with ordinality as e(value, n);
$$;

-- ---------------------------------------------------------------------------
-- Página inicial: textos (homeContentSchema)
-- ---------------------------------------------------------------------------

create or replace function public.wa_update_home(actor uuid, new_content jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  botao jsonb := '{"t":"obj","keys":{"label":{"t":"text","max":60},"href":{"t":"text","max":200}}}';
  forma jsonb;
begin
  perform public.wa_begin_as(actor, array['pagina-inicial']);
  forma := jsonb_build_object('t', 'obj', 'keys', jsonb_build_object(
    'hero', jsonb_build_object('t', 'obj', 'keys', jsonb_build_object(
      'eyebrow', '{"t":"text","max":80}'::jsonb,
      'title', '{"t":"text","min":1,"max":160}'::jsonb,
      'subtitle', '{"t":"text","max":300}'::jsonb,
      'primaryCta', botao,
      'secondaryCta', botao,
      'media', '{"t":"enum","of":["auto","video","image"]}'::jsonb)),
    'motoHero', jsonb_build_object('t', 'obj', 'keys', jsonb_build_object(
      'eyebrow', '{"t":"text","max":80}'::jsonb,
      'title', '{"t":"text","min":1,"max":160}'::jsonb,
      'subtitle', '{"t":"text","max":300}'::jsonb,
      'primaryCta', botao)),
    'brands', '{"t":"list","max":30,"item":{"t":"text","min":1,"max":200}}'::jsonb,
    'trust', jsonb_build_object('t', 'obj', 'keys', jsonb_build_object(
      'eyebrow', '{"t":"text","max":80}'::jsonb,
      'title', '{"t":"text","max":160}'::jsonb,
      'pillars', '{"t":"list","max":8,"item":{"t":"obj","keys":{"kpi":{"t":"text","max":20},"title":{"t":"text","max":80},"body":{"t":"text","max":400}}}}'::jsonb)),
    'cta', jsonb_build_object('t', 'obj', 'keys', jsonb_build_object(
      'eyebrow', '{"t":"text","max":80}'::jsonb,
      'title', '{"t":"text","max":160}'::jsonb,
      'whatsappLabel', '{"t":"text","max":60}'::jsonb,
      'secondary', botao))));
  if not public.wa_json_fits(new_content, forma) then raise exception 'Conteúdo inválido'; end if;
  insert into public.site_content(key, content) values ('home', new_content)
  on conflict (key) do update set content = excluded.content;
end $$;

-- ---------------------------------------------------------------------------
-- Página inicial: serviços, perguntas, Google e pontos de venda (showroomSchema)
-- ---------------------------------------------------------------------------

create or replace function public.wa_update_showroom(actor uuid, new_content jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  atual jsonb;
  forma jsonb := '{"t":"obj","keys":{
    "locations":{"t":"list","max":20,"item":{"t":"obj","keys":{
      "id":{"t":"text","min":1,"max":80,"re":"^[a-z0-9-]+$"},
      "name":{"t":"text","min":1,"max":100},
      "address":{"t":"text","min":1,"max":250},
      "city":{"t":"text","min":1,"max":100},
      "postalCode":{"t":"text","max":20},
      "phone":{"t":"text","max":30,"re":"^[-+0-9[:space:]()]*$"},
      "email":{"t":"text","max":320},
      "hours":{"t":"text","max":500},
      "latitude":{"t":"num","min":-90,"max":90,"null":true},
      "longitude":{"t":"num","min":-180,"max":180,"null":true}}}},
    "faqs":{"t":"list","max":60,"item":{"t":"obj","keys":{
      "question":{"t":"text","min":1,"max":200},
      "answer":{"t":"text","min":1,"max":2000},
      "category":{"t":"enum","of":["geral","financiamento","garantia","oficina","encomendas"]}}}},
    "services":{"t":"list","max":4,"item":{"t":"obj","keys":{
      "id":{"t":"enum","of":["financiamento","garantia","oficina","encomendas"]},
      "title":{"t":"text","min":1,"max":100},
      "summary":{"t":"text","min":1,"max":300},
      "body":{"t":"text","min":1,"max":10000},
      "enabled":{"t":"bool"}}}},
    "google":{"t":"obj","keys":{
      "enabled":{"t":"bool"},
      "placeId":{"t":"text","max":200,"re":"^[a-zA-Z0-9_-]*$"},
      "mapsUrl":{"t":"text","max":2000,"re":"^(https://[^[:space:]]+)?$"}}}}}';
begin
  perform public.wa_begin_as(actor, array['pagina-inicial']);
  if not public.wa_json_fits(new_content, forma) then raise exception 'Conteúdo inválido'; end if;
  if jsonb_array_length(new_content->'services') <> 4
     or (select count(distinct s) from unnest(public.wa_ids(new_content->'services')) s) <> 4 then
    raise exception 'Conteúdo inválido';
  end if;

  select content into atual from public.site_content where key = 'showroom' for update;
  -- Por aqui só se altera o que existe: os mesmos pontos de venda, pela mesma
  -- ordem (o primeiro é o principal e o id liga as viaturas), e as mesmas
  -- perguntas. Acrescentar ou retirar é no backoffice.
  if public.wa_ids(new_content->'locations') is distinct from public.wa_ids(atual->'locations') then
    raise exception 'Pontos de venda diferentes';
  end if;
  if jsonb_typeof(atual->'faqs') = 'array'
     and jsonb_array_length(atual->'faqs') <> jsonb_array_length(new_content->'faqs') then
    raise exception 'Conteúdo mudou';
  end if;

  insert into public.site_content(key, content) values ('showroom', new_content)
  on conflict (key) do update set content = excluded.content;
end $$;

-- ---------------------------------------------------------------------------
-- Definições: etiquetas dos cards (badgesSchema). Só administradores.
-- ---------------------------------------------------------------------------

create or replace function public.wa_update_badges(actor uuid, new_content jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  atual jsonb;
  novos text[];
  antigos text[];
  forma jsonb := '{"t":"obj","keys":{"items":{"t":"list","max":40,"item":{"t":"obj","keys":{
    "id":{"t":"text","min":1,"max":40,"re":"^[a-z0-9_-]+$"},
    "label":{"t":"text","min":1,"max":30},
    "color":{"t":"text","max":7,"re":"^#[0-9a-fA-F]{6}$"},
    "enabled":{"t":"bool"}}}}}}';
begin
  perform public.wa_begin_as(actor, array['definicoes']);
  perform public.wa_require_admin(actor);
  if not public.wa_json_fits(new_content, forma) then raise exception 'Conteúdo inválido'; end if;
  novos := public.wa_ids(new_content->'items');
  if (select count(distinct x) from unnest(novos) x) <> cardinality(novos) then
    raise exception 'Conteúdo inválido';
  end if;

  select content into atual from public.site_content where key = 'badges' for update;
  antigos := public.wa_ids(atual->'items');
  -- As mesmas etiquetas: as do stand que existem continuam (nenhuma sai), e só
  -- entram as automáticas, que o `mergeBadges` repõe sempre.
  if not (antigos <@ novos)
     or not (novos <@ (antigos || array['reserved', 'sold', 'price_drop', 'national', 'new', 'low_km'])) then
    raise exception 'Conteúdo mudou';
  end if;

  insert into public.site_content(key, content) values ('badges', new_content)
  on conflict (key) do update set content = excluded.content;
end $$;

-- ---------------------------------------------------------------------------
-- Definições: marca, canais de conversa e valor/hora (site_settings). Só
-- administradores. Só as colunas da lista; GA4, Pixel, reservas, logótipo e
-- os contactos antigos (que agora vêm do ponto de venda) ficam de fora.
-- ---------------------------------------------------------------------------

create or replace function public.wa_update_site_settings(actor uuid, changes jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare k text; v jsonb; s public.site_settings%rowtype;
begin
  perform public.wa_begin_as(actor, array['definicoes']);
  perform public.wa_require_admin(actor);
  if changes is null or jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  for k in select jsonb_object_keys(changes) loop
    if k not in ('company_name', 'tagline', 'accent', 'accent_soft', 'whatsapp', 'messenger',
                 'workshop_hourly_rate') then
      raise exception 'Campo não permitido';
    end if;
  end loop;

  select * into s from public.site_settings where id = 1 for update;
  if not found then raise exception 'Definições inexistentes'; end if;

  -- As regras do siteSettingsSchema / companySchema / workshopSchema. Texto
  -- vazio grava-se como nulo, como nas acções (`|| null`).
  if changes ? 'company_name' then
    v := changes->'company_name';
    if not public.wa_json_fits(v, '{"t":"text","min":1,"max":60}') then raise exception 'Nome inválido'; end if;
    s.company_name := trim(v #>> '{}');
  end if;
  if changes ? 'tagline' then
    v := changes->'tagline';
    if not public.wa_json_fits(v, '{"t":"text","max":160}') then raise exception 'Slogan inválido'; end if;
    s.tagline := nullif(trim(v #>> '{}'), '');
  end if;
  if changes ? 'accent' then
    v := changes->'accent';
    if not public.wa_json_fits(v, '{"t":"text","max":7,"re":"^#[0-9a-fA-F]{6}$"}') then raise exception 'Cor inválida'; end if;
    s.accent := v #>> '{}';
  end if;
  if changes ? 'accent_soft' then
    v := changes->'accent_soft';
    if not public.wa_json_fits(v, '{"t":"text","max":7,"re":"^#[0-9a-fA-F]{6}$"}') then raise exception 'Cor inválida'; end if;
    s.accent_soft := v #>> '{}';
  end if;
  if changes ? 'whatsapp' then
    v := changes->'whatsapp';
    -- Só dígitos e com indicativo (o TypeScript já completou o 351).
    if not public.wa_json_fits(v, '{"t":"text","max":23,"re":"^([0-9]{11,23})?$"}') then
      raise exception 'WhatsApp inválido';
    end if;
    s.whatsapp := nullif(v #>> '{}', '');
  end if;
  if changes ? 'messenger' then
    v := changes->'messenger';
    if not public.wa_json_fits(v, '{"t":"text","max":200}') then raise exception 'Messenger inválido'; end if;
    s.messenger := nullif(trim(v #>> '{}'), '');
  end if;
  if changes ? 'workshop_hourly_rate' then
    v := changes->'workshop_hourly_rate';
    if not public.wa_json_fits(v, '{"t":"num","min":0,"max":1000}') then raise exception 'Valor inválido'; end if;
    s.workshop_hourly_rate := round((v #>> '{}')::numeric, 2);
  end if;

  update public.site_settings
     set company_name = s.company_name, tagline = s.tagline, accent = s.accent,
         accent_soft = s.accent_soft, whatsapp = s.whatsapp, messenger = s.messenger,
         workshop_hourly_rate = s.workshop_hourly_rate
   where id = 1;
end $$;

-- Só o servidor, como na 0024 e na 0038: revoke e grant juntos.
do $$ declare sig text; begin
  foreach sig in array array[
    'wa_json_fits(jsonb,jsonb)',
    'wa_require_admin(uuid)',
    'wa_ids(jsonb)',
    'wa_update_home(uuid,jsonb)',
    'wa_update_showroom(uuid,jsonb)',
    'wa_update_badges(uuid,jsonb)',
    'wa_update_site_settings(uuid,jsonb)'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0041_more_notifications.sql
-- ---------------------------------------------------------------------------
-- Mais avisos por WhatsApp à equipa: férias, contactos atribuídos, vendas,
-- reservas que terminam, preços que mudam e viaturas que saem da oficina.
--
-- A 0036 avisava do que ENTRA no backoffice (contactos do site, testemunhos,
-- viaturas novas). Faltava o que acontece depois — e o que mais pesa no dia a
-- dia de um stand: «a mota saiu da oficina e está pronta», «tens um contacto
-- novo atribuído», «o João vai de férias na semana que vem».
--
-- Tudo o que a 0036 garante continua a valer, e pelos mesmos caminhos:
--
--  * Os avisos agendam-se em gatilhos e nunca bloqueiam a gravação (um erro é
--    engolido, com um WARNING no log).
--  * O índice único (aviso, registo, pessoa) impede repetições. Nos avisos
--    sobre uma MUDANÇA (uma viatura que sai da oficina, um contacto atribuído),
--    o «registo» é a mudança — `notification_subject`, um id por aviso, registo
--    e transação: a mesma mota pode sair da oficina duas vezes, e as duas são
--    novidade; o mesmo gatilho a correr duas vezes na mesma transação não é.
--  * Quem recebe decide-se com as permissões do backoffice e volta a verificar-se
--    antes de enviar — agora com o conteúdo do aviso
--    (`notification_job_block_reason`): o pedido de férias já decidido, o
--    contacto entretanto atribuído a outro, as férias desmarcadas já não se
--    enviam.
--  * Quem fez a ação não é avisado; com o interruptor geral desligado, nada
--    entra na fila; a limpeza dos 30 dias (0036) apanha tudo.
--
-- Avisos novos, quem os recebe e se vêm ligados por defeito (sem linha em
-- `notification_preferences` vale `notification_event_default`):
--
--   lead_assigned          Leads    o responsável a quem o contacto foi atribuído  ligado
--   lead_outcome           Leads    o responsável, quando outro dá o contacto
--                                   como ganho ou perdido                           ligado
--   vehicle_sold           Leads    quem vende (Leads + tipo de viatura): deixa de
--                                   a oferecer, como na reserva (0036)              ligado
--   reservation_ended      Leads    quem vende: a reserva foi cancelada ou expirou
--                                   e a viatura voltou a estar disponível           ligado
--   vehicle_price_changed  Viaturas quem tem Viaturas, quando muda o preço de uma
--                                   viatura publicada ou reservada                  DESLIGADO
--   leave_requested        Férias   quem pode decidir as férias do colaborador
--                                   (a hierarquia da 0022)                          ligado
--   leave_decided          Férias   quem pediu, quando o pedido é aprovado ou
--                                   recusado                                        ligado
--   leave_upcoming         Férias   toda a equipa (quem vê «Férias colegas»), menos
--                                   o próprio: as férias aprovadas de um colega
--                                   começam nos próximos 7 dias                     ligado
--
-- E o `vehicle_prepared` da 0036 passa a disparar sempre que uma viatura SAI da
-- oficina (para preparada, rascunho ou, já publicada antes, de volta ao site),
-- e não só da primeira vez: antes, o registo era a viatura, e uma mota que
-- voltava à oficina e saía outra vez já não avisava ninguém.
--
-- «Férias» não é um separador do backoffice: é a área pessoal, que toda a gente
-- tem (o próprio mecânico). Fica no catálogo como 'perfil'.
--
-- Os textos vão nos quatro modelos que já existem (docs/WHATSAPP_TEMPLATES.md):
-- nenhum stand tem de pedir à Meta um modelo novo.
--
-- Os números 0039 e 0040 são de outro trabalho (o assistente do WhatsApp); esta
-- não lhes toca.
begin;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

-- A mesma função da 0036, com os avisos novos. O TypeScript
-- (src/lib/notification-events.ts) tem os textos; um teste garante que os dois
-- catálogos têm os mesmos avisos, no mesmo separador.
create or replace function public.notification_event_section(ev text)
returns text language sql immutable set search_path = public as $$
  select case ev
    -- Contactos do site, um aviso por tipo de pedido.
    when 'lead_contact'          then 'leads'
    when 'lead_test_drive'       then 'leads'
    when 'lead_offer'            then 'leads'
    when 'lead_reservation'      then 'leads'
    when 'lead_trade_in'         then 'leads'
    when 'lead_order'            then 'leads'
    when 'lead_alert'            then 'leads'
    -- Um contacto atribuído, ou fechado por um colega: só para o responsável.
    when 'lead_assigned'         then 'leads'
    when 'lead_outcome'          then 'leads'
    -- Uma reserva feita por um colega: quem vende tem de deixar de a oferecer.
    when 'vehicle_reserved'      then 'leads'
    -- E o contrário: vendida (deixar de oferecer) ou reserva terminada (voltar a).
    when 'vehicle_sold'          then 'leads'
    when 'reservation_ended'     then 'leads'
    when 'testimonial_pending'   then 'testemunhos'
    when 'vehicle_workshop'      then 'oficina'
    when 'vehicle_created'       then 'carros'
    when 'vehicle_prepared'      then 'carros'
    when 'vehicle_published'     then 'carros'
    when 'vehicle_price_changed' then 'carros'
    -- Férias: a área pessoal, que toda a gente tem.
    when 'leave_requested'       then 'perfil'
    when 'leave_decided'         then 'perfil'
    when 'leave_upcoming'        then 'perfil'
    -- O acesso dado pela Meta dura 60 dias; sem ele, o WhatsApp todo pára.
    when 'whatsapp_expiring'     then 'integracoes'
    else null end;
$$;

-- Ligado ou desligado para quem nunca mexeu nas escolhas do perfil. Só o que
-- pode chegar aos montes sem pedir ação começa desligado.
create or replace function public.notification_event_default(ev text)
returns boolean language sql immutable set search_path = public as $$
  select ev is distinct from 'vehicle_price_changed';
$$;

-- ---------------------------------------------------------------------------
-- A hierarquia das férias (0022), com o id explícito
-- ---------------------------------------------------------------------------

-- A regra da 0022, parametrizada por quem decide — para saber quem avisar de um
-- pedido sem depender de `auth.uid()`. `can_decide_leave_for` passa a invólucro,
-- como o `has_section` da 0024: a regra continua a existir numa só cópia.
create or replace function public.can_decide_leave_as(approver uuid, target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    -- O administrador está no topo: decide tudo, incluindo o seu próprio plano.
    when (select role::text from public.profiles where id = approver) = 'admin'
      then true
    -- O chefe decide quem está abaixo dele, nunca um par nem um superior.
    when (select role::text from public.profiles where id = approver) = 'chefe'
      then coalesce((select role::text from public.profiles where id = target)
                    in ('vendedor', 'mecanico'), false)
    else false
  end;
$$;

create or replace function public.can_decide_leave_for(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_decide_leave_as(auth.uid(), target);
$$;

-- ---------------------------------------------------------------------------
-- Dias em que não se trabalha (para juntar os dias de férias num período)
-- ---------------------------------------------------------------------------

-- Domingo de Páscoa (Meeus/Jones/Butcher), como `easterSunday` em src/lib/leave.ts.
create or replace function public.easter_sunday(y int)
returns date language plpgsql immutable set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
begin
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  return make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end $$;

-- Fim de semana, feriado nacional (os de `nationalHolidays`) ou dia definido
-- pelo stand (feriado municipal, tolerância, fecho obrigatório). Umas férias de
-- quinta a terça, com o fim de semana pelo meio, são UM período; com um dia de
-- trabalho pelo meio, são dois.
create or replace function public.is_day_off(d date)
returns boolean language sql stable security definer set search_path = public as $$
  select extract(isodow from d) >= 6
      or to_char(d, 'MM-DD') in ('01-01', '04-25', '05-01', '06-10', '08-15',
                                 '10-05', '11-01', '12-01', '12-08', '12-25')
      or d in (public.easter_sunday(extract(year from d)::int) - 2,
               public.easter_sunday(extract(year from d)::int),
               public.easter_sunday(extract(year from d)::int) + 60)
      or exists (select 1 from public.company_days cd where cd.day = d);
$$;

-- ---------------------------------------------------------------------------
-- Quem recebe
-- ---------------------------------------------------------------------------

-- A da 0036, com duas mudanças: os avisos de «perfil» não dependem de um
-- separador (toda a gente tem perfil), e quem nunca escolheu fica com o valor
-- por defeito do aviso — que, para os da 0036, continua a ser «ligado».
create or replace function public.notification_block_reason(uid uuid, ev text, vtype text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.notification_event_section(ev) is null then 'Aviso desconhecido'
    when p.id is null then 'O colaborador já não existe'
    -- O WhatsApp quer o número com indicativo: entre 9 e 15 algarismos.
    when length(coalesce(public.normalize_phone(p.phone), '')) not between 9 and 15
      then 'Sem telefone válido no perfil'
    when public.notification_event_section(ev) <> 'perfil'
         and not public.has_section_for(p.id, public.notification_event_section(ev))
      then 'Sem acesso a este separador'
    when vtype is not null and not public.has_vehicle_type_for(p.id, vtype)
      then 'Sem acesso a este tipo de viatura'
    when not coalesce((select np.enabled from public.notification_preferences np
                        where np.profile_id = p.id and np.event = ev),
                      public.notification_event_default(ev))
      then 'Aviso desligado no perfil'
    else null end
  from (select uid as id) alvo
  left join public.profiles p on p.id = alvo.id;
$$;

-- O mesmo, mais o que depende do conteúdo do aviso. É esta que decide antes de
-- enviar: entre agendar e enviar, o pedido de férias pode ter sido decidido, o
-- contacto atribuído a outra pessoa, as férias desmarcadas.
create or replace function public.notification_job_block_reason(uid uuid, ev text, details jsonb)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  motivo text := public.notification_block_reason(uid, ev, details ->> 'vehicle_type');
  pessoa uuid;
begin
  if motivo is not null then return motivo; end if;
  if ev in ('lead_assigned', 'lead_outcome') then
    if (select l.assigned_to from public.leads l where l.id = (details ->> 'lead_id')::uuid)
       is distinct from uid then
      return 'O contacto já não está atribuído a esta pessoa';
    end if;
  elsif ev in ('leave_requested', 'leave_decided', 'leave_upcoming') then
    pessoa := (details ->> 'profile_id')::uuid;
    if ev = 'leave_requested' then
      if not public.can_decide_leave_as(uid, pessoa) or uid = pessoa then
        return 'Já não decide as férias desta pessoa';
      end if;
      if not exists (select 1 from public.leave_days d
                      where d.profile_id = pessoa and d.status = 'pending'
                        and d.day between (details ->> 'start')::date and (details ->> 'end')::date) then
        return 'O pedido de férias já foi decidido';
      end if;
    elsif ev = 'leave_decided' then
      if uid is distinct from pessoa then return 'O pedido de férias não é desta pessoa'; end if;
    else
      if uid = pessoa then return 'São as férias da própria pessoa'; end if;
      if not exists (select 1 from public.leave_days d
                      where d.profile_id = pessoa and d.status = 'approved'
                        and d.day = (details ->> 'start')::date) then
        return 'As férias foram desmarcadas';
      end if;
    end if;
  end if;
  return null;
end $$;

-- O registo de um aviso sobre uma MUDANÇA: um id por aviso, registo e
-- transação. A mesma transação dá sempre o mesmo id (o índice único trava a
-- repetição); outra transação, outra mudança, outro aviso.
create or replace function public.notification_subject(ev text, rec uuid)
returns uuid language sql volatile set search_path = public as $$
  select md5(ev || ':' || rec::text || ':' || txid_current()::text)::uuid;
$$;

-- Agenda um aviso para um grupo escolhido de pessoas (o responsável do
-- contacto, quem decide as férias…), em vez de para todos os que têm o
-- separador. As mesmas regras de `queue_whatsapp_event` (0036): interruptor,
-- autor de fora, um telefone recebe uma vez, nunca duas vezes o mesmo aviso.
create or replace function public.queue_whatsapp_notice(
  ev text, subject uuid, vtype text, details jsonb, lead uuid, candidates uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int; carga jsonb;
begin
  if not coalesce((select whatsapp_enabled from public.notification_settings where id = 1), false) then
    return 0;
  end if;
  if public.notification_event_section(ev) is null then
    raise exception 'Aviso desconhecido: %', ev;
  end if;
  carga := coalesce(details, '{}'::jsonb) || jsonb_build_object('vehicle_type', vtype);
  insert into public.notification_jobs (channel, event, subject_id, recipient_id, lead_id, payload)
  select distinct on (public.normalize_phone(p.phone)) 'whatsapp', ev, subject, p.id, lead, carga
    from public.profiles p
   where p.id = any(coalesce(candidates, '{}'::uuid[]))
     and p.id is distinct from auth.uid()
     and public.notification_job_block_reason(p.id, ev, carga) is null
   order by public.normalize_phone(p.phone), p.created_at, p.id
  on conflict (event, subject_id, recipient_id) where channel = 'whatsapp' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Viaturas: sai da oficina, vendida, preço alterado
-- ---------------------------------------------------------------------------

-- Substitui a da 0036. O que já existia fica igual (criada, na oficina,
-- publicada pela primeira vez). Muda o «preparada»: dispara sempre que a
-- viatura sai da oficina, seja pelo botão da Oficina, seja mudando o estado na
-- ficha — e uma vez por saída. Uma viatura que sai da oficina diretamente para
-- o site pela primeira vez dá só o aviso de publicada, o que interessa.
create or replace function public.notify_car_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text; det jsonb;
begin
  det := jsonb_build_object(
    'make', new.make, 'model', new.model, 'variant', new.variant,
    'plate', new.license_plate, 'year', new.year, 'car_id', new.id);
  if tg_op = 'INSERT' then
    ev := case
      -- Criada já publicada: um aviso só, o que interessa.
      when new.published_at is not null then 'vehicle_published'
      when new.status = 'workshop' then 'vehicle_workshop'
      else 'vehicle_created' end;
    perform public.queue_whatsapp_event(ev, new.id, new.vehicle_type, det);
    return null;
  end if;

  if new.published_at is not null and old.published_at is null then
    perform public.queue_whatsapp_event('vehicle_published', new.id, new.vehicle_type, det);
  elsif old.status = 'workshop' and new.status <> 'workshop' then
    perform public.queue_whatsapp_event('vehicle_prepared',
      public.notification_subject('vehicle_prepared', new.id), new.vehicle_type,
      det || jsonb_build_object('status', new.status));
  end if;

  if new.status = 'sold' and old.status is distinct from 'sold' then
    perform public.queue_whatsapp_event('vehicle_sold',
      public.notification_subject('vehicle_sold', new.id), new.vehicle_type, det);
  end if;

  -- Só o preço de uma viatura à venda, e só quando o estado não muda na mesma
  -- gravação (publicar ou vender já têm o seu aviso).
  if new.status = old.status and new.status in ('published', 'reserved')
     and (new.price is distinct from old.price or new.price_on_request is distinct from old.price_on_request) then
    perform public.queue_whatsapp_event('vehicle_price_changed',
      public.notification_subject('vehicle_price_changed', new.id), new.vehicle_type,
      det || jsonb_build_object(
        'old_price', case when old.price_on_request then null else old.price end,
        'new_price', case when new.price_on_request then null else new.price end));
  end if;
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (viatura %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp on public.cars;
create trigger notify_whatsapp after insert or update of status, published_at, price, price_on_request
  on public.cars for each row execute function public.notify_car_whatsapp();

-- ---------------------------------------------------------------------------
-- Reserva cancelada ou expirada: a viatura volta a estar disponível
-- ---------------------------------------------------------------------------

-- O registo é a reserva, que só termina uma vez. A expiração corre na
-- manutenção, sem autor: avisa toda a equipa comercial.
create or replace function public.notify_reservation_end_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; cliente text;
begin
  select make, model, variant, license_plate, vehicle_type into c
    from public.cars where id = new.car_id;
  select name into cliente from public.leads where id = new.lead_id;
  perform public.queue_whatsapp_event('reservation_ended', new.id, c.vehicle_type,
    jsonb_build_object(
      'make', c.make, 'model', c.model, 'variant', c.variant, 'plate', c.license_plate,
      'car_id', new.car_id, 'lead_id', new.lead_id, 'outcome', new.status, 'customer', cliente));
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (reserva %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp_end on public.reservations;
create trigger notify_whatsapp_end after update of status on public.reservations
  for each row when (old.status = 'active' and new.status in ('cancelled', 'expired'))
  execute function public.notify_reservation_end_whatsapp();

-- ---------------------------------------------------------------------------
-- Contactos: atribuído a alguém, ganho ou perdido
-- ---------------------------------------------------------------------------

-- Só para o responsável. «Atribuído» é um aviso à parte dos contactos novos:
-- quem desligou os contactos do site continua a saber o que lhe atribuem.
create or replace function public.notify_lead_followup_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare det jsonb;
begin
  det := jsonb_build_object(
    'kind', new.kind, 'name', new.name, 'car_label', new.car_label,
    'offer_amount', new.car_details -> 'offer_amount', 'deposit', new.car_details -> 'deposit',
    'lead_id', new.id);
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    perform public.queue_whatsapp_notice('lead_assigned',
      public.notification_subject('lead_assigned', new.id), new.vehicle_type, det, new.id,
      array[new.assigned_to]);
  end if;
  if tg_op = 'UPDATE' and new.assigned_to is not null
     and new.status::text in ('won', 'lost') and new.status is distinct from old.status then
    perform public.queue_whatsapp_notice('lead_outcome',
      public.notification_subject('lead_outcome', new.id), new.vehicle_type,
      det || jsonb_build_object('status', new.status, 'loss_reason', new.loss_reason), new.id,
      array[new.assigned_to]);
  end if;
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (contacto %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp_followup on public.leads;
create trigger notify_whatsapp_followup after insert or update of assigned_to, status on public.leads
  for each row execute function public.notify_lead_followup_whatsapp();

-- ---------------------------------------------------------------------------
-- Férias: pedido, decisão
-- ---------------------------------------------------------------------------

-- Um pedido é o que a pessoa submete de uma vez (vários dias, uma gravação):
-- os gatilhos são por instrução, e não por linha — dez dias pedidos são UM
-- aviso para quem decide, com o período todo.
create or replace function public.queue_whatsapp_leave_request(requester uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record;
begin
  -- Os dias pendentes que esta transação gravou (`updated_at` é o `now()` dela).
  select min(d.day) inicio, max(d.day) fim, sum(case when d.half then 0.5 else 1 end) dias
    into r
    from public.leave_days d
   where d.profile_id = requester and d.status = 'pending' and d.updated_at = now();
  if r.inicio is null then return 0; end if;
  return public.queue_whatsapp_notice('leave_requested',
    public.notification_subject('leave_requested', requester), null,
    jsonb_build_object(
      'profile_id', requester,
      'name', (select coalesce(nullif(p.full_name, ''), p.email, 'Colaborador') from public.profiles p where p.id = requester),
      'start', r.inicio, 'end', r.fim, 'days', r.dias),
    null,
    array(select p.id from public.profiles p
           where p.id <> requester and public.can_decide_leave_as(p.id, requester)));
end $$;

create or replace function public.notify_leave_insert_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare pessoa uuid;
begin
  for pessoa in select distinct profile_id from novos where status = 'pending' loop
    perform public.queue_whatsapp_leave_request(pessoa);
  end loop;
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (pedido de férias): %', sqlerrm;
  return null;
end $$;

create or replace function public.notify_leave_update_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare pessoa uuid; r record;
begin
  -- Um rascunho (ou um dia recusado) que passa a pedido.
  for pessoa in
    select distinct d.profile_id from depois d join antes a on a.id = d.id
     where d.status = 'pending' and a.status <> 'pending'
  loop
    perform public.queue_whatsapp_leave_request(pessoa);
  end loop;

  -- Uma decisão: aprovado ou recusado, avisa quem pediu.
  for r in
    select d.profile_id, d.status, min(d.day) inicio, max(d.day) fim,
           sum(case when d.half then 0.5 else 1 end) dias
      from depois d join antes a on a.id = d.id
     where a.status = 'pending' and d.status in ('approved', 'rejected')
     group by d.profile_id, d.status
  loop
    perform public.queue_whatsapp_notice('leave_decided',
      public.notification_subject('leave_decided:' || r.status, r.profile_id), null,
      jsonb_build_object(
        'profile_id', r.profile_id, 'decision', r.status,
        'start', r.inicio, 'end', r.fim, 'days', r.dias,
        'decided_by', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid())),
      null, array[r.profile_id]);
  end loop;
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (férias): %', sqlerrm;
  return null;
end $$;

-- Com tabelas de transição, um gatilho só pode ser de um tipo de operação: um
-- para as inserções, outro para as alterações. Um `upsert` (marcar dias) dispara
-- os dois; o registo é o mesmo (mesma pessoa, mesma transação), e sai um aviso.
drop trigger if exists notify_whatsapp_insert on public.leave_days;
create trigger notify_whatsapp_insert after insert on public.leave_days
  referencing new table as novos
  for each statement execute function public.notify_leave_insert_whatsapp();
drop trigger if exists notify_whatsapp_update on public.leave_days;
create trigger notify_whatsapp_update after update on public.leave_days
  referencing old table as antes new table as depois
  for each statement execute function public.notify_leave_update_whatsapp();

-- ---------------------------------------------------------------------------
-- Férias: um colega vai de férias nos próximos 7 dias
-- ---------------------------------------------------------------------------

-- Corre na manutenção (e a seguir às ações, com o envio). Um período são dias
-- aprovados seguidos, contando que fins de semana e feriados pelo meio não o
-- partem; avisa-se uma vez por período (o registo é a pessoa e o primeiro dia),
-- quando esse primeiro dia fica a 7 dias ou menos. Só férias APROVADAS: um
-- pedido ainda pode ser recusado.
--
-- Datas de Lisboa. Só entre as 9h e as 20h: a manutenção corre de noite, e uma
-- mensagem destas às três da manhã é ruído — sai às 9h.
create or replace function public.queue_whatsapp_leave_upcoming(agora timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  hora_local timestamp := agora at time zone 'Europe/Lisbon';
  hoje date := hora_local::date;
  r record;
  n int := 0;
begin
  if not coalesce((select whatsapp_enabled from public.notification_settings where id = 1), false) then
    return 0;
  end if;
  if extract(hour from hora_local) < 9 or extract(hour from hora_local) >= 20 then return 0; end if;

  for r in
    with dias as (
      select d.profile_id, d.day, d.half,
             lag(d.day) over (partition by d.profile_id order by d.day) as anterior
        from public.leave_days d
       -- Para trás chega para saber se o dia continua um período (pontes de
       -- poucos dias); para a frente, para saber até quando vai.
       where d.status = 'approved' and d.day between hoje - 14 and hoje + 120
    ), marcados as (
      select profile_id, day, half,
             (anterior is null or exists (
               select 1 from generate_series((anterior + 1)::timestamp, (day - 1)::timestamp, interval '1 day') g
                where not public.is_day_off(g::date))) as novo
        from dias
    ), periodos as (
      select profile_id, day, half,
             sum(case when novo then 1 else 0 end) over (partition by profile_id order by day) as grupo
        from marcados
    )
    select pr.profile_id, min(pr.day) inicio, max(pr.day) fim,
           sum(case when pr.half then 0.5 else 1 end) total
      from periodos pr
     group by pr.profile_id, pr.grupo
    having min(pr.day) between hoje + 1 and hoje + 7
  loop
    n := n + public.queue_whatsapp_notice('leave_upcoming',
      md5('leave_upcoming:' || r.profile_id::text || ':' || r.inicio::text)::uuid, null,
      jsonb_build_object(
        'profile_id', r.profile_id,
        'name', (select coalesce(nullif(p.full_name, ''), p.email, 'Colaborador') from public.profiles p where p.id = r.profile_id),
        'start', r.inicio, 'end', r.fim, 'days', r.total),
      null,
      -- Quem vê «Férias colegas»: toda a equipa, menos o próprio.
      array(select p.id from public.profiles p where p.id <> r.profile_id));
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- O envio volta a verificar com o conteúdo do aviso
-- ---------------------------------------------------------------------------

-- Igual à 0036, salvo o passo 2, que passa a usar `notification_job_block_reason`.
create or replace function public.claim_whatsapp_notifications(batch int default 10)
returns table (job_id uuid, event_kind text, subject uuid, details jsonb, attempt int, to_phone text)
language plpgsql security definer set search_path = public as $$
begin
  -- 1. Já não é novidade: um aviso que esperou mais de um dia sem ser tentado
  --    não se envia — senão, ao ligar o número, chegava tudo de uma vez.
  update public.notification_jobs j
     set cancelled_at = now(), last_error = 'Expirou sem ser enviado (mais de 24 horas à espera)'
   where j.channel = 'whatsapp' and j.delivered_at is null and j.cancelled_at is null
     and j.claimed_at is null and j.next_attempt_at < now() - interval '24 hours';

  -- 2. Quem deixou de poder receber desde que o aviso foi agendado: perdeu o
  --    acesso, tirou o telefone, desligou o aviso — ou o aviso deixou de ser
  --    verdade (pedido decidido, contacto reatribuído, férias desmarcadas).
  update public.notification_jobs j
     set cancelled_at = now(),
         last_error = public.notification_job_block_reason(j.recipient_id, j.event, j.payload)
   where j.channel = 'whatsapp' and j.delivered_at is null and j.cancelled_at is null
     and j.claimed_at is null and j.attempts < 8
     and public.notification_job_block_reason(j.recipient_id, j.event, j.payload) is not null;

  -- 3. Os próximos, por ordem. Os do mesmo instante ficam juntos por pessoa e
  --    aviso, para o envio poder juntar «12 viaturas publicadas» numa mensagem.
  return query
  with escolhidos as (
    select q.id from public.notification_jobs q
     where q.channel = 'whatsapp' and q.delivered_at is null and q.cancelled_at is null
       and q.claimed_at is null and q.attempts < 8 and q.next_attempt_at <= now()
     order by q.created_at, q.recipient_id, q.event
     limit greatest(1, least(coalesce(batch, 10), 50))
     for update skip locked
  ), reclamados as (
    update public.notification_jobs j
       set attempts = j.attempts + 1, claimed_at = now()
      from escolhidos e
     where j.id = e.id
    returning j.id, j.event, j.subject_id, j.payload, j.attempts, j.recipient_id, j.created_at
  )
  select r.id, r.event, r.subject_id, r.payload, r.attempts,
         (select public.normalize_phone(p.phone) from public.profiles p where p.id = r.recipient_id)
    from reclamados r
   order by r.created_at, r.recipient_id, r.event;
end $$;

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------

-- Só o servidor, como na 0036 (revoke e grant juntos). `notification_event_default`
-- fica executável por todos, como `notification_event_section`: é catálogo, e
-- o perfil pode precisar dele. `can_decide_leave_for` mantém os privilégios da
-- 0022 (create or replace não os muda). As funções de gatilho não precisam de
-- ser executáveis por ninguém.
do $$ declare sig text; begin
  foreach sig in array array[
    'can_decide_leave_as(uuid,uuid)',
    'easter_sunday(int)',
    'is_day_off(date)',
    'notification_job_block_reason(uuid,text,jsonb)',
    'notification_subject(text,uuid)',
    'queue_whatsapp_notice(text,uuid,text,jsonb,uuid,uuid[])',
    'queue_whatsapp_leave_request(uuid)',
    'queue_whatsapp_leave_upcoming(timestamptz)',
    'notify_reservation_end_whatsapp()',
    'notify_lead_followup_whatsapp()',
    'notify_leave_insert_whatsapp()',
    'notify_leave_update_whatsapp()'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0042_alerts_visits.sql
-- ---------------------------------------------------------------------------
-- Alertas de stock automáticos e visitas ao stand.
--
-- Até aqui, o «avise-me quando entrar» era só um contacto com texto livre: a
-- equipa tinha de se lembrar dele quando entrasse uma viatura parecida. E quem
-- queria ver uma viatura ao vivo tinha de telefonar para combinar a hora.
--
--  * Um alerta passa a guardar critérios (marca, modelo, preço máximo, …) em
--    `car_details.criteria`. Quando uma viatura compatível é publicada, fica
--    uma linha em `stock_alert_matches` (uma por alerta e viatura, nunca duas)
--    e o cliente é avisado por WhatsApp — se o pediu e se o stand ligou as
--    mensagens aos clientes. Senão, a equipa vê a correspondência no contacto,
--    com o botão para enviar pelo WhatsApp dela.
--  * Uma visita é um contacto com dia e hora (`visit_at`) e um estado próprio
--    (`visit_status`), para a agenda. Qualquer contacto pode ganhar uma visita;
--    os pedidos do site entram com o tipo 'visit'.
--  * As definições (horário das visitas e o interruptor das mensagens aos
--    clientes) ficam numa tabela à parte: só o servidor e o administrador as
--    leem, e nada do que já existe em `site_settings` muda.
--
-- O valor 'visit' do tipo de contacto não é usado nesta migração: o Postgres
-- não deixa usar um valor de enum acabado de criar na mesma transação.
begin;

alter type public.lead_kind add value if not exists 'visit';

-- ---------------------------------------------------------------------------
-- Visitas
-- ---------------------------------------------------------------------------

alter table public.leads
  add column if not exists visit_at          timestamptz,
  add column if not exists visit_status      text,
  -- Lembrete do dia anterior, enviado uma vez.
  add column if not exists visit_reminded_at timestamptz;

alter table public.leads drop constraint if exists leads_visit_status_check;
alter table public.leads add constraint leads_visit_status_check check (
  visit_status is null or visit_status in ('requested', 'confirmed', 'done', 'no_show', 'cancelled'));
-- Uma visita tem sempre dia e estado, ou nenhum dos dois.
alter table public.leads drop constraint if exists leads_visit_shape;
alter table public.leads add constraint leads_visit_shape check ((visit_at is null) = (visit_status is null));

create index if not exists leads_visit_at_idx on public.leads (visit_at) where visit_at is not null;

-- ---------------------------------------------------------------------------
-- Correspondências dos alertas de stock
-- ---------------------------------------------------------------------------

create table if not exists public.stock_alert_matches (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  car_id        uuid not null references public.cars(id) on delete cascade,
  -- pending: por avisar · sending: a enviar agora · sent: avisado por WhatsApp
  -- manual: fica para a equipa (sem WhatsApp automático) · failed: a Meta recusou
  -- cancelled: a viatura deixou de estar à venda antes do aviso
  status        text not null default 'pending'
                check (status in ('pending', 'sending', 'sent', 'manual', 'failed', 'cancelled')),
  attempts      int not null default 0,
  error         text,
  wa_message_id text,
  sent_at       timestamptz,
  created_at    timestamptz not null default now(),
  unique (lead_id, car_id)
);
create index if not exists stock_alert_matches_pending
  on public.stock_alert_matches (created_at) where status in ('pending', 'sending');

alter table public.stock_alert_matches enable row level security;
drop policy if exists "stock_alert_matches: leads" on public.stock_alert_matches;
create policy "stock_alert_matches: leads" on public.stock_alert_matches
  for select to authenticated using (public.has_section('leads'));
-- A equipa marca «avisado» à mão; o resto escreve-o o servidor.
drop policy if exists "stock_alert_matches: leads update" on public.stock_alert_matches;
create policy "stock_alert_matches: leads update" on public.stock_alert_matches
  for update to authenticated using (public.has_section('leads')) with check (public.has_section('leads'));
revoke all on public.stock_alert_matches from anon, authenticated;
grant select on public.stock_alert_matches to authenticated;
grant update (status, sent_at, error) on public.stock_alert_matches to authenticated;
grant all on public.stock_alert_matches to service_role;

-- ---------------------------------------------------------------------------
-- Definições: visitas e mensagens aos clientes
-- ---------------------------------------------------------------------------

create table if not exists public.customer_settings (
  id                int primary key default 1 check (id = 1),
  visits_enabled    boolean not null default true,
  -- { "days": { "1": [["09:00","19:00"]], …, "0": [] }, "slot": 30,
  --   "capacity": 1, "notice_hours": 2, "max_days": 21 }  (0 = domingo)
  visit_schedule    jsonb not null default '{}'::jsonb,
  -- Mensagens automáticas por WhatsApp aos CLIENTES (alertas e visitas).
  -- Começa desligado: precisa dos modelos aprovados pela Meta.
  customer_whatsapp boolean not null default false,
  updated_at        timestamptz not null default now()
);
insert into public.customer_settings (id) values (1) on conflict (id) do nothing;

alter table public.customer_settings enable row level security;
drop policy if exists "customer_settings: staff read" on public.customer_settings;
create policy "customer_settings: staff read" on public.customer_settings
  for select to authenticated using (public.is_staff());
drop policy if exists "customer_settings: admin write" on public.customer_settings;
create policy "customer_settings: admin write" on public.customer_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.customer_settings from anon, authenticated;
grant select on public.customer_settings to authenticated;
grant update (visits_enabled, visit_schedule, customer_whatsapp, updated_at) on public.customer_settings to authenticated;
grant all on public.customer_settings to service_role;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0043_wa_contacts.sql
-- ---------------------------------------------------------------------------
-- Contactos externos do número de WhatsApp.
--
-- Até aqui o número era só do pessoal: uma mensagem de um telefone sem perfil
-- ficava sem resposta. Agora é o número da marca, para toda a gente. Quem não
-- é colaborador é um contacto, e identifica-se SEMPRE pela empresa e pelo cargo
-- (o assistente pergunta-os na primeira conversa). Os colaboradores continuam a
-- ser reconhecidos pelo telefone do perfil e não passam por aqui.
begin;

create table if not exists public.wa_contacts (
  -- Telefone normalizado (normalize_phone): uma linha por pessoa.
  phone           text primary key,
  -- O nome do perfil de WhatsApp, tal como a Meta o entrega.
  profile_name    text,
  name            text,
  company         text,
  role            text,
  -- Em que ponto da apresentação vai: company → role → done.
  step            text not null default 'company' check (step in ('company', 'role', 'done')),
  first_message   text,
  last_message    text,
  messages        int  not null default 1,
  created_at      timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);

create index if not exists idx_wa_contacts_last on public.wa_contacts (last_message_at desc);

-- O staff vê; só o servidor (chave de serviço) escreve.
alter table public.wa_contacts enable row level security;
revoke all on public.wa_contacts from anon, authenticated;
grant select on public.wa_contacts to authenticated;

drop policy if exists "wa_contacts: staff read" on public.wa_contacts;
create policy "wa_contacts: staff read"
  on public.wa_contacts for select to authenticated
  using (public.is_staff());

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0044_visit_confirm.sql
-- ---------------------------------------------------------------------------
-- Pedido de visita feito no site: aviso por WhatsApp à equipa e confirmação com
-- um toque.
--
--  * Novo aviso `lead_visit` (Leads, ligado por defeito): sai quando o cliente
--    pede uma visita no site (kind 'visit', visit_status 'requested'). Substitui
--    o `lead_contact` genérico para este tipo de contacto. Visitas já criadas
--    como confirmadas pela equipa não avisam ninguém.
--  * O aviso leva `lead_id`, `visit_at` (ISO UTC) e `visit_status`, para o
--    botão de resposta saber a que contacto se refere.
--  * Antes de enviar, o aviso volta a verificar-se: se a visita já não existe
--    ou já não está por tratar (um colega confirmou, ou foi tratada no
--    backoffice), o aviso cancela-se.
--  * `wa_set_visit(actor, lead, outcome)`: confirma ou recusa a visita pelo
--    WhatsApp. Devolve um texto com o resultado; é idempotente.
begin;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

create or replace function public.notification_event_section(ev text)
returns text language sql immutable set search_path = public as $$
  select case ev
    -- Contactos do site, um aviso por tipo de pedido.
    when 'lead_contact'          then 'leads'
    when 'lead_test_drive'       then 'leads'
    when 'lead_offer'            then 'leads'
    when 'lead_reservation'      then 'leads'
    when 'lead_trade_in'         then 'leads'
    when 'lead_order'            then 'leads'
    when 'lead_alert'            then 'leads'
    -- Pedido de visita ao stand: a equipa confirma ou recusa pelo WhatsApp.
    when 'lead_visit'            then 'leads'
    -- Um contacto atribuído, ou fechado por um colega: só para o responsável.
    when 'lead_assigned'         then 'leads'
    when 'lead_outcome'          then 'leads'
    -- Uma reserva feita por um colega: quem vende tem de deixar de a oferecer.
    when 'vehicle_reserved'      then 'leads'
    -- E o contrário: vendida (deixar de oferecer) ou reserva terminada (voltar a).
    when 'vehicle_sold'          then 'leads'
    when 'reservation_ended'     then 'leads'
    when 'testimonial_pending'   then 'testemunhos'
    when 'vehicle_workshop'      then 'oficina'
    when 'vehicle_created'       then 'carros'
    when 'vehicle_prepared'      then 'carros'
    when 'vehicle_published'     then 'carros'
    when 'vehicle_price_changed' then 'carros'
    -- Férias: a área pessoal, que toda a gente tem.
    when 'leave_requested'       then 'perfil'
    when 'leave_decided'         then 'perfil'
    when 'leave_upcoming'        then 'perfil'
    -- O acesso dado pela Meta dura 60 dias; sem ele, o WhatsApp todo pára.
    when 'whatsapp_expiring'     then 'integracoes'
    else null end;
$$;

-- `lead_visit` vem ligado (só `vehicle_price_changed` começa desligado, 0041).
create or replace function public.notification_event_default(ev text)
returns boolean language sql immutable set search_path = public as $$
  select ev is distinct from 'vehicle_price_changed';
$$;

-- ---------------------------------------------------------------------------
-- O aviso
-- ---------------------------------------------------------------------------

create or replace function public.notify_lead_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind::text = 'visit' then
    -- Só os pedidos do site (por confirmar). Uma visita criada já confirmada
    -- pela equipa não precisa de aviso.
    if new.visit_status is distinct from 'requested' then
      return null;
    end if;
    perform public.queue_whatsapp_event('lead_visit', new.id, new.vehicle_type,
      jsonb_build_object(
        'kind', new.kind,
        'name', new.name,
        'car_label', new.car_label,
        'lead_id', new.id::text,
        'visit_at', to_char(new.visit_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'visit_status', new.visit_status),
      new.id);
    return null;
  end if;

  perform public.queue_whatsapp_event(
    case new.kind::text
      when 'test_drive'  then 'lead_test_drive'
      when 'offer'       then 'lead_offer'
      when 'reservation' then 'lead_reservation'
      when 'trade_in'    then 'lead_trade_in'
      when 'order'       then 'lead_order'
      when 'alert'       then 'lead_alert'
      else 'lead_contact' end,
    new.id, new.vehicle_type,
    -- Só o que a mensagem mostra. Email e telefone do cliente não vão para o
    -- WhatsApp: estão no backoffice, a um toque do link.
    jsonb_build_object(
      'kind', new.kind,
      'name', new.name,
      'car_label', new.car_label,
      'offer_amount', new.car_details -> 'offer_amount',
      'deposit', new.car_details -> 'deposit'),
    new.id);
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (contacto %): %', new.id, sqlerrm;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Verificação antes de enviar
-- ---------------------------------------------------------------------------

-- Igual à 0041, mais `lead_visit`: o contacto tem de existir e a visita tem de
-- continuar por tratar.
create or replace function public.notification_job_block_reason(uid uuid, ev text, details jsonb)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  motivo text := public.notification_block_reason(uid, ev, details ->> 'vehicle_type');
  pessoa uuid;
begin
  if motivo is not null then return motivo; end if;
  if ev in ('lead_assigned', 'lead_outcome') then
    if (select l.assigned_to from public.leads l where l.id = (details ->> 'lead_id')::uuid)
       is distinct from uid then
      return 'O contacto já não está atribuído a esta pessoa';
    end if;
  elsif ev = 'lead_visit' then
    if not exists (select 1 from public.leads l where l.id = (details ->> 'lead_id')::uuid) then
      return 'O contacto já não existe';
    end if;
    if not exists (select 1 from public.leads l
                    where l.id = (details ->> 'lead_id')::uuid and l.visit_status = 'requested') then
      return 'A visita já foi tratada';
    end if;
  elsif ev in ('leave_requested', 'leave_decided', 'leave_upcoming') then
    pessoa := (details ->> 'profile_id')::uuid;
    if ev = 'leave_requested' then
      if not public.can_decide_leave_as(uid, pessoa) or uid = pessoa then
        return 'Já não decide as férias desta pessoa';
      end if;
      if not exists (select 1 from public.leave_days d
                      where d.profile_id = pessoa and d.status = 'pending'
                        and d.day between (details ->> 'start')::date and (details ->> 'end')::date) then
        return 'O pedido de férias já foi decidido';
      end if;
    elsif ev = 'leave_decided' then
      if uid is distinct from pessoa then return 'O pedido de férias não é desta pessoa'; end if;
    else
      if uid = pessoa then return 'São as férias da própria pessoa'; end if;
      if not exists (select 1 from public.leave_days d
                      where d.profile_id = pessoa and d.status = 'approved'
                        and d.day = (details ->> 'start')::date) then
        return 'As férias foram desmarcadas';
      end if;
    end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Confirmar ou recusar a visita pelo WhatsApp
-- ---------------------------------------------------------------------------

create or replace function public.wa_set_visit(actor uuid, lead uuid, outcome text)
returns text language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  perform public.wa_begin_as(actor, array['leads']);
  if outcome is null or outcome not in ('confirm', 'decline') then
    raise exception 'Resposta inválida';
  end if;
  if not exists (select 1 from public.leads where id = lead and visit_at is not null) then
    return 'not_found';
  end if;
  l := public.wa_lead_for_update(actor, lead);
  if l.visit_at is null then return 'not_found'; end if;

  if outcome = 'confirm' and l.visit_status = 'confirmed' then return 'already_confirmed'; end if;
  if outcome = 'decline' and l.visit_status = 'cancelled' then return 'already_declined'; end if;
  -- Recusada (ou cancelada) por um colega: quem carrega «Confirmar» depois vê isso.
  if outcome = 'confirm' and l.visit_status = 'cancelled' then return 'already_declined'; end if;
  if outcome = 'confirm' and l.visit_status in ('done', 'no_show') then
    return 'already_handled';
  end if;
  if outcome = 'decline' and l.visit_status in ('done', 'no_show', 'confirmed') then
    return 'already_handled';
  end if;
  -- Daqui em diante só resta 'requested'.
  if l.visit_status is distinct from 'requested' then return 'already_handled'; end if;
  if l.visit_at < now() then return 'past'; end if;

  if outcome = 'confirm' then
    update public.leads
       set visit_status = 'confirmed', next_action = 'Visita ao stand', next_action_at = l.visit_at
     where id = lead;
    insert into public.lead_activities(lead_id, kind, body, created_by)
    values (lead, 'visit', 'Visita confirmada para '
      || to_char(l.visit_at at time zone 'Europe/Lisbon', 'DD/MM/YYYY "às" HH24:MI')
      || ' pelo WhatsApp.', actor);
    return 'confirmed';
  end if;

  update public.leads
     set visit_status = 'cancelled', next_action = 'Propor outra hora ao cliente', next_action_at = now()
   where id = lead;
  insert into public.lead_activities(lead_id, kind, body, created_by)
  values (lead, 'visit', 'Visita recusada pelo WhatsApp: equipa propõe outra hora.', actor);
  return 'declined';
end $$;

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------

do $$ declare sig text; begin
  foreach sig in array array[
    'notification_job_block_reason(uuid,text,jsonb)',
    'wa_set_visit(uuid,uuid,text)'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0045_public_privacy.sql
-- ---------------------------------------------------------------------------
-- ============================================================================
-- 0045 — O que o público lê, as quotas dos formulários e a fila do webhook
--
--  1. Viaturas: o papel `anon` (a chave pública do site) deixa de ler a tabela
--     inteira. Lê coluna a coluna tudo o que o site mostra; a matrícula, o
--     autor (`created_by`) e a categoria do OLX ficam só para a equipa.
--     A RLS continua a decidir QUE viaturas se veem; isto decide QUE colunas.
--  2. Definições do site: o preço/hora da oficina deixa de ser público.
--  3. Fotografias (bucket `car-media`): a API de Storage deixa de listar ao
--     público as pastas de viaturas que não estão no site (rascunhos, oficina).
--     Os links públicos (/object/public/…) continuam a funcionar como antes.
--  4. Quotas dos formulários: um pedido recusado deixa de contar.
--  5. Webhook dos contactos: só entra na fila com um webhook configurado, o que
--     ficou parado mais de 24 horas já não sai sozinho, e a limpeza apaga o que
--     tem mais de 30 dias.
--
-- Pode correr-se mais do que uma vez. O site funciona antes e depois dela: as
-- leituras públicas já pedem as colunas pela lista de src/lib/public-columns.ts.
--
-- ATENÇÃO a migrações futuras: uma coluna nova em `cars` ou `site_settings`
-- NÃO fica visível ao público. Se o site a mostrar, acrescentar
-- `grant select (coluna) on public.<tabela> to anon;` e a coluna à lista de
-- src/lib/public-columns.ts (o teste tests/security.test.mjs compara as duas).
-- ============================================================================
begin;

-- ---------------------------------------------------------------------------
-- 1. Viaturas: colunas públicas
-- ---------------------------------------------------------------------------
-- O revoke da tabela tira também os grants por coluna de uma corrida anterior:
-- a lista abaixo fica a ser a única verdade.
revoke select on public.cars from anon;
grant select (
  id, slug, make, model, variant, year, mileage, fuel, transmission, body,
  power, displacement, color, doors, seats, price, price_on_request, status,
  featured, tagline, description, extras, location, highlights, published_at,
  sold_at, created_at, updated_at, previous_price, national, owners,
  first_owner, service_book, warranty_months, last_inspection, channels,
  registration_month, vehicle_type, point_of_sale_id, olx_attributes, badges
) on public.cars to anon;
-- `authenticated` (a equipa) e `service_role` mantêm a tabela inteira.

-- ---------------------------------------------------------------------------
-- 2. Definições do site: tudo menos o preço/hora da oficina
-- ---------------------------------------------------------------------------
revoke select on public.site_settings from anon;
grant select (
  id, company_name, logo_url, tagline, accent, accent_soft, updated_at,
  ga4_id, pixel_id, reservation_enabled, deposit_amount, phone, email,
  whatsapp, address_street, address_city, address_postal, address_country,
  hours, geo_lat, geo_lng, messenger
) on public.site_settings to anon;

-- ---------------------------------------------------------------------------
-- 3. Storage: o público só lista/lê pela API as pastas de viaturas no site
-- ---------------------------------------------------------------------------
-- As fotografias de uma viatura ficam em `<id da viatura>/<ficheiro>`. O
-- `split_part` é o mesmo que `(storage.foldername(name))[1]` para estes nomes.
-- O bucket continua público: os URLs /object/public/ não passam pela RLS (são
-- nomes aleatórios, que só se conhecem pela ficha publicada).
drop policy if exists "car-media: public read" on storage.objects;
drop policy if exists "car-media: public read on-site" on storage.objects;
create policy "car-media: public read on-site" on storage.objects for select to anon
using (
  bucket_id = 'car-media'
  and exists (
    select 1 from public.cars c
     where c.id::text = split_part(objects.name, '/', 1)
       and c.status in ('published', 'reserved', 'sold')
  )
);
-- A equipa (e quem tem sessão a ver o site) continua a ver o mesmo que antes
-- no que é da equipa: tudo o que está no bucket.
drop policy if exists "car-media: staff read" on storage.objects;
create policy "car-media: staff read" on storage.objects for select to authenticated
using (
  bucket_id = 'car-media'
  and (
    public.is_staff()
    or exists (
      select 1 from public.cars c
       where c.id::text = split_part(objects.name, '/', 1)
         and c.status in ('published', 'reserved', 'sold')
    )
  )
);

-- ---------------------------------------------------------------------------
-- 4. Quotas: um pedido recusado não conta
-- ---------------------------------------------------------------------------
-- Mesma assinatura e privilégios da 0013. O contador não passa de `max + 1`:
-- recusar não volta a gastar a quota. O servidor pede primeiro as quotas por IP
-- e por identidade e só depois a global (src/lib/public-submissions.ts), por
-- isso um cliente travado no seu limite já não gasta a quota de todos.
create or replace function public.consume_submission(key_value text, max_hits int, window_seconds int) returns boolean
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  insert into submission_limits as l (key, window_start, hits) values (key_value, now(), 1)
  on conflict (key) do update set
    hits = case when l.window_start < now() - make_interval(secs => window_seconds) then 1
                else least(l.hits + 1, greatest(max_hits, 0) + 1) end,
    window_start = case when l.window_start < now() - make_interval(secs => window_seconds) then now()
                        else l.window_start end
  returning hits into n;
  return n <= max_hits;
end $$;
revoke all on function public.consume_submission(text, int, int) from public, anon, authenticated;
grant execute on function public.consume_submission(text, int, int) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Webhook dos contactos
-- ---------------------------------------------------------------------------
-- Só há envio com um webhook configurado (Integrações). Sem ele, cada contacto
-- deixava uma linha na fila para sempre — e ligar o webhook mais tarde enviava
-- os contactos antigos todos, de 3 em 3.
create or replace function public.queue_lead_notification() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.integration_secrets
              where id = 1 and nullif(btrim(data->>'lead_webhook'), '') is not null) then
    insert into public.notification_jobs (lead_id) values (new.id);
  end if;
  return new;
exception when others then
  -- Um problema na fila nunca impede o contacto de ficar gravado.
  raise warning 'queue_lead_notification: %', sqlerrm;
  return new;
end $$;
revoke all on function public.queue_lead_notification() from public, anon, authenticated;

-- O que está há mais de 24 horas por tentar (porque o webhook esteve desligado
-- ou mal configurado) já não é novidade: fica marcado e não sai sozinho. O
-- administrador pode sempre «Voltar a tentar» no painel, que repõe
-- `next_attempt_at` e o torna a pôr na fila. Mesma assinatura da 0013/0036.
create or replace function public.claim_notification_jobs() returns setof public.notification_jobs
language sql security definer set search_path = public as $$
  with parados as (
    update public.notification_jobs
       set attempts = greatest(attempts, 8),
           last_error = 'Não enviado: ficou mais de 24 horas na fila'
     where channel = 'webhook' and delivered_at is null and attempts < 8
       and next_attempt_at < now() - interval '24 hours'
    returning id
  )
  update public.notification_jobs set attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
   where id in (select id from public.notification_jobs
                 where channel = 'webhook' and delivered_at is null and attempts < 8
                   and next_attempt_at <= now()
                   and next_attempt_at >= now() - interval '24 hours'
                 order by created_at limit 3 for update skip locked)
  returning *;
$$;
revoke all on function public.claim_notification_jobs() from public, anon, authenticated;
grant execute on function public.claim_notification_jobs() to service_role;

-- A limpeza (0036) passa a apagar também o webhook com mais de 30 dias.
create or replace function public.prune_notification_jobs() returns void
language sql security definer set search_path = public as $$
  delete from public.notification_jobs
   where channel in ('whatsapp', 'webhook') and created_at < now() - interval '30 days';
$$;
revoke all on function public.prune_notification_jobs() from public, anon, authenticated;
grant execute on function public.prune_notification_jobs() to service_role;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0046_backoffice_rules.sql
-- ---------------------------------------------------------------------------
-- Backoffice: oficina, horas e férias.
--
--  1. Registar na oficina uma viatura do tipo carro falhava: a 0019/0028
--     gravavam portas e lugares a NULL, e as colunas são NOT NULL. Só as motas
--     entravam. Agora o carro fica com os valores por defeito da tabela (os
--     mesmos que a ficha propõe e que a `create_workshop_intake` sempre usou);
--     quem completa a ficha corrige-os antes de publicar.
--  2. Férias: quem pede deixava de precisar de chefe — um pedido direto à API
--     punha o próprio dia como aprovado. O próprio só grava rascunho/pedido;
--     aprovar e recusar fica para quem pode decidir (`can_decide_leave_for`).
--     Um dia recusado pode voltar a ser pedido.
--  3. Horas da oficina: cada um mexe nos seus registos. Quem está acima na
--     hierarquia (o administrador; o chefe sobre vendedores e mecânicos) pode
--     corrigir os dos outros — a mesma regra das férias.
--  4. Totais de horas por viatura calculados na base de dados (vista), em vez
--     de ler todos os registos para o servidor — a API corta em 1000 linhas.
--  5. Apagar um utilizador já não apaga as horas dele: ficam sem dono, como
--     as da oficina, e com o nome guardado.
--
-- Pode ser corrida mais de uma vez.
begin;

-- ---------------------------------------------------------------------------
-- 1. Entrada na oficina
-- ---------------------------------------------------------------------------
create or replace function public.create_workshop_intake_for_type(vehicle_name text,plate text,selected_type text) returns uuid
language plpgsql security definer set search_path=public as $$
declare result uuid := gen_random_uuid();
begin
  if not public.has_section('oficina') then raise exception 'Sem permissão'; end if;
  if selected_type is null or selected_type not in ('car','motorcycle') then raise exception 'Tipo inválido'; end if;
  if vehicle_name is null or plate is null or length(trim(vehicle_name)) not between 1 and 120 or length(trim(plate)) not between 2 and 20 then raise exception 'Dados inválidos'; end if;
  if selected_type = 'motorcycle' then
    insert into public.cars(id,slug,make,model,year,license_plate,fuel,transmission,body,status,price_on_request,created_by,vehicle_type,doors,seats)
    values(result,'oficina-'||result,trim(vehicle_name),'—',null,upper(trim(plate)),null,null,null,'workshop',true,auth.uid(),selected_type,0,2);
  else
    -- Portas e lugares ficam com o valor por defeito da tabela.
    insert into public.cars(id,slug,make,model,year,license_plate,fuel,transmission,body,status,price_on_request,created_by,vehicle_type)
    values(result,'oficina-'||result,trim(vehicle_name),'—',null,upper(trim(plate)),null,null,null,'workshop',true,auth.uid(),selected_type);
  end if;
  return result;
end $$;
revoke all on function public.create_workshop_intake_for_type(text,text,text) from public;
grant execute on function public.create_workshop_intake_for_type(text,text,text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Férias: o próprio pede, quem está acima decide
-- ---------------------------------------------------------------------------
drop policy if exists "leave_days: own update" on public.leave_days;
create policy "leave_days: own update"
  on public.leave_days for update to authenticated
  using (
    (profile_id = auth.uid() and status in ('draft', 'pending', 'rejected'))
    or public.can_decide_leave_for(profile_id)
  )
  with check (
    (profile_id = auth.uid() and status in ('draft', 'pending'))
    or public.can_decide_leave_for(profile_id)
  );

-- Um dia que volta a rascunho ou a pedido deixa de ter decisão: assim não se
-- herda "decidido por" de uma recusa anterior, nem se inventa um.
create or replace function public.leave_days_clear_decision() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.status in ('draft', 'pending') then
    new.decided_by := null;
    new.decided_at := null;
  end if;
  return new;
end $$;
revoke all on function public.leave_days_clear_decision() from public, anon, authenticated;

drop trigger if exists leave_days_clear_decision on public.leave_days;
create trigger leave_days_clear_decision
  before insert or update on public.leave_days
  for each row execute function public.leave_days_clear_decision();

-- ---------------------------------------------------------------------------
-- 3. Horas da oficina: os próprios, ou de quem está abaixo
-- ---------------------------------------------------------------------------
create or replace function public.can_manage_hours_of(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  -- A regra de quem está acima é a das férias (0041). Registos de quem já foi
  -- apagado (sem dono) ficam só para o administrador, que decide tudo.
  select auth.uid() is not null
     and (coalesce(target = auth.uid(), false)
          or coalesce(public.can_decide_leave_as(auth.uid(), target), false));
$$;
revoke all on function public.can_manage_hours_of(uuid) from public, anon;
grant execute on function public.can_manage_hours_of(uuid) to authenticated, service_role;

-- Quem regista é quem está autenticado, se o pedido não disser outra coisa.
alter table public.vehicle_tasks alter column created_by set default auth.uid();

drop policy if exists "tasks: workshop" on public.vehicle_tasks;
drop policy if exists "tasks: workshop read" on public.vehicle_tasks;
create policy "tasks: workshop read" on public.vehicle_tasks for select to authenticated
using (public.has_section('oficina'));

drop policy if exists "tasks: workshop insert" on public.vehicle_tasks;
create policy "tasks: workshop insert" on public.vehicle_tasks for insert to authenticated
with check (public.has_section('oficina') and public.can_manage_hours_of(created_by));

drop policy if exists "tasks: workshop update" on public.vehicle_tasks;
create policy "tasks: workshop update" on public.vehicle_tasks for update to authenticated
using (public.has_section('oficina') and public.can_manage_hours_of(created_by))
with check (public.has_section('oficina') and public.can_manage_hours_of(created_by));

drop policy if exists "tasks: workshop delete" on public.vehicle_tasks;
create policy "tasks: workshop delete" on public.vehicle_tasks for delete to authenticated
using (public.has_section('oficina') and public.can_manage_hours_of(created_by));

-- ---------------------------------------------------------------------------
-- 4. Totais de horas por viatura
-- ---------------------------------------------------------------------------
-- `security_invoker`: a vista obedece ao RLS de quem consulta, como a tabela.
create or replace view public.vehicle_task_totals
with (security_invoker = true) as
  select car_id, sum(hours)::numeric(10,2) as total_hours, count(*)::int as log_count
    from public.vehicle_tasks
   group by car_id;
revoke all on public.vehicle_task_totals from anon;
grant select on public.vehicle_task_totals to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Horas de quem foi apagado
-- ---------------------------------------------------------------------------
alter table public.vehicle_tasks add column if not exists created_by_name text;
alter table public.time_entries add column if not exists profile_name text;

alter table public.time_entries alter column profile_id drop not null;
alter table public.time_entries drop constraint if exists time_entries_profile_id_fkey;
alter table public.time_entries add constraint time_entries_profile_id_fkey
  foreign key (profile_id) references public.profiles(id) on delete set null;

-- Antes de o perfil desaparecer, o nome fica nos registos de horas.
create or replace function public.keep_hours_author_name() returns trigger
language plpgsql security definer set search_path = public as $$
declare nome text := coalesce(nullif(old.full_name, ''), old.email, 'Utilizador apagado');
begin
  update public.vehicle_tasks set created_by_name = nome where created_by = old.id;
  update public.time_entries set profile_name = nome where profile_id = old.id;
  return old;
end $$;
revoke all on function public.keep_hours_author_name() from public, anon, authenticated;

drop trigger if exists keep_hours_author_name on public.profiles;
create trigger keep_hours_author_name
  before delete on public.profiles
  for each row execute function public.keep_hours_author_name();

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0047_backoffice_sales_visits.sql
-- ---------------------------------------------------------------------------
-- Backoffice: viaturas, contactos, vendas e visitas.
--
--  * OLX: qualquer mudança de estado de uma viatura (venda, reserva, fim da
--    reserva, reserva expirada…) marca o anúncio para sincronizar. Antes só a
--    gravação pelo backoffice o fazia, e uma viatura vendida pelo contacto
--    ficava à venda no OLX. A manutenção periódica (`syncPending`) faz o resto.
--  * Viaturas com reservas ou venda registadas não se apagam: o histórico
--    comercial tem de ficar. Antes a tentativa falhava com um erro técnico da
--    base de dados (ou com «Não pode trocar a viatura…»), já depois de o
--    anúncio do OLX ter sido retirado.
--  * `erase_lead_personal_data(lead)`: apagar os dados pessoais de um contacto
--    (RGPD). Sem reservas nem venda, apaga o contacto; com elas, anonimiza-o e
--    mantém o histórico. Só o administrador. Fica registado no histórico.
--  * O tipo de viatura de cada utilizador (`allowed_vehicle_types`, 0020) passa
--    a valer na base de dados para viaturas e contactos. Nulo ou vazio = todos;
--    o administrador vê sempre tudo (`has_vehicle_type_for`, 0024).
--  * `close_vehicle_sale`: a data da venda compara-se com o dia de hoje em
--    Lisboa, não em UTC — entre a meia-noite e a uma da manhã de verão o
--    «hoje» do formulário era recusado.
--  * Pedidos de visita do site: uma vaga cheia já não aceita um segundo pedido
--    feito ao mesmo tempo (a verificação do servidor lia e depois gravava).
--
-- Idempotente: pode correr-se mais de uma vez no editor de SQL da Supabase.
begin;

-- ---------------------------------------------------------------------------
-- OLX: uma mudança de estado marca o anúncio para sincronizar
-- ---------------------------------------------------------------------------
-- Só marca anúncios que já existem (há linha em channel_listings): sem ela, a
-- viatura nunca foi enviada ao OLX e não há nada a acompanhar.
create or replace function public.queue_olx_on_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.channel_listings
     set sync_state = 'pending', attempts = 0
   where car_id = new.id and channel = 'olx';
  return new;
end $$;
revoke all on function public.queue_olx_on_status_change() from public, anon, authenticated;
drop trigger if exists queue_olx_on_status_change on public.cars;
create trigger queue_olx_on_status_change after update of status on public.cars
for each row when (old.status is distinct from new.status)
execute function public.queue_olx_on_status_change();

-- ---------------------------------------------------------------------------
-- Viaturas com histórico comercial não se apagam
-- ---------------------------------------------------------------------------
create or replace function public.car_has_sales_history(car uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.reservations where car_id = car)
      or exists (select 1 from public.vehicle_financials where car_id = car and sale_lead_id is not null)
      or exists (select 1 from public.leads where car_id = car and status = 'won');
$$;
revoke all on function public.car_has_sales_history(uuid) from public, anon;
grant execute on function public.car_has_sales_history(uuid) to authenticated, service_role;

create or replace function public.guard_car_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.car_has_sales_history(old.id) then
    raise exception 'Viatura com reservas ou venda registadas: o histórico tem de ficar, por isso não pode ser apagada.';
  end if;
  return old;
end $$;
revoke all on function public.guard_car_delete() from public, anon, authenticated;
drop trigger if exists guard_car_delete on public.cars;
create trigger guard_car_delete before delete on public.cars
for each row execute function public.guard_car_delete();

-- ---------------------------------------------------------------------------
-- RGPD: apagar os dados pessoais de um contacto
-- ---------------------------------------------------------------------------
create or replace function public.erase_lead_personal_data(lead uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  l public.leads%rowtype;
  outcome text;
  -- Colunas com dados pessoais, também no histórico de alterações.
  personal text[] := array['name', 'email', 'phone', 'message', 'notes', 'car_details', 'next_action'];
begin
  if not public.is_admin() then raise exception 'Apenas administradores.'; end if;
  select * into l from public.leads where id = lead for update;
  if not found then raise exception 'Contacto inexistente'; end if;

  if exists (select 1 from public.reservations where lead_id = lead)
     or exists (select 1 from public.vehicle_financials where sale_lead_id = lead)
     or l.status = 'won' then
    -- Reservas ou venda: o registo fica (contabilidade, histórico da viatura),
    -- sem nada que identifique a pessoa.
    update public.leads set
      name = 'Dados apagados (RGPD)', email = '', phone = null, message = null,
      notes = null, car_details = '{}'::jsonb, next_action = null, next_action_at = null
    where id = lead;
    update public.lead_activities set body = 'Conteúdo apagado a pedido do cliente (RGPD).'
    where lead_id = lead;
    outcome := 'anonymised';
  else
    delete from public.leads where id = lead;
    outcome := 'deleted';
  end if;

  -- Os avisos já enviados ou por enviar levam o nome do cliente.
  delete from public.notification_jobs where lead_id = lead or payload ->> 'lead_id' = lead::text;
  -- O histórico de alterações guardava os valores antigos: ficam só os outros.
  update public.audit_log set changed_fields = changed_fields - personal
  where entity = 'leads' and record_id = lead::text;
  insert into public.audit_log(entity, record_id, action, actor_id, changed_fields)
  values ('leads', lead::text, 'ERASE', auth.uid(),
          jsonb_build_object('rgpd', jsonb_build_object('before', null, 'after',
            case outcome when 'deleted' then 'contacto apagado' else 'dados pessoais anonimizados' end)));
  return outcome;
end $$;
revoke all on function public.erase_lead_personal_data(uuid) from public, anon;
grant execute on function public.erase_lead_personal_data(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tipo de viatura por utilizador (restritivas: somam-se às políticas que já
-- existem, sem as substituir)
-- ---------------------------------------------------------------------------
drop policy if exists "cars: vehicle type read" on public.cars;
create policy "cars: vehicle type read" on public.cars as restrictive for select to authenticated
using (status in ('published', 'reserved', 'sold') or public.has_vehicle_type_for(auth.uid(), vehicle_type));
drop policy if exists "cars: vehicle type insert" on public.cars;
create policy "cars: vehicle type insert" on public.cars as restrictive for insert to authenticated
with check (public.has_vehicle_type_for(auth.uid(), vehicle_type));
drop policy if exists "cars: vehicle type update" on public.cars;
create policy "cars: vehicle type update" on public.cars as restrictive for update to authenticated
using (public.has_vehicle_type_for(auth.uid(), vehicle_type))
with check (public.has_vehicle_type_for(auth.uid(), vehicle_type));
drop policy if exists "cars: vehicle type delete" on public.cars;
create policy "cars: vehicle type delete" on public.cars as restrictive for delete to authenticated
using (public.has_vehicle_type_for(auth.uid(), vehicle_type));

-- Contactos sem tipo (contactos gerais) continuam visíveis a todos.
drop policy if exists "leads: vehicle type" on public.leads;
create policy "leads: vehicle type" on public.leads as restrictive for all to authenticated
using (vehicle_type is null or public.has_vehicle_type_for(auth.uid(), vehicle_type))
with check (vehicle_type is null or public.has_vehicle_type_for(auth.uid(), vehicle_type));

-- ---------------------------------------------------------------------------
-- Venda: «hoje» é o dia de Lisboa
-- ---------------------------------------------------------------------------
create or replace function public.close_vehicle_sale(lead uuid, amount numeric, sale_date date) returns void
language plpgsql security definer set search_path=public as $$
declare vehicle uuid; current_status public.car_status;
begin
 if not public.has_section('leads') or not public.has_section('carros') or not public.has_section('financeiro') then raise exception 'É necessário acesso a contactos, viaturas e financeiro'; end if;
 if amount <= 0 or sale_date > (now() at time zone 'Europe/Lisbon')::date then raise exception 'Valor ou data inválida'; end if;
 select car_id into vehicle from public.leads where id=lead and status in ('new','contacted','proposal') for update;
 if vehicle is null then raise exception 'Associe uma viatura'; end if;
 select status into current_status from public.cars where id=vehicle for update;
 if current_status not in ('published','reserved') then raise exception 'Viatura indisponível'; end if;
 if exists(select 1 from public.reservations where car_id=vehicle and status='active' and lead_id<>lead) then raise exception 'Viatura reservada para outro contacto'; end if;
 update public.reservations set status='completed' where car_id=vehicle and status='active';
 update public.cars set status='sold',sold_at=sale_date::timestamptz where id=vehicle;
 insert into public.vehicle_financials(car_id,sale_price,sold_on,sale_lead_id) values(vehicle,amount,sale_date,lead)
 on conflict(car_id) do update set sale_price=excluded.sale_price,sold_on=excluded.sold_on,sale_lead_id=excluded.sale_lead_id,updated_at=now();
 update public.leads set status='won',next_action=null,next_action_at=null where id=lead;
end $$;
revoke all on function public.close_vehicle_sale(uuid,numeric,date) from public, anon;
grant execute on function public.close_vehicle_sale(uuid,numeric,date) to authenticated;

-- ---------------------------------------------------------------------------
-- Pedidos de visita: a lotação da vaga garantida na gravação
-- ---------------------------------------------------------------------------
-- Só os pedidos do site (visit_status 'requested'); a equipa pode marcar por
-- cima de uma vaga cheia de propósito. A vaga é o instante exato, como em
-- `takenSlots`/`slotKey`. O bloqueio serializa os pedidos: o segundo de dois
-- pedidos simultâneos espera pelo primeiro e já o conta.
create or replace function public.guard_visit_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare schedule jsonb; capacity int; taken int;
begin
  perform pg_advisory_xact_lock(hashtext('public.leads:visit_slot'));
  select visit_schedule into schedule from public.customer_settings where id = 1;
  -- A mesma leitura que `parseVisitSchedule` (src/lib/visits.ts): 1 a 20, por defeito 1.
  capacity := case when jsonb_typeof(schedule -> 'capacity') = 'number'
    then greatest(1, least(20, round((schedule ->> 'capacity')::numeric)::int)) else 1 end;
  select count(*) into taken from public.leads
   where visit_status in ('requested', 'confirmed')
     and visit_at = new.visit_at;
  if taken >= capacity then
    raise exception 'Essa hora acabou de ficar ocupada. Escolha outra, por favor.';
  end if;
  return new;
end $$;
revoke all on function public.guard_visit_capacity() from public, anon, authenticated;
drop trigger if exists guard_visit_capacity on public.leads;
create trigger guard_visit_capacity before insert on public.leads
for each row when (new.visit_status = 'requested' and new.visit_at is not null)
execute function public.guard_visit_capacity();

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0048_security_hardening.sql
-- ---------------------------------------------------------------------------
-- 0048 · Endurecimento de segurança (revisão do backoffice)
--
-- (A regra das férias — ninguém aprova os próprios dias — já está na 0046.)
-- 1. Telefone do perfil: único (o assistente de WhatsApp identifica quem fala
--    pelo número; dois perfis com o mesmo bloqueavam a vítima e um número de
--    fora recebia avisos com dados de contactos).
-- 2. Contactos externos do WhatsApp: só quem tem o separador Integrações.
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.

begin;

-- 1 ── profiles.phone único (pela forma normalizada). Se já existirem números
-- repetidos, não se cria o índice e fica o aviso: corrigir à mão e voltar a correr.
do $$
begin
  if exists (
    select 1 from public.profiles
    where phone is not null and public.normalize_phone(phone) <> ''
    group by public.normalize_phone(phone)
    having count(*) > 1
  ) then
    raise notice 'profiles.phone tem números repetidos: índice único NÃO criado. Corrija os perfis e volte a correr a migração.';
  else
    create unique index if not exists profiles_phone_unique
      on public.profiles (public.normalize_phone(phone))
      where phone is not null and public.normalize_phone(phone) <> '';
  end if;
end $$;

-- 2 ── wa_contacts: nome, empresa e mensagens de pessoas externas.
drop policy if exists "wa_contacts: staff read" on public.wa_contacts;
create policy "wa_contacts: staff read"
  on public.wa_contacts for select to authenticated
  using (public.has_section('integracoes'));

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0049_site_settings_admin.sql
-- ---------------------------------------------------------------------------
-- 0049 · Só o administrador muda o «Tipo de site» e as etiquetas dos cards
--
-- O tipo de site (só carros / carros e motas / só motas) e as etiquetas dos
-- cards ficam em `site_content` (chaves `site` e `badges`). No site só o
-- administrador os grava, mas a política da tabela (0013) deixa escrever a
-- quem tem o separador «Página inicial» — por exemplo um chefe podia, pela API,
-- esconder todos os carros do site. Esta migração junta uma regra restritiva:
-- essas duas chaves só as escreve (cria, muda ou apaga) um administrador.
-- Os textos da página inicial (`home`, …) continuam com o separador.
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.

begin;

drop policy if exists "content: admin-only keys insert" on public.site_content;
create policy "content: admin-only keys insert" on public.site_content
  as restrictive for insert to authenticated
  with check (key not in ('site', 'badges') or public.is_admin());

drop policy if exists "content: admin-only keys update" on public.site_content;
create policy "content: admin-only keys update" on public.site_content
  as restrictive for update to authenticated
  using (key not in ('site', 'badges') or public.is_admin())
  with check (key not in ('site', 'badges') or public.is_admin());

drop policy if exists "content: admin-only keys delete" on public.site_content;
create policy "content: admin-only keys delete" on public.site_content
  as restrictive for delete to authenticated
  using (key not in ('site', 'badges') or public.is_admin());

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0050_vehicle_type_rls.sql
-- ---------------------------------------------------------------------------
-- 0050 · O tipo de viatura também vale nas tabelas que dependem de viaturas e contactos
--
-- A 0047 impôs o tipo de viatura de cada utilizador (`allowed_vehicle_types`)
-- em `cars` e `leads`. As tabelas que dependem delas só olhavam ao separador:
-- um vendedor só de motas lia pela API, com o seu JWT, o histórico de
-- alterações de contactos e carros que não vê (com email e telefone), e lia e
-- escrevia fotografias, custos, financeiro, atividades, reservas, anúncios,
-- alertas, preparação e horas da oficina de carros.
--
--  1. Regras restritivas (somam-se às que já existem, nunca alargam nada) em
--     `car_media`, `vehicle_costs`, `vehicle_financials`, `preparation_tasks`,
--     `vehicle_tasks` (e a vista `vehicle_task_totals`, que lhe obedece),
--     `channel_listings`, `car_views`, `lead_activities`, `reservations` e
--     `stock_alert_matches`: a viatura (ou o contacto) tem de ser de um tipo
--     que o utilizador vê. Contactos sem tipo continuam de todos, como na 0047.
--     As fotografias de viaturas no site (publicada, reservada, vendida) leem-se
--     como a própria viatura (0047): são públicas.
--  2. `audit_log`: as linhas de viaturas, contactos, reservas, financeiro,
--     custos, preparação e oficina só aparecem a quem vê o tipo do registo.
--     Para um registo apagado, vale o tipo que ficou gravado no histórico
--     (a linha DELETE guarda a ficha toda); sem tipo conhecido, só quem vê
--     todos os tipos. O administrador vê tudo, apagados incluídos.
--  3. Storage, bucket `car-media`: a mesma regra pela pasta da viatura
--     (`<id da viatura>/…`, e `_originais/<id da viatura>/…` das cópias das
--     fotos reduzidas). Pastas que não são de uma viatura (logótipo…) ficam
--     como estavam.
--  4. `site_content`: só se conseguia apagar a linha 'showroom'. O gatilho da
--     0018 devolvia NEW num DELETE (nulo), o que cancela a operação sem erro.
--  5. Reservar, cancelar a reserva, confirmar o sinal e fechar a venda
--     (funções SECURITY DEFINER) passam a verificar o tipo da viatura de quem
--     as chama; antes só o TypeScript o fazia.
--
-- Não muda nada para o administrador, para quem não tem restrição de tipo
-- (nulo ou vazio), para o service_role (ignora a RLS), para as funções
-- SECURITY DEFINER e gatilhos (auditoria, reservas, vendas, WhatsApp) nem para
-- o público anónimo.
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.
begin;

-- ---------------------------------------------------------------------------
-- Funções de apoio
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: decidem SÓ pelo tipo, sem passar pela RLS de `cars` e
-- `leads` (que tem outras regras, como o separador). Nota sobre
-- `has_vehicle_type_for(uid, null)`: só é verdade para quem vê todos os tipos
-- (administrador, restrição nula ou vazia) — é o atalho «sem restrição».

-- A viatura `car` é de um tipo que o utilizador vê? Sem viatura: sim.
-- `public_too`: as viaturas no site (publicada, reservada, vendida) contam
-- como vistas, como na leitura de `cars` (0047).
create or replace function public.car_type_allowed(car uuid, public_too boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select car is null
      or public.has_vehicle_type_for(auth.uid(), null)
      or coalesce((select (public_too and c.status in ('published', 'reserved', 'sold'))
                          or public.has_vehicle_type_for(auth.uid(), c.vehicle_type)
                     from public.cars c where c.id = car), false);
$$;
revoke all on function public.car_type_allowed(uuid, boolean) from public, anon;
grant execute on function public.car_type_allowed(uuid, boolean) to authenticated, service_role;

-- O contacto `lead` é de um tipo que o utilizador vê? Sem contacto ou contacto
-- sem tipo (contacto geral): sim, como na 0047.
create or replace function public.lead_type_allowed(lead uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select lead is null
      or public.has_vehicle_type_for(auth.uid(), null)
      or coalesce((select l.vehicle_type is null or public.has_vehicle_type_for(auth.uid(), l.vehicle_type)
                     from public.leads l where l.id = lead), false);
$$;
revoke all on function public.lead_type_allowed(uuid) from public, anon;
grant execute on function public.lead_type_allowed(uuid) to authenticated, service_role;

-- Uma linha do histórico (`audit_log`) é de um tipo que o utilizador vê?
-- O `record_id` é o id da viatura em cars/vehicle_financials/vehicle_costs/
-- preparation_tasks/vehicle_tasks, o do contacto em leads e o da reserva em
-- reservations (ver `audit_change`, 0013). Outras entidades (perfis) não têm
-- tipo: decide só a política "audit: read".
create or replace function public.audit_type_allowed(entry_entity text, entry_record text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rec uuid;
  vtype text;
begin
  if public.has_vehicle_type_for(uid, null) then return true; end if;
  if entry_entity not in ('cars', 'leads', 'reservations', 'vehicle_financials',
                          'vehicle_costs', 'preparation_tasks', 'vehicle_tasks') then
    return true;
  end if;
  if entry_record !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  rec := entry_record::uuid;

  if entry_entity = 'leads' then
    select l.vehicle_type into vtype from public.leads l where l.id = rec;
    if not found then
      -- Contacto apagado: o tipo gravado no histórico (o da linha mais recente
      -- que o tenha; num DELETE é o valor «antes»). Sem nenhum: desconhecido.
      select case when a.action = 'DELETE' then a.changed_fields -> 'vehicle_type' ->> 'before'
                  else a.changed_fields -> 'vehicle_type' ->> 'after' end
        into vtype
        from public.audit_log a
       where a.entity = 'leads' and a.record_id = entry_record and a.changed_fields ? 'vehicle_type'
       order by a.id desc limit 1;
      if not found then return false; end if;
    end if;
    return vtype is null or public.has_vehicle_type_for(uid, vtype);
  end if;

  if entry_entity = 'reservations' then
    -- A reserva leva à viatura (também se a reserva já não existir).
    select r.car_id into rec from public.reservations r where r.id = entry_record::uuid;
    if not found then
      select (case when a.action = 'DELETE' then a.changed_fields -> 'car_id' ->> 'before'
                   else a.changed_fields -> 'car_id' ->> 'after' end)::uuid
        into rec
        from public.audit_log a
       where a.entity = 'reservations' and a.record_id = entry_record and a.changed_fields ? 'car_id'
       order by a.id desc limit 1;
      if rec is null then return false; end if;
    end if;
  end if;

  -- A viatura: a ficha atual, ou o tipo gravado no histórico se foi apagada.
  select c.vehicle_type into vtype from public.cars c where c.id = rec;
  if not found then
    select case when a.action = 'DELETE' then a.changed_fields -> 'vehicle_type' ->> 'before'
                else a.changed_fields -> 'vehicle_type' ->> 'after' end
      into vtype
      from public.audit_log a
     where a.entity = 'cars' and a.record_id = rec::text and a.changed_fields ? 'vehicle_type'
     order by a.id desc limit 1;
  end if;
  -- Tipo desconhecido: has_vehicle_type_for(uid, null) já foi falso acima.
  return vtype is not null and public.has_vehicle_type_for(uid, vtype);
end $$;
revoke all on function public.audit_type_allowed(text, text) from public, anon;
grant execute on function public.audit_type_allowed(text, text) to authenticated, service_role;

-- Um objeto do bucket `car-media` pode ser tocado pelo tipo da viatura?
-- `<id da viatura>/<ficheiro>` (MediaManager) ou `_originais/<id>/<ficheiro>`
-- (cópias das fotos reduzidas, src/lib/photo-optimize.ts). Pastas que não são
-- de uma viatura que exista (logótipo em `branding/`, …): sim — decidem as
-- políticas que já existiam.
create or replace function public.car_media_path_allowed(object_name text, public_too boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  with folder as (
    select case when split_part(object_name, '/', 1) = '_originais'
                then split_part(object_name, '/', 2) else split_part(object_name, '/', 1) end as id
  ), car as (
    select c.id from folder f
      join public.cars c
        on c.id = case when f.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then f.id::uuid end
  )
  select coalesce((select public.car_type_allowed(car.id, public_too) from car), true);
$$;
revoke all on function public.car_media_path_allowed(text, boolean) from public, anon;
grant execute on function public.car_media_path_allowed(text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Tabelas que dependem de uma viatura ou de um contacto
-- ---------------------------------------------------------------------------

-- Fotografias: as de viaturas no site leem-se (como a viatura); escrever só
-- nas do próprio tipo.
drop policy if exists "media: vehicle type read" on public.car_media;
create policy "media: vehicle type read" on public.car_media as restrictive for select to authenticated
using (public.car_type_allowed(car_id, true));
drop policy if exists "media: vehicle type insert" on public.car_media;
create policy "media: vehicle type insert" on public.car_media as restrictive for insert to authenticated
with check (public.car_type_allowed(car_id));
drop policy if exists "media: vehicle type update" on public.car_media;
create policy "media: vehicle type update" on public.car_media as restrictive for update to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));
drop policy if exists "media: vehicle type delete" on public.car_media;
create policy "media: vehicle type delete" on public.car_media as restrictive for delete to authenticated
using (public.car_type_allowed(car_id));

-- Dados internos de uma viatura: só do próprio tipo (ler e escrever).
drop policy if exists "costs: vehicle type" on public.vehicle_costs;
create policy "costs: vehicle type" on public.vehicle_costs as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

drop policy if exists "financials: vehicle type" on public.vehicle_financials;
create policy "financials: vehicle type" on public.vehicle_financials as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

drop policy if exists "preparation: vehicle type" on public.preparation_tasks;
create policy "preparation: vehicle type" on public.preparation_tasks as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

drop policy if exists "tasks: vehicle type" on public.vehicle_tasks;
create policy "tasks: vehicle type" on public.vehicle_tasks as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

drop policy if exists "channel_listings: vehicle type" on public.channel_listings;
create policy "channel_listings: vehicle type" on public.channel_listings as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

-- Estatísticas de visitas (só leitura para a equipa; quem grava é o servidor).
drop policy if exists "views: vehicle type" on public.car_views;
create policy "views: vehicle type" on public.car_views as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

-- Do contacto.
drop policy if exists "activities: vehicle type" on public.lead_activities;
create policy "activities: vehicle type" on public.lead_activities as restrictive for all to authenticated
using (public.lead_type_allowed(lead_id)) with check (public.lead_type_allowed(lead_id));

-- Da viatura e do contacto.
drop policy if exists "reservations: vehicle type" on public.reservations;
create policy "reservations: vehicle type" on public.reservations as restrictive for all to authenticated
using (public.car_type_allowed(car_id) and public.lead_type_allowed(lead_id))
with check (public.car_type_allowed(car_id) and public.lead_type_allowed(lead_id));

drop policy if exists "stock_alert_matches: vehicle type" on public.stock_alert_matches;
create policy "stock_alert_matches: vehicle type" on public.stock_alert_matches as restrictive for all to authenticated
using (public.car_type_allowed(car_id) and public.lead_type_allowed(lead_id))
with check (public.car_type_allowed(car_id) and public.lead_type_allowed(lead_id));

-- ---------------------------------------------------------------------------
-- 2. Histórico de alterações
-- ---------------------------------------------------------------------------
-- Só leitura: ninguém escreve no histórico pela API (só a função de auditoria,
-- SECURITY DEFINER, que não passa pela RLS).
drop policy if exists "audit: vehicle type" on public.audit_log;
create policy "audit: vehicle type" on public.audit_log as restrictive for select to authenticated
using (public.audit_type_allowed(entity, record_id));

-- ---------------------------------------------------------------------------
-- 3. Storage: fotografias por pasta da viatura
-- ---------------------------------------------------------------------------
drop policy if exists "car-media: vehicle type read" on storage.objects;
create policy "car-media: vehicle type read" on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'car-media' or public.car_media_path_allowed(name, true));
drop policy if exists "car-media: vehicle type insert" on storage.objects;
create policy "car-media: vehicle type insert" on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'car-media' or public.car_media_path_allowed(name));
drop policy if exists "car-media: vehicle type update" on storage.objects;
create policy "car-media: vehicle type update" on storage.objects as restrictive for update to authenticated
using (bucket_id <> 'car-media' or public.car_media_path_allowed(name))
with check (bucket_id <> 'car-media' or public.car_media_path_allowed(name));
drop policy if exists "car-media: vehicle type delete" on storage.objects;
create policy "car-media: vehicle type delete" on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'car-media' or public.car_media_path_allowed(name));

-- ---------------------------------------------------------------------------
-- 4. site_content: apagar volta a funcionar
-- ---------------------------------------------------------------------------
-- Igual à 0018, exceto o `return coalesce(new, old)` das linhas que não são
-- 'showroom': num DELETE o NEW é nulo, e um gatilho BEFORE que devolve nulo
-- cancela a operação sem erro (o DELETE dizia «0 linhas»).
create or replace function public.validate_showroom_location() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb;
begin
  if tg_table_name = 'cars' then
    if new.point_of_sale_id is null then return new; end if;
    select content into cfg from public.site_content where key = 'showroom' for update;
    if not exists (select 1 from jsonb_array_elements(coalesce(cfg->'locations','[]'::jsonb)) p where p->>'id' = new.point_of_sale_id) then
      raise exception 'Ponto de venda inexistente';
    end if;
    return new;
  end if;
  if old.key <> 'showroom' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then cfg := '{}'::jsonb;
  elsif new.key <> 'showroom' then cfg := '{}'::jsonb; else cfg := new.content; end if;
  if exists (select 1 from public.cars c where c.point_of_sale_id is not null and not exists
    (select 1 from jsonb_array_elements(coalesce(cfg->'locations','[]'::jsonb)) p where p->>'id' = c.point_of_sale_id)) then
    raise exception 'Reatribua as viaturas antes de remover o ponto de venda';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.validate_showroom_location() from public;

-- ---------------------------------------------------------------------------
-- 5. Reservas e vendas: o tipo da viatura também nas funções
-- ---------------------------------------------------------------------------
-- São SECURITY DEFINER (não passam pela RLS) e só verificavam o separador: o
-- tipo dependia só do TypeScript. Corpo igual ao atual (0013; a venda da
-- 0047), mais a verificação do tipo da viatura, como na oficina (0028). Quem
-- chama sem sessão já era recusado pelo `has_section`, que continua primeiro.
create or replace function public.reserve_vehicle(lead uuid, expiry timestamptz, deposit numeric) returns uuid
language plpgsql security definer set search_path=public as $$
declare vehicle uuid; current_status public.car_status; result uuid; vtype text;
begin
 if not public.has_section('leads') or not public.has_section('carros') then raise exception 'É necessário acesso a contactos e viaturas'; end if;
 if expiry <= now() or expiry > now()+interval '30 days' or deposit < 0 then raise exception 'Prazo ou sinal inválido'; end if;
 select car_id into vehicle from public.leads where id=lead and status in ('new','contacted','proposal') for update;
 if vehicle is null then raise exception 'Associe uma viatura ao contacto'; end if;
 select status, vehicle_type into current_status, vtype from public.cars where id=vehicle for update;
 if not public.has_vehicle_type_for(auth.uid(), vtype) then raise exception 'Sem permissão'; end if;
 if current_status <> 'published' then raise exception 'A viatura não está disponível'; end if;
 insert into public.reservations(car_id,lead_id,expires_at,deposit_amount,created_by) values(vehicle,lead,expiry,deposit,auth.uid()) returning id into result;
 update public.cars set status='reserved' where id=vehicle;
 return result;
end $$;
revoke all on function public.reserve_vehicle(uuid,timestamptz,numeric) from public, anon;
grant execute on function public.reserve_vehicle(uuid,timestamptz,numeric) to authenticated;

create or replace function public.release_reservation(reservation_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare vehicle uuid;
begin
 if not public.has_section('leads') or not public.has_section('carros') then raise exception 'Sem permissão'; end if;
 select car_id into vehicle from public.reservations where id=reservation_id;
 if vehicle is not null and not public.has_vehicle_type_for(auth.uid(), (select vehicle_type from public.cars where id=vehicle)) then
   raise exception 'Sem permissão';
 end if;
 perform 1 from public.cars where id=vehicle for update;
 update public.reservations set status='cancelled' where id=reservation_id and status='active';
 if not found then raise exception 'Reserva já terminada'; end if;
 update public.cars set status='published' where id=vehicle and status='reserved';
end $$;
revoke all on function public.release_reservation(uuid) from public, anon;
grant execute on function public.release_reservation(uuid) to authenticated;

create or replace function public.confirm_reservation_deposit(reservation_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_section('leads') then raise exception 'Sem permissão'; end if;
 if exists (select 1 from public.reservations r join public.cars c on c.id = r.car_id
             where r.id = reservation_id and not public.has_vehicle_type_for(auth.uid(), c.vehicle_type)) then
   raise exception 'Sem permissão';
 end if;
 update public.reservations set deposit_received=true where id=reservation_id and status='active' and expires_at>now();
 if not found then raise exception 'Reserva não está ativa'; end if;
end $$;
revoke all on function public.confirm_reservation_deposit(uuid) from public, anon;
grant execute on function public.confirm_reservation_deposit(uuid) to authenticated;

create or replace function public.close_vehicle_sale(lead uuid, amount numeric, sale_date date) returns void
language plpgsql security definer set search_path=public as $$
declare vehicle uuid; current_status public.car_status; vtype text;
begin
 if not public.has_section('leads') or not public.has_section('carros') or not public.has_section('financeiro') then raise exception 'É necessário acesso a contactos, viaturas e financeiro'; end if;
 if amount <= 0 or sale_date > (now() at time zone 'Europe/Lisbon')::date then raise exception 'Valor ou data inválida'; end if;
 select car_id into vehicle from public.leads where id=lead and status in ('new','contacted','proposal') for update;
 if vehicle is null then raise exception 'Associe uma viatura'; end if;
 select status, vehicle_type into current_status, vtype from public.cars where id=vehicle for update;
 if not public.has_vehicle_type_for(auth.uid(), vtype) then raise exception 'Sem permissão'; end if;
 if current_status not in ('published','reserved') then raise exception 'Viatura indisponível'; end if;
 if exists(select 1 from public.reservations where car_id=vehicle and status='active' and lead_id<>lead) then raise exception 'Viatura reservada para outro contacto'; end if;
 update public.reservations set status='completed' where car_id=vehicle and status='active';
 update public.cars set status='sold',sold_at=sale_date::timestamptz where id=vehicle;
 insert into public.vehicle_financials(car_id,sale_price,sold_on,sale_lead_id) values(vehicle,amount,sale_date,lead)
 on conflict(car_id) do update set sale_price=excluded.sale_price,sold_on=excluded.sold_on,sale_lead_id=excluded.sale_lead_id,updated_at=now();
 update public.leads set status='won',next_action=null,next_action_at=null where id=lead;
end $$;
revoke all on function public.close_vehicle_sale(uuid,numeric,date) from public, anon;
grant execute on function public.close_vehicle_sale(uuid,numeric,date) to authenticated;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0051_olx_adverts.sql
-- ---------------------------------------------------------------------------
-- Anúncios da conta do OLX ligada, todos — também os que não foram criados
-- pelo site (feitos à mão no OLX ou exportados do Standvirtual).
--
-- `channel_listings` continua a ser o motor da sincronização por viatura (um
-- anúncio por viatura, `car_id` obrigatório). Esta tabela é o espelho do que
-- existe no OLX: lida da API todos os dias e com o botão «Ler anúncios do OLX»,
-- e é por ela que cada anúncio fica associado à sua viatura.
--
-- Como `olx_connection`, só o servidor lhe toca: o painel lê-a pelo cliente de
-- serviço. Pode ser corrida mais de uma vez.
begin;

create table if not exists public.olx_adverts (
  id             bigint primary key,
  car_id         uuid unique references public.cars (id) on delete set null,
  -- site: criado pelo backoffice (external_id = id da viatura);
  -- olx: criado diretamente no OLX (gere-se pela API);
  -- standvirtual: exportado do Standvirtual (o OLX recusa alterá-lo).
  origin         text not null check (origin in ('site', 'olx', 'standvirtual')),
  status         text not null,
  title          text not null default '',
  url            text,
  external_id    text,
  price          numeric,
  category_id    bigint,
  -- Nome da categoria do OLX (nos carros é a marca): usado nas sugestões.
  category_name  text,
  valid_to       timestamptz,
  olx_created_at timestamptz,
  views          integer check (views >= 0),
  phone_views    integer check (phone_views >= 0),
  observers      integer check (observers >= 0),
  stats_at       timestamptz,
  seen_at        timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

drop trigger if exists trg_olx_adverts_updated_at on public.olx_adverts;
create trigger trg_olx_adverts_updated_at
  before update on public.olx_adverts
  for each row execute function public.set_updated_at();

alter table public.olx_adverts enable row level security;
revoke all on public.olx_adverts from anon, authenticated;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0052_facebook_shares.sql
-- ---------------------------------------------------------------------------
-- Separador «Partilhas»: cada utilizador partilha anúncios nos grupos do
-- Facebook a partir do próprio Chrome, com a extensão «CoreMotors Partilhas».
--
-- O servidor nunca toca no Facebook nem guarda sessões ou palavras-passe: a
-- extensão faz os cliques no browser de quem a usa e o backoffice guarda só o
-- que é preciso para não repetir partilhas:
--
--  fb_accounts        as contas do Facebook de cada utilizador, com o nome que
--                     ele escolher («Facebook Stand», «Facebook pessoal»…). O
--                     `fb_user_id` é o id da conta ligada no Chrome quando os
--                     grupos foram lidos: serve para avisar quando o Chrome
--                     está noutra conta.
--  fb_groups          os grupos de cada conta, pela ordem do Facebook.
--  fb_share_ads       os anúncios a partilhar (link do Marketplace), opcional-
--                     mente ligados a uma viatura do inventário.
--  fb_share_attempts  o histórico: um registo por tentativa (anúncio × grupo).
--
-- Tudo é pessoal: cada um só vê e mexe no que é seu (nem o administrador vê o
-- dos outros), e só com acesso ao separador «partilhas».
--
-- Pode ser corrida mais de uma vez.
begin;

-- ---------------------------------------------------------------------------
-- Permissões: «partilhas» nos acessos por defeito do chefe e do vendedor
-- ---------------------------------------------------------------------------
-- O MESMO `case` da 0024, com «partilhas» nas listas por defeito (quem tem
-- `allowed_sections` preenchido continua a ter só o que lá está).
create or replace function public.has_section_for(uid uuid, section text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case
    when role::text = 'admin' then true
    when role::text = 'mecanico' then section = 'oficina'
    when section = 'dashboard' then true
    when cardinality(allowed_sections) > 0 then section = any(allowed_sections)
    when role::text = 'chefe' then section = any(array['carros','pagina-inicial','leads','testemunhos','financeiro','partilhas'])
    when role::text = 'vendedor' then section = any(array['carros','leads','partilhas'])
    else false end from public.profiles where id = uid), false);
$$;
revoke all on function public.has_section_for(uuid, text) from public, anon;
grant execute on function public.has_section_for(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Contas do Facebook
-- ---------------------------------------------------------------------------
create table if not exists public.fb_accounts (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name           text not null check (length(trim(name)) between 1 and 80),
  -- O cookie `c_user` (ou `i_user`, a agir como página/perfil) do Facebook.
  fb_user_id     text check (fb_user_id ~ '^[0-9]{1,30}$'),
  groups_read_at timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create unique index if not exists fb_accounts_profile_name_idx
  on public.fb_accounts (profile_id, lower(trim(name)));

drop trigger if exists trg_fb_accounts_updated_at on public.fb_accounts;
create trigger trg_fb_accounts_updated_at before update on public.fb_accounts
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Grupos de cada conta
-- ---------------------------------------------------------------------------
create table if not exists public.fb_groups (
  id           uuid primary key default gen_random_uuid(),
  account_id   uuid not null references public.fb_accounts (id) on delete cascade,
  profile_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  -- O id do grupo no endereço (/groups/<id>/): número ou nome curto. Nos
  -- grupos acrescentados à mão é «nome:» + o nome normalizado.
  group_key    text not null check (length(group_key) between 1 and 220),
  name         text not null check (length(trim(name)) between 1 and 200),
  url          text check (url is null or (url ~* '^https://([a-z]+\.)?facebook\.com/' and length(url) <= 500)),
  -- A posição na lista do Facebook; null = deixou de aparecer (saiu do grupo).
  position     integer check (position is null or position > 0),
  -- null = automático (pelo nome do grupo); true/false = escolha do utilizador.
  include      boolean,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (account_id, group_key)
);
create index if not exists fb_groups_account_position_idx on public.fb_groups (account_id, position);

drop trigger if exists trg_fb_groups_updated_at on public.fb_groups;
create trigger trg_fb_groups_updated_at before update on public.fb_groups
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Anúncios a partilhar
-- ---------------------------------------------------------------------------
create table if not exists public.fb_share_ads (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  car_id       uuid references public.cars (id) on delete set null,
  title        text not null check (length(trim(title)) between 1 and 160),
  -- Só links do Facebook: é o que a extensão abre para carregar em «Partilhar».
  url          text not null check (url ~* '^https://([a-z]+\.)?facebook\.com/' and length(url) <= 500),
  price        numeric(12,2) check (price is null or price >= 0),
  vehicle_type text not null default 'car' check (vehicle_type in ('car', 'motorcycle')),
  archived     boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists fb_share_ads_profile_idx on public.fb_share_ads (profile_id, archived);

drop trigger if exists trg_fb_share_ads_updated_at on public.fb_share_ads;
create trigger trg_fb_share_ads_updated_at before update on public.fb_share_ads
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Histórico das tentativas
-- ---------------------------------------------------------------------------
-- confirmed     o Facebook mostrou a confirmação
-- pending       ficou à espera da aprovação dos administradores do grupo
-- uncertain     carregou-se em «Publicar», mas não se viu o resultado
-- rate_limited  o Facebook mostrou o limite de publicações
-- failed        não foi submetido (grupo não encontrado, botão em falta…)
-- reset         o utilizador desbloqueou o grupo para voltar a tentar
-- O último registo de cada (anúncio, grupo) é o estado; os quatro primeiros
-- bloqueiam uma nova partilha do mesmo anúncio no mesmo grupo.
create table if not exists public.fb_share_attempts (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  account_id  uuid not null references public.fb_accounts (id) on delete cascade,
  group_id    uuid not null references public.fb_groups (id) on delete cascade,
  ad_id       uuid not null references public.fb_share_ads (id) on delete cascade,
  status      text not null check (status in ('confirmed', 'pending', 'uncertain', 'rate_limited', 'failed', 'reset')),
  reason      text check (reason is null or length(reason) <= 1000),
  created_at  timestamptz not null default now()
);
create index if not exists fb_share_attempts_ad_group_idx on public.fb_share_attempts (ad_id, group_id, created_at desc);
create index if not exists fb_share_attempts_account_idx on public.fb_share_attempts (account_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: cada um só o que é seu, e só com o separador
-- ---------------------------------------------------------------------------
alter table public.fb_accounts enable row level security;
alter table public.fb_groups enable row level security;
alter table public.fb_share_ads enable row level security;
alter table public.fb_share_attempts enable row level security;

revoke all on public.fb_accounts, public.fb_groups, public.fb_share_ads, public.fb_share_attempts from anon;
grant select, insert, update, delete on public.fb_accounts, public.fb_groups, public.fb_share_ads to authenticated;
-- O histórico não se reescreve: só se acrescenta (e desaparece com a conta).
revoke update, delete on public.fb_share_attempts from authenticated;
grant select, insert on public.fb_share_attempts to authenticated;

drop policy if exists "fb accounts: own" on public.fb_accounts;
create policy "fb accounts: own" on public.fb_accounts for all to authenticated
using (profile_id = auth.uid() and public.has_section('partilhas'))
with check (profile_id = auth.uid() and public.has_section('partilhas'));

-- O grupo é de uma conta do próprio.
drop policy if exists "fb groups: own" on public.fb_groups;
create policy "fb groups: own" on public.fb_groups for all to authenticated
using (profile_id = auth.uid() and public.has_section('partilhas'))
with check (
  profile_id = auth.uid() and public.has_section('partilhas')
  and exists (select 1 from public.fb_accounts a where a.id = account_id and a.profile_id = auth.uid())
);

drop policy if exists "fb ads: own" on public.fb_share_ads;
create policy "fb ads: own" on public.fb_share_ads for all to authenticated
using (profile_id = auth.uid() and public.has_section('partilhas'))
with check (profile_id = auth.uid() and public.has_section('partilhas'));

drop policy if exists "fb attempts: read own" on public.fb_share_attempts;
create policy "fb attempts: read own" on public.fb_share_attempts for select to authenticated
using (profile_id = auth.uid() and public.has_section('partilhas'));

-- A conta, o grupo (dessa conta) e o anúncio têm de ser todos do próprio.
drop policy if exists "fb attempts: insert own" on public.fb_share_attempts;
create policy "fb attempts: insert own" on public.fb_share_attempts for insert to authenticated
with check (
  profile_id = auth.uid() and public.has_section('partilhas')
  and exists (select 1 from public.fb_groups g
              where g.id = group_id and g.account_id = fb_share_attempts.account_id and g.profile_id = auth.uid())
  and exists (select 1 from public.fb_share_ads d where d.id = ad_id and d.profile_id = auth.uid())
);

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0053_usernames_invites.sql
-- ---------------------------------------------------------------------------
-- Nomes de utilizador e convites para entrar no backoffice.
--
-- Entra-se com nome de utilizador + palavra-passe. O Supabase Auth continua a
-- exigir um email, por isso:
--  - quem já existe mantém o email que tem no Auth (o dono incluído, que passa
--    a chamar-se «Core» e não muda de palavra-passe);
--  - quem é criado a partir de agora fica com um email interno derivado do nome
--    (`<nome>@utilizadores.coremotors.local`), que nunca recebe correio.
-- O login traduz o nome no email com `login_email`, que só o servidor chama.
--
-- O administrador cria a conta só com o nome e recebe um link de convite: um
-- token aleatório de que aqui só se guarda o hash, com validade e de uso único.
-- Quem o abre define a palavra-passe. O mesmo link serve para dar uma
-- palavra-passe nova a quem a esqueceu.
--
-- E a gestão de utilizadores passa a ser só dos administradores: o separador
-- «utilizadores» deixa de se poder conceder a chefes ou vendedores.
begin;

-- ---------------------------------------------------------------------------
-- profiles.username
-- ---------------------------------------------------------------------------
alter table public.profiles add column if not exists username text;

alter table public.profiles drop constraint if exists profiles_username_format;
alter table public.profiles add constraint profiles_username_format check (
  username is null or (
    length(username) between 3 and 32
    and username ~ '^[A-Za-z0-9]+([._-][A-Za-z0-9]+)*$'
  )
);

-- Único sem olhar a maiúsculas: «Core» e «core» são o mesmo utilizador.
create unique index if not exists profiles_username_unique
  on public.profiles (lower(username));

-- O dono fica «Core» (se ninguém tiver já esse nome).
update public.profiles set username = 'Core'
where is_owner and username is null
  and not exists (select 1 from public.profiles where lower(username) = 'core');

-- Os restantes: a parte do email antes do @, só com letras, números e pontos.
-- Nomes repetidos ganham -2, -3, … O administrador vê-os em Utilizadores.
do $$
declare
  r record;
  base text;
  candidate text;
  n int;
begin
  for r in select id, email from public.profiles where username is null order by created_at, id loop
    base := lower(coalesce(split_part(r.email, '@', 1), ''));
    base := regexp_replace(base, '[^a-z0-9]+', '.', 'g');
    base := regexp_replace(left(regexp_replace(base, '^\.+', ''), 28), '\.+$', '');
    if length(base) < 3 then base := 'utilizador'; end if;
    candidate := base;
    n := 1;
    while exists (select 1 from public.profiles where lower(username) = candidate) loop
      n := n + 1;
      candidate := base || '-' || n;
    end loop;
    update public.profiles set username = candidate where id = r.id;
  end loop;
end $$;

-- O próprio não muda o nome: o `authenticated` só tem update em full_name,
-- phone, birth_date e job_title (0013/0023), e assim continua.

-- Email de Auth de um nome de utilizador, para o login. Só o servidor: dar isto
-- ao anon era entregar a lista de emails a quem adivinhasse nomes.
create or replace function public.login_email(p_username text)
returns text language sql stable security definer set search_path = public as $$
  select u.email
  from public.profiles p
  join auth.users u on u.id = p.id
  where lower(p.username) = lower(trim(p_username))
  limit 1;
$$;
revoke all on function public.login_email(text) from public, anon, authenticated;
grant execute on function public.login_email(text) to service_role;

-- ---------------------------------------------------------------------------
-- Convites
-- ---------------------------------------------------------------------------
create table if not exists public.user_invites (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade,
  -- sha256 (hex) do token do link. O token em si nunca chega à base de dados.
  token_hash  text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  check (expires_at > created_at)
);
create index if not exists user_invites_user_idx on public.user_invites (user_id, created_at desc);

-- Sem políticas: só o servidor (service_role, que ignora a RLS) lê e escreve.
alter table public.user_invites enable row level security;
revoke all on public.user_invites from public, anon, authenticated;

-- Novo convite: os que estavam por usar deixam de valer, para haver no máximo
-- um link vivo por pessoa.
create or replace function public.create_user_invite(
  p_user uuid, p_token_hash text, p_created_by uuid, p_expires_at timestamptz
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  new_id uuid;
begin
  update public.user_invites set used_at = now()
  where user_id = p_user and used_at is null;
  insert into public.user_invites (user_id, token_hash, created_by, expires_at)
  values (p_user, p_token_hash, p_created_by, p_expires_at)
  returning id into new_id;
  return new_id;
end;
$$;

-- Usa o convite: devolve o utilizador, ou null se não existe, já foi usado ou
-- expirou. É um só UPDATE, por isso dois pedidos ao mesmo tempo não o usam os dois.
create or replace function public.claim_user_invite(p_token_hash text)
returns uuid language sql security definer set search_path = public as $$
  update public.user_invites set used_at = now()
  where token_hash = p_token_hash and used_at is null and expires_at > now()
  returning user_id;
$$;

-- Devolve o convite se não se conseguiu gravar a palavra-passe (ex.: fraca),
-- para a pessoa poder tentar outra vez com o mesmo link. Só o último convite
-- da pessoa: um link substituído entretanto não volta a valer.
create or replace function public.release_user_invite(p_token_hash text)
returns void language sql security definer set search_path = public as $$
  update public.user_invites i set used_at = null
  where i.token_hash = p_token_hash and i.expires_at > now()
    and i.created_at = (select max(created_at) from public.user_invites o where o.user_id = i.user_id);
$$;

revoke all on function public.create_user_invite(uuid, text, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_user_invite(text) from public, anon, authenticated;
revoke all on function public.release_user_invite(text) from public, anon, authenticated;
grant execute on function public.create_user_invite(uuid, text, uuid, timestamptz) to service_role;
grant execute on function public.claim_user_invite(text) to service_role;
grant execute on function public.release_user_invite(text) to service_role;

-- ---------------------------------------------------------------------------
-- «utilizadores» só para administradores
-- ---------------------------------------------------------------------------
-- Igual à 0052, mais a linha do separador «utilizadores»: mesmo que esteja em
-- allowed_sections de alguém, só um admin lhe acede. Assim a política
-- «profiles: managers read» (0013) também passa a ser só dos admins.
create or replace function public.has_section_for(uid uuid, section text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select case
    when role::text = 'admin' then true
    when section = 'utilizadores' then false
    when role::text = 'mecanico' then section = 'oficina'
    when section = 'dashboard' then true
    when cardinality(allowed_sections) > 0 then section = any(allowed_sections)
    when role::text = 'chefe' then section = any(array['carros','pagina-inicial','leads','testemunhos','financeiro','partilhas'])
    when role::text = 'vendedor' then section = any(array['carros','leads','partilhas'])
    else false end from public.profiles where id = uid), false);
$$;
revoke all on function public.has_section_for(uuid, text) from public, anon;
grant execute on function public.has_section_for(uuid, text) to authenticated, service_role;

-- Tira-se o separador a quem o tinha concedido: deixou de ter efeito. Uma lista
-- que ficasse vazia passava aos acessos por omissão do papel (mais largos),
-- por isso fica pelo menos o Dashboard.
update public.profiles
set allowed_sections = coalesce(
  nullif(array_remove(allowed_sections, 'utilizadores'), '{}'::text[]),
  array['dashboard'])
where role::text <> 'admin' and 'utilizadores' = any(allowed_sections);

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0054_mark_vehicle_sold.sql
-- ---------------------------------------------------------------------------
-- 0054 · Marcar uma viatura como vendida diretamente (sem contacto)
--
-- Para vendas ao balcão, sem contacto no backoffice: na lista de Viaturas (ou
-- na ficha) escolhe-se «Vendida» e indica-se o preço e a data. Fica registado
-- como no «Concluir venda» do contacto — a viatura passa a vendida e o preço
-- e a data vão para os Custos (vehicle_financials), para a margem ficar certa.
--
-- Regras (as mesmas do contacto, menos o próprio contacto):
--  - é preciso acesso a Viaturas e a Custos, e ao tipo de viatura;
--  - preço maior que zero e data não futura;
--  - não serve para uma viatura com reserva ativa (essa conclui-se no
--    contacto da reserva) nem para uma já vendida ou na oficina.
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.
-- Antes de a aplicar, o backoffice faz o mesmo em dois passos (sem a garantia
-- de ser tudo ou nada).

begin;

create or replace function public.mark_vehicle_sold(vehicle uuid, amount numeric, sale_date date) returns void
language plpgsql security definer set search_path = public as $$
declare current_status public.car_status; vtype text;
begin
  if not public.has_section('carros') or not public.has_section('financeiro') then
    raise exception 'É necessário acesso a viaturas e a custos';
  end if;
  if amount is null or amount <= 0 or sale_date is null or sale_date > (now() at time zone 'Europe/Lisbon')::date then
    raise exception 'Valor ou data inválida';
  end if;
  select status, vehicle_type into current_status, vtype from public.cars where id = vehicle for update;
  if current_status is null then raise exception 'Viatura não encontrada'; end if;
  if not public.has_vehicle_type_for(auth.uid(), vtype) then raise exception 'Sem permissão'; end if;
  if current_status not in ('draft', 'prepared', 'published', 'reserved') then
    raise exception 'Viatura indisponível';
  end if;
  if exists (select 1 from public.reservations where car_id = vehicle and status = 'active') then
    raise exception 'Viatura com reserva ativa: conclua a venda no contacto do cliente';
  end if;
  update public.cars set status = 'sold', sold_at = sale_date::timestamptz where id = vehicle;
  insert into public.vehicle_financials (car_id, sale_price, sold_on)
  values (vehicle, amount, sale_date)
  on conflict (car_id) do update set sale_price = excluded.sale_price, sold_on = excluded.sold_on, updated_at = now();
end $$;

revoke all on function public.mark_vehicle_sold(uuid, numeric, date) from public, anon;
grant execute on function public.mark_vehicle_sold(uuid, numeric, date) to authenticated;

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0055_site_theme_owner.sql
-- ---------------------------------------------------------------------------
-- 0055 · Versão do site (tema Core / Core2): só o acesso core a muda
--
-- O tema do site público escolhe-se no backoffice, em Gestão, e fica em
-- `site_content` (chave `theme`, ex.: {"theme": "core2"}), que o público já lê.
-- Gestão é só do acesso core — o dono da conta (`profiles.is_owner`); nem os
-- administradores do stand a mudam. A app já o verifica; aqui fica a mesma
-- regra na base de dados (políticas restritivas, que se somam às de 0013/0049).
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.

begin;

-- O utilizador autenticado é o dono da conta?
create or replace function public.is_owner()
returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from public.profiles where id = auth.uid()), false);
$$;
revoke all on function public.is_owner() from public, anon;
grant execute on function public.is_owner() to authenticated;

drop policy if exists "content: owner-only keys insert" on public.site_content;
create policy "content: owner-only keys insert" on public.site_content
  as restrictive for insert to authenticated
  with check (key <> 'theme' or public.is_owner());

drop policy if exists "content: owner-only keys update" on public.site_content;
create policy "content: owner-only keys update" on public.site_content
  as restrictive for update to authenticated
  using (key <> 'theme' or public.is_owner())
  with check (key <> 'theme' or public.is_owner());

drop policy if exists "content: owner-only keys delete" on public.site_content;
create policy "content: owner-only keys delete" on public.site_content
  as restrictive for delete to authenticated
  using (key <> 'theme' or public.is_owner());

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0056_facebook_discovery.sql
-- ---------------------------------------------------------------------------
-- 0056 · Partilhas: procurar e aderir a grupos novos, categorias e horários
--
--  fb_categories    as categorias de cada utilizador («Carros», «Motas»…),
--                   cada uma com as suas palavras-chave. Servem para procurar
--                   grupos novos no Facebook e para escolher em que grupos se
--                   partilha um anúncio (o nome do grupo tem uma das palavras).
--  fb_group_joins   o histórico dos pedidos de adesão de cada conta do
--                   Facebook: para não repetir grupos e contar o limite diário.
--  fb_schedules     os horários automáticos: aderir a N grupos de uma
--                   categoria, ou partilhar um anúncio em N grupos de uma
--                   categoria, em certos dias da semana a uma hora.
--
-- Como em 0052, tudo é pessoal: cada um só vê e mexe no que é seu, e só com
-- acesso ao separador «partilhas».
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.
begin;

-- ---------------------------------------------------------------------------
-- Categorias e palavras-chave
-- ---------------------------------------------------------------------------
create table if not exists public.fb_categories (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name        text not null check (length(trim(name)) between 1 and 60),
  -- Pelo menos uma palavra; cada uma com 2 a 60 caracteres (a app limpa-as).
  keywords    text[] not null check (cardinality(keywords) between 1 and 30),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists fb_categories_profile_name_idx
  on public.fb_categories (profile_id, lower(trim(name)));

drop trigger if exists trg_fb_categories_updated_at on public.fb_categories;
create trigger trg_fb_categories_updated_at before update on public.fb_categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Pedidos de adesão a grupos
-- ---------------------------------------------------------------------------
-- joined     entrou logo (grupo público)
-- requested  pedido enviado, à espera dos administradores (grupo privado)
-- questions  o grupo pede respostas: fica para o utilizador responder no Facebook
-- member     já era membro (ou o pedido já estava feito)
-- limited    o Facebook mostrou um limite ou bloqueio: pára tudo
-- failed     não se conseguiu carregar em «Aderir»
create table if not exists public.fb_group_joins (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  account_id   uuid not null references public.fb_accounts (id) on delete cascade,
  category_id  uuid references public.fb_categories (id) on delete set null,
  group_key    text not null check (length(group_key) between 1 and 220),
  name         text not null check (length(trim(name)) between 1 and 200),
  url          text check (url is null or (url ~* '^https://([a-z]+\.)?facebook\.com/' and length(url) <= 500)),
  keyword      text check (keyword is null or length(keyword) <= 60),
  privacy      text check (privacy is null or privacy in ('public', 'private')),
  status       text not null check (status in ('joined', 'requested', 'questions', 'member', 'limited', 'failed')),
  reason       text check (reason is null or length(reason) <= 1000),
  created_at   timestamptz not null default now()
);
create index if not exists fb_group_joins_account_idx on public.fb_group_joins (account_id, created_at desc);
create index if not exists fb_group_joins_key_idx on public.fb_group_joins (account_id, group_key);

-- ---------------------------------------------------------------------------
-- Horários automáticos
-- ---------------------------------------------------------------------------
create table if not exists public.fb_schedules (
  id           uuid primary key default gen_random_uuid(),
  profile_id   uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  account_id   uuid not null references public.fb_accounts (id) on delete cascade,
  kind         text not null check (kind in ('join', 'share')),
  -- null numa partilha = todos os grupos da fila do anúncio.
  category_id  uuid references public.fb_categories (id) on delete cascade,
  -- Só nas partilhas: o anúncio a partilhar.
  ad_id        uuid references public.fb_share_ads (id) on delete cascade,
  count        integer not null check (count between 1 and 100),
  -- 0 = domingo … 6 = sábado (como o Date.getDay do JavaScript).
  weekdays     smallint[] not null check (cardinality(weekdays) between 1 and 7 and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]),
  -- Hora de Lisboa, «HH:MM».
  at_time      text not null check (at_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  enabled      boolean not null default true,
  last_run_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  check (kind = 'share' or (category_id is not null and ad_id is null)),
  check (kind = 'join' or ad_id is not null)
);
create index if not exists fb_schedules_account_idx on public.fb_schedules (account_id);

drop trigger if exists trg_fb_schedules_updated_at on public.fb_schedules;
create trigger trg_fb_schedules_updated_at before update on public.fb_schedules
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.fb_categories enable row level security;
alter table public.fb_group_joins enable row level security;
alter table public.fb_schedules enable row level security;

revoke all on public.fb_categories, public.fb_group_joins, public.fb_schedules from anon;
grant select, insert, update, delete on public.fb_categories, public.fb_schedules to authenticated;
-- O histórico das adesões não se reescreve: só se acrescenta.
revoke update, delete on public.fb_group_joins from authenticated;
grant select, insert on public.fb_group_joins to authenticated;

drop policy if exists "fb categories: own" on public.fb_categories;
create policy "fb categories: own" on public.fb_categories for all to authenticated
using (profile_id = auth.uid() and public.has_section('partilhas'))
with check (profile_id = auth.uid() and public.has_section('partilhas'));

drop policy if exists "fb joins: read own" on public.fb_group_joins;
create policy "fb joins: read own" on public.fb_group_joins for select to authenticated
using (profile_id = auth.uid() and public.has_section('partilhas'));

drop policy if exists "fb joins: insert own" on public.fb_group_joins;
create policy "fb joins: insert own" on public.fb_group_joins for insert to authenticated
with check (
  profile_id = auth.uid() and public.has_section('partilhas')
  and exists (select 1 from public.fb_accounts a where a.id = account_id and a.profile_id = auth.uid())
  and (category_id is null or exists (select 1 from public.fb_categories c where c.id = category_id and c.profile_id = auth.uid()))
);

-- A conta, a categoria e o anúncio têm de ser todos do próprio.
drop policy if exists "fb schedules: own" on public.fb_schedules;
create policy "fb schedules: own" on public.fb_schedules for all to authenticated
using (profile_id = auth.uid() and public.has_section('partilhas'))
with check (
  profile_id = auth.uid() and public.has_section('partilhas')
  and exists (select 1 from public.fb_accounts a where a.id = account_id and a.profile_id = auth.uid())
  and (category_id is null or exists (select 1 from public.fb_categories c where c.id = category_id and c.profile_id = auth.uid()))
  and (ad_id is null or exists (select 1 from public.fb_share_ads d where d.id = ad_id and d.profile_id = auth.uid()))
);

commit;
commit;

-- ---------------------------------------------------------------------------
-- 0057_projeto_proprio.sql
-- ---------------------------------------------------------------------------
-- 0057 · Cada stand no seu projeto (Supabase + R2 + Netlify próprios)
--
-- O código é o mesmo para todos os stands; o que é de cada um fica na base de
-- dados dele ou nas variáveis do Netlify dele. Aqui:
--
-- 1. A identificação legal (nome da empresa, NIF) e a ficha de intermediário
--    de crédito passam do código para as Definições → Empresa. Antes estavam
--    fixas no código com os dados da Supermotas — um stand novo mostraria o
--    NIF de outro no rodapé e nas políticas.
-- 2. `setup_owner(email)`: numa base de dados nova, transforma a primeira
--    conta (criada no Supabase → Authentication) no acesso core: administrador,
--    dono da conta e nome de utilizador «Core». Só se corre no SQL Editor.
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.

-- ---------------------------------------------------------------------------
-- 1. Identificação legal nas Definições
-- ---------------------------------------------------------------------------
alter table public.site_settings add column if not exists legal_name text;
alter table public.site_settings add column if not exists nif text;
alter table public.site_settings add column if not exists credit_intermediary_url text;

-- O site público (anon) lê estas colunas, como as restantes da marca (0045).
grant select (legal_name, nif, credit_intermediary_url) on public.site_settings to anon;

-- A Supermotas (o primeiro stand) tinha estes dados no código: passam para a
-- base de dados dela, para nada mudar no site. Só nessa base de dados (pelo
-- nome da empresa) e só se ainda estiverem vazios — num stand novo não faz nada.
update public.site_settings
set legal_name = coalesce(legal_name, 'Carlos Moreira – Supermotas, Unipessoal Lda'),
    nif = coalesce(nif, '518429261'),
    credit_intermediary_url = coalesce(credit_intermediary_url, '/documentos/informacao-intermediario-credito.pdf')
where id = 1
  and company_name ilike 'supermotas%'
  and legal_name is null;

-- ---------------------------------------------------------------------------
-- 2. O acesso core numa base de dados nova
-- ---------------------------------------------------------------------------
-- Uso (SQL Editor), depois de criar a conta em Authentication → Users → Add user:
--   select public.setup_owner('email@do-dono.pt');
-- Recusa se o email não existir, ou se já houver outro dono.
create or replace function public.setup_owner(p_email text, p_username text default 'Core')
returns text
language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
  current_owner uuid;
begin
  select id into uid from auth.users where lower(email) = lower(trim(p_email)) limit 1;
  if uid is null then
    raise exception 'Não existe nenhuma conta com o email %. Crie-a primeiro em Authentication → Users → Add user.', p_email;
  end if;
  select id into current_owner from public.profiles where is_owner limit 1;
  if current_owner is not null and current_owner <> uid then
    raise exception 'Esta base de dados já tem um dono (acesso core). Só pode haver um.';
  end if;
  if exists (select 1 from public.profiles where lower(username) = lower(p_username) and id <> uid) then
    raise exception 'O nome de utilizador % já está a ser usado por outra conta.', p_username;
  end if;

  -- O perfil nasce com a conta (gatilho de 0001/0013); se ainda não existir, cria-o.
  insert into public.profiles (id, email, full_name, role)
  values (uid, lower(trim(p_email)), p_username, 'admin')
  on conflict (id) do nothing;

  update public.profiles
  set role = 'admin', is_owner = true, username = p_username, allowed_sections = null
  where id = uid;
  return format('Pronto: %s entra no backoffice com o nome de utilizador «%s».', p_email, p_username);
end;
$$;
revoke all on function public.setup_owner(text, text) from public, anon, authenticated;
commit;
