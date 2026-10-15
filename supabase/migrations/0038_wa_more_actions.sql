-- Assistente interno por WhatsApp, segunda fase: mais ordens de escrita.
--
-- Até aqui o canal só escrevia na oficina e nos custos (0024). Passa a poder
-- também, sempre por proposta + imagem + «sim» lido por igualdade:
--
--   Viaturas     → criar uma viatura em RASCUNHO; mudar preço, quilómetros,
--                  frase de destaque e descrição; publicar / passar a rascunho.
--   Leads        → mudar o estado, atribuir o responsável, registar uma nota.
--   Testemunhos  → aprovar (publicar) ou rejeitar (retirar do site).
--
-- O desenho é o da 0024 e não muda: a autorização é feita SEMPRE com o id
-- explícito do colaborador (`has_section_for`, `has_vehicle_type_for`) e só
-- depois `wa_begin_as` assume a identidade, para a auditoria atribuir a ordem a
-- quem a deu. Cada função valida os valores outra vez, aqui — o TypeScript já
-- os validou, mas a chave de serviço ignora a RLS, e estas funções são a única
-- barreira que sobra se um dia alguém as chamar por outro caminho.
--
-- Nada se apaga por este canal: nenhuma função desta migração tem `delete`.
-- Reservar e vender têm fluxo próprio no backoffice (prazo e sinal; preço e
-- data da venda, a partir do contacto) e por isso ficam de fora — o estado
-- de uma viatura só passa a «publicada» ou a «rascunho» por aqui.
--
-- A 0036 é das notificações por WhatsApp (outro trabalho); esta não lhe toca.
begin;

-- ---------------------------------------------------------------------------
-- As novas propostas cabem na tabela de propostas
-- ---------------------------------------------------------------------------

alter table public.wa_pending_actions drop constraint if exists wa_pending_actions_kind_check;
alter table public.wa_pending_actions add constraint wa_pending_actions_kind_check check (kind in (
  'register_vehicle', 'add_cost', 'log_hours',
  'create_draft_car', 'update_car', 'set_car_status',
  'set_lead_status', 'assign_lead', 'add_lead_note',
  'set_testimonial'
));

-- A proposta passa a ir como imagem. A Meta aceita o envio e só DEPOIS vai
-- buscar a imagem; se falhar, avisa por um recibo «failed» com o id da
-- mensagem. Guarda-se esse id para, nesse caso, mandar a proposta em texto —
-- senão a pessoa ficava sem a pergunta e sem saber porquê.
alter table public.wa_pending_actions add column if not exists image_wamid text;
create index if not exists wa_pending_image_idx
  on public.wa_pending_actions (image_wamid) where image_wamid is not null;

-- ---------------------------------------------------------------------------
-- Procuras, já filtradas pelas permissões (como wa_vehicles_for_actor)
-- ---------------------------------------------------------------------------

-- Minúsculas e sem acentos, sem depender da extensão `unaccent` (que nem todas
-- as instalações têm): «João» e «joao» têm de ser o mesmo contacto.
create or replace function public.wa_fold(t text) returns text
language sql immutable set search_path = public as $$
  select translate(lower(coalesce(t, '')),
    'áàâãäéèêëíìîïóòôõöúùûüçñ', 'aaaaaeeeeiiiiooooouuuucn');
$$;

-- O texto procurado → palavras. Tudo o que não é letra, algarismo, @ ou ponto
-- vira espaço: assim nem um «%» nem um «_» chegam ao `like` como curinga.
create or replace function public.wa_words(search text) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_remove(regexp_split_to_array(
    trim(regexp_replace(public.wa_fold(search), '[^a-z0-9@.]+', ' ', 'g')), ' '), ''), '{}');
$$;

-- Contactos (leads) que o colaborador pode alterar: precisa de Leads e do tipo
-- de viatura do contacto (um contacto antigo sem tipo vê-se nos dois mundos,
-- como no backoffice). Sem nenhuma pista não se devolve a lista toda.
create or replace function public.wa_leads_for_actor(actor uuid, search text, only_status text)
returns table(id uuid, name text, phone text, email text, status text, car_label text,
              vehicle_type text, assigned_to uuid, assigned_name text,
              active_reservation boolean, created_at timestamptz, total bigint)
