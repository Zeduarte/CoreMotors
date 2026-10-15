-- Avisos por WhatsApp aos colaboradores do backoffice.
--
-- Até aqui, o que entrava no backoffice (um contacto do site, uma proposta de
-- preço, um testemunho por aprovar, uma viatura nova na oficina) só se via
-- abrindo o backoffice — ou, para os contactos, num webhook genérico (Slack,
-- Make…). A partir daqui, cada colaborador com telefone no perfil recebe uma
-- mensagem no WhatsApp sobre o que é da sua área.
--
-- Decisões que não se devem desfazer sem pensar:
--
--  * A fila é a que já existia (`notification_jobs`, 0013), com um canal novo.
--    Um aviso por WhatsApp é uma linha por PESSOA, e um índice único (aviso,
--    registo, pessoa) garante que o mesmo acontecimento nunca chega duas vezes
--    à mesma pessoa — mesmo que o gatilho volte a correr ou que dois processos
--    agendem ao mesmo tempo.
--  * Os avisos são agendados por gatilhos na base de dados, e não no código das
--    páginas: assim apanham também o que não passa pelos formulários do
--    backoffice — as viaturas criadas pelo assistente do WhatsApp, por exemplo.
--    E nunca bloqueiam: um erro a agendar é engolido (fica um WARNING no log da
--    base de dados) e o contacto do cliente grava-se na mesma.
--  * Quem recebe decide-se com as MESMAS regras do backoffice
--    (`has_section_for` e `has_vehicle_type_for`, da 0024): ninguém fica a saber
--    pelo WhatsApp de um contacto que não poderia abrir no backoffice. E volta a
--    verificar-se antes de enviar — quem perdeu o acesso entretanto não recebe.
--  * Quem fez a ação não é avisado dela própria.
--  * O canal começa DESLIGADO. A Meta só deixa a empresa iniciar conversas com
--    modelos aprovados (docs/WHATSAPP_TEMPLATES.md); até lá, cada envio falhava.
--    O administrador liga-o em Integrações depois de os modelos estarem
--    aprovados — e, desligado, nada se acumula na fila.
--  * Entrega «no máximo uma vez»: um envio cujo resultado não se sabe (a Meta
--    não respondeu a tempo) não é repetido automaticamente — pode ter chegado.
--    Fica no painel de Integrações para o administrador decidir.
--
-- O número 0037 já existia (memória das conversas do assistente) quando esta
-- foi escrita; as duas não se tocam.
begin;

-- ---------------------------------------------------------------------------
-- Catálogo dos avisos: a que separador pertence cada um
-- ---------------------------------------------------------------------------

-- Uma só cópia da regra em SQL. O TypeScript (src/lib/notification-events.ts)
-- tem os textos; um teste garante que os dois catálogos têm os mesmos avisos.
-- Fica executável por todos de propósito: é usada na verificação da tabela de
-- preferências, que corre com as permissões de quem grava.
create or replace function public.notification_event_section(ev text)
returns text language sql immutable set search_path = public as $$
  select case ev
    -- Contactos do site, um aviso por tipo de pedido.
    when 'lead_contact'        then 'leads'
    when 'lead_test_drive'     then 'leads'
    when 'lead_offer'          then 'leads'
    when 'lead_reservation'    then 'leads'
    when 'lead_trade_in'       then 'leads'
    when 'lead_order'          then 'leads'
    when 'lead_alert'          then 'leads'
    -- Uma reserva feita por um colega: quem vende tem de deixar de a oferecer.
    when 'vehicle_reserved'    then 'leads'
    when 'testimonial_pending' then 'testemunhos'
    when 'vehicle_workshop'    then 'oficina'
    when 'vehicle_created'     then 'carros'
    when 'vehicle_prepared'    then 'carros'
    when 'vehicle_published'   then 'carros'
    -- O acesso dado pela Meta dura 60 dias; sem ele, o WhatsApp todo pára.
    when 'whatsapp_expiring'   then 'integracoes'
    else null end;
$$;

-- ---------------------------------------------------------------------------
-- Interruptor geral (uma linha só)
-- ---------------------------------------------------------------------------

