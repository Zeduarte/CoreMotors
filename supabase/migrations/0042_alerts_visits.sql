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