language sql stable security definer set search_path = public as $$
  with pedido as (
    select public.wa_words(search) as palavras,
           regexp_replace(coalesce(search, ''), '\D', '', 'g') as digitos
  )
  select l.id, l.name, l.phone, nullif(l.email, ''), l.status::text, l.car_label,
         l.vehicle_type, l.assigned_to, coalesce(nullif(trim(p.full_name), ''), p.email),
         exists (select 1 from public.reservations r where r.lead_id = l.id and r.status = 'active'),
         l.created_at, count(*) over ()
    from public.leads l
    left join public.profiles p on p.id = l.assigned_to
    cross join pedido
   where public.has_section_for(actor, 'leads')
     and (l.vehicle_type is null or public.has_vehicle_type_for(actor, l.vehicle_type))
     and (only_status is null or l.status::text = only_status)
     and (cardinality(pedido.palavras) > 0 or only_status is not null)
     and (cardinality(pedido.palavras) = 0
       or (length(pedido.digitos) >= 6
           and regexp_replace(coalesce(l.phone, ''), '\D', '', 'g') like '%' || pedido.digitos || '%')
       or not exists (
         select 1 from unnest(pedido.palavras) w
          where public.wa_fold(l.name || ' ' || coalesce(l.email, '') || ' ' ||
                coalesce(l.car_label, '') || ' ' || coalesce(l.phone, '')) not like '%' || w || '%'))
   order by l.created_at desc
   limit 5;
$$;

-- Testemunhos: precisa de Testemunhos. Os por aprovar vêm primeiro.
create or replace function public.wa_testimonials_for_actor(actor uuid, search text, only_pending boolean)
returns table(id uuid, name text, rating int, role text, body text, published boolean,
              created_at timestamptz, total bigint)
language sql stable security definer set search_path = public as $$
  with pedido as (select public.wa_words(search) as palavras)
  select t.id, t.name, t.rating::int, t.role, t.body, t.published, t.created_at, count(*) over ()
    from public.testimonials t
    cross join pedido
   where public.has_section_for(actor, 'testemunhos')
     and (not coalesce(only_pending, false) or not t.published)
     and (cardinality(pedido.palavras) > 0 or coalesce(only_pending, false))
     and not exists (
       select 1 from unnest(pedido.palavras) w
        where public.wa_fold(t.name || ' ' || coalesce(t.role, '') || ' ' || t.body)
              not like '%' || w || '%')
   order by t.published, t.created_at desc
   limit 5;
$$;

-- Quem pode ser responsável de um contacto: a mesma regra do backoffice
-- (`saveLeadFollowup`): qualquer colaborador menos o mecânico.
create or replace function public.wa_staff_for_actor(actor uuid, search text)
returns table(id uuid, full_name text, total bigint)
language sql stable security definer set search_path = public as $$
  with pedido as (select public.wa_words(search) as palavras)
  select p.id, coalesce(nullif(trim(p.full_name), ''), p.email, 'Colaborador'), count(*) over ()
    from public.profiles p
    cross join pedido
   where public.has_section_for(actor, 'leads')
     and p.role::text <> 'mecanico'
     and cardinality(pedido.palavras) > 0
     and not exists (
       select 1 from unnest(pedido.palavras) w
        where public.wa_fold(coalesce(p.full_name, '') || ' ' || coalesce(p.email, ''))
              not like '%' || w || '%')
   order by p.full_name
   limit 5;
$$;

-- ---------------------------------------------------------------------------
-- Viaturas (separador Viaturas = 'carros')
-- ---------------------------------------------------------------------------

-- Viatura nova, SEMPRE em rascunho: não aparece no site até alguém a publicar,
-- e para isso tem de ter os dados que o formulário do backoffice exige. Os
-- campos mínimos são os do `carFormSchema` (marca, modelo, ano, km,
-- combustível, caixa, segmento, preço ou «sob consulta»).
create or replace function public.wa_create_draft_car(
  actor uuid, selected_type text, vehicle_make text, vehicle_model text, vehicle_variant text,
  vehicle_year int, km int, fuel_kind text, gearbox text, body_kind text,
  asking_price int, on_request boolean, plate text, paint text,
  door_count int, seat_count int, slug_base text)