create table if not exists public.notification_settings (
  id               int primary key default 1 check (id = 1),
  whatsapp_enabled boolean not null default false,
  updated_by       uuid references public.profiles(id) on delete set null,
  updated_at       timestamptz not null default now()
);
insert into public.notification_settings (id) values (1) on conflict (id) do nothing;

alter table public.notification_settings enable row level security;
-- Qualquer colaborador vê se o canal está ligado (o perfil diz-lhe se vai
-- receber avisos); só o administrador o muda.
drop policy if exists "notification_settings: staff read" on public.notification_settings;
create policy "notification_settings: staff read" on public.notification_settings
  for select to authenticated using (public.is_staff());
drop policy if exists "notification_settings: admin write" on public.notification_settings;
create policy "notification_settings: admin write" on public.notification_settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke all on public.notification_settings from anon, authenticated;
grant select on public.notification_settings to authenticated;
grant update (whatsapp_enabled, updated_by, updated_at) on public.notification_settings to authenticated;
grant all on public.notification_settings to service_role;

-- ---------------------------------------------------------------------------
-- Preferências de cada pessoa
-- ---------------------------------------------------------------------------

-- Sem linha = ligado. Assim, quem nunca abriu o perfil recebe tudo, e um aviso
-- novo acrescentado mais tarde chega ligado a toda a gente, como os outros.
create table if not exists public.notification_preferences (
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event      text not null check (public.notification_event_section(event) is not null),
  enabled    boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (profile_id, event)
);

alter table public.notification_preferences enable row level security;
-- São pessoais: cada um vê e muda as suas, e mais ninguém (nem o administrador
-- desliga os avisos de outra pessoa).
drop policy if exists "notification_preferences: own" on public.notification_preferences;
create policy "notification_preferences: own" on public.notification_preferences
  for all to authenticated
  using (profile_id = auth.uid()) with check (profile_id = auth.uid());
revoke all on public.notification_preferences from anon, authenticated;
grant select, insert, update, delete on public.notification_preferences to authenticated;
grant all on public.notification_preferences to service_role;

-- ---------------------------------------------------------------------------
-- A fila de 0013 ganha o canal WhatsApp
-- ---------------------------------------------------------------------------

alter table public.notification_jobs
  add column if not exists channel       text not null default 'webhook',
  -- Só no WhatsApp: que aviso, sobre que registo, para quem.
  add column if not exists event         text,
  add column if not exists subject_id    uuid,
  add column if not exists recipient_id  uuid references public.profiles(id) on delete cascade,
  -- O que a mensagem diz, guardado no momento: o texto não muda se o registo
  -- for editado entretanto, e o envio não precisa de ler mais nada.
  add column if not exists payload       jsonb not null default '{}'::jsonb,
  -- Reclamado para envio. Fica preenchido enquanto não se sabe o resultado —
  -- é isso que impede o envio automático de repetir uma mensagem que pode ter
  -- chegado.
  add column if not exists claimed_at    timestamptz,
  -- Não enviado de propósito (a pessoa perdeu o acesso, já não é novidade…).
  -- O motivo fica em `last_error`.
  add column if not exists cancelled_at  timestamptz,
  -- O id da mensagem na Meta, para cruzar com o WhatsApp Manager.
  add column if not exists wa_message_id text;

-- Um aviso por WhatsApp sobre uma viatura não tem contacto associado.
alter table public.notification_jobs alter column lead_id drop not null;
-- O webhook continua a ter um envio por contacto; o WhatsApp tem um por pessoa.
alter table public.notification_jobs drop constraint if exists notification_jobs_lead_id_key;
create unique index if not exists notification_jobs_webhook_lead
  on public.notification_jobs (lead_id) where channel = 'webhook';
-- A garantia de «nunca duas vezes à mesma pessoa».
create unique index if not exists notification_jobs_whatsapp_once
  on public.notification_jobs (event, subject_id, recipient_id) where channel = 'whatsapp';
create index if not exists notification_jobs_whatsapp_recent
  on public.notification_jobs (created_at desc) where channel = 'whatsapp';

alter table public.notification_jobs drop constraint if exists notification_jobs_channel_check;
alter table public.notification_jobs add constraint notification_jobs_channel_check
  check (channel in ('webhook', 'whatsapp'));
