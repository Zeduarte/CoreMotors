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
