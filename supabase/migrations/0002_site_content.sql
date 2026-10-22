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
