-- 0050 · O tipo de viatura também vale nas tabelas que dependem de viaturas e contactos
--
-- A 0047 impôs o tipo de viatura de cada utilizador (`allowed_vehicle_types`)
-- em `cars` e `leads`. As tabelas que dependem delas só olhavam ao separador:
-- um vendedor só de motas lia pela API, com o seu JWT, o histórico de
-- alterações de contactos e carros que não vê (com email e telefone), e lia e
-- escrevia fotografias, custos, financeiro, atividades, reservas, anúncios,
-- alertas, preparação e horas da oficina de carros.
--
--  1. Regras restritivas (somam-se às que já existem, nunca alargam nada) em
--     `car_media`, `vehicle_costs`, `vehicle_financials`, `preparation_tasks`,
--     `vehicle_tasks` (e a vista `vehicle_task_totals`, que lhe obedece),
--     `channel_listings`, `car_views`, `lead_activities`, `reservations` e
--     `stock_alert_matches`: a viatura (ou o contacto) tem de ser de um tipo
--     que o utilizador vê. Contactos sem tipo continuam de todos, como na 0047.
--     As fotografias de viaturas no site (publicada, reservada, vendida) leem-se
--     como a própria viatura (0047): são públicas.
--  2. `audit_log`: as linhas de viaturas, contactos, reservas, financeiro,
--     custos, preparação e oficina só aparecem a quem vê o tipo do registo.
--     Para um registo apagado, vale o tipo que ficou gravado no histórico
--     (a linha DELETE guarda a ficha toda); sem tipo conhecido, só quem vê
--     todos os tipos. O administrador vê tudo, apagados incluídos.
--  3. Storage, bucket `car-media`: a mesma regra pela pasta da viatura
--     (`<id da viatura>/…`, e `_originais/<id da viatura>/…` das cópias das
--     fotos reduzidas). Pastas que não são de uma viatura (logótipo…) ficam
--     como estavam.
--  4. `site_content`: só se conseguia apagar a linha 'showroom'. O gatilho da
--     0018 devolvia NEW num DELETE (nulo), o que cancela a operação sem erro.
--  5. Reservar, cancelar a reserva, confirmar o sinal e fechar a venda
--     (funções SECURITY DEFINER) passam a verificar o tipo da viatura de quem
--     as chama; antes só o TypeScript o fazia.
--
-- Não muda nada para o administrador, para quem não tem restrição de tipo
-- (nulo ou vazio), para o service_role (ignora a RLS), para as funções
-- SECURITY DEFINER e gatilhos (auditoria, reservas, vendas, WhatsApp) nem para
-- o público anónimo.
--
-- Idempotente: pode correr-se mais de uma vez. Aplicar no Supabase → SQL Editor.
begin;

-- ---------------------------------------------------------------------------
-- Funções de apoio
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER: decidem SÓ pelo tipo, sem passar pela RLS de `cars` e
-- `leads` (que tem outras regras, como o separador). Nota sobre
-- `has_vehicle_type_for(uid, null)`: só é verdade para quem vê todos os tipos
-- (administrador, restrição nula ou vazia) — é o atalho «sem restrição».