returns uuid language plpgsql security definer set search_path = public as $$
declare novo uuid := gen_random_uuid(); candidato text; n int := 1;
begin
  perform public.wa_begin_as(actor, array['carros']);
  if selected_type is null or selected_type not in ('car', 'motorcycle') then
    raise exception 'Tipo inválido';
  end if;
  if not public.has_vehicle_type_for(actor, selected_type) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;
  if length(trim(coalesce(vehicle_make, ''))) not between 1 and 60
     or length(trim(coalesce(vehicle_model, ''))) not between 1 and 80
     or trim(vehicle_model) = '—' then
    raise exception 'Marca ou modelo inválido';
  end if;
  if length(coalesce(vehicle_variant, '')) > 80 or length(coalesce(paint, '')) > 60 then
    raise exception 'Dados inválidos';
  end if;
  if vehicle_year is null or vehicle_year < 1950
     or vehicle_year > extract(year from current_date)::int + 1 then
    raise exception 'Ano inválido';
  end if;
  if km is null or km < 0 or km > 2000000 then raise exception 'Quilómetros inválidos'; end if;
  -- A regra do formulário: um preço positivo, ou «sob consulta» (e então sem preço).
  if coalesce(on_request, false) then
    asking_price := null;
  elsif asking_price is null or asking_price <= 0 or asking_price > 99999999 then
    raise exception 'Preço inválido';
  end if;
  if plate is not null and plate !~ '^[A-Z0-9]{2}-[A-Z0-9]{2}-[A-Z0-9]{2}$' then
    raise exception 'Matrícula inválida';
  end if;
  -- Portas e lugares: as restrições da tabela já recusam uma mota com portas;
  -- os lugares de uma mota só o formulário verificava.
  if door_count is null or seat_count is null or door_count not between 0 and 9
     or seat_count not between 1 and 9
     or (selected_type = 'motorcycle' and (door_count <> 0 or seat_count > 2))
     or (selected_type = 'car' and door_count < 1) then
    raise exception 'Portas ou lugares inválidos';
  end if;
  -- O slug base vem do `vehicleSlug` do TypeScript (a mesma regra do
  -- formulário); aqui só se garante que é um slug e que é único.
  if slug_base is null or length(slug_base) > 120 or slug_base !~ '^[a-z0-9]+(-[a-z0-9]+)*$' then
    raise exception 'Slug inválido';
  end if;
  candidato := slug_base;
  while exists (select 1 from public.cars where slug = candidato) loop
    n := n + 1;
    candidato := slug_base || '-' || n;
  end loop;

  -- Os enums (combustível, caixa, segmento) validam-se no próprio cast, e a
  -- restrição cars_vehicle_category_check recusa um segmento do outro tipo.
  insert into public.cars(id, slug, make, model, variant, year, vehicle_type, license_plate,
    mileage, fuel, transmission, body, color, doors, seats, price, price_on_request,
    status, created_by)
  values (novo, candidato, trim(vehicle_make), trim(vehicle_model),
    nullif(trim(coalesce(vehicle_variant, '')), ''), vehicle_year, selected_type, plate,
    km, fuel_kind::public.fuel_type, gearbox::public.transmission, body_kind::public.body_type,
    nullif(trim(coalesce(paint, '')), ''), door_count, seat_count, asking_price,
    coalesce(on_request, false), 'draft', actor);
  return novo;
end $$;