alter table public.notification_jobs drop constraint if exists notification_jobs_shape;
alter table public.notification_jobs add constraint notification_jobs_shape check (
  (channel = 'webhook' and lead_id is not null) or
  (channel = 'whatsapp' and event is not null and subject_id is not null and recipient_id is not null));

-- O processamento do webhook (0013) passa a reclamar só os seus. Mesma
-- assinatura: os privilégios da 0013 mantêm-se.
create or replace function public.claim_notification_jobs() returns setof public.notification_jobs
language sql security definer set search_path = public as $$
 update public.notification_jobs set attempts = attempts + 1, next_attempt_at = now() + interval '2 minutes'
 where id in (select id from public.notification_jobs
               where channel = 'webhook' and delivered_at is null and attempts < 8 and next_attempt_at <= now()
               order by created_at limit 3 for update skip locked)
 returning *;
$$;

-- ---------------------------------------------------------------------------
-- Quem recebe
-- ---------------------------------------------------------------------------

-- Porque é que esta pessoa NÃO pode receber este aviso (nulo = pode). Serve ao
-- agendar e outra vez antes de enviar, e o texto vai para o painel.
create or replace function public.notification_block_reason(uid uuid, ev text, vtype text)
returns text language sql stable security definer set search_path = public as $$
  select case
    when public.notification_event_section(ev) is null then 'Aviso desconhecido'
    when p.id is null then 'O colaborador já não existe'
    -- O WhatsApp quer o número com indicativo: entre 9 e 15 algarismos.
    when length(coalesce(public.normalize_phone(p.phone), '')) not between 9 and 15
      then 'Sem telefone válido no perfil'
    when not public.has_section_for(p.id, public.notification_event_section(ev))
      then 'Sem acesso a este separador'
    when vtype is not null and not public.has_vehicle_type_for(p.id, vtype)
      then 'Sem acesso a este tipo de viatura'
    when exists (select 1 from public.notification_preferences np
                  where np.profile_id = p.id and np.event = ev and not np.enabled)
      then 'Aviso desligado no perfil'
    else null end
  from (select uid as id) alvo
  left join public.profiles p on p.id = alvo.id;
$$;

-- Toda a gente que pode receber, menos quem fez a ação. Dois perfis com o mesmo
-- telefone são o mesmo WhatsApp: recebe uma vez.
create or replace function public.notification_recipients(ev text, vtype text, actor uuid)
returns table (profile_id uuid, phone text)
language sql stable security definer set search_path = public as $$
  select distinct on (public.normalize_phone(p.phone)) p.id, public.normalize_phone(p.phone)
    from public.profiles p
   where p.id is distinct from actor
     and public.notification_block_reason(p.id, ev, vtype) is null
   order by public.normalize_phone(p.phone), p.created_at, p.id;
$$;

