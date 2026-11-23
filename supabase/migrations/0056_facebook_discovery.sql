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