-- Preço, quilómetros, frase de destaque e descrição. Só as chaves enviadas
-- mudam, numa ÚNICA actualização: o histórico da viatura mostra uma alteração
-- com tudo o que a pessoa confirmou, e não várias soltas.
create or replace function public.wa_update_car(actor uuid, car uuid, changes jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.cars%rowtype; k text; v jsonb;
begin
  perform public.wa_begin_as(actor, array['carros']);
  if changes is null or jsonb_typeof(changes) <> 'object' or changes = '{}'::jsonb then
    raise exception 'Nada para alterar';
  end if;
  for k in select jsonb_object_keys(changes) loop
    if k not in ('price', 'mileage', 'tagline', 'description') then
      raise exception 'Campo não permitido';
    end if;
  end loop;

  select * into c from public.cars where id = car for update;
  if not found then raise exception 'Viatura inexistente'; end if;
  if not public.has_vehicle_type_for(actor, c.vehicle_type) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;

  if changes ? 'price' then
    v := changes -> 'price';
    -- null = «sob consulta», como no formulário.
    if jsonb_typeof(v) = 'null' then
      c.price := null; c.price_on_request := true;
    elsif jsonb_typeof(v) = 'number' and (v #>> '{}')::numeric = trunc((v #>> '{}')::numeric)
          and (v #>> '{}')::numeric between 1 and 99999999 then
      c.price := (v #>> '{}')::int; c.price_on_request := false;
    else
      raise exception 'Preço inválido';
    end if;
  end if;
  if changes ? 'mileage' then
    v := changes -> 'mileage';
    if jsonb_typeof(v) <> 'number' or (v #>> '{}')::numeric <> trunc((v #>> '{}')::numeric)
       or (v #>> '{}')::numeric not between 0 and 2000000 then
      raise exception 'Quilómetros inválidos';
    end if;
    c.mileage := (v #>> '{}')::int;
  end if;
  -- Texto vazio não apaga nada: por aqui só se substitui.
  if changes ? 'tagline' then
    v := changes -> 'tagline';
    if jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 160 then
      raise exception 'Frase de destaque inválida';
    end if;
    c.tagline := trim(v #>> '{}');
  end if;
  if changes ? 'description' then
    v := changes -> 'description';
    if jsonb_typeof(v) <> 'string' or length(trim(v #>> '{}')) not between 1 and 5000 then
      raise exception 'Descrição inválida';
    end if;
    c.description := trim(v #>> '{}');
  end if;

  update public.cars
     set price = c.price, price_on_request = c.price_on_request, mileage = c.mileage,
         tagline = c.tagline, description = c.description
   where id = car;
  return car;
end $$;

-- Publicar ou passar a rascunho. Reservada e vendida ficam de fora (fluxo
-- próprio no contacto); a oficina tem os seus botões; uma venda não se desfaz
-- por mensagem. Uma reserva activa bloqueia, como no gatilho protect_reservation.
create or replace function public.wa_set_car_status(actor uuid, car uuid, new_status text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c public.cars%rowtype;
begin
  perform public.wa_begin_as(actor, array['carros']);
  if new_status is null or new_status not in ('draft', 'published') then
    raise exception 'Estado não permitido por aqui';
  end if;
  select * into c from public.cars where id = car for update;
  if not found then raise exception 'Viatura inexistente'; end if;
  if not public.has_vehicle_type_for(actor, c.vehicle_type) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;
  if c.status::text = new_status then raise exception 'Já está nesse estado'; end if;
  if c.status in ('workshop', 'sold') then
    raise exception 'Estado atual não se altera por aqui';
  end if;
  if exists (select 1 from public.reservations where car_id = car and status = 'active') then
    raise exception 'Termine a reserva antes de alterar a disponibilidade';
  end if;
  -- A mesma exigência que a restrição complete_public_car e o formulário.
  if new_status = 'published' and (c.year is null or c.fuel is null or c.transmission is null
     or c.body is null or c.model = '—') then
    raise exception 'Ficha incompleta';
  end if;
  if new_status = 'published' and not c.price_on_request and coalesce(c.price, 0) <= 0 then
    raise exception 'Preço em falta';
  end if;
  update public.cars set status = new_status::public.car_status where id = car;
  return car;
end $$;

-- ---------------------------------------------------------------------------
-- Leads
-- ---------------------------------------------------------------------------

create or replace function public.wa_lead_for_update(actor uuid, lead uuid)
returns public.leads language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  select * into l from public.leads where id = lead for update;
  if not found then raise exception 'Contacto inexistente'; end if;
  if l.vehicle_type is not null and not public.has_vehicle_type_for(actor, l.vehicle_type) then
    raise exception 'Sem acesso a este tipo de viatura';
  end if;
  return l;
end $$;

-- Os estados da lista do backoffice. «Ganho» só pela «Concluir venda» (preço
-- e data); um perdido leva sempre o motivo. O gatilho validate_followup
-- continua a aplicar-se por cima (venda concluída não volta atrás, etc.).
create or replace function public.wa_set_lead_status(actor uuid, lead uuid, new_status text, reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  perform public.wa_begin_as(actor, array['leads']);
  if new_status is null or new_status not in ('new', 'contacted', 'proposal', 'lost', 'closed') then
    raise exception 'Estado não permitido por aqui';
  end if;
  l := public.wa_lead_for_update(actor, lead);
  if l.status = 'won' then raise exception 'A venda já está concluída'; end if;
  if l.status::text = new_status then raise exception 'Já está nesse estado'; end if;
  if new_status = 'lost' and length(trim(coalesce(reason, ''))) not between 1 and 1000 then
    raise exception 'Indique o motivo de perda';
  end if;
  -- Perder ou fechar um contacto com a viatura reservada deixava a viatura
  -- presa a uma reserva de ninguém. A reserva cancela-se primeiro, no backoffice.
  if new_status in ('lost', 'closed') and exists (
       select 1 from public.reservations where lead_id = lead and status = 'active') then
    raise exception 'Termine a reserva antes de alterar a disponibilidade';
  end if;
  update public.leads
     set status = new_status::public.lead_status,
         loss_reason = case when new_status = 'lost' then trim(reason) else null end
   where id = lead;
  return lead;
end $$;

create or replace function public.wa_assign_lead(actor uuid, lead uuid, assignee uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  perform public.wa_begin_as(actor, array['leads']);
  l := public.wa_lead_for_update(actor, lead);
  if assignee is null or not exists (
       select 1 from public.profiles where id = assignee and role::text <> 'mecanico') then
    raise exception 'Responsável inválido';
  end if;
  if l.assigned_to is not distinct from assignee then raise exception 'Já está nesse estado'; end if;
  update public.leads set assigned_to = assignee where id = lead;
  return lead;
end $$;

create or replace function public.wa_add_lead_note(actor uuid, lead uuid, note_kind text, note text)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype; novo uuid;
begin
  perform public.wa_begin_as(actor, array['leads']);
  if note_kind is null or note_kind not in ('call', 'message', 'proposal', 'visit', 'note') then
    raise exception 'Tipo inválido';
  end if;
  if length(trim(coalesce(note, ''))) not between 1 and 4000 then raise exception 'Texto inválido'; end if;
  l := public.wa_lead_for_update(actor, lead);
  insert into public.lead_activities(lead_id, kind, body, created_by)
  values (l.id, note_kind, trim(note), actor)
  returning id into novo;
  return novo;
end $$;

-- ---------------------------------------------------------------------------
-- Testemunhos
-- ---------------------------------------------------------------------------

-- Aprovar = publicar no site; rejeitar = retirar do site. Apagar fica no
-- backoffice, como tudo o que se apaga.
create or replace function public.wa_set_testimonial(actor uuid, testimonial uuid, publish boolean)
returns uuid language plpgsql security definer set search_path = public as $$
declare atual boolean;
begin
  perform public.wa_begin_as(actor, array['testemunhos']);
  if publish is null then raise exception 'Dados inválidos'; end if;
  select published into atual from public.testimonials where id = testimonial for update;
  if not found then raise exception 'Testemunho inexistente'; end if;
  if atual = publish then raise exception 'Já está nesse estado'; end if;
  update public.testimonials set published = publish where id = testimonial;
  return testimonial;
end $$;

-- Só o servidor, como na 0024: revoke e grant juntos, para não se poder
-- acrescentar uma função e esquecer o revoke.
do $$ declare sig text; begin
  foreach sig in array array[
    'wa_fold(text)',
    'wa_words(text)',
    'wa_leads_for_actor(uuid,text,text)',
    'wa_testimonials_for_actor(uuid,text,boolean)',
    'wa_staff_for_actor(uuid,text)',
    'wa_create_draft_car(uuid,text,text,text,text,integer,integer,text,text,text,integer,boolean,text,text,integer,integer,text)',
    'wa_update_car(uuid,uuid,jsonb)',
    'wa_set_car_status(uuid,uuid,text)',
    'wa_lead_for_update(uuid,uuid)',
    'wa_set_lead_status(uuid,uuid,text,text)',
    'wa_assign_lead(uuid,uuid,uuid)',
    'wa_add_lead_note(uuid,uuid,text,text)',
    'wa_set_testimonial(uuid,uuid,boolean)'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
