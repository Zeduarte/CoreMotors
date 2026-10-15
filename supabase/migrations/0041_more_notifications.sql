-- Mais avisos por WhatsApp à equipa: férias, contactos atribuídos, vendas,
-- reservas que terminam, preços que mudam e viaturas que saem da oficina.
--
-- A 0036 avisava do que ENTRA no backoffice (contactos do site, testemunhos,
-- viaturas novas). Faltava o que acontece depois — e o que mais pesa no dia a
-- dia de um stand: «a mota saiu da oficina e está pronta», «tens um contacto
-- novo atribuído», «o João vai de férias na semana que vem».
--
-- Tudo o que a 0036 garante continua a valer, e pelos mesmos caminhos:
--
--  * Os avisos agendam-se em gatilhos e nunca bloqueiam a gravação (um erro é
--    engolido, com um WARNING no log).
--  * O índice único (aviso, registo, pessoa) impede repetições. Nos avisos
--    sobre uma MUDANÇA (uma viatura que sai da oficina, um contacto atribuído),
--    o «registo» é a mudança — `notification_subject`, um id por aviso, registo
--    e transação: a mesma mota pode sair da oficina duas vezes, e as duas são
--    novidade; o mesmo gatilho a correr duas vezes na mesma transação não é.
--  * Quem recebe decide-se com as permissões do backoffice e volta a verificar-se
--    antes de enviar — agora com o conteúdo do aviso
--    (`notification_job_block_reason`): o pedido de férias já decidido, o
--    contacto entretanto atribuído a outro, as férias desmarcadas já não se
--    enviam.
--  * Quem fez a ação não é avisado; com o interruptor geral desligado, nada
--    entra na fila; a limpeza dos 30 dias (0036) apanha tudo.
--
-- Avisos novos, quem os recebe e se vêm ligados por defeito (sem linha em
-- `notification_preferences` vale `notification_event_default`):
--
--   lead_assigned          Leads    o responsável a quem o contacto foi atribuído  ligado
--   lead_outcome           Leads    o responsável, quando outro dá o contacto
--                                   como ganho ou perdido                           ligado
--   vehicle_sold           Leads    quem vende (Leads + tipo de viatura): deixa de
--                                   a oferecer, como na reserva (0036)              ligado
--   reservation_ended      Leads    quem vende: a reserva foi cancelada ou expirou
--                                   e a viatura voltou a estar disponível           ligado
--   vehicle_price_changed  Viaturas quem tem Viaturas, quando muda o preço de uma
--                                   viatura publicada ou reservada                  DESLIGADO
--   leave_requested        Férias   quem pode decidir as férias do colaborador
--                                   (a hierarquia da 0022)                          ligado
--   leave_decided          Férias   quem pediu, quando o pedido é aprovado ou
--                                   recusado                                        ligado
--   leave_upcoming         Férias   toda a equipa (quem vê «Férias colegas»), menos
--                                   o próprio: as férias aprovadas de um colega
--                                   começam nos próximos 7 dias                     ligado
--
-- E o `vehicle_prepared` da 0036 passa a disparar sempre que uma viatura SAI da
-- oficina (para preparada, rascunho ou, já publicada antes, de volta ao site),
-- e não só da primeira vez: antes, o registo era a viatura, e uma mota que
-- voltava à oficina e saía outra vez já não avisava ninguém.
--
-- «Férias» não é um separador do backoffice: é a área pessoal, que toda a gente
-- tem (o próprio mecânico). Fica no catálogo como 'perfil'.
--
-- Os textos vão nos quatro modelos que já existem (docs/WHATSAPP_TEMPLATES.md):
-- nenhum stand tem de pedir à Meta um modelo novo.
--
-- Os números 0039 e 0040 são de outro trabalho (o assistente do WhatsApp); esta
-- não lhes toca.
begin;

-- ---------------------------------------------------------------------------
-- Catálogo
-- ---------------------------------------------------------------------------

-- A mesma função da 0036, com os avisos novos. O TypeScript
-- (src/lib/notification-events.ts) tem os textos; um teste garante que os dois
-- catálogos têm os mesmos avisos, no mesmo separador.
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

-- Ligado ou desligado para quem nunca mexeu nas escolhas do perfil. Só o que
-- pode chegar aos montes sem pedir ação começa desligado.
create or replace function public.notification_event_default(ev text)
returns boolean language sql immutable set search_path = public as $$
  select ev is distinct from 'vehicle_price_changed';
