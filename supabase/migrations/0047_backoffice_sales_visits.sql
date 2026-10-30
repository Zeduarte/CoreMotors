-- Backoffice: viaturas, contactos, vendas e visitas.
--
--  * OLX: qualquer mudança de estado de uma viatura (venda, reserva, fim da
--    reserva, reserva expirada…) marca o anúncio para sincronizar. Antes só a
--    gravação pelo backoffice o fazia, e uma viatura vendida pelo contacto
--    ficava à venda no OLX. A manutenção periódica (`syncPending`) faz o resto.
--  * Viaturas com reservas ou venda registadas não se apagam: o histórico
--    comercial tem de ficar. Antes a tentativa falhava com um erro técnico da
--    base de dados (ou com «Não pode trocar a viatura…»), já depois de o
--    anúncio do OLX ter sido retirado.
--  * `erase_lead_personal_data(lead)`: apagar os dados pessoais de um contacto
--    (RGPD). Sem reservas nem venda, apaga o contacto; com elas, anonimiza-o e
--    mantém o histórico. Só o administrador. Fica registado no histórico.
--  * O tipo de viatura de cada utilizador (`allowed_vehicle_types`, 0020) passa
--    a valer na base de dados para viaturas e contactos. Nulo ou vazio = todos;
--    o administrador vê sempre tudo (`has_vehicle_type_for`, 0024).
--  * `close_vehicle_sale`: a data da venda compara-se com o dia de hoje em
--    Lisboa, não em UTC — entre a meia-noite e a uma da manhã de verão o
--    «hoje» do formulário era recusado.
--  * Pedidos de visita do site: uma vaga cheia já não aceita um segundo pedido
--    feito ao mesmo tempo (a verificação do servidor lia e depois gravava).
--
-- Idempotente: pode correr-se mais de uma vez no editor de SQL da Supabase.
begin;

-- ---------------------------------------------------------------------------
-- OLX: uma mudança de estado marca o anúncio para sincronizar
-- ---------------------------------------------------------------------------
-- Só marca anúncios que já existem (há linha em channel_listings): sem ela, a
-- viatura nunca foi enviada ao OLX e não há nada a acompanhar.
create or replace function public.queue_olx_on_status_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.channel_listings
     set sync_state = 'pending', attempts = 0
   where car_id = new.id and channel = 'olx';
  return new;
end $$;
revoke all on function public.queue_olx_on_status_change() from public, anon, authenticated;
drop trigger if exists queue_olx_on_status_change on public.cars;
create trigger queue_olx_on_status_change after update of status on public.cars
for each row when (old.status is distinct from new.status)
execute function public.queue_olx_on_status_change();

-- ---------------------------------------------------------------------------
-- Viaturas com histórico comercial não se apagam
-- ---------------------------------------------------------------------------
create or replace function public.car_has_sales_history(car uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.reservations where car_id = car)
      or exists (select 1 from public.vehicle_financials where car_id = car and sale_lead_id is not null)
      or exists (select 1 from public.leads where car_id = car and status = 'won');
$$;
revoke all on function public.car_has_sales_history(uuid) from public, anon;
grant execute on function public.car_has_sales_history(uuid) to authenticated, service_role;

create or replace function public.guard_car_delete() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.car_has_sales_history(old.id) then
    raise exception 'Viatura com reservas ou venda registadas: o histórico tem de ficar, por isso não pode ser apagada.';
  end if;
  return old;
end $$;
revoke all on function public.guard_car_delete() from public, anon, authenticated;
drop trigger if exists guard_car_delete on public.cars;
create trigger guard_car_delete before delete on public.cars
for each row execute function public.guard_car_delete();

-- ---------------------------------------------------------------------------
-- RGPD: apagar os dados pessoais de um contacto
-- ---------------------------------------------------------------------------
create or replace function public.erase_lead_personal_data(lead uuid) returns text
language plpgsql security definer set search_path = public as $$
declare
  l public.leads%rowtype;
  outcome text;
  -- Colunas com dados pessoais, também no histórico de alterações.
  personal text[] := array['name', 'email', 'phone', 'message', 'notes', 'car_details', 'next_action'];
begin
  if not public.is_admin() then raise exception 'Apenas administradores.'; end if;
  select * into l from public.leads where id = lead for update;
  if not found then raise exception 'Contacto inexistente'; end if;

  if exists (select 1 from public.reservations where lead_id = lead)
     or exists (select 1 from public.vehicle_financials where sale_lead_id = lead)
     or l.status = 'won' then
    -- Reservas ou venda: o registo fica (contabilidade, histórico da viatura),
    -- sem nada que identifique a pessoa.
    update public.leads set
      name = 'Dados apagados (RGPD)', email = '', phone = null, message = null,
      notes = null, car_details = '{}'::jsonb, next_action = null, next_action_at = null
    where id = lead;
    update public.lead_activities set body = 'Conteúdo apagado a pedido do cliente (RGPD).'
    where lead_id = lead;
    outcome := 'anonymised';
  else
    delete from public.leads where id = lead;
    outcome := 'deleted';
  end if;

  -- Os avisos já enviados ou por enviar levam o nome do cliente.
  delete from public.notification_jobs where lead_id = lead or payload ->> 'lead_id' = lead::text;
  -- O histórico de alterações guardava os valores antigos: ficam só os outros.
  update public.audit_log set changed_fields = changed_fields - personal
  where entity = 'leads' and record_id = lead::text;
  insert into public.audit_log(entity, record_id, action, actor_id, changed_fields)
  values ('leads', lead::text, 'ERASE', auth.uid(),
          jsonb_build_object('rgpd', jsonb_build_object('before', null, 'after',
            case outcome when 'deleted' then 'contacto apagado' else 'dados pessoais anonimizados' end)));
  return outcome;
