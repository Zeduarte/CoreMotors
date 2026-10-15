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
