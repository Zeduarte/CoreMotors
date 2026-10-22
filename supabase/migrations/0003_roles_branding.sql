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
