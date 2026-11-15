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
