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
