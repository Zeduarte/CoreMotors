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
