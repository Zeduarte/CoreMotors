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