$$;

-- ---------------------------------------------------------------------------
-- A hierarquia das férias (0022), com o id explícito
-- ---------------------------------------------------------------------------

-- A regra da 0022, parametrizada por quem decide — para saber quem avisar de um
-- pedido sem depender de `auth.uid()`. `can_decide_leave_for` passa a invólucro,
-- como o `has_section` da 0024: a regra continua a existir numa só cópia.
create or replace function public.can_decide_leave_as(approver uuid, target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    -- O administrador está no topo: decide tudo, incluindo o seu próprio plano.
    when (select role::text from public.profiles where id = approver) = 'admin'
      then true
    -- O chefe decide quem está abaixo dele, nunca um par nem um superior.
    when (select role::text from public.profiles where id = approver) = 'chefe'
      then coalesce((select role::text from public.profiles where id = target)
                    in ('vendedor', 'mecanico'), false)
    else false
  end;
$$;

create or replace function public.can_decide_leave_for(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.can_decide_leave_as(auth.uid(), target);
$$;

-- ---------------------------------------------------------------------------
-- Dias em que não se trabalha (para juntar os dias de férias num período)
-- ---------------------------------------------------------------------------

-- Domingo de Páscoa (Meeus/Jones/Butcher), como `easterSunday` em src/lib/leave.ts.
create or replace function public.easter_sunday(y int)
returns date language plpgsql immutable set search_path = public as $$
declare a int; b int; c int; d int; e int; f int; g int; h int; i int; k int; l int; m int;
begin
  a := y % 19; b := y / 100; c := y % 100; d := b / 4; e := b % 4;
  f := (b + 8) / 25; g := (b - f + 1) / 3;
  h := (19 * a + b - d - g + 15) % 30;
  i := c / 4; k := c % 4;
  l := (32 + 2 * e + 2 * i - h - k) % 7;
  m := (a + 11 * h + 22 * l) / 451;
  return make_date(y, (h + l - 7 * m + 114) / 31, ((h + l - 7 * m + 114) % 31) + 1);
end $$;

-- Fim de semana, feriado nacional (os de `nationalHolidays`) ou dia definido
-- pelo stand (feriado municipal, tolerância, fecho obrigatório). Umas férias de
-- quinta a terça, com o fim de semana pelo meio, são UM período; com um dia de
-- trabalho pelo meio, são dois.
create or replace function public.is_day_off(d date)
returns boolean language sql stable security definer set search_path = public as $$
  select extract(isodow from d) >= 6
      or to_char(d, 'MM-DD') in ('01-01', '04-25', '05-01', '06-10', '08-15',
                                 '10-05', '11-01', '12-01', '12-08', '12-25')
      or d in (public.easter_sunday(extract(year from d)::int) - 2,
               public.easter_sunday(extract(year from d)::int),
               public.easter_sunday(extract(year from d)::int) + 60)
      or exists (select 1 from public.company_days cd where cd.day = d);
$$;

-- ---------------------------------------------------------------------------
-- Quem recebe
-- ---------------------------------------------------------------------------

-- A da 0036, com duas mudanças: os avisos de «perfil» não dependem de um
-- separador (toda a gente tem perfil), e quem nunca escolheu fica com o valor
-- por defeito do aviso — que, para os da 0036, continua a ser «ligado».
create or replace function public.notification_block_reason(uid uuid, ev text, vtype text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.notification_event_section(ev) is null then 'Aviso desconhecido'
    when p.id is null then 'O colaborador já não existe'
    -- O WhatsApp quer o número com indicativo: entre 9 e 15 algarismos.
    when length(coalesce(public.normalize_phone(p.phone), '')) not between 9 and 15
      then 'Sem telefone válido no perfil'
    when public.notification_event_section(ev) <> 'perfil'
         and not public.has_section_for(p.id, public.notification_event_section(ev))
      then 'Sem acesso a este separador'
    when vtype is not null and not public.has_vehicle_type_for(p.id, vtype)
      then 'Sem acesso a este tipo de viatura'
    when not coalesce((select np.enabled from public.notification_preferences np
                        where np.profile_id = p.id and np.event = ev),
                      public.notification_event_default(ev))
      then 'Aviso desligado no perfil'
    else null end
  from (select uid as id) alvo
  left join public.profiles p on p.id = alvo.id;
$$;

-- O mesmo, mais o que depende do conteúdo do aviso. É esta que decide antes de
-- enviar: entre agendar e enviar, o pedido de férias pode ter sido decidido, o
-- contacto atribuído a outra pessoa, as férias desmarcadas.
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

-- O registo de um aviso sobre uma MUDANÇA: um id por aviso, registo e
-- transação. A mesma transação dá sempre o mesmo id (o índice único trava a
-- repetição); outra transação, outra mudança, outro aviso.
create or replace function public.notification_subject(ev text, rec uuid)
returns uuid language sql volatile set search_path = public as $$
  select md5(ev || ':' || rec::text || ':' || txid_current()::text)::uuid;
$$;

-- Agenda um aviso para um grupo escolhido de pessoas (o responsável do
-- contacto, quem decide as férias…), em vez de para todos os que têm o
-- separador. As mesmas regras de `queue_whatsapp_event` (0036): interruptor,
-- autor de fora, um telefone recebe uma vez, nunca duas vezes o mesmo aviso.
create or replace function public.queue_whatsapp_notice(
  ev text, subject uuid, vtype text, details jsonb, lead uuid, candidates uuid[])
returns int language plpgsql security definer set search_path = public as $$
declare n int; carga jsonb;
begin
  if not coalesce((select whatsapp_enabled from public.notification_settings where id = 1), false) then
    return 0;
  end if;
  if public.notification_event_section(ev) is null then
    raise exception 'Aviso desconhecido: %', ev;
  end if;
  carga := coalesce(details, '{}'::jsonb) || jsonb_build_object('vehicle_type', vtype);
  insert into public.notification_jobs (channel, event, subject_id, recipient_id, lead_id, payload)
  select distinct on (public.normalize_phone(p.phone)) 'whatsapp', ev, subject, p.id, lead, carga
    from public.profiles p
   where p.id = any(coalesce(candidates, '{}'::uuid[]))
     and p.id is distinct from auth.uid()
     and public.notification_job_block_reason(p.id, ev, carga) is null
   order by public.normalize_phone(p.phone), p.created_at, p.id
  on conflict (event, subject_id, recipient_id) where channel = 'whatsapp' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Viaturas: sai da oficina, vendida, preço alterado
-- ---------------------------------------------------------------------------

-- Substitui a da 0036. O que já existia fica igual (criada, na oficina,
-- publicada pela primeira vez). Muda o «preparada»: dispara sempre que a
-- viatura sai da oficina, seja pelo botão da Oficina, seja mudando o estado na
-- ficha — e uma vez por saída. Uma viatura que sai da oficina diretamente para
-- o site pela primeira vez dá só o aviso de publicada, o que interessa.
create or replace function public.notify_car_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text; det jsonb;
begin
  det := jsonb_build_object(
    'make', new.make, 'model', new.model, 'variant', new.variant,
    'plate', new.license_plate, 'year', new.year, 'car_id', new.id);
  if tg_op = 'INSERT' then
    ev := case
      -- Criada já publicada: um aviso só, o que interessa.
      when new.published_at is not null then 'vehicle_published'
      when new.status = 'workshop' then 'vehicle_workshop'
      else 'vehicle_created' end;
    perform public.queue_whatsapp_event(ev, new.id, new.vehicle_type, det);
    return null;
  end if;

  if new.published_at is not null and old.published_at is null then
    perform public.queue_whatsapp_event('vehicle_published', new.id, new.vehicle_type, det);
  elsif old.status = 'workshop' and new.status <> 'workshop' then
    perform public.queue_whatsapp_event('vehicle_prepared',
      public.notification_subject('vehicle_prepared', new.id), new.vehicle_type,
      det || jsonb_build_object('status', new.status));
  end if;

  if new.status = 'sold' and old.status is distinct from 'sold' then
    perform public.queue_whatsapp_event('vehicle_sold',
      public.notification_subject('vehicle_sold', new.id), new.vehicle_type, det);
  end if;

  -- Só o preço de uma viatura à venda, e só quando o estado não muda na mesma
  -- gravação (publicar ou vender já têm o seu aviso).
  if new.status = old.status and new.status in ('published', 'reserved')
     and (new.price is distinct from old.price or new.price_on_request is distinct from old.price_on_request) then
    perform public.queue_whatsapp_event('vehicle_price_changed',
      public.notification_subject('vehicle_price_changed', new.id), new.vehicle_type,
      det || jsonb_build_object(
        'old_price', case when old.price_on_request then null else old.price end,
        'new_price', case when new.price_on_request then null else new.price end));
  end if;
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (viatura %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp on public.cars;
create trigger notify_whatsapp after insert or update of status, published_at, price, price_on_request
  on public.cars for each row execute function public.notify_car_whatsapp();

-- ---------------------------------------------------------------------------
-- Reserva cancelada ou expirada: a viatura volta a estar disponível
-- ---------------------------------------------------------------------------

-- O registo é a reserva, que só termina uma vez. A expiração corre na
-- manutenção, sem autor: avisa toda a equipa comercial.
create or replace function public.notify_reservation_end_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; cliente text;
begin
  select make, model, variant, license_plate, vehicle_type into c
    from public.cars where id = new.car_id;
  select name into cliente from public.leads where id = new.lead_id;
  perform public.queue_whatsapp_event('reservation_ended', new.id, c.vehicle_type,
    jsonb_build_object(
      'make', c.make, 'model', c.model, 'variant', c.variant, 'plate', c.license_plate,
      'car_id', new.car_id, 'lead_id', new.lead_id, 'outcome', new.status, 'customer', cliente));
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (reserva %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp_end on public.reservations;
create trigger notify_whatsapp_end after update of status on public.reservations
  for each row when (old.status = 'active' and new.status in ('cancelled', 'expired'))
  execute function public.notify_reservation_end_whatsapp();

-- ---------------------------------------------------------------------------
-- Contactos: atribuído a alguém, ganho ou perdido
-- ---------------------------------------------------------------------------

-- Só para o responsável. «Atribuído» é um aviso à parte dos contactos novos:
-- quem desligou os contactos do site continua a saber o que lhe atribuem.
create or replace function public.notify_lead_followup_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare det jsonb;
begin
  det := jsonb_build_object(
    'kind', new.kind, 'name', new.name, 'car_label', new.car_label,
    'offer_amount', new.car_details -> 'offer_amount', 'deposit', new.car_details -> 'deposit',
    'lead_id', new.id);
  if new.assigned_to is not null
     and (tg_op = 'INSERT' or new.assigned_to is distinct from old.assigned_to) then
    perform public.queue_whatsapp_notice('lead_assigned',
      public.notification_subject('lead_assigned', new.id), new.vehicle_type, det, new.id,
      array[new.assigned_to]);
  end if;
  if tg_op = 'UPDATE' and new.assigned_to is not null
     and new.status::text in ('won', 'lost') and new.status is distinct from old.status then
    perform public.queue_whatsapp_notice('lead_outcome',
      public.notification_subject('lead_outcome', new.id), new.vehicle_type,
      det || jsonb_build_object('status', new.status, 'loss_reason', new.loss_reason), new.id,
      array[new.assigned_to]);
  end if;
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (contacto %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp_followup on public.leads;
create trigger notify_whatsapp_followup after insert or update of assigned_to, status on public.leads
  for each row execute function public.notify_lead_followup_whatsapp();

-- ---------------------------------------------------------------------------
-- Férias: pedido, decisão
-- ---------------------------------------------------------------------------

-- Um pedido é o que a pessoa submete de uma vez (vários dias, uma gravação):
-- os gatilhos são por instrução, e não por linha — dez dias pedidos são UM
-- aviso para quem decide, com o período todo.
create or replace function public.queue_whatsapp_leave_request(requester uuid)
returns int language plpgsql security definer set search_path = public as $$
declare r record;
begin
  -- Os dias pendentes que esta transação gravou (`updated_at` é o `now()` dela).
  select min(d.day) inicio, max(d.day) fim, sum(case when d.half then 0.5 else 1 end) dias
    into r
    from public.leave_days d
   where d.profile_id = requester and d.status = 'pending' and d.updated_at = now();
  if r.inicio is null then return 0; end if;
  return public.queue_whatsapp_notice('leave_requested',
    public.notification_subject('leave_requested', requester), null,
    jsonb_build_object(
      'profile_id', requester,
      'name', (select coalesce(nullif(p.full_name, ''), p.email, 'Colaborador') from public.profiles p where p.id = requester),
      'start', r.inicio, 'end', r.fim, 'days', r.dias),
    null,
    array(select p.id from public.profiles p
           where p.id <> requester and public.can_decide_leave_as(p.id, requester)));
end $$;

create or replace function public.notify_leave_insert_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare pessoa uuid;
begin
  for pessoa in select distinct profile_id from novos where status = 'pending' loop
    perform public.queue_whatsapp_leave_request(pessoa);
  end loop;
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (pedido de férias): %', sqlerrm;
  return null;
end $$;

create or replace function public.notify_leave_update_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare pessoa uuid; r record;
begin
  -- Um rascunho (ou um dia recusado) que passa a pedido.
  for pessoa in
    select distinct d.profile_id from depois d join antes a on a.id = d.id
     where d.status = 'pending' and a.status <> 'pending'
  loop
    perform public.queue_whatsapp_leave_request(pessoa);
  end loop;

  -- Uma decisão: aprovado ou recusado, avisa quem pediu.
  for r in
    select d.profile_id, d.status, min(d.day) inicio, max(d.day) fim,
           sum(case when d.half then 0.5 else 1 end) dias
      from depois d join antes a on a.id = d.id
     where a.status = 'pending' and d.status in ('approved', 'rejected')
     group by d.profile_id, d.status
  loop
    perform public.queue_whatsapp_notice('leave_decided',
      public.notification_subject('leave_decided:' || r.status, r.profile_id), null,
      jsonb_build_object(
        'profile_id', r.profile_id, 'decision', r.status,
        'start', r.inicio, 'end', r.fim, 'days', r.dias,
        'decided_by', (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = auth.uid())),
      null, array[r.profile_id]);
  end loop;
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (férias): %', sqlerrm;
  return null;
end $$;

-- Com tabelas de transição, um gatilho só pode ser de um tipo de operação: um
-- para as inserções, outro para as alterações. Um `upsert` (marcar dias) dispara
-- os dois; o registo é o mesmo (mesma pessoa, mesma transação), e sai um aviso.
drop trigger if exists notify_whatsapp_insert on public.leave_days;
create trigger notify_whatsapp_insert after insert on public.leave_days
  referencing new table as novos
  for each statement execute function public.notify_leave_insert_whatsapp();
drop trigger if exists notify_whatsapp_update on public.leave_days;
create trigger notify_whatsapp_update after update on public.leave_days
  referencing old table as antes new table as depois
  for each statement execute function public.notify_leave_update_whatsapp();

-- ---------------------------------------------------------------------------
-- Férias: um colega vai de férias nos próximos 7 dias
-- ---------------------------------------------------------------------------

-- Corre na manutenção (e a seguir às ações, com o envio). Um período são dias
-- aprovados seguidos, contando que fins de semana e feriados pelo meio não o
-- partem; avisa-se uma vez por período (o registo é a pessoa e o primeiro dia),
-- quando esse primeiro dia fica a 7 dias ou menos. Só férias APROVADAS: um
-- pedido ainda pode ser recusado.
--
-- Datas de Lisboa. Só entre as 9h e as 20h: a manutenção corre de noite, e uma
-- mensagem destas às três da manhã é ruído — sai às 9h.
create or replace function public.queue_whatsapp_leave_upcoming(agora timestamptz default now())
returns int language plpgsql security definer set search_path = public as $$
declare
  hora_local timestamp := agora at time zone 'Europe/Lisbon';
  hoje date := hora_local::date;
  r record;
  n int := 0;
begin
  if not coalesce((select whatsapp_enabled from public.notification_settings where id = 1), false) then
    return 0;
  end if;
  if extract(hour from hora_local) < 9 or extract(hour from hora_local) >= 20 then return 0; end if;

  for r in
    with dias as (
      select d.profile_id, d.day, d.half,
             lag(d.day) over (partition by d.profile_id order by d.day) as anterior
        from public.leave_days d
       -- Para trás chega para saber se o dia continua um período (pontes de
       -- poucos dias); para a frente, para saber até quando vai.
       where d.status = 'approved' and d.day between hoje - 14 and hoje + 120
    ), marcados as (
      select profile_id, day, half,
             (anterior is null or exists (
               select 1 from generate_series((anterior + 1)::timestamp, (day - 1)::timestamp, interval '1 day') g
                where not public.is_day_off(g::date))) as novo
        from dias
    ), periodos as (
      select profile_id, day, half,
             sum(case when novo then 1 else 0 end) over (partition by profile_id order by day) as grupo
        from marcados
    )
    select pr.profile_id, min(pr.day) inicio, max(pr.day) fim,
           sum(case when pr.half then 0.5 else 1 end) total
      from periodos pr
     group by pr.profile_id, pr.grupo
    having min(pr.day) between hoje + 1 and hoje + 7
  loop
    n := n + public.queue_whatsapp_notice('leave_upcoming',
      md5('leave_upcoming:' || r.profile_id::text || ':' || r.inicio::text)::uuid, null,
      jsonb_build_object(
        'profile_id', r.profile_id,
        'name', (select coalesce(nullif(p.full_name, ''), p.email, 'Colaborador') from public.profiles p where p.id = r.profile_id),
        'start', r.inicio, 'end', r.fim, 'days', r.total),
      null,
      -- Quem vê «Férias colegas»: toda a equipa, menos o próprio.
      array(select p.id from public.profiles p where p.id <> r.profile_id));
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- O envio volta a verificar com o conteúdo do aviso
-- ---------------------------------------------------------------------------

-- Igual à 0036, salvo o passo 2, que passa a usar `notification_job_block_reason`.
create or replace function public.claim_whatsapp_notifications(batch int default 10)
returns table (job_id uuid, event_kind text, subject uuid, details jsonb, attempt int, to_phone text)
language plpgsql security definer set search_path = public as $$
begin
  -- 1. Já não é novidade: um aviso que esperou mais de um dia sem ser tentado
  --    não se envia — senão, ao ligar o número, chegava tudo de uma vez.
  update public.notification_jobs j
     set cancelled_at = now(), last_error = 'Expirou sem ser enviado (mais de 24 horas à espera)'
   where j.channel = 'whatsapp' and j.delivered_at is null and j.cancelled_at is null
     and j.claimed_at is null and j.next_attempt_at < now() - interval '24 hours';

  -- 2. Quem deixou de poder receber desde que o aviso foi agendado: perdeu o
  --    acesso, tirou o telefone, desligou o aviso — ou o aviso deixou de ser
  --    verdade (pedido decidido, contacto reatribuído, férias desmarcadas).
  update public.notification_jobs j
     set cancelled_at = now(),
         last_error = public.notification_job_block_reason(j.recipient_id, j.event, j.payload)
   where j.channel = 'whatsapp' and j.delivered_at is null and j.cancelled_at is null
     and j.claimed_at is null and j.attempts < 8
     and public.notification_job_block_reason(j.recipient_id, j.event, j.payload) is not null;

  -- 3. Os próximos, por ordem. Os do mesmo instante ficam juntos por pessoa e
  --    aviso, para o envio poder juntar «12 viaturas publicadas» numa mensagem.
  return query
  with escolhidos as (
    select q.id from public.notification_jobs q
     where q.channel = 'whatsapp' and q.delivered_at is null and q.cancelled_at is null
       and q.claimed_at is null and q.attempts < 8 and q.next_attempt_at <= now()
     order by q.created_at, q.recipient_id, q.event
     limit greatest(1, least(coalesce(batch, 10), 50))
     for update skip locked
  ), reclamados as (
    update public.notification_jobs j
       set attempts = j.attempts + 1, claimed_at = now()
      from escolhidos e
     where j.id = e.id
    returning j.id, j.event, j.subject_id, j.payload, j.attempts, j.recipient_id, j.created_at
  )
  select r.id, r.event, r.subject_id, r.payload, r.attempts,
         (select public.normalize_phone(p.phone) from public.profiles p where p.id = r.recipient_id)
    from reclamados r
   order by r.created_at, r.recipient_id, r.event;
end $$;

-- ---------------------------------------------------------------------------
-- Privilégios
-- ---------------------------------------------------------------------------

-- Só o servidor, como na 0036 (revoke e grant juntos). `notification_event_default`
-- fica executável por todos, como `notification_event_section`: é catálogo, e
-- o perfil pode precisar dele. `can_decide_leave_for` mantém os privilégios da
-- 0022 (create or replace não os muda). As funções de gatilho não precisam de
-- ser executáveis por ninguém.
do $$ declare sig text; begin
  foreach sig in array array[
    'can_decide_leave_as(uuid,uuid)',
    'easter_sunday(int)',
    'is_day_off(date)',
    'notification_job_block_reason(uuid,text,jsonb)',
    'notification_subject(text,uuid)',
    'queue_whatsapp_notice(text,uuid,text,jsonb,uuid,uuid[])',
    'queue_whatsapp_leave_request(uuid)',
    'queue_whatsapp_leave_upcoming(timestamptz)',
    'notify_reservation_end_whatsapp()',
    'notify_lead_followup_whatsapp()',
    'notify_leave_insert_whatsapp()',
    'notify_leave_update_whatsapp()'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