-- Agenda um aviso para todos os que o devem receber. `auth.uid()` é quem fez a
-- ação: o colaborador no backoffice, o do WhatsApp (assumido pelo wa_begin_as
-- da 0024), ou ninguém num formulário público.
create or replace function public.queue_whatsapp_event(
  ev text, subject uuid, vtype text, details jsonb, lead uuid default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not coalesce((select whatsapp_enabled from public.notification_settings where id = 1), false) then
    return 0;
  end if;
  if public.notification_event_section(ev) is null then
    raise exception 'Aviso desconhecido: %', ev;
  end if;
  insert into public.notification_jobs (channel, event, subject_id, recipient_id, lead_id, payload)
  select 'whatsapp', ev, subject, r.profile_id, lead,
         coalesce(details, '{}'::jsonb) || jsonb_build_object('vehicle_type', vtype)
    from public.notification_recipients(ev, vtype, auth.uid()) r
  on conflict (event, subject_id, recipient_id) where channel = 'whatsapp' do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Os gatilhos. Todos engolem os próprios erros: avisar é acessório, gravar não.
-- ---------------------------------------------------------------------------

-- Contactos do site, de qualquer tipo. O tipo de viatura já foi preenchido pelo
-- gatilho `leads_vehicle_type` (0019), que corre antes.
create or replace function public.notify_lead_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
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
drop trigger if exists notify_whatsapp on public.leads;
create trigger notify_whatsapp after insert on public.leads
  for each row execute function public.notify_lead_whatsapp();

-- Testemunho enviado pelo site: entra por aprovar. Os criados no backoffice já
-- vêm aprovados e não precisam de aviso.
create or replace function public.notify_testimonial_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  perform public.queue_whatsapp_event('testimonial_pending', new.id, null,
    jsonb_build_object('name', new.name, 'rating', new.rating));
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (testemunho %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp on public.testimonials;
create trigger notify_whatsapp after insert on public.testimonials
  for each row when (not new.published) execute function public.notify_testimonial_whatsapp();

-- Viaturas: entrada na oficina (incluindo as do assistente do WhatsApp),
-- criação em Viaturas, preparada pela oficina, e a PRIMEIRA publicação.
-- `published_at` só é preenchido uma vez (0001), por isso uma viatura que sai de
-- reservada e volta a publicada não avisa outra vez.
create or replace function public.notify_car_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev text;
begin
  if tg_op = 'INSERT' then
    ev := case
      -- Criada já publicada: um aviso só, o que interessa.
      when new.published_at is not null then 'vehicle_published'
      when new.status = 'workshop' then 'vehicle_workshop'
      else 'vehicle_created' end;
  elsif new.published_at is not null and old.published_at is null then
    ev := 'vehicle_published';
  elsif new.status = 'prepared' and old.status = 'workshop' then
    ev := 'vehicle_prepared';
  else
    return null;
  end if;
  perform public.queue_whatsapp_event(ev, new.id, new.vehicle_type,
    jsonb_build_object(
      'make', new.make, 'model', new.model, 'variant', new.variant,
      'plate', new.license_plate, 'year', new.year));
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (viatura %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp on public.cars;
create trigger notify_whatsapp after insert or update of status, published_at on public.cars
  for each row execute function public.notify_car_whatsapp();

-- Reserva confirmada no backoffice. O registo é a reserva (e não a viatura):
-- a mesma viatura pode voltar a ser reservada mais tarde, e isso é novidade.
create or replace function public.notify_reservation_whatsapp() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record;
begin
  select make, model, variant, license_plate, vehicle_type into c
    from public.cars where id = new.car_id;
  perform public.queue_whatsapp_event('vehicle_reserved', new.id, c.vehicle_type,
    jsonb_build_object(
      'make', c.make, 'model', c.model, 'variant', c.variant, 'plate', c.license_plate,
      'car_id', new.car_id, 'lead_id', new.lead_id,
      'expires_at', new.expires_at, 'deposit', new.deposit_amount));
  return null;
exception when others then
  raise warning 'Aviso por WhatsApp não agendado (reserva %): %', new.id, sqlerrm;
  return null;
end $$;
drop trigger if exists notify_whatsapp on public.reservations;
create trigger notify_whatsapp after insert on public.reservations
  for each row execute function public.notify_reservation_whatsapp();

-- O acesso do número à Meta expira (60 dias, 0035). Avisa-se uma vez na última
-- semana; o registo é a própria data de expiração, por isso voltar a ligar o
-- número (data nova) volta a poder avisar daqui a 60 dias.
create or replace function public.queue_whatsapp_expiry_warning() returns int
language plpgsql security definer set search_path = public as $$
declare expira timestamptz;
begin
  select token_expires_at into expira from public.whatsapp_connection where id = 1;
  if expira is null or expira <= now() or expira > now() + interval '7 days' then
    return 0;
  end if;
  return public.queue_whatsapp_event('whatsapp_expiring',
    md5('whatsapp_expiring:' || expira::text)::uuid, null,
    jsonb_build_object('expires_at', expira));
end $$;

-- ---------------------------------------------------------------------------
-- Envio: reclamar e registar o resultado
-- ---------------------------------------------------------------------------

create or replace function public.claim_whatsapp_notifications(batch int default 10)
returns table (job_id uuid, event_kind text, subject uuid, details jsonb, attempt int, to_phone text)
language plpgsql security definer set search_path = public as $$
begin
  -- 1. Já não é novidade: um aviso que esperou mais de um dia sem ser tentado
  --    (o número não estava ligado, a manutenção parou…) não se envia — senão,
  --    ao ligar o número, chegava de uma vez tudo o que se acumulou.
  update public.notification_jobs j
     set cancelled_at = now(), last_error = 'Expirou sem ser enviado (mais de 24 horas à espera)'
   where j.channel = 'whatsapp' and j.delivered_at is null and j.cancelled_at is null
     and j.claimed_at is null and j.next_attempt_at < now() - interval '24 hours';

  -- 2. Quem deixou de poder receber desde que o aviso foi agendado: perdeu o
  --    acesso, tirou o telefone, desligou o aviso.
  update public.notification_jobs j
     set cancelled_at = now(),
         last_error = public.notification_block_reason(j.recipient_id, j.event, j.payload ->> 'vehicle_type')
   where j.channel = 'whatsapp' and j.delivered_at is null and j.cancelled_at is null
     and j.claimed_at is null and j.attempts < 8
     and public.notification_block_reason(j.recipient_id, j.event, j.payload ->> 'vehicle_type') is not null;

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

-- O resultado de um envio:
--   sent       → entregue à Meta.
--   failed     → a Meta recusou; volta a tentar mais tarde (até 8 vezes).
--   permanent  → repetir não adianta (modelo inexistente, número sem WhatsApp…):
--                fica à espera do administrador.
--   uncertain  → não se sabe se chegou. Fica reclamado, com o motivo, e o envio
--                automático não lhe volta a tocar.
--   skipped    → não se enviou de propósito.
create or replace function public.finish_whatsapp_notification(
  job uuid, outcome text, detail text default null, message_id text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if outcome = 'sent' then
    update public.notification_jobs
       set delivered_at = now(), claimed_at = null, last_error = null, wa_message_id = left(message_id, 200)
     where id = job and channel = 'whatsapp';
  elsif outcome = 'failed' then
    update public.notification_jobs
       set claimed_at = null, last_error = left(coalesce(detail, 'Falha no envio'), 300),
           next_attempt_at = now() + make_interval(secs => least(3600, 30 * power(2, attempts)))
     where id = job and channel = 'whatsapp' and delivered_at is null;
  elsif outcome = 'permanent' then
    update public.notification_jobs
       set claimed_at = null, attempts = greatest(attempts, 8),
           last_error = left(coalesce(detail, 'Falha no envio'), 300)
     where id = job and channel = 'whatsapp' and delivered_at is null;
  elsif outcome = 'uncertain' then
    update public.notification_jobs
       set last_error = left(coalesce(detail, 'Sem resposta da Meta'), 300)
     where id = job and channel = 'whatsapp' and delivered_at is null;
  elsif outcome = 'skipped' then
    update public.notification_jobs
       set claimed_at = null, cancelled_at = now(), last_error = left(coalesce(detail, 'Não enviado'), 300)
     where id = job and channel = 'whatsapp' and delivered_at is null;
  else
    raise exception 'Resultado inválido: %', outcome;
  end if;
end $$;

-- O histórico do painel chega para um mês; o resto é ruído.
create or replace function public.prune_notification_jobs() returns void
language sql security definer set search_path = public as $$
  delete from public.notification_jobs
   where channel = 'whatsapp' and created_at < now() - interval '30 days';
$$;

-- Só o servidor. O bloco faz o revoke e o grant juntos, para não se poder
-- acrescentar uma função e esquecer o revoke. As funções de gatilho não
-- precisam de ser executáveis por ninguém: o Postgres não o verifica ao
-- disparar.
do $$ declare sig text; begin
  foreach sig in array array[
    'notification_block_reason(uuid,text,text)',
    'notification_recipients(text,text,uuid)',
    'queue_whatsapp_event(text,uuid,text,jsonb,uuid)',
    'queue_whatsapp_expiry_warning()',
    'claim_whatsapp_notifications(int)',
    'finish_whatsapp_notification(uuid,text,text,text)',
    'prune_notification_jobs()',
    'notify_lead_whatsapp()',
    'notify_testimonial_whatsapp()',
    'notify_car_whatsapp()',
    'notify_reservation_whatsapp()'
  ] loop
    execute 'revoke all on function public.' || sig || ' from public, anon, authenticated';
    execute 'grant execute on function public.' || sig || ' to service_role';
  end loop;
end $$;

commit;
