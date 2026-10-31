-- Pedido de visita feito no site: aviso por WhatsApp à equipa e confirmação com
-- um toque.
--
--  * Novo aviso `lead_visit` (Leads, ligado por defeito): sai quando o cliente
--    pede uma visita no site (kind 'visit', visit_status 'requested'). Substitui
--    o `lead_contact` genérico para este tipo de contacto. Visitas já criadas
--    como confirmadas pela equipa não avisam ninguém.
--  * O aviso leva `lead_id`, `visit_at` (ISO UTC) e `visit_status`, para o
--    botão de resposta saber a que contacto se refere.
--  * Antes de enviar, o aviso volta a verificar-se: se a visita já não existe
--    ou já não está por tratar (um colega confirmou, ou foi tratada no
--    backoffice), o aviso cancela-se.
--  * `wa_set_visit(actor, lead, outcome)`: confirma ou recusa a visita pelo
--    WhatsApp. Devolve um texto com o resultado; é idempotente.
begin;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

create or replace function public.notification_event_section(ev text)
returns text language sql immutable set search_path = public as $$
  select case ev
    -- Contactos do site, um aviso por tipo de pedido.
    when 'lead_contact'          then 'leads'
    when 'lead_test_drive'       then 'leads'
    when 'lead_offer'            then 'leads'
    when 'lead_reservation'      then 'leads'
    when 'lead_trade_in'         then 'leads'
    when 'lead_order'            then 'leads'
    when 'lead_alert'            then 'leads'
    -- Pedido de visita ao stand: a equipa confirma ou recusa pelo WhatsApp.
    when 'lead_visit'            then 'leads'
    -- Um contacto atribuído, ou fechado por um colega: só para o responsável.
    when 'lead_assigned'         then 'leads'
    when 'lead_outcome'          then 'leads'
    -- Uma reserva feita por um colega: quem vende tem de deixar de a oferecer.
    when 'vehicle_reserved'      then 'leads'
    -- E o contrário: vendida (deixar de oferecer) ou reserva terminada (voltar a).
    when 'vehicle_sold'          then 'leads'
    when 'reservation_ended'     then 'leads'
    when 'testimonial_pending'   then 'testemunhos'
    when 'vehicle_workshop'      then 'oficina'
    when 'vehicle_created'       then 'carros'
    when 'vehicle_prepared'      then 'carros'
    when 'vehicle_published'     then 'carros'
    when 'vehicle_price_changed' then 'carros'
    -- Férias: a área pessoal, que toda a gente tem.
    when 'leave_requested'       then 'perfil'
    when 'leave_decided'         then 'perfil'
    when 'leave_upcoming'        then 'perfil'
    -- O acesso dado pela Meta dura 60 dias; sem ele, o WhatsApp todo pára.
    when 'whatsapp_expiring'     then 'integracoes'
    else null end;
$$;

-- `lead_visit` vem ligado (só `vehicle_price_changed` começa desligado, 0041).
create or replace function public.notification_event_default(ev text)
returns boolean language sql immutable set search_path = public as $$
  select ev is distinct from 'vehicle_price_changed';
$$;

-- ---------------------------------------------------------------------------
-- O aviso
-- ---------------------------------------------------------------------------