-- A viatura `car` é de um tipo que o utilizador vê? Sem viatura: sim.
-- `public_too`: as viaturas no site (publicada, reservada, vendida) contam
-- como vistas, como na leitura de `cars` (0047).
create or replace function public.car_type_allowed(car uuid, public_too boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  select car is null
      or public.has_vehicle_type_for(auth.uid(), null)
      or coalesce((select (public_too and c.status in ('published', 'reserved', 'sold'))
                          or public.has_vehicle_type_for(auth.uid(), c.vehicle_type)
                     from public.cars c where c.id = car), false);
$$;
revoke all on function public.car_type_allowed(uuid, boolean) from public, anon;
grant execute on function public.car_type_allowed(uuid, boolean) to authenticated, service_role;

-- O contacto `lead` é de um tipo que o utilizador vê? Sem contacto ou contacto
-- sem tipo (contacto geral): sim, como na 0047.
create or replace function public.lead_type_allowed(lead uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select lead is null
      or public.has_vehicle_type_for(auth.uid(), null)
      or coalesce((select l.vehicle_type is null or public.has_vehicle_type_for(auth.uid(), l.vehicle_type)
                     from public.leads l where l.id = lead), false);
$$;
revoke all on function public.lead_type_allowed(uuid) from public, anon;
grant execute on function public.lead_type_allowed(uuid) to authenticated, service_role;

-- Uma linha do histórico (`audit_log`) é de um tipo que o utilizador vê?
-- O `record_id` é o id da viatura em cars/vehicle_financials/vehicle_costs/
-- preparation_tasks/vehicle_tasks, o do contacto em leads e o da reserva em
-- reservations (ver `audit_change`, 0013). Outras entidades (perfis) não têm
-- tipo: decide só a política "audit: read".
create or replace function public.audit_type_allowed(entry_entity text, entry_record text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  uid uuid := auth.uid();
  rec uuid;
  vtype text;
begin
  if public.has_vehicle_type_for(uid, null) then return true; end if;
  if entry_entity not in ('cars', 'leads', 'reservations', 'vehicle_financials',
                          'vehicle_costs', 'preparation_tasks', 'vehicle_tasks') then
    return true;
  end if;
  if entry_record !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  rec := entry_record::uuid;

  if entry_entity = 'leads' then
    select l.vehicle_type into vtype from public.leads l where l.id = rec;
    if not found then
      -- Contacto apagado: o tipo gravado no histórico (o da linha mais recente
      -- que o tenha; num DELETE é o valor «antes»). Sem nenhum: desconhecido.
      select case when a.action = 'DELETE' then a.changed_fields -> 'vehicle_type' ->> 'before'
                  else a.changed_fields -> 'vehicle_type' ->> 'after' end
        into vtype
        from public.audit_log a
       where a.entity = 'leads' and a.record_id = entry_record and a.changed_fields ? 'vehicle_type'
       order by a.id desc limit 1;
      if not found then return false; end if;
    end if;
    return vtype is null or public.has_vehicle_type_for(uid, vtype);
  end if;

  if entry_entity = 'reservations' then
    -- A reserva leva à viatura (também se a reserva já não existir).
    select r.car_id into rec from public.reservations r where r.id = entry_record::uuid;
    if not found then
      select (case when a.action = 'DELETE' then a.changed_fields -> 'car_id' ->> 'before'
                   else a.changed_fields -> 'car_id' ->> 'after' end)::uuid
        into rec
        from public.audit_log a
       where a.entity = 'reservations' and a.record_id = entry_record and a.changed_fields ? 'car_id'
       order by a.id desc limit 1;
      if rec is null then return false; end if;
    end if;
  end if;

  -- A viatura: a ficha atual, ou o tipo gravado no histórico se foi apagada.
  select c.vehicle_type into vtype from public.cars c where c.id = rec;
  if not found then
    select case when a.action = 'DELETE' then a.changed_fields -> 'vehicle_type' ->> 'before'
                else a.changed_fields -> 'vehicle_type' ->> 'after' end
      into vtype
      from public.audit_log a
     where a.entity = 'cars' and a.record_id = rec::text and a.changed_fields ? 'vehicle_type'
     order by a.id desc limit 1;
  end if;
  -- Tipo desconhecido: has_vehicle_type_for(uid, null) já foi falso acima.
  return vtype is not null and public.has_vehicle_type_for(uid, vtype);
end $$;
revoke all on function public.audit_type_allowed(text, text) from public, anon;
grant execute on function public.audit_type_allowed(text, text) to authenticated, service_role;

-- Um objeto do bucket `car-media` pode ser tocado pelo tipo da viatura?
-- `<id da viatura>/<ficheiro>` (MediaManager) ou `_originais/<id>/<ficheiro>`
-- (cópias das fotos reduzidas, src/lib/photo-optimize.ts). Pastas que não são
-- de uma viatura que exista (logótipo em `branding/`, …): sim — decidem as
-- políticas que já existiam.
create or replace function public.car_media_path_allowed(object_name text, public_too boolean default false)
returns boolean language sql stable security definer set search_path = public as $$
  with folder as (
    select case when split_part(object_name, '/', 1) = '_originais'
                then split_part(object_name, '/', 2) else split_part(object_name, '/', 1) end as id
  ), car as (
    select c.id from folder f
      join public.cars c
        on c.id = case when f.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                       then f.id::uuid end
  )
  select coalesce((select public.car_type_allowed(car.id, public_too) from car), true);
$$;
revoke all on function public.car_media_path_allowed(text, boolean) from public, anon;
grant execute on function public.car_media_path_allowed(text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Tabelas que dependem de uma viatura ou de um contacto
-- ---------------------------------------------------------------------------

-- Fotografias: as de viaturas no site leem-se (como a viatura); escrever só
-- nas do próprio tipo.
drop policy if exists "media: vehicle type read" on public.car_media;
create policy "media: vehicle type read" on public.car_media as restrictive for select to authenticated
using (public.car_type_allowed(car_id, true));
drop policy if exists "media: vehicle type insert" on public.car_media;
create policy "media: vehicle type insert" on public.car_media as restrictive for insert to authenticated
with check (public.car_type_allowed(car_id));
drop policy if exists "media: vehicle type update" on public.car_media;
create policy "media: vehicle type update" on public.car_media as restrictive for update to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));
drop policy if exists "media: vehicle type delete" on public.car_media;
create policy "media: vehicle type delete" on public.car_media as restrictive for delete to authenticated
using (public.car_type_allowed(car_id));

-- Dados internos de uma viatura: só do próprio tipo (ler e escrever).
drop policy if exists "costs: vehicle type" on public.vehicle_costs;
create policy "costs: vehicle type" on public.vehicle_costs as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

drop policy if exists "financials: vehicle type" on public.vehicle_financials;
create policy "financials: vehicle type" on public.vehicle_financials as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

drop policy if exists "preparation: vehicle type" on public.preparation_tasks;
create policy "preparation: vehicle type" on public.preparation_tasks as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

drop policy if exists "tasks: vehicle type" on public.vehicle_tasks;
create policy "tasks: vehicle type" on public.vehicle_tasks as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

drop policy if exists "channel_listings: vehicle type" on public.channel_listings;
create policy "channel_listings: vehicle type" on public.channel_listings as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

-- Estatísticas de visitas (só leitura para a equipa; quem grava é o servidor).
drop policy if exists "views: vehicle type" on public.car_views;
create policy "views: vehicle type" on public.car_views as restrictive for all to authenticated
using (public.car_type_allowed(car_id)) with check (public.car_type_allowed(car_id));

-- Do contacto.
drop policy if exists "activities: vehicle type" on public.lead_activities;
create policy "activities: vehicle type" on public.lead_activities as restrictive for all to authenticated
using (public.lead_type_allowed(lead_id)) with check (public.lead_type_allowed(lead_id));

-- Da viatura e do contacto.
drop policy if exists "reservations: vehicle type" on public.reservations;
create policy "reservations: vehicle type" on public.reservations as restrictive for all to authenticated
using (public.car_type_allowed(car_id) and public.lead_type_allowed(lead_id))
with check (public.car_type_allowed(car_id) and public.lead_type_allowed(lead_id));

drop policy if exists "stock_alert_matches: vehicle type" on public.stock_alert_matches;
create policy "stock_alert_matches: vehicle type" on public.stock_alert_matches as restrictive for all to authenticated
using (public.car_type_allowed(car_id) and public.lead_type_allowed(lead_id))
with check (public.car_type_allowed(car_id) and public.lead_type_allowed(lead_id));

-- ---------------------------------------------------------------------------
-- 2. Histórico de alterações
-- ---------------------------------------------------------------------------
-- Só leitura: ninguém escreve no histórico pela API (só a função de auditoria,
-- SECURITY DEFINER, que não passa pela RLS).
drop policy if exists "audit: vehicle type" on public.audit_log;
create policy "audit: vehicle type" on public.audit_log as restrictive for select to authenticated
using (public.audit_type_allowed(entity, record_id));

-- ---------------------------------------------------------------------------
-- 3. Storage: fotografias por pasta da viatura
-- ---------------------------------------------------------------------------
drop policy if exists "car-media: vehicle type read" on storage.objects;
create policy "car-media: vehicle type read" on storage.objects as restrictive for select to authenticated
using (bucket_id <> 'car-media' or public.car_media_path_allowed(name, true));
drop policy if exists "car-media: vehicle type insert" on storage.objects;
create policy "car-media: vehicle type insert" on storage.objects as restrictive for insert to authenticated
with check (bucket_id <> 'car-media' or public.car_media_path_allowed(name));
drop policy if exists "car-media: vehicle type update" on storage.objects;
create policy "car-media: vehicle type update" on storage.objects as restrictive for update to authenticated
using (bucket_id <> 'car-media' or public.car_media_path_allowed(name))
with check (bucket_id <> 'car-media' or public.car_media_path_allowed(name));
drop policy if exists "car-media: vehicle type delete" on storage.objects;
create policy "car-media: vehicle type delete" on storage.objects as restrictive for delete to authenticated
using (bucket_id <> 'car-media' or public.car_media_path_allowed(name));

-- ---------------------------------------------------------------------------
-- 4. site_content: apagar volta a funcionar
-- ---------------------------------------------------------------------------
-- Igual à 0018, exceto o `return coalesce(new, old)` das linhas que não são
-- 'showroom': num DELETE o NEW é nulo, e um gatilho BEFORE que devolve nulo
-- cancela a operação sem erro (o DELETE dizia «0 linhas»).
create or replace function public.validate_showroom_location() returns trigger
language plpgsql security definer set search_path = public, pg_temp as $$
declare cfg jsonb;
begin
  if tg_table_name = 'cars' then
    if new.point_of_sale_id is null then return new; end if;
    select content into cfg from public.site_content where key = 'showroom' for update;
    if not exists (select 1 from jsonb_array_elements(coalesce(cfg->'locations','[]'::jsonb)) p where p->>'id' = new.point_of_sale_id) then
      raise exception 'Ponto de venda inexistente';
    end if;
    return new;
  end if;
  if old.key <> 'showroom' then return coalesce(new, old); end if;
  if tg_op = 'DELETE' then cfg := '{}'::jsonb;
  elsif new.key <> 'showroom' then cfg := '{}'::jsonb; else cfg := new.content; end if;
  if exists (select 1 from public.cars c where c.point_of_sale_id is not null and not exists
    (select 1 from jsonb_array_elements(coalesce(cfg->'locations','[]'::jsonb)) p where p->>'id' = c.point_of_sale_id)) then
    raise exception 'Reatribua as viaturas antes de remover o ponto de venda';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.validate_showroom_location() from public;

-- ---------------------------------------------------------------------------
-- 5. Reservas e vendas: o tipo da viatura também nas funções
-- ---------------------------------------------------------------------------
-- São SECURITY DEFINER (não passam pela RLS) e só verificavam o separador: o
-- tipo dependia só do TypeScript. Corpo igual ao atual (0013; a venda da
-- 0047), mais a verificação do tipo da viatura, como na oficina (0028). Quem
-- chama sem sessão já era recusado pelo `has_section`, que continua primeiro.
create or replace function public.reserve_vehicle(lead uuid, expiry timestamptz, deposit numeric) returns uuid
language plpgsql security definer set search_path=public as $$
declare vehicle uuid; current_status public.car_status; result uuid; vtype text;
begin
 if not public.has_section('leads') or not public.has_section('carros') then raise exception 'É necessário acesso a contactos e viaturas'; end if;
 if expiry <= now() or expiry > now()+interval '30 days' or deposit < 0 then raise exception 'Prazo ou sinal inválido'; end if;
 select car_id into vehicle from public.leads where id=lead and status in ('new','contacted','proposal') for update;
 if vehicle is null then raise exception 'Associe uma viatura ao contacto'; end if;
 select status, vehicle_type into current_status, vtype from public.cars where id=vehicle for update;
 if not public.has_vehicle_type_for(auth.uid(), vtype) then raise exception 'Sem permissão'; end if;
 if current_status <> 'published' then raise exception 'A viatura não está disponível'; end if;
 insert into public.reservations(car_id,lead_id,expires_at,deposit_amount,created_by) values(vehicle,lead,expiry,deposit,auth.uid()) returning id into result;
 update public.cars set status='reserved' where id=vehicle;
 return result;
end $$;
revoke all on function public.reserve_vehicle(uuid,timestamptz,numeric) from public, anon;
grant execute on function public.reserve_vehicle(uuid,timestamptz,numeric) to authenticated;

create or replace function public.release_reservation(reservation_id uuid) returns void
language plpgsql security definer set search_path=public as $$
declare vehicle uuid;
begin
 if not public.has_section('leads') or not public.has_section('carros') then raise exception 'Sem permissão'; end if;
 select car_id into vehicle from public.reservations where id=reservation_id;
 if vehicle is not null and not public.has_vehicle_type_for(auth.uid(), (select vehicle_type from public.cars where id=vehicle)) then
   raise exception 'Sem permissão';
 end if;
 perform 1 from public.cars where id=vehicle for update;
 update public.reservations set status='cancelled' where id=reservation_id and status='active';
 if not found then raise exception 'Reserva já terminada'; end if;
 update public.cars set status='published' where id=vehicle and status='reserved';
end $$;
revoke all on function public.release_reservation(uuid) from public, anon;
grant execute on function public.release_reservation(uuid) to authenticated;

create or replace function public.confirm_reservation_deposit(reservation_id uuid) returns void
language plpgsql security definer set search_path=public as $$
begin
 if not public.has_section('leads') then raise exception 'Sem permissão'; end if;
 if exists (select 1 from public.reservations r join public.cars c on c.id = r.car_id
             where r.id = reservation_id and not public.has_vehicle_type_for(auth.uid(), c.vehicle_type)) then
   raise exception 'Sem permissão';
 end if;
 update public.reservations set deposit_received=true where id=reservation_id and status='active' and expires_at>now();
 if not found then raise exception 'Reserva não está ativa'; end if;
end $$;
revoke all on function public.confirm_reservation_deposit(uuid) from public, anon;
grant execute on function public.confirm_reservation_deposit(uuid) to authenticated;

create or replace function public.close_vehicle_sale(lead uuid, amount numeric, sale_date date) returns void
language plpgsql security definer set search_path=public as $$
declare vehicle uuid; current_status public.car_status; vtype text;
begin
 if not public.has_section('leads') or not public.has_section('carros') or not public.has_section('financeiro') then raise exception 'É necessário acesso a contactos, viaturas e financeiro'; end if;
 if amount <= 0 or sale_date > (now() at time zone 'Europe/Lisbon')::date then raise exception 'Valor ou data inválida'; end if;
 select car_id into vehicle from public.leads where id=lead and status in ('new','contacted','proposal') for update;
 if vehicle is null then raise exception 'Associe uma viatura'; end if;
 select status, vehicle_type into current_status, vtype from public.cars where id=vehicle for update;
 if not public.has_vehicle_type_for(auth.uid(), vtype) then raise exception 'Sem permissão'; end if;
 if current_status not in ('published','reserved') then raise exception 'Viatura indisponível'; end if;
 if exists(select 1 from public.reservations where car_id=vehicle and status='active' and lead_id<>lead) then raise exception 'Viatura reservada para outro contacto'; end if;
 update public.reservations set status='completed' where car_id=vehicle and status='active';
 update public.cars set status='sold',sold_at=sale_date::timestamptz where id=vehicle;
 insert into public.vehicle_financials(car_id,sale_price,sold_on,sale_lead_id) values(vehicle,amount,sale_date,lead)
 on conflict(car_id) do update set sale_price=excluded.sale_price,sold_on=excluded.sold_on,sale_lead_id=excluded.sale_lead_id,updated_at=now();
 update public.leads set status='won',next_action=null,next_action_at=null where id=lead;
end $$;
revoke all on function public.close_vehicle_sale(uuid,numeric,date) from public, anon;
grant execute on function public.close_vehicle_sale(uuid,numeric,date) to authenticated;

commit;