end $$;
revoke all on function public.erase_lead_personal_data(uuid) from public, anon;
grant execute on function public.erase_lead_personal_data(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tipo de viatura por utilizador (restritivas: somam-se às políticas que já
-- existem, sem as substituir)
-- ---------------------------------------------------------------------------
drop policy if exists "cars: vehicle type read" on public.cars;
create policy "cars: vehicle type read" on public.cars as restrictive for select to authenticated
using (status in ('published', 'reserved', 'sold') or public.has_vehicle_type_for(auth.uid(), vehicle_type));
drop policy if exists "cars: vehicle type insert" on public.cars;
create policy "cars: vehicle type insert" on public.cars as restrictive for insert to authenticated
with check (public.has_vehicle_type_for(auth.uid(), vehicle_type));
drop policy if exists "cars: vehicle type update" on public.cars;
create policy "cars: vehicle type update" on public.cars as restrictive for update to authenticated
using (public.has_vehicle_type_for(auth.uid(), vehicle_type))
with check (public.has_vehicle_type_for(auth.uid(), vehicle_type));
drop policy if exists "cars: vehicle type delete" on public.cars;
create policy "cars: vehicle type delete" on public.cars as restrictive for delete to authenticated
using (public.has_vehicle_type_for(auth.uid(), vehicle_type));

-- Contactos sem tipo (contactos gerais) continuam visíveis a todos.
drop policy if exists "leads: vehicle type" on public.leads;
create policy "leads: vehicle type" on public.leads as restrictive for all to authenticated
using (vehicle_type is null or public.has_vehicle_type_for(auth.uid(), vehicle_type))
with check (vehicle_type is null or public.has_vehicle_type_for(auth.uid(), vehicle_type));

-- ---------------------------------------------------------------------------
-- Venda: «hoje» é o dia de Lisboa
-- ---------------------------------------------------------------------------
create or replace function public.close_vehicle_sale(lead uuid, amount numeric, sale_date date) returns void
language plpgsql security definer set search_path=public as $$
declare vehicle uuid; current_status public.car_status;
begin
 if not public.has_section('leads') or not public.has_section('carros') or not public.has_section('financeiro') then raise exception 'É necessário acesso a contactos, viaturas e financeiro'; end if;
 if amount <= 0 or sale_date > (now() at time zone 'Europe/Lisbon')::date then raise exception 'Valor ou data inválida'; end if;
 select car_id into vehicle from public.leads where id=lead and status in ('new','contacted','proposal') for update;
 if vehicle is null then raise exception 'Associe uma viatura'; end if;
 select status into current_status from public.cars where id=vehicle for update;
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

-- ---------------------------------------------------------------------------
-- Pedidos de visita: a lotação da vaga garantida na gravação
-- ---------------------------------------------------------------------------
-- Só os pedidos do site (visit_status 'requested'); a equipa pode marcar por
-- cima de uma vaga cheia de propósito. A vaga é o instante exato, como em
-- `takenSlots`/`slotKey`. O bloqueio serializa os pedidos: o segundo de dois
-- pedidos simultâneos espera pelo primeiro e já o conta.
create or replace function public.guard_visit_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare schedule jsonb; capacity int; taken int;
begin
  perform pg_advisory_xact_lock(hashtext('public.leads:visit_slot'));
  select visit_schedule into schedule from public.customer_settings where id = 1;
  -- A mesma leitura que `parseVisitSchedule` (src/lib/visits.ts): 1 a 20, por defeito 1.
  capacity := case when jsonb_typeof(schedule -> 'capacity') = 'number'
    then greatest(1, least(20, round((schedule ->> 'capacity')::numeric)::int)) else 1 end;
  select count(*) into taken from public.leads
   where visit_status in ('requested', 'confirmed')
     and visit_at = new.visit_at;
  if taken >= capacity then
    raise exception 'Essa hora acabou de ficar ocupada. Escolha outra, por favor.';
  end if;
  return new;
end $$;
revoke all on function public.guard_visit_capacity() from public, anon, authenticated;
drop trigger if exists guard_visit_capacity on public.leads;
create trigger guard_visit_capacity before insert on public.leads
for each row when (new.visit_status = 'requested' and new.visit_at is not null)
execute function public.guard_visit_capacity();

commit;