create or replace function public.notify_lead_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.kind::text = 'visit' then
    -- Só os pedidos do site (por confirmar). Uma visita criada já confirmada
    -- pela equipa não precisa de aviso.
    if new.visit_status is distinct from 'requested' then
      return null;
    end if;
    perform public.queue_whatsapp_event('lead_visit', new.id, new.vehicle_type,
      jsonb_build_object(
        'kind', new.kind,
        'name', new.name,
        'car_label', new.car_label,
        'lead_id', new.id::text,
        'visit_at', to_char(new.visit_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'visit_status', new.visit_status),
      new.id);
    return null;
  end if;

  perform public.queue_whatsapp_event(
    case new.kind::text
      when 'test_drive'  then 'lead_test_drive'
      when 'offer'       then 'lead_offer'
      when 'reservation' then 'lead_reservation'
      when 'trade_in'    then 'lead_trade_in'
      when 'order'       then 'lead_order'
      when 'alert'       then 'lead_alert'
      else 'lead_contact' end,
    new.id, new.vehicle_type,
    -- Só o que a mensagem mostra. Email e telefone do cliente não vão para o
    -- WhatsApp: estão no backoffice, a um toque do link.
    jsonb_build_object(
      'kind', new.kind,
      'name', new.name,
      'car_label', new.car_label,
      'offer_amount', new.car_details -> 'offer_amount',
      'deposit', new.car_details -> 'deposit'),
    new.id);
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (contacto %): %', new.id, sqlerrm;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Verificação antes de enviar
-- ---------------------------------------------------------------------------

-- Igual à 0041, mais `lead_visit`: o contacto tem de existir e a visita tem de
-- continuar por tratar.
create or replace function public.notification_job_block_reason(uid uuid, ev text, details jsonb)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  motivo text := public.notification_block_reason(uid, ev, details ->> 'vehicle_type');
  pessoa uuid;
begin
  if motivo is not null then return motivo; end if;
  if ev in ('lead_assigned', 'lead_outcome') then
    if (select l.assigned_to from public.leads l where l.id = (details ->> 'lead_id')::uuid)
       is distinct from uid then
      return 'O contacto já não está atribuído a esta pessoa';
    end if;
  elsif ev = 'lead_visit' then
    if not exists (select 1 from public.leads l where l.id = (details ->> 'lead_id')::uuid) then
      return 'O contacto já não existe';
    end if;
    if not exists (select 1 from public.leads l
                    where l.id = (details ->> 'lead_id')::uuid and l.visit_status = 'requested') then
      return 'A visita já foi tratada';
    end if;
  elsif ev in ('leave_requested', 'leave_decided', 'leave_upcoming') then
    pessoa := (details ->> 'profile_id')::uuid;
    if ev = 'leave_requested' then
      if not public.can_decide_leave_as(uid, pessoa) or uid = pessoa then
        return 'Já não decide as férias desta pessoa';
      end if;
      if not exists (select 1 from public.leave_days d
                      where d.profile_id = pessoa and d.status = 'pending'
                        and d.day between (details ->> 'start')::date and (details ->> 'end')::date) then
        return 'O pedido de férias já foi decidido';
      end if;
    elsif ev = 'leave_decided' then
      if uid is distinct from pessoa then return 'O pedido de férias não é desta pessoa'; end if;
    else
      if uid = pessoa then return 'São as férias da própria pessoa'; end if;
      if not exists (select 1 from public.leave_days d
                      where d.profile_id = pessoa and d.status = 'approved'
                        and d.day = (details ->> 'start')::date) then
        return 'As férias foram desmarcadas';
      end if;
    end if;
  end if;
  return null;
end $$;

-- ---------------------------------------------------------------------------
-- Confirmar ou recusar a visita pelo WhatsApp
-- ---------------------------------------------------------------------------

create or replace function public.wa_set_visit(actor uuid, lead uuid, outcome text)
returns text language plpgsql security definer set search_path = public as $$
declare l public.leads%rowtype;
begin
  perform public.wa_begin_as(actor, array['leads']);
  if outcome is null or outcome not in ('confirm', 'decline') then
    raise exception 'Resposta inválida';
  end if;
  if not exists (select 1 from public.leads where id = lead and visit_at is not null) then
    return 'not_found';
  end if;
  l := public.wa_lead_for_update(actor, lead);
  if l.visit_at is null then return 'not_found'; end if;

  if outcome = 'confirm' and l.visit_status = 'confirmed' then return 'already_confirmed'; end if;
  if outcome = 'decline' and l.visit_status = 'cancelled' then return 'already_declined'; end if;
  -- Recusada (ou cancelada) por um colega: quem carrega «Confirmar» depois vê isso.
  if outcome = 'confirm' and l.visit_status = 'cancelled' then return 'already_declined'; end if;
  if outcome = 'confirm' and l.visit_status in ('done', 'no_show') then
    return 'already_handled';
  end if;
  if outcome = 'decline' and l.visit_status in ('done', 'no_show', 'confirmed') then
    return 'already_handled';
  end if;
  -- Daqui em diante só resta 'requested'.
  if l.visit_status is distinct from 'requested' then return 'already_handled'; end if;
  if l.visit_at < now() then return 'past'; end if;

  if outcome = 'confirm' then
    update public.leads
       set visit_status = 'confirmed', next_action = 'Visita ao stand', next_action_at = l.visit_at
     where id = lead;
    insert into public.lead_activities(lead_id, kind, body, created_by)
    values (lead, 'visit', 'Visita confirmada para '
      || to_char(l.visit_at at time zone 'Europe/Lisbon', 'DD/MM/YYYY "às" HH24:MI')
      || ' pelo WhatsApp.', actor);
    return 'confirmed';
  end if;

  update public.leads
     set visit_status = 'cancelled', next_action = 'Propor outra hora ao cliente', next_action_at = now()
   where id = lead;
  insert into public.lead_activities(lead_id, kind, body, created_by)
  values (lead, 'visit', 'Visita recusada pelo WhatsApp: equipa propõe outra hora.', actor);
  return 'declined';
end $$;

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------

do $$ declare sig text; begin
  foreach sig in array array[
    'notification_job_block_reason(uuid,text,jsonb)',
    'wa_set_visit(uuid,uuid,text)'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
